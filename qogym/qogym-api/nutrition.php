<?php
require_once 'config.php';

// ----------------------------------------------------------------------------
// nutrition.php
//
// Endpoints :
//   - GET  ?action=library                  → liste des items perso
//   - POST ?action=library  (item dans body) → crée un item
//   - PUT  ?action=library&id=N             → modifie un item
//   - DELETE ?action=library&id=N            → supprime un item
//
//   - GET  ?action=entries&date=YYYY-MM-DD  → entrées d'un jour + agrégats
//   - POST ?action=entries  (entry dans body) → ajoute une consommation
//   - PUT  ?action=entries&id=N              → modifie quantité d'une entrée
//                                              OU la déplace : body { meal_id: N|null }
//                                              (null = sortir du repas)
//   - DELETE ?action=entries&id=N            → supprime une entrée
//
//   - POST   ?action=meals  {date}           → crée un repas vide pour ce jour
//   - DELETE ?action=meals&id=N              → supprime le repas ET ses aliments
//   Un repas ("Repas 1", "Repas 2"...) regroupe des entrées d'une même journée
//   via qogym_food_entries.meal_id. Le numéro n'est pas stocké : il est
//   calculé à l'affichage (ordre de création dans la journée). Les entrées
//   sans meal_id restent des aliments "à l'unité" comme avant.
//   Migration SQL : nutrition_meals_migration.sql
//
// Aucune statistique persistée : les agrégats sont recalculés à chaque
// chargement à partir de qogym_food_entries.
//
// Support des unités (mai 2026) :
//   Un aliment peut être défini "à l'unité" (ex: 1 pomme = 180g, 1 oeuf = 60g)
//   en passant unit_label + grams_per_unit. Si ces deux champs sont NULL ou
//   vides, l'aliment fonctionne en grammes comme avant. Côté entrée, on stocke
//   toujours quantity_g (utile pour les calculs) mais on stocke aussi
//   quantity_units quand l'utilisateur a saisi en unités, pour réafficher
//   "2 pommes" au lieu de "360g".
// ----------------------------------------------------------------------------

$user   = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$pdo    = getDB();

$action = $_GET['action'] ?? null;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Cast/sanitize les champs numériques nutritionnels d'une payload. */
function readNutritionFields(array $src)
{
    // Lecture du couple unité (peuvent être NULL → aliment en grammes)
    $unitLabel = isset($src['unit_label']) ? trim((string)$src['unit_label']) : '';
    if ($unitLabel === '') $unitLabel = null;
    $gramsPerUnit = isset($src['grams_per_unit']) && $src['grams_per_unit'] !== ''
        ? (float)$src['grams_per_unit']
        : null;
    // Cohérence : il faut les deux ou aucun
    if ($unitLabel === null || $gramsPerUnit === null) {
        $unitLabel = null;
        $gramsPerUnit = null;
    }

    return [
        'name'             => isset($src['name']) ? trim($src['name']) : '',
        'unit_label'       => $unitLabel,
        'grams_per_unit'   => $gramsPerUnit,
        'kcal_per_100g'    => isset($src['kcal_per_100g'])    ? (float)$src['kcal_per_100g']    : 0,
        'protein_per_100g' => isset($src['protein_per_100g']) ? (float)$src['protein_per_100g'] : 0,
        'carbs_per_100g'   => isset($src['carbs_per_100g'])   ? (float)$src['carbs_per_100g']   : 0,
        'fat_per_100g'     => isset($src['fat_per_100g'])     ? (float)$src['fat_per_100g']     : 0,
    ];
}

function validateNutrition(array $f, &$err)
{
    if ($f['name'] === '') {
        $err = 'Nom requis';
        return false;
    }
    if (mb_strlen($f['name']) > 120) {
        $err = 'Nom trop long (120 max)';
        return false;
    }
    if ($f['kcal_per_100g'] < 0) {
        $err = 'Calories doivent être positives';
        return false;
    }
    if ($f['kcal_per_100g'] > 9999) {
        $err = 'Calories invalides';
        return false;
    }
    foreach (['protein_per_100g', 'carbs_per_100g', 'fat_per_100g'] as $k) {
        if ($f[$k] < 0 || $f[$k] > 999) {
            $err = 'Macros invalides';
            return false;
        }
    }
    if ($f['unit_label'] !== null) {
        if (mb_strlen($f['unit_label']) > 40) {
            $err = "Libellé d'unité trop long (40 max)";
            return false;
        }
        if ($f['grams_per_unit'] === null || $f['grams_per_unit'] <= 0 || $f['grams_per_unit'] > 99999) {
            $err = "Poids/unité invalide";
            return false;
        }
    }
    return true;
}

// ============================================================================
// LIBRARY (qogym_food_items)
// ============================================================================

if ($action === 'library') {

    // --- LIST ---
    if ($method === 'GET') {
        $stmt = $pdo->prepare("
            SELECT id, name, unit_label, grams_per_unit,
                   kcal_per_100g, protein_per_100g, carbs_per_100g,
                   fat_per_100g, created_at
            FROM qogym_food_items
            WHERE user_id = ?
            ORDER BY name ASC
        ");
        $stmt->execute([$user['id']]);
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);
        // Cast en float pour des JSON propres côté client
        foreach ($items as &$it) {
            $it['kcal_per_100g']    = (float)$it['kcal_per_100g'];
            $it['protein_per_100g'] = (float)$it['protein_per_100g'];
            $it['carbs_per_100g']   = (float)$it['carbs_per_100g'];
            $it['fat_per_100g']     = (float)$it['fat_per_100g'];
            $it['grams_per_unit']   = $it['grams_per_unit'] !== null ? (float)$it['grams_per_unit'] : null;
            // unit_label reste string ou null
        }
        jsonResponse(['success' => true, 'items' => $items]);
    }

    // --- CREATE ---
    if ($method === 'POST') {
        $f = readNutritionFields($input);
        $err = null;
        if (!validateNutrition($f, $err)) {
            jsonResponse(['error' => $err], 400);
        }
        try {
            $stmt = $pdo->prepare("
                INSERT INTO qogym_food_items
                    (user_id, name, unit_label, grams_per_unit,
                     kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $user['id'],
                $f['name'],
                $f['unit_label'],
                $f['grams_per_unit'],
                $f['kcal_per_100g'],
                $f['protein_per_100g'],
                $f['carbs_per_100g'],
                $f['fat_per_100g'],
            ]);
            jsonResponse(['success' => true, 'id' => $pdo->lastInsertId()]);
        } catch (PDOException $e) {
            // Doublon de nom (unique key user_id+name)
            if ($e->getCode() === '23000') {
                jsonResponse(['error' => "Un aliment portant ce nom existe déjà dans ta bibliothèque"], 409);
            }
            throw $e;
        }
    }

    // --- UPDATE ---
    if ($method === 'PUT') {
        $id = isset($_GET['id']) ? (int)$_GET['id'] : ((int)($input['id'] ?? 0));
        if ($id <= 0) jsonResponse(['error' => 'id requis'], 400);

        // Vérifier ownership
        $stmt = $pdo->prepare("SELECT id FROM qogym_food_items WHERE id = ? AND user_id = ?");
        $stmt->execute([$id, $user['id']]);
        if (!$stmt->fetch()) jsonResponse(['error' => 'Aliment non trouvé'], 404);

        $f = readNutritionFields($input);
        $err = null;
        if (!validateNutrition($f, $err)) {
            jsonResponse(['error' => $err], 400);
        }
        try {
            $stmt = $pdo->prepare("
                UPDATE qogym_food_items
                SET name = ?, unit_label = ?, grams_per_unit = ?,
                    kcal_per_100g = ?, protein_per_100g = ?,
                    carbs_per_100g = ?, fat_per_100g = ?
                WHERE id = ? AND user_id = ?
            ");
            $stmt->execute([
                $f['name'],
                $f['unit_label'],
                $f['grams_per_unit'],
                $f['kcal_per_100g'],
                $f['protein_per_100g'],
                $f['carbs_per_100g'],
                $f['fat_per_100g'],
                $id,
                $user['id'],
            ]);
            jsonResponse(['success' => true]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                jsonResponse(['error' => "Un autre aliment porte déjà ce nom"], 409);
            }
            throw $e;
        }
    }

    // --- DELETE ---
    if ($method === 'DELETE') {
        $id = isset($_GET['id']) ? (int)$_GET['id'] : ((int)($input['id'] ?? 0));
        if ($id <= 0) jsonResponse(['error' => 'id requis'], 400);
        $stmt = $pdo->prepare("DELETE FROM qogym_food_items WHERE id = ? AND user_id = ?");
        $stmt->execute([$id, $user['id']]);
        // ON DELETE SET NULL côté qogym_food_entries.food_item_id, donc
        // l'historique n'est pas perdu.
        jsonResponse(['success' => true]);
    }

    jsonResponse(['error' => 'Méthode non supportée'], 405);
}

// ============================================================================
// ENTRIES (qogym_food_entries)
// ============================================================================

if ($action === 'entries') {

    // --- LIST pour un jour donné + agrégats ---
    if ($method === 'GET') {
        $date = $_GET['date'] ?? date('Y-m-d');
        // Validation basique du format
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            jsonResponse(['error' => 'date invalide (format YYYY-MM-DD)'], 400);
        }

        $start = $date . ' 00:00:00';
        $end   = $date . ' 23:59:59';

        $stmt = $pdo->prepare("
            SELECT id, food_item_id, name_snapshot AS name,
                   unit_label, grams_per_unit, quantity_units,
                   kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                   quantity_g, consumed_at, meal_id
            FROM qogym_food_entries
            WHERE user_id = ? AND consumed_at BETWEEN ? AND ?
            ORDER BY consumed_at ASC
        ");
        $stmt->execute([$user['id'], $start, $end]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Calcule les valeurs effectives par entrée + totaux du jour
        $totals = ['kcal' => 0, 'protein' => 0, 'carbs' => 0, 'fat' => 0];
        $entries = [];
        foreach ($rows as $r) {
            $factor = ((float)$r['quantity_g']) / 100.0;
            $kcal    = round((float)$r['kcal_per_100g']    * $factor, 1);
            $protein = round((float)$r['protein_per_100g'] * $factor, 1);
            $carbs   = round((float)$r['carbs_per_100g']   * $factor, 1);
            $fat     = round((float)$r['fat_per_100g']     * $factor, 1);

            $totals['kcal']    += $kcal;
            $totals['protein'] += $protein;
            $totals['carbs']   += $carbs;
            $totals['fat']     += $fat;

            $entries[] = [
                'id'               => (int)$r['id'],
                'food_item_id'     => $r['food_item_id'] !== null ? (int)$r['food_item_id'] : null,
                'name'             => $r['name'],
                'unit_label'       => $r['unit_label'],
                'grams_per_unit'   => $r['grams_per_unit']  !== null ? (float)$r['grams_per_unit']  : null,
                'quantity_units'   => $r['quantity_units']  !== null ? (float)$r['quantity_units']  : null,
                'kcal_per_100g'    => (float)$r['kcal_per_100g'],
                'protein_per_100g' => (float)$r['protein_per_100g'],
                'carbs_per_100g'   => (float)$r['carbs_per_100g'],
                'fat_per_100g'     => (float)$r['fat_per_100g'],
                'quantity_g'       => (float)$r['quantity_g'],
                'consumed_at'      => $r['consumed_at'],
                'meal_id'          => $r['meal_id'] !== null ? (int)$r['meal_id'] : null,
                'totals'           => [
                    'kcal'    => $kcal,
                    'protein' => $protein,
                    'carbs'   => $carbs,
                    'fat'     => $fat,
                ],
            ];
        }
        // Round final pour éviter les .999999 d'accumulation
        foreach ($totals as $k => $v) $totals[$k] = round($v, 1);

        // Repas du jour, numérotés dans l'ordre de création (Repas 1, 2...).
        // `name` = nom du repas type d'origine (colonne ajoutée par
        // migration_meal_templates_20261127.sql) ; null sinon / sans migration.
        try {
            $stmt = $pdo->prepare("
                SELECT id, name FROM qogym_food_meals
                WHERE user_id = ? AND meal_date = ?
                ORDER BY id ASC
            ");
            $stmt->execute([$user['id'], $date]);
        } catch (PDOException $e) {
            $stmt = $pdo->prepare("
                SELECT id, NULL AS name FROM qogym_food_meals
                WHERE user_id = ? AND meal_date = ?
                ORDER BY id ASC
            ");
            $stmt->execute([$user['id'], $date]);
        }
        $meals = [];
        $n = 1;
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $m) {
            $meals[] = ['id' => (int)$m['id'], 'number' => $n++, 'name' => $m['name'] !== null && $m['name'] !== '' ? $m['name'] : null];
        }

        jsonResponse([
            'success' => true,
            'date'    => $date,
            'entries' => $entries,
            'meals'   => $meals,
            'totals'  => $totals,
        ]);
    }

    // --- CREATE entry ---
    if ($method === 'POST') {
        // Champs nutritionnels (snapshot)
        $f = readNutritionFields($input);
        $err = null;
        if (!validateNutrition($f, $err)) {
            jsonResponse(['error' => $err], 400);
        }

        // L'utilisateur peut envoyer soit quantity_g (saisie en grammes) soit
        // quantity_units (saisie en unités). On résout au moins l'un des deux.
        $quantityG     = isset($input['quantity_g'])     && $input['quantity_g']     !== '' ? (float)$input['quantity_g']     : null;
        $quantityUnits = isset($input['quantity_units']) && $input['quantity_units'] !== '' ? (float)$input['quantity_units'] : null;

        if ($quantityUnits !== null) {
            // Saisie en unités → on a besoin du grams_per_unit pour convertir
            if ($f['grams_per_unit'] === null || $f['grams_per_unit'] <= 0) {
                jsonResponse(['error' => "grams_per_unit requis pour une saisie en unités"], 400);
            }
            if ($quantityUnits <= 0 || $quantityUnits > 9999) {
                jsonResponse(['error' => 'Nombre d\'unités invalide'], 400);
            }
            // Conversion → quantity_g pour les calculs
            $quantityG = round($quantityUnits * $f['grams_per_unit'], 2);
        }

        if ($quantityG === null || $quantityG <= 0 || $quantityG > 99999) {
            jsonResponse(['error' => 'Quantité invalide'], 400);
        }

        $foodItemId = isset($input['food_item_id']) && (int)$input['food_item_id'] > 0
            ? (int)$input['food_item_id']
            : null;
        // Si food_item_id fourni, vérifier ownership
        if ($foodItemId !== null) {
            $stmt = $pdo->prepare("SELECT id FROM qogym_food_items WHERE id = ? AND user_id = ?");
            $stmt->execute([$foodItemId, $user['id']]);
            if (!$stmt->fetch()) jsonResponse(['error' => "Aliment introuvable"], 404);
        }
        // consumed_at optionnel ; par défaut maintenant. Format attendu :
        // 'YYYY-MM-DD HH:MM:SS' ou ISO 8601.
        $consumedAt = $input['consumed_at'] ?? null;
        if ($consumedAt) {
            $ts = strtotime($consumedAt);
            if (!$ts) jsonResponse(['error' => "consumed_at invalide"], 400);
            $consumedAt = date('Y-m-d H:i:s', $ts);
        } else {
            $consumedAt = date('Y-m-d H:i:s');
        }

        // Repas optionnel : doit appartenir à l'utilisateur. L'entrée est
        // alors forcée sur le jour du repas (même heure, jour du repas).
        $mealId = isset($input['meal_id']) && (int)$input['meal_id'] > 0
            ? (int)$input['meal_id']
            : null;
        if ($mealId !== null) {
            $stmt = $pdo->prepare("SELECT meal_date FROM qogym_food_meals WHERE id = ? AND user_id = ?");
            $stmt->execute([$mealId, $user['id']]);
            $mealRow = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$mealRow) jsonResponse(['error' => 'Repas introuvable'], 404);
            $consumedAt = $mealRow['meal_date'] . ' ' . date('H:i:s', strtotime($consumedAt));
        }

        $stmt = $pdo->prepare("
            INSERT INTO qogym_food_entries
                (user_id, food_item_id, name_snapshot,
                 unit_label, grams_per_unit, quantity_units,
                 kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                 quantity_g, consumed_at, meal_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            $user['id'],
            $foodItemId,
            $f['name'],
            $f['unit_label'],
            $f['grams_per_unit'],
            $quantityUnits,
            $f['kcal_per_100g'],
            $f['protein_per_100g'],
            $f['carbs_per_100g'],
            $f['fat_per_100g'],
            $quantityG,
            $consumedAt,
            $mealId,
        ]);

        jsonResponse(['success' => true, 'id' => $pdo->lastInsertId()]);
    }

    // --- UPDATE entry (modifier la quantité) ---
    if ($method === 'PUT') {
        $id = isset($_GET['id']) ? (int)$_GET['id'] : ((int)($input['id'] ?? 0));
        if ($id <= 0) jsonResponse(['error' => 'id requis'], 400);

        // Ownership + récupérer les infos d'unité de l'entrée
        $stmt = $pdo->prepare("
            SELECT id, unit_label, grams_per_unit, consumed_at
            FROM qogym_food_entries
            WHERE id = ? AND user_id = ?
        ");
        $stmt->execute([$id, $user['id']]);
        $entryRow = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$entryRow) jsonResponse(['error' => "Entrée non trouvée"], 404);

        // --- Déplacement dans / hors d'un repas (pas de quantité fournie) ---
        $hasQty = (isset($input['quantity_g']) && $input['quantity_g'] !== '')
               || (isset($input['quantity_units']) && $input['quantity_units'] !== '');
        if (!$hasQty && array_key_exists('meal_id', $input)) {
            $newMealId = (int)$input['meal_id'] > 0 ? (int)$input['meal_id'] : null;
            if ($newMealId !== null) {
                $stmt = $pdo->prepare("SELECT meal_date FROM qogym_food_meals WHERE id = ? AND user_id = ?");
                $stmt->execute([$newMealId, $user['id']]);
                $mealRow = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$mealRow) jsonResponse(['error' => 'Repas introuvable'], 404);
                // Un repas regroupe les aliments d'un même jour
                if (substr($entryRow['consumed_at'], 0, 10) !== $mealRow['meal_date']) {
                    jsonResponse(['error' => "Ce repas est sur un autre jour"], 400);
                }
            }
            $stmt = $pdo->prepare("UPDATE qogym_food_entries SET meal_id = ? WHERE id = ? AND user_id = ?");
            $stmt->execute([$newMealId, $id, $user['id']]);
            jsonResponse(['success' => true]);
        }

        // L'utilisateur peut soit modifier quantity_g, soit quantity_units
        $quantityG     = isset($input['quantity_g'])     && $input['quantity_g']     !== '' ? (float)$input['quantity_g']     : null;
        $quantityUnits = isset($input['quantity_units']) && $input['quantity_units'] !== '' ? (float)$input['quantity_units'] : null;

        if ($quantityUnits !== null) {
            $gpu = $entryRow['grams_per_unit'] !== null ? (float)$entryRow['grams_per_unit'] : null;
            if ($gpu === null || $gpu <= 0) {
                jsonResponse(['error' => "Cette entrée n'est pas en unités"], 400);
            }
            if ($quantityUnits <= 0 || $quantityUnits > 9999) {
                jsonResponse(['error' => "Nombre d'unités invalide"], 400);
            }
            $quantityG = round($quantityUnits * $gpu, 2);
        }

        if ($quantityG === null || $quantityG <= 0 || $quantityG > 99999) {
            jsonResponse(['error' => 'Quantité invalide'], 400);
        }

        $stmt = $pdo->prepare("
            UPDATE qogym_food_entries
            SET quantity_g = ?, quantity_units = ?
            WHERE id = ? AND user_id = ?
        ");
        $stmt->execute([$quantityG, $quantityUnits, $id, $user['id']]);
        jsonResponse(['success' => true]);
    }

    // --- DELETE entry ---
    if ($method === 'DELETE') {
        $id = isset($_GET['id']) ? (int)$_GET['id'] : ((int)($input['id'] ?? 0));
        if ($id <= 0) jsonResponse(['error' => 'id requis'], 400);
        $stmt = $pdo->prepare("DELETE FROM qogym_food_entries WHERE id = ? AND user_id = ?");
        $stmt->execute([$id, $user['id']]);
        jsonResponse(['success' => true]);
    }

    jsonResponse(['error' => 'Méthode non supportée'], 405);
}

// ============================================================================
// MEALS (qogym_food_meals)
// ============================================================================

if ($action === 'meals') {

    // --- CREATE : repas vide pour un jour donné ---
    if ($method === 'POST') {
        $date = $input['date'] ?? date('Y-m-d');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !strtotime($date)) {
            jsonResponse(['error' => 'date invalide (format YYYY-MM-DD)'], 400);
        }
        $stmt = $pdo->prepare("INSERT INTO qogym_food_meals (user_id, meal_date) VALUES (?, ?)");
        $stmt->execute([$user['id'], $date]);
        jsonResponse(['success' => true, 'id' => (int)$pdo->lastInsertId()]);
    }

    // --- DELETE : supprime le repas et tous ses aliments ---
    if ($method === 'DELETE') {
        $id = isset($_GET['id']) ? (int)$_GET['id'] : ((int)($input['id'] ?? 0));
        if ($id <= 0) jsonResponse(['error' => 'id requis'], 400);

        $stmt = $pdo->prepare("SELECT id FROM qogym_food_meals WHERE id = ? AND user_id = ?");
        $stmt->execute([$id, $user['id']]);
        if (!$stmt->fetch()) jsonResponse(['error' => 'Repas non trouvé'], 404);

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("DELETE FROM qogym_food_entries WHERE meal_id = ? AND user_id = ?");
            $stmt->execute([$id, $user['id']]);
            $stmt = $pdo->prepare("DELETE FROM qogym_food_meals WHERE id = ? AND user_id = ?");
            $stmt->execute([$id, $user['id']]);
            $pdo->commit();
        } catch (Exception $e) {
            $pdo->rollBack();
            jsonResponse(['error' => 'Erreur lors de la suppression'], 500);
        }
        jsonResponse(['success' => true]);
    }

    jsonResponse(['error' => 'Méthode non supportée'], 405);
}

// ============================================================================
// REPAS TYPES (qogym_meal_templates + qogym_meal_template_items)
//
//   - GET    ?action=templates               → mes repas types + leurs aliments + totaux
//   - POST   ?action=templates  {name, items:[…]}      → crée un repas type
//   - POST   ?action=templates  {name, from_meal_id}   → crée depuis un repas du journal
//   - PUT    ?action=templates&id=N  {name?, items?}   → renomme / remplace les aliments
//   - DELETE ?action=templates&id=N                    → supprime
//   - POST   ?action=apply_template {template_id, date, meal_id?}
//       → ajoute tous les aliments au journal : dans un NOUVEAU repas du jour
//         (nommé comme le repas type), ou dans le repas `meal_id` existant.
//
// Un aliment de repas type = mêmes champs qu'une entrée du journal
// (food_item_id facultatif, nom, unité, valeurs /100 g) + quantity_g OU
// quantity_units. À l'ajout, si l'aliment est encore dans la bibliothèque,
// ses valeurs actuelles sont utilisées (une correction de la bibliothèque
// profite donc aux repas types).
// Migration : sql/migration_meal_templates_20261127.sql
// ============================================================================

const MEAL_TEMPLATE_MAX_ITEMS = 40;

/** Valide un aliment de repas type ; renvoie la ligne à insérer ou une erreur. */
function readTemplateItem(PDO $pdo, int $userId, $raw, &$err): ?array
{
    if (!is_array($raw)) { $err = 'Aliment invalide'; return null; }
    $f = readNutritionFields($raw);
    if (!validateNutrition($f, $err)) return null;

    $quantityG     = isset($raw['quantity_g'])     && $raw['quantity_g']     !== '' && $raw['quantity_g']     !== null ? (float)$raw['quantity_g']     : null;
    $quantityUnits = isset($raw['quantity_units']) && $raw['quantity_units'] !== '' && $raw['quantity_units'] !== null ? (float)$raw['quantity_units'] : null;
    if ($quantityUnits !== null) {
        if ($f['grams_per_unit'] === null) { $err = "« {$f['name']} » : grams_per_unit requis pour une quantité en unités"; return null; }
        if ($quantityUnits <= 0 || $quantityUnits > 9999) { $err = "« {$f['name']} » : nombre d'unités invalide"; return null; }
        $quantityG = round($quantityUnits * $f['grams_per_unit'], 2);
    }
    if ($quantityG === null || $quantityG <= 0 || $quantityG > 99999) {
        $err = "« {$f['name']} » : quantité invalide";
        return null;
    }

    $foodItemId = isset($raw['food_item_id']) && (int)$raw['food_item_id'] > 0 ? (int)$raw['food_item_id'] : null;
    if ($foodItemId !== null) {
        $stmt = $pdo->prepare("SELECT id FROM qogym_food_items WHERE id = ? AND user_id = ?");
        $stmt->execute([$foodItemId, $userId]);
        if (!$stmt->fetch()) $foodItemId = null; // aliment d'un autre / supprimé : on garde la copie
    }

    return $f + [
        'food_item_id'   => $foodItemId,
        'quantity_g'     => $quantityG,
        'quantity_units' => $quantityUnits,
    ];
}

function readTemplateName($raw, &$err): ?string
{
    $name = trim((string)($raw ?? ''));
    if ($name === '') { $err = 'Nom du repas type requis'; return null; }
    // 80 caractères max (sans mb_* : mbstring n'est pas garanti sur l'hébergement)
    if (!preg_match('/^.{1,80}$/us', $name)) { $err = 'Nom trop long (80 max)'; return null; }
    return $name;
}

function insertTemplateItems(PDO $pdo, int $templateId, array $items): void
{
    $stmt = $pdo->prepare("
        INSERT INTO qogym_meal_template_items
            (template_id, position, food_item_id, name, unit_label, grams_per_unit,
             quantity_g, quantity_units, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    foreach (array_values($items) as $i => $it) {
        $stmt->execute([
            $templateId, $i, $it['food_item_id'], $it['name'], $it['unit_label'], $it['grams_per_unit'],
            $it['quantity_g'], $it['quantity_units'],
            $it['kcal_per_100g'], $it['protein_per_100g'], $it['carbs_per_100g'], $it['fat_per_100g'],
        ]);
    }
}

/**
 * Aliments des repas types donnés, avec les valeurs ACTUELLES de la
 * bibliothèque quand l'aliment y est encore. Renvoie [template_id => [items]].
 */
function loadTemplateItems(PDO $pdo, int $userId, array $templateIds): array
{
    if (!$templateIds) return [];
    $ph = implode(',', array_fill(0, count($templateIds), '?'));
    $stmt = $pdo->prepare("
        SELECT ti.template_id, ti.position, fi.id AS lib_id,
               COALESCE(fi.name, ti.name) AS name,
               CASE WHEN fi.id IS NULL THEN ti.unit_label     ELSE fi.unit_label     END AS unit_label,
               CASE WHEN fi.id IS NULL THEN ti.grams_per_unit ELSE fi.grams_per_unit END AS grams_per_unit,
               ti.quantity_g, ti.quantity_units,
               COALESCE(fi.kcal_per_100g,    ti.kcal_per_100g)    AS kcal_per_100g,
               COALESCE(fi.protein_per_100g, ti.protein_per_100g) AS protein_per_100g,
               COALESCE(fi.carbs_per_100g,   ti.carbs_per_100g)   AS carbs_per_100g,
               COALESCE(fi.fat_per_100g,     ti.fat_per_100g)     AS fat_per_100g
        FROM qogym_meal_template_items ti
        LEFT JOIN qogym_food_items fi ON fi.id = ti.food_item_id AND fi.user_id = ?
        WHERE ti.template_id IN ($ph)
        ORDER BY ti.template_id, ti.position, ti.id
    ");
    $stmt->execute(array_merge([$userId], array_map('intval', $templateIds)));
    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $gpu   = $r['grams_per_unit'] !== null ? (float)$r['grams_per_unit'] : null;
        $units = $r['quantity_units'] !== null ? (float)$r['quantity_units'] : null;
        $qg    = (float)$r['quantity_g'];
        if ($units !== null && $gpu !== null && $gpu > 0) {
            $qg = round($units * $gpu, 2);          // l'unité a pu changer de poids
        } elseif ($gpu === null || $r['unit_label'] === null) {
            $units = null;                           // l'aliment n'est plus « à l'unité »
        }
        $f = $qg / 100.0;
        $out[(int)$r['template_id']][] = [
            'food_item_id'     => $r['lib_id'] !== null ? (int)$r['lib_id'] : null,
            'name'             => $r['name'],
            'unit_label'       => $r['unit_label'],
            'grams_per_unit'   => $gpu,
            'quantity_g'       => $qg,
            'quantity_units'   => $units,
            'kcal_per_100g'    => (float)$r['kcal_per_100g'],
            'protein_per_100g' => (float)$r['protein_per_100g'],
            'carbs_per_100g'   => (float)$r['carbs_per_100g'],
            'fat_per_100g'     => (float)$r['fat_per_100g'],
            'totals' => [
                'kcal'    => round((float)$r['kcal_per_100g']    * $f, 1),
                'protein' => round((float)$r['protein_per_100g'] * $f, 1),
                'carbs'   => round((float)$r['carbs_per_100g']   * $f, 1),
                'fat'     => round((float)$r['fat_per_100g']     * $f, 1),
            ],
        ];
    }
    return $out;
}

function templateWithItems(array $t, array $items): array
{
    $tot = ['kcal' => 0, 'protein' => 0, 'carbs' => 0, 'fat' => 0];
    foreach ($items as $it) foreach ($tot as $k => $_) $tot[$k] += $it['totals'][$k];
    foreach ($tot as $k => $v) $tot[$k] = round($v, 1);
    return [
        'id'     => (int)$t['id'],
        'name'   => $t['name'],
        'items'  => $items,
        'totals' => $tot,
    ];
}

if ($action === 'templates' || $action === 'apply_template') {
    try {
        $uid = (int)$user['id'];

        // --- LISTE ---
        if ($action === 'templates' && $method === 'GET') {
            $stmt = $pdo->prepare("SELECT id, name FROM qogym_meal_templates WHERE user_id = ? ORDER BY name ASC");
            $stmt->execute([$uid]);
            $templates = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $items = loadTemplateItems($pdo, $uid, array_column($templates, 'id'));
            $out = [];
            foreach ($templates as $t) $out[] = templateWithItems($t, $items[(int)$t['id']] ?? []);
            jsonResponse(['success' => true, 'templates' => $out]);
        }

        // --- CRÉER ---
        if ($action === 'templates' && $method === 'POST') {
            $err = null;
            $name = readTemplateName($input['name'] ?? null, $err);
            if ($name === null) jsonResponse(['error' => $err], 400);

            $items = [];
            if (!empty($input['from_meal_id'])) {
                // Depuis un repas du journal : on reprend ses aliments tels quels
                $mealId = (int)$input['from_meal_id'];
                $stmt = $pdo->prepare("SELECT id FROM qogym_food_meals WHERE id = ? AND user_id = ?");
                $stmt->execute([$mealId, $uid]);
                if (!$stmt->fetch()) jsonResponse(['error' => 'Repas introuvable'], 404);
                $stmt = $pdo->prepare("
                    SELECT food_item_id, name_snapshot AS name, unit_label, grams_per_unit,
                           quantity_g, quantity_units,
                           kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g
                    FROM qogym_food_entries
                    WHERE meal_id = ? AND user_id = ?
                    ORDER BY consumed_at ASC, id ASC
                ");
                $stmt->execute([$mealId, $uid]);
                $raws = $stmt->fetchAll(PDO::FETCH_ASSOC);
                if (!$raws) jsonResponse(['error' => 'Ce repas est vide'], 400);
            } else {
                $raws = $input['items'] ?? null;
                if (!is_array($raws) || !$raws) jsonResponse(['error' => 'Ajoute au moins un aliment'], 400);
            }
            if (count($raws) > MEAL_TEMPLATE_MAX_ITEMS) {
                jsonResponse(['error' => 'Trop d\'aliments (' . MEAL_TEMPLATE_MAX_ITEMS . ' max)'], 400);
            }
            foreach ($raws as $raw) {
                $it = readTemplateItem($pdo, $uid, $raw, $err);
                if ($it === null) jsonResponse(['error' => $err], 400);
                $items[] = $it;
            }

            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare("INSERT INTO qogym_meal_templates (user_id, name) VALUES (?, ?)");
                $stmt->execute([$uid, $name]);
                $templateId = (int)$pdo->lastInsertId();
                insertTemplateItems($pdo, $templateId, $items);
                $pdo->commit();
            } catch (PDOException $e) {
                $pdo->rollBack();
                if ($e->getCode() === '23000') jsonResponse(['error' => 'Tu as déjà un repas type avec ce nom'], 409);
                throw $e;
            }
            jsonResponse(['success' => true, 'id' => $templateId]);
        }

        // --- MODIFIER (nom et/ou liste complète d'aliments) ---
        if ($action === 'templates' && $method === 'PUT') {
            $id = isset($_GET['id']) ? (int)$_GET['id'] : (int)($input['id'] ?? 0);
            $stmt = $pdo->prepare("SELECT id FROM qogym_meal_templates WHERE id = ? AND user_id = ?");
            $stmt->execute([$id, $uid]);
            if (!$stmt->fetch()) jsonResponse(['error' => 'Repas type introuvable'], 404);

            $err = null;
            $name = null;
            if (array_key_exists('name', $input)) {
                $name = readTemplateName($input['name'], $err);
                if ($name === null) jsonResponse(['error' => $err], 400);
            }
            $items = null;
            if (array_key_exists('items', $input)) {
                if (!is_array($input['items']) || !$input['items']) jsonResponse(['error' => 'Ajoute au moins un aliment'], 400);
                if (count($input['items']) > MEAL_TEMPLATE_MAX_ITEMS) {
                    jsonResponse(['error' => 'Trop d\'aliments (' . MEAL_TEMPLATE_MAX_ITEMS . ' max)'], 400);
                }
                $items = [];
                foreach ($input['items'] as $raw) {
                    $it = readTemplateItem($pdo, $uid, $raw, $err);
                    if ($it === null) jsonResponse(['error' => $err], 400);
                    $items[] = $it;
                }
            }

            $pdo->beginTransaction();
            try {
                if ($name !== null) {
                    $stmt = $pdo->prepare("UPDATE qogym_meal_templates SET name = ? WHERE id = ? AND user_id = ?");
                    $stmt->execute([$name, $id, $uid]);
                }
                if ($items !== null) {
                    $pdo->prepare("DELETE FROM qogym_meal_template_items WHERE template_id = ?")->execute([$id]);
                    insertTemplateItems($pdo, $id, $items);
                }
                $pdo->commit();
            } catch (PDOException $e) {
                $pdo->rollBack();
                if ($e->getCode() === '23000') jsonResponse(['error' => 'Tu as déjà un repas type avec ce nom'], 409);
                throw $e;
            }
            jsonResponse(['success' => true]);
        }

        // --- SUPPRIMER ---
        if ($action === 'templates' && $method === 'DELETE') {
            $id = isset($_GET['id']) ? (int)$_GET['id'] : (int)($input['id'] ?? 0);
            $stmt = $pdo->prepare("DELETE FROM qogym_meal_templates WHERE id = ? AND user_id = ?");
            $stmt->execute([$id, $uid]);
            if ($stmt->rowCount() === 0) jsonResponse(['error' => 'Repas type introuvable'], 404);
            // Les aliments partent avec (ON DELETE CASCADE) ; le journal n'est pas touché.
            jsonResponse(['success' => true]);
        }

        // --- AJOUTER AU JOURNAL ---
        if ($action === 'apply_template' && $method === 'POST') {
            $templateId = (int)($input['template_id'] ?? 0);
            $stmt = $pdo->prepare("SELECT id, name FROM qogym_meal_templates WHERE id = ? AND user_id = ?");
            $stmt->execute([$templateId, $uid]);
            $template = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$template) jsonResponse(['error' => 'Repas type introuvable'], 404);
            $items = loadTemplateItems($pdo, $uid, [$templateId])[$templateId] ?? [];
            if (!$items) jsonResponse(['error' => 'Ce repas type est vide'], 400);

            $mealId = (int)($input['meal_id'] ?? 0) ?: null;
            if ($mealId !== null) {
                $stmt = $pdo->prepare("SELECT meal_date FROM qogym_food_meals WHERE id = ? AND user_id = ?");
                $stmt->execute([$mealId, $uid]);
                $meal = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$meal) jsonResponse(['error' => 'Repas introuvable'], 404);
                $date = $meal['meal_date'];
            } else {
                $date = $input['date'] ?? date('Y-m-d');
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !strtotime($date)) {
                    jsonResponse(['error' => 'date invalide (format YYYY-MM-DD)'], 400);
                }
            }
            $consumedAt = $date . ' ' . date('H:i:s');

            $pdo->beginTransaction();
            try {
                if ($mealId === null) {
                    $stmt = $pdo->prepare("INSERT INTO qogym_food_meals (user_id, meal_date, name) VALUES (?, ?, ?)");
                    $stmt->execute([$uid, $date, $template['name']]);
                    $mealId = (int)$pdo->lastInsertId();
                }
                $stmt = $pdo->prepare("
                    INSERT INTO qogym_food_entries
                        (user_id, food_item_id, name_snapshot,
                         unit_label, grams_per_unit, quantity_units,
                         kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                         quantity_g, consumed_at, meal_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                foreach ($items as $it) {
                    $stmt->execute([
                        $uid, $it['food_item_id'], $it['name'],
                        $it['unit_label'], $it['grams_per_unit'], $it['quantity_units'],
                        $it['kcal_per_100g'], $it['protein_per_100g'], $it['carbs_per_100g'], $it['fat_per_100g'],
                        $it['quantity_g'], $consumedAt, $mealId,
                    ]);
                }
                $pdo->commit();
            } catch (Exception $e) {
                $pdo->rollBack();
                throw $e;
            }
            jsonResponse(['success' => true, 'meal_id' => $mealId, 'added' => count($items)]);
        }

        jsonResponse(['error' => 'Méthode non supportée'], 405);
    } catch (PDOException $e) {
        // Table / colonne absente : migration pas encore jouée
        if (in_array($e->getCode(), ['42S02', '42S22'], true)) {
            jsonResponse(['error' => 'Repas types indisponibles pour le moment', 'code' => 'migration_needed'], 503);
        }
        throw $e;
    }
}

jsonResponse(['error' => 'Action non reconnue'], 400);
