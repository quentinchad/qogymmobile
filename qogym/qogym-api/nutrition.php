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

        // Repas du jour, numérotés dans l'ordre de création (Repas 1, 2...)
        $stmt = $pdo->prepare("
            SELECT id FROM qogym_food_meals
            WHERE user_id = ? AND meal_date = ?
            ORDER BY id ASC
        ");
        $stmt->execute([$user['id'], $date]);
        $meals = [];
        $n = 1;
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $m) {
            $meals[] = ['id' => (int)$m['id'], 'number' => $n++];
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

jsonResponse(['error' => 'Action non reconnue'], 400);
