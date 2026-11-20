<?php
require_once 'config.php';

// ----------------------------------------------------------------------------
// weight.php — suivi du poids corporel (une pesée par jour)
//
// Migration SQL : sql/migration_body_weight_20261120.sql
//
// Endpoints :
//   GET    ?action=list[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//          → toutes les pesées de l'utilisateur (ou l'intervalle demandé),
//            triées par date croissante, + objectif de poids (`goal`).
//            Les agrégats (moyennes hebdo / mensuelles, tendance) sont
//            calculés côté front : une pesée par jour = ~365 lignes/an.
//   POST   (body: { day, weight })
//          → upsert de la pesée du jour `day` (aujourd'hui par défaut).
//            Ressaisir un jour existant = corriger la valeur.
//   DELETE ?day=YYYY-MM-DD
//          → supprime la pesée de ce jour.
//   PUT    (body: { goal })
//          → définit / retire (null) l'objectif de poids.
//
// Le jour est fourni par le client (qui connaît son fuseau local). Les dates
// futures sont refusées (on ne pèse pas demain), les dates passées acceptées.
// ----------------------------------------------------------------------------

try {
    $user = verifyAuth();
} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 401);
}

$method = $_SERVER['REQUEST_METHOD'];
$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$pdo    = getDB();
$action = $_GET['action'] ?? null;

const WEIGHT_MIN = 20;
const WEIGHT_MAX = 400;

/** Table/colonne absente = migration pas encore exécutée. */
function weightMissingSchema(PDOException $e)
{
    $code = $e->getCode();
    $msg  = $e->getMessage();
    return in_array($code, ['42S02', '42S22'], true)
        || strpos($msg, '1146') !== false
        || strpos($msg, '1054') !== false
        || stripos($msg, "doesn't exist") !== false
        || stripos($msg, 'Unknown column') !== false;
}

/** Valide une date 'YYYY-MM-DD'. Retourne la chaîne ou null. */
function weightValidDay($s)
{
    if (!is_string($s)) return null;
    $d = DateTime::createFromFormat('Y-m-d', $s);
    if (!$d) return null;
    return $d->format('Y-m-d') === $s ? $s : null;
}

/** Parse un poids (accepte "78,4" ou 78.4). Retourne un float arrondi ou null. */
function weightParse($v)
{
    if (is_string($v)) $v = str_replace(',', '.', trim($v));
    if (!is_numeric($v)) return null;
    $w = round((float)$v, 2);
    if ($w < WEIGHT_MIN || $w > WEIGHT_MAX) return null;
    return $w;
}

function weightGetGoal($pdo, $userId)
{
    $stmt = $pdo->prepare("SELECT target_weight_kg FROM qogym_users WHERE id = ?");
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row || $row['target_weight_kg'] === null) return null;
    return (float)$row['target_weight_kg'];
}

try {

// ─────────────────────────────────────────────────────────────────────────────
// GET — liste des pesées
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $from = weightValidDay($_GET['from'] ?? '');
    $to   = weightValidDay($_GET['to'] ?? '');

    $sql    = "SELECT day, weight_kg FROM qogym_body_weights WHERE user_id = ?";
    $params = [$user['id']];
    if ($from) { $sql .= " AND day >= ?"; $params[] = $from; }
    if ($to)   { $sql .= " AND day <= ?"; $params[] = $to; }
    $sql .= " ORDER BY day ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $entries = array_map(function ($r) {
        return ['day' => $r['day'], 'weight' => (float)$r['weight_kg']];
    }, $stmt->fetchAll());

    jsonResponse([
        'success' => true,
        'goal'    => weightGetGoal($pdo, $user['id']),
        'entries' => $entries,
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — upsert d'une pesée
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    $weight = weightParse($input['weight'] ?? null);
    if ($weight === null) {
        jsonResponse(['error' => 'Poids invalide (entre ' . WEIGHT_MIN . ' et ' . WEIGHT_MAX . ' kg)'], 400);
    }
    $day = array_key_exists('day', $input) ? weightValidDay($input['day']) : date('Y-m-d');
    if ($day === null) {
        jsonResponse(['error' => 'Date invalide'], 400);
    }
    // Tolérance d'un jour pour les décalages de fuseau client/serveur.
    if ($day > date('Y-m-d', strtotime('+1 day'))) {
        jsonResponse(['error' => 'Impossible de saisir un poids dans le futur'], 400);
    }

    $stmt = $pdo->prepare(
        "INSERT INTO qogym_body_weights (user_id, day, weight_kg)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE weight_kg = VALUES(weight_kg)"
    );
    $stmt->execute([$user['id'], $day, $weight]);

    jsonResponse(['success' => true, 'day' => $day, 'weight' => $weight]);
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — suppression d'une pesée
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    $day = weightValidDay($_GET['day'] ?? '');
    if ($day === null) {
        jsonResponse(['error' => 'Date invalide'], 400);
    }
    $stmt = $pdo->prepare("DELETE FROM qogym_body_weights WHERE user_id = ? AND day = ?");
    $stmt->execute([$user['id'], $day]);
    jsonResponse(['success' => true, 'deleted' => $stmt->rowCount() > 0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT — objectif de poids
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'PUT') {
    if (!array_key_exists('goal', $input)) {
        jsonResponse(['error' => 'Champ goal manquant'], 400);
    }
    $raw = $input['goal'];
    if ($raw === null || $raw === '' || $raw === 0 || $raw === '0') {
        $stmt = $pdo->prepare("UPDATE qogym_users SET target_weight_kg = NULL WHERE id = ?");
        $stmt->execute([$user['id']]);
        jsonResponse(['success' => true, 'goal' => null]);
    }
    $goal = weightParse($raw);
    if ($goal === null) {
        jsonResponse(['error' => 'Objectif de poids invalide'], 400);
    }
    $stmt = $pdo->prepare("UPDATE qogym_users SET target_weight_kg = ? WHERE id = ?");
    $stmt->execute([$goal, $user['id']]);
    jsonResponse(['success' => true, 'goal' => $goal]);
}

jsonResponse(['error' => 'Méthode non supportée'], 405);

} catch (PDOException $e) {
    if (weightMissingSchema($e)) {
        if ($method === 'GET') {
            jsonResponse([
                'success'          => true,
                'migration_needed' => true,
                'goal'             => null,
                'entries'          => [],
            ]);
        }
        jsonResponse(['error' => 'Migration BDD manquante (migration_body_weight)', 'migration_needed' => true], 503);
    }
    jsonResponse(['error' => 'Erreur base de données'], 500);
} catch (Exception $e) {
    jsonResponse(['error' => 'Erreur serveur'], 500);
}
