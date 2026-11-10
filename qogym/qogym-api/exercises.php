<?php
require_once 'config.php';

// ----------------------------------------------------------------------------
// exercises.php
//
// Endpoint "Bibliothèque d'exercices" :
//   - GET ?library=1&user_id=N                        — liste des exercices
//         déjà réalisés par l'utilisateur N, avec stats (nb de fois fait,
//         dernière fois, 1RM estimé le plus élevé...).
//   - GET ?progress=1&user_id=N&name=...[&from=&to=]   — progression détaillée
//         d'UN exercice (par nom) dans le temps, avec le détail des séries de
//         chaque séance et le 1RM estimé de chacune.
//
// Contrôle d'accès : identique à user_profile.php — on ne peut consulter la
// bibliothèque / progression que de son propre profil, ou de celui d'un ami
// dont la demande a été acceptée (même logique que pour l'historique de la
// page profil : pas de notion de "compte privé" distincte dans cette appli,
// c'est le statut d'amitié qui fait foi).
//
// Identité d'un exercice : comme ailleurs dans le backend (sessions.php,
// workouts.php), un "exercice" est identifié par son NOM (normalisé en
// minuscules + trim), pas par son id qogym_exercises — un même exercice
// existe potentiellement sous plusieurs lignes/ids au fil des séances.
// ----------------------------------------------------------------------------

$user   = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$pdo    = getDB();

/**
 * Formule d'Epley pour le 1RM estimé.
 * reps = 1 → on renvoie le poids brut (pas d'extrapolation nécessaire).
 * reps <= 0 ou poids manquant/nul → pas de 1RM calculable (renvoie null).
 */
function estimateOneRepMax($weight, $reps): ?float
{
    $weight = $weight !== null ? (float)$weight : null;
    $reps   = $reps   !== null ? (int)$reps     : null;

    if ($weight === null || $weight <= 0 || $reps === null || $reps <= 0) {
        return null;
    }
    if ($reps === 1) {
        return round($weight, 1);
    }
    // Epley : 1RM = poids * (1 + reps / 30)
    return round($weight * (1 + $reps / 30), 1);
}

/**
 * Un utilisateur peut-il consulter la bibliothèque/progression de $targetId ?
 * Vrai si c'est son propre profil, ou s'il existe une amitié acceptée entre
 * les deux (peu importe qui a envoyé la demande).
 */
function canViewUserExercises(PDO $pdo, $viewerId, $targetId): bool
{
    if ((int)$viewerId === (int)$targetId) {
        return true;
    }
    $stmt = $pdo->prepare("
        SELECT 1 FROM qogym_friendships
        WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
          AND status = 'accepted'
    ");
    $stmt->execute([$viewerId, $targetId, $targetId, $viewerId]);
    return (bool)$stmt->fetch();
}

// =============================================================================
// BIBLIOTHÈQUE D'EXERCICES
// =============================================================================
if ($method === 'GET' && isset($_GET['library'])) {
    $targetId = (int)($_GET['user_id'] ?? $user['id']);

    $stmt = $pdo->prepare("SELECT id, username FROM qogym_users WHERE id = ?");
    $stmt->execute([$targetId]);
    $targetUser = $stmt->fetch();
    if (!$targetUser) {
        jsonResponse(['error' => 'Utilisateur non trouvé'], 404);
    }

    if (!canViewUserExercises($pdo, $user['id'], $targetId)) {
        jsonResponse(['error' => 'Accès refusé'], 403);
    }

    // Toutes les séries complétées de l'utilisateur, avec le nom d'exercice
    // et la date de la séance — triées chronologiquement pour pouvoir
    // agréger en une passe PHP (plus simple et plus sûr que du SQL complexe
    // pour calculer un 1RM max par groupe).
    $stmt = $pdo->prepare("
        SELECT e.name, cs.weight, cs.reps, cs.completed_workout_id, cw.completed_at
        FROM qogym_completed_sets cs
        INNER JOIN qogym_exercises e ON e.id = cs.exercise_id
        INNER JOIN qogym_completed_workouts cw ON cw.id = cs.completed_workout_id
        WHERE cw.user_id = ? AND cw.completed_at IS NOT NULL
        ORDER BY cw.completed_at ASC
    ");
    $stmt->execute([$targetId]);
    $rows = $stmt->fetchAll();

    $byKey = []; // name_key => aggregat
    foreach ($rows as $row) {
        $key = mb_strtolower(trim($row['name']));
        if ($key === '') continue;

        if (!isset($byKey[$key])) {
            $byKey[$key] = [
                'name'              => trim($row['name']),
                'times_performed'   => 0,
                'workout_ids'       => [],
                'total_sets'        => 0,
                'first_performed_at'=> $row['completed_at'],
                'last_performed_at' => $row['completed_at'],
                'best_one_rep_max'  => null,
                'best_weight'       => null,
                'best_reps'         => null,
            ];
        }

        // Toujours garder la casse la plus récente pour l'affichage (plus
        // susceptible de refléter comment l'utilisateur nomme l'exo aujourd'hui).
        $byKey[$key]['name'] = trim($row['name']);
        $byKey[$key]['total_sets'] += 1;
        $byKey[$key]['workout_ids'][$row['completed_workout_id']] = true;
        if ($row['completed_at'] > $byKey[$key]['last_performed_at']) {
            $byKey[$key]['last_performed_at'] = $row['completed_at'];
        }
        if ($row['completed_at'] < $byKey[$key]['first_performed_at']) {
            $byKey[$key]['first_performed_at'] = $row['completed_at'];
        }

        $orm = estimateOneRepMax($row['weight'], $row['reps']);
        if ($orm !== null && ($byKey[$key]['best_one_rep_max'] === null || $orm > $byKey[$key]['best_one_rep_max'])) {
            $byKey[$key]['best_one_rep_max'] = $orm;
            $byKey[$key]['best_weight']      = (float)$row['weight'];
            $byKey[$key]['best_reps']        = (int)$row['reps'];
        }
    }

    $exercises = [];
    foreach ($byKey as $agg) {
        $exercises[] = [
            'name'               => $agg['name'],
            'times_performed'    => count($agg['workout_ids']),
            'total_sets'         => $agg['total_sets'],
            'first_performed_at' => $agg['first_performed_at'],
            'last_performed_at'  => $agg['last_performed_at'],
            'best_one_rep_max'   => $agg['best_one_rep_max'],
            'best_weight'        => $agg['best_weight'],
            'best_reps'          => $agg['best_reps'],
        ];
    }

    // Tri par défaut : dernière fois faite, plus récent en premier. Le
    // frontend permet de re-trier (alphabétique / nb de fois) côté client.
    usort($exercises, fn($a, $b) => strcmp($b['last_performed_at'], $a['last_performed_at']));

    jsonResponse([
        'success'   => true,
        'user'      => $targetUser,
        'exercises' => $exercises,
    ]);
}

// =============================================================================
// PROGRESSION D'UN EXERCICE
// =============================================================================
if ($method === 'GET' && isset($_GET['progress'])) {
    $targetId = (int)($_GET['user_id'] ?? $user['id']);
    $name     = trim($_GET['name'] ?? '');
    $from     = $_GET['from'] ?? null; // YYYY-MM-DD, optionnel
    $to       = $_GET['to']   ?? null; // YYYY-MM-DD, optionnel

    if ($name === '') {
        jsonResponse(['error' => 'Nom d\'exercice requis'], 400);
    }

    $stmt = $pdo->prepare("SELECT id, username FROM qogym_users WHERE id = ?");
    $stmt->execute([$targetId]);
    $targetUser = $stmt->fetch();
    if (!$targetUser) {
        jsonResponse(['error' => 'Utilisateur non trouvé'], 404);
    }

    if (!canViewUserExercises($pdo, $user['id'], $targetId)) {
        jsonResponse(['error' => 'Accès refusé'], 403);
    }

    $nameKey = mb_strtolower($name);

    // Toutes les séries (sans filtre de date) pour calculer le 1RM all-time
    // et les bornes de dates disponibles, indépendamment du filtre appliqué
    // au graphique.
    $stmt = $pdo->prepare("
        SELECT e.name, cs.weight, cs.reps, cs.set_number, cs.completed_workout_id,
               cw.completed_at, ws.name AS session_name
        FROM qogym_completed_sets cs
        INNER JOIN qogym_exercises e ON e.id = cs.exercise_id
        INNER JOIN qogym_completed_workouts cw ON cw.id = cs.completed_workout_id
        INNER JOIN qogym_workout_sessions ws ON ws.id = cw.workout_session_id
        WHERE cw.user_id = ? AND cw.completed_at IS NOT NULL
          AND LOWER(TRIM(e.name)) = ?
        ORDER BY cw.completed_at ASC, cs.set_number ASC
    ");
    $stmt->execute([$targetId, $nameKey]);
    $allRows = $stmt->fetchAll();

    if (empty($allRows)) {
        jsonResponse([
            'success'            => true,
            'user'               => $targetUser,
            'name'               => $name,
            'all_time_best'      => null,
            'available_from'     => null,
            'available_to'       => null,
            'sessions'           => [],
        ]);
    }

    // 1RM all-time (toutes dates confondues)
    $allTimeBest = null;
    foreach ($allRows as $row) {
        $orm = estimateOneRepMax($row['weight'], $row['reps']);
        if ($orm !== null && ($allTimeBest === null || $orm > $allTimeBest['one_rep_max'])) {
            $allTimeBest = [
                'one_rep_max' => $orm,
                'weight'      => (float)$row['weight'],
                'reps'        => (int)$row['reps'],
                'achieved_at' => $row['completed_at'],
            ];
        }
    }
    $availableFrom = $allRows[0]['completed_at'];
    $availableTo   = $allRows[count($allRows) - 1]['completed_at'];

    // Applique le filtre de dates demandé (si fourni) pour construire la
    // série affichée dans le graphique de progression.
    $fromDt = $from ? $from . ' 00:00:00' : null;
    $toDt   = $to   ? $to   . ' 23:59:59' : null;

    $sessionsByWorkout = []; // completed_workout_id => données agrégées
    $order = [];
    foreach ($allRows as $row) {
        if ($fromDt !== null && $row['completed_at'] < $fromDt) continue;
        if ($toDt   !== null && $row['completed_at'] > $toDt)   continue;

        $wid = $row['completed_workout_id'];
        if (!isset($sessionsByWorkout[$wid])) {
            $sessionsByWorkout[$wid] = [
                'workout_id'      => (int)$wid,
                'completed_at'    => $row['completed_at'],
                'session_name'    => $row['session_name'],
                'sets'            => [],
                'best_one_rep_max'=> null,
                'best_weight'     => null,
                'best_reps'       => null,
                'total_volume_kg' => 0,
            ];
            $order[] = $wid;
        }

        $orm = estimateOneRepMax($row['weight'], $row['reps']);
        $sessionsByWorkout[$wid]['sets'][] = [
            'set_number'  => (int)$row['set_number'],
            'weight'      => $row['weight'] !== null ? (float)$row['weight'] : null,
            'reps'        => (int)$row['reps'],
            'one_rep_max' => $orm,
        ];
        if ($row['weight'] !== null) {
            $sessionsByWorkout[$wid]['total_volume_kg'] += (float)$row['weight'] * (int)$row['reps'];
        }
        if ($orm !== null && ($sessionsByWorkout[$wid]['best_one_rep_max'] === null || $orm > $sessionsByWorkout[$wid]['best_one_rep_max'])) {
            $sessionsByWorkout[$wid]['best_one_rep_max'] = $orm;
            $sessionsByWorkout[$wid]['best_weight']      = (float)$row['weight'];
            $sessionsByWorkout[$wid]['best_reps']        = (int)$row['reps'];
        }
    }

    $sessions = array_map(fn($wid) => $sessionsByWorkout[$wid], $order);

    jsonResponse([
        'success'        => true,
        'user'           => $targetUser,
        'name'           => $allRows[count($allRows) - 1]['name'], // casse la plus récente
        'all_time_best'  => $allTimeBest,
        'available_from' => $availableFrom,
        'available_to'   => $availableTo,
        'sessions'       => $sessions,
    ]);
}

jsonResponse(['error' => 'Action non reconnue'], 400);
