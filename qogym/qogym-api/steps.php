<?php
require_once 'config.php';

// ----------------------------------------------------------------------------
// steps.php — compteur de pas quotidiens
//
// Endpoints :
//   GET  ?action=range&from=YYYY-MM-DD&to=YYYY-MM-DD
//        → liste des jours dans l'intervalle (pour l'historique + graphique)
//        → renvoie aussi le `goal` (objectif de pas) courant
//   GET  ?action=today
//        → pas du jour courant + goal
//   POST (body: { steps, day?, source? })
//        → upsert des pas d'un jour (par défaut aujourd'hui).
//          Règle anti-régression : on ne DIMINUE jamais la valeur d'un jour
//          si la source est 'native' (le capteur du téléphone est cumulatif
//          et peut renvoyer une valeur partielle au boot ; on garde le max).
//          Une saisie 'manual' écrase toujours (l'utilisateur fait foi).
//   PUT  (body: { goal })  → définit/retire l'objectif de pas (null = retire)
//
// Le jour est calculé/serveur en fonction du paramètre fourni par le client
// (qui connaît le fuseau local de l'utilisateur). On valide juste le format.
// ----------------------------------------------------------------------------

$user   = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$pdo    = getDB();
$action = $_GET['action'] ?? null;

/**
 * Détecte une erreur SQL "schéma manquant" (table qogym_daily_steps ou
 * colonne daily_steps_target absentes = migration pas encore exécutée).
 * MySQL : 1146 = table inconnue, 1054 = colonne inconnue, 42S02/42S22 =
 * SQLSTATE équivalents.
 */
function isMissingSchema(PDOException $e)
{
    $code = $e->getCode();
    $msg  = $e->getMessage();
    return in_array($code, ['42S02', '42S22'], true)
        || strpos($msg, '1146') !== false
        || strpos($msg, '1054') !== false
        || stripos($msg, "doesn't exist") !== false
        || stripos($msg, 'Unknown column') !== false;
}

/** Valide une date 'YYYY-MM-DD'. Retourne la chaîne ou null si invalide. */
function validDay($s)
{
    if (!is_string($s)) return null;
    $d = DateTime::createFromFormat('Y-m-d', $s);
    if (!$d) return null;
    // Rejette les dates "réécrites" (ex: 2026-02-31 → 2026-03-03)
    return $d->format('Y-m-d') === $s ? $s : null;
}

/** Récupère l'objectif de pas de l'utilisateur (int ou null). */
function getStepsGoal($pdo, $userId)
{
    $stmt = $pdo->prepare("SELECT daily_steps_target FROM qogym_users WHERE id = ?");
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row || $row['daily_steps_target'] === null) return null;
    return (int)$row['daily_steps_target'];
}

// Tout le traitement est encapsulé : si la migration n'a pas encore été
// exécutée (table/colonne absentes), on renvoie un JSON propre et explicite
// au lieu d'un fatal PHP non-JSON qui casserait l'appel axios côté front.
try {

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $goal = getStepsGoal($pdo, $user['id']);

    if ($action === 'today') {
        // Le client passe sa date locale ; à défaut on prend la date serveur.
        $day = validDay($_GET['day'] ?? '') ?? date('Y-m-d');
        $stmt = $pdo->prepare(
            "SELECT day, steps, source, updated_at
             FROM qogym_daily_steps
             WHERE user_id = ? AND day = ?"
        );
        $stmt->execute([$user['id'], $day]);
        $row = $stmt->fetch();
        jsonResponse([
            'success' => true,
            'goal'    => $goal,
            'day'     => $day,
            'steps'   => $row ? (int)$row['steps'] : 0,
            'source'  => $row ? $row['source'] : null,
        ]);
    }

    // action=range (défaut)
    $to   = validDay($_GET['to'] ?? '')   ?? date('Y-m-d');
    $from = validDay($_GET['from'] ?? '') ?? date('Y-m-d', strtotime($to . ' -29 days'));
    if ($from > $to) { $tmp = $from; $from = $to; $to = $tmp; }

    $stmt = $pdo->prepare(
        "SELECT day, steps, source
         FROM qogym_daily_steps
         WHERE user_id = ? AND day BETWEEN ? AND ?
         ORDER BY day ASC"
    );
    $stmt->execute([$user['id'], $from, $to]);
    $rows = $stmt->fetchAll();
    $days = array_map(function ($r) {
        return [
            'day'    => $r['day'],
            'steps'  => (int)$r['steps'],
            'source' => $r['source'],
        ];
    }, $rows);

    jsonResponse([
        'success' => true,
        'goal'    => $goal,
        'from'    => $from,
        'to'      => $to,
        'days'    => $days,
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — upsert des pas d'un jour
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    if (!array_key_exists('steps', $input)) {
        jsonResponse(['error' => 'Champ steps manquant'], 400);
    }
    $steps = (int)$input['steps'];
    if ($steps < 0 || $steps > 500000) {
        jsonResponse(['error' => 'Valeur de pas invalide'], 400);
    }
    $day = validDay($input['day'] ?? '') ?? date('Y-m-d');
    // Sources acceptées :
    //  - 'manual'         : saisie utilisateur (écrase, fait foi)
    //  - 'native'         : capteur, total fiable du jour
    //  - 'native-partial' : capteur expo-sensors (compteur observé app
    //                       ouverte, pas le total depuis minuit)
    // Pour 'native' ET 'native-partial' on applique le GREATEST du jour :
    // une valeur partielle/plus petite ne fait jamais régresser le
    // compteur ni n'écrase un total plus élevé déjà connu (saisie
    // manuelle notamment). On conserve la source réelle pour l'affichage.
    $rawSource = $input['source'] ?? 'manual';
    if ($rawSource === 'native' || $rawSource === 'native-partial') {
        $source = $rawSource;
        $isNative = true;
    } else {
        $source = 'manual';
        $isNative = false;
    }

    if ($isNative) {
        $stmt = $pdo->prepare(
            "INSERT INTO qogym_daily_steps (user_id, day, steps, source)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               steps  = GREATEST(steps, VALUES(steps)),
               source = VALUES(source)"
        );
        $stmt->execute([$user['id'], $day, $steps, $source]);
    } else {
        $stmt = $pdo->prepare(
            "INSERT INTO qogym_daily_steps (user_id, day, steps, source)
             VALUES (?, ?, ?, 'manual')
             ON DUPLICATE KEY UPDATE
               steps  = VALUES(steps),
               source = 'manual'"
        );
        $stmt->execute([$user['id'], $day, $steps]);
    }

    // Renvoie la valeur effectivement stockée (utile vu le GREATEST).
    $stmt = $pdo->prepare(
        "SELECT steps, source FROM qogym_daily_steps WHERE user_id = ? AND day = ?"
    );
    $stmt->execute([$user['id'], $day]);
    $row = $stmt->fetch();

    jsonResponse([
        'success' => true,
        'day'     => $day,
        'steps'   => $row ? (int)$row['steps'] : $steps,
        'source'  => $row ? $row['source'] : $source,
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT — définir / retirer l'objectif de pas
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'PUT') {
    if (!array_key_exists('goal', $input)) {
        jsonResponse(['error' => 'Champ goal manquant'], 400);
    }
    $goal = $input['goal'];
    if ($goal === null || $goal === '' || $goal === 0 || $goal === '0') {
        $stmt = $pdo->prepare("UPDATE qogym_users SET daily_steps_target = NULL WHERE id = ?");
        $stmt->execute([$user['id']]);
        jsonResponse(['success' => true, 'goal' => null]);
    }
    $goal = (int)$goal;
    if ($goal < 0 || $goal > 200000) {
        jsonResponse(['error' => 'Objectif de pas invalide'], 400);
    }
    $stmt = $pdo->prepare("UPDATE qogym_users SET daily_steps_target = ? WHERE id = ?");
    $stmt->execute([$goal, $user['id']]);
    jsonResponse(['success' => true, 'goal' => $goal]);
}

jsonResponse(['error' => 'Méthode non supportée'], 405);

} catch (PDOException $e) {
    if (isMissingSchema($e)) {
        // Migration pas encore exécutée. On répond 200 avec des valeurs
        // neutres + un flag : le front affiche un état vide propre (et la
        // saisie manuelle restera, elle, indisponible tant que la table
        // n'existe pas — mais l'app ne casse pas).
        jsonResponse([
            'success'        => true,
            'migration_needed' => true,
            'goal'           => null,
            'steps'          => 0,
            'day'            => date('Y-m-d'),
            'days'           => [],
            'source'         => null,
        ]);
    }
    // Autre erreur DB : message générique, pas de détail technique exposé.
    jsonResponse(['error' => 'Erreur base de données'], 500);
} catch (Exception $e) {
    jsonResponse(['error' => 'Erreur serveur'], 500);
}
