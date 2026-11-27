<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// Vérifier que l'utilisateur est admin
if (!$user['is_admin']) {
    jsonResponse(['error' => 'Accès non autorisé'], 403);
}

// STATISTIQUES GÉNÉRALES
if ($method === 'GET' && isset($_GET['stats'])) {
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM qogym_users");
    $totalUsers = $stmt->fetch()['total'];
    
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM qogym_workout_sessions WHERE is_qojim_session = 1");
    $totalQojimSessions = $stmt->fetch()['total'];
    
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM qogym_completed_workouts WHERE completed_at IS NOT NULL");
    $totalWorkouts = $stmt->fetch()['total'];
    
    jsonResponse([
        'success' => true,
        'stats' => [
            'total_users' => $totalUsers,
            'total_qojim_sessions' => $totalQojimSessions,
            'total_completed_workouts' => $totalWorkouts
        ]
    ]);
}

// LISTE DES UTILISATEURS
if ($method === 'GET' && isset($_GET['users'])) {
    $stmt = $pdo->query("
        SELECT id, email, username, is_admin, created_at,
               (SELECT COUNT(*) FROM qogym_completed_workouts WHERE user_id = qogym_users.id AND completed_at IS NOT NULL) as total_workouts
        FROM qogym_users
        ORDER BY created_at DESC
    ");
    $users = $stmt->fetchAll();
    
    jsonResponse(['success' => true, 'users' => $users]);
}

// TYPES DE SÉANCES
if ($method === 'GET' && isset($_GET['session_types'])) {
    $stmt = $pdo->query("
        SELECT st.*, COUNT(ws.id) as usage_count
        FROM qogym_session_types st
        LEFT JOIN qogym_workout_sessions ws ON st.id = ws.session_type_id
        GROUP BY st.id
        ORDER BY st.name
    ");
    $types = $stmt->fetchAll();
    
    jsonResponse(['success' => true, 'session_types' => $types]);
}

// CRÉER UN TYPE DE SÉANCE
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'create_type') {
    $name = trim($input['name'] ?? '');
    
    if (empty($name)) {
        jsonResponse(['error' => 'Nom du type requis'], 400);
    }
    
    $stmt = $pdo->prepare("INSERT INTO qogym_session_types (name) VALUES (?)");
    $stmt->execute([$name]);
    
    jsonResponse(['success' => true, 'type_id' => $pdo->lastInsertId()]);
}

// METTRE À JOUR UN TYPE DE SÉANCE
if ($method === 'PUT' && isset($input['action']) && $input['action'] === 'update_type') {
    $typeId = $input['type_id'] ?? null;
    $name = trim($input['name'] ?? '');
    
    if (!$typeId || empty($name)) {
        jsonResponse(['error' => 'ID et nom requis'], 400);
    }
    
    $stmt = $pdo->prepare("UPDATE qogym_session_types SET name = ? WHERE id = ?");
    $stmt->execute([$name, $typeId]);
    
    jsonResponse(['success' => true, 'message' => 'Type mis à jour']);
}

// SUPPRIMER UN TYPE DE SÉANCE
if ($method === 'DELETE' && isset($_GET['type_id'])) {
    $typeId = $_GET['type_id'];
    
    // Vérifier qu'il n'est pas utilisé
    $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM qogym_workout_sessions WHERE session_type_id = ?");
    $stmt->execute([$typeId]);
    if ($stmt->fetch()['count'] > 0) {
        jsonResponse(['error' => 'Ce type est utilisé par des séances'], 409);
    }
    
    $stmt = $pdo->prepare("DELETE FROM qogym_session_types WHERE id = ?");
    $stmt->execute([$typeId]);
    
    jsonResponse(['success' => true, 'message' => 'Type supprimé']);
}

// LISTE DES SÉANCES QOJIM (incluant archivées)
if ($method === 'GET' && isset($_GET['qojim_sessions'])) {
    $stmt = $pdo->query("
        SELECT ws.*, st.name as session_type_name,
               (SELECT COUNT(*) FROM qogym_user_library WHERE workout_session_id = ws.id) as users_count
        FROM qogym_workout_sessions ws
        INNER JOIN qogym_session_types st ON ws.session_type_id = st.id
        WHERE ws.is_qojim_session = 1
        ORDER BY ws.is_archived, ws.created_at DESC
    ");
    $sessions = $stmt->fetchAll();
    
    jsonResponse(['success' => true, 'sessions' => $sessions]);
}

// ============================================================================
// SUPPRESSION D'UN UTILISATEUR (définitive)
//
//   GET  ?delete_preview=N
//        → { user, counts } : ce qui sera supprimé (pour la confirmation)
//   POST { action: 'delete_user', user_id: N, confirm_username: "…" }
//        → supprime le compte et TOUTES ses données, dans une transaction.
//
// Garde-fous : impossible de se supprimer soi-même ou de supprimer un autre
// admin (retirer d'abord son rôle dans la base) ; confirm_username doit
// correspondre exactement au pseudo, pour éviter une erreur d'id.
//
// Ce qui part : ses entraînements (séries, participants, likes, commentaires,
// musique), ses likes / commentaires sur les séances des autres (et les
// réponses à ses commentaires), amis, partages, bibliothèque, nutrition,
// pas, poids, rapports, tokens, réactions Recomp.
// Ses séances (modèles) sont supprimées, SAUF celles qui ont servi aux
// entraînements d'autres utilisateurs : elles sont seulement marquées
// supprimées (comme une suppression normale) pour ne pas casser leur historique.
// Les séances officielles Qojim ne sont jamais supprimées.
// ============================================================================

/** Exécute une requête ; ignore seulement l'absence de table / colonne (migrations optionnelles). */
function adminExec(PDO $pdo, string $sql, array $params = []): int
{
    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    } catch (PDOException $e) {
        if (in_array($e->getCode(), ['42S02', '42S22'], true)) return 0;
        throw $e;
    }
}

function adminCount(PDO $pdo, string $sql, array $params = []): int
{
    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return (int)$stmt->fetchColumn();
    } catch (PDOException $e) {
        if (in_array($e->getCode(), ['42S02', '42S22'], true)) return 0;
        throw $e;
    }
}

function adminLoadTarget(PDO $pdo, array $me, $targetId): array
{
    $targetId = (int)$targetId;
    if ($targetId <= 0) jsonResponse(['error' => 'user_id requis'], 400);
    $stmt = $pdo->prepare("SELECT id, username, email, is_admin, created_at FROM qogym_users WHERE id = ?");
    $stmt->execute([$targetId]);
    $target = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$target) jsonResponse(['error' => 'Utilisateur introuvable'], 404);
    if ((int)$target['id'] === (int)$me['id']) {
        jsonResponse(['error' => 'Tu ne peux pas supprimer ton propre compte'], 400);
    }
    if ((int)$target['is_admin'] === 1) {
        jsonResponse(['error' => 'Impossible de supprimer un administrateur (retire d\'abord son rôle admin)'], 400);
    }
    return $target;
}

if ($method === 'GET' && isset($_GET['delete_preview'])) {
    $target = adminLoadTarget($pdo, $user, $_GET['delete_preview']);
    $uid = (int)$target['id'];
    jsonResponse([
        'success' => true,
        'user'    => $target,
        'counts'  => [
            'workouts'     => adminCount($pdo, "SELECT COUNT(*) FROM qogym_completed_workouts WHERE user_id = ?", [$uid]),
            'sessions'     => adminCount($pdo, "SELECT COUNT(*) FROM qogym_workout_sessions WHERE user_id = ? AND is_qojim_session = 0", [$uid]),
            'friends'      => adminCount($pdo, "SELECT COUNT(*) FROM qogym_friendships WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'", [$uid, $uid]),
            'food_entries' => adminCount($pdo, "SELECT COUNT(*) FROM qogym_food_entries WHERE user_id = ?", [$uid]),
            'comments'     => adminCount($pdo, "SELECT COUNT(*) FROM qogym_workout_comments WHERE user_id = ?", [$uid]),
        ],
    ]);
}

if ($method === 'POST' && isset($input['action']) && $input['action'] === 'delete_user') {
    $target = adminLoadTarget($pdo, $user, $input['user_id'] ?? 0);
    $uid = (int)$target['id'];
    if (!isset($input['confirm_username']) || (string)$input['confirm_username'] !== (string)$target['username']) {
        jsonResponse(['error' => 'Le pseudo de confirmation ne correspond pas'], 400);
    }

    $deleted = [];
    $pdo->beginTransaction();
    try {
        // 1. Ses entraînements et tout ce qui y est rattaché
        $w = "SELECT id FROM qogym_completed_workouts WHERE user_id = ?";
        adminExec($pdo, "DELETE FROM qogym_completed_sets WHERE completed_workout_id IN ($w)", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_workout_participants WHERE completed_workout_id IN ($w)", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_workout_likes WHERE completed_workout_id IN ($w)", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_workout_comments WHERE completed_workout_id IN ($w)", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_workout_music WHERE completed_workout_id IN ($w)", [$uid]);
        $deleted['workouts'] = adminExec($pdo, "DELETE FROM qogym_completed_workouts WHERE user_id = ?", [$uid]);

        // 2. Ses traces chez les autres
        adminExec($pdo, "DELETE FROM qogym_workout_likes WHERE user_id = ?", [$uid]);
        // Réponses à ses commentaires, puis ses commentaires (table dérivée :
        // MySQL refuse un sous-SELECT direct sur la table qu'on supprime)
        adminExec($pdo, "DELETE FROM qogym_workout_comments WHERE parent_comment_id IN
                            (SELECT id FROM (SELECT id FROM qogym_workout_comments WHERE user_id = ?) t)", [$uid]);
        $deleted['comments'] = adminExec($pdo, "DELETE FROM qogym_workout_comments WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_workout_participants WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_external_comments WHERE parent_comment_id IN
                            (SELECT id FROM (SELECT id FROM qogym_external_comments WHERE user_id = ?) t)", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_external_comments WHERE user_id = ? OR owner_id = ?", [$uid, $uid]);
        adminExec($pdo, "DELETE FROM qogym_external_likes WHERE user_id = ? OR owner_id = ?", [$uid, $uid]);

        // 3. Relations
        $deleted['friendships'] = adminExec($pdo, "DELETE FROM qogym_friendships WHERE user_id = ? OR friend_id = ?", [$uid, $uid]);
        adminExec($pdo, "DELETE FROM qogym_session_shares WHERE sender_id = ? OR receiver_id = ?", [$uid, $uid]);
        adminExec($pdo, "DELETE FROM qogym_user_library WHERE user_id = ?", [$uid]);

        // 4. Ses séances (modèles), hors séances officielles Qojim
        $stmt = $pdo->prepare("SELECT id FROM qogym_workout_sessions WHERE user_id = ? AND is_qojim_session = 0");
        $stmt->execute([$uid]);
        $sessionIds = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
        $deleted['sessions'] = 0;
        $deleted['sessions_kept'] = 0;
        foreach ($sessionIds as $sid) {
            adminExec($pdo, "DELETE FROM qogym_user_library WHERE workout_session_id = ?", [$sid]);
            adminExec($pdo, "DELETE FROM qogym_session_shares WHERE session_id = ?", [$sid]);
            $usedByOthers = adminCount($pdo, "SELECT COUNT(*) FROM qogym_completed_workouts WHERE workout_session_id = ?", [$sid]) > 0;
            if ($usedByOthers) {
                // Sert à l'historique d'autres utilisateurs : on la garde, marquée supprimée
                adminExec($pdo, "UPDATE qogym_workout_sessions SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [$sid]);
                $deleted['sessions_kept']++;
            } else {
                adminExec($pdo, "DELETE FROM qogym_exercises WHERE workout_session_id = ?", [$sid]);
                adminExec($pdo, "DELETE FROM qogym_workout_sessions WHERE id = ?", [$sid]);
                $deleted['sessions']++;
            }
        }

        // 5. Nutrition, suivi, comptes
        adminExec($pdo, "DELETE FROM qogym_meal_templates WHERE user_id = ?", [$uid]); // + aliments (cascade)
        $deleted['food_entries'] = adminExec($pdo, "DELETE FROM qogym_food_entries WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_food_meals WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_food_items WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_daily_steps WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_body_weights WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_monthly_reports WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_password_resets WHERE user_id = ?", [$uid]);
        adminExec($pdo, "DELETE FROM qogym_auth_tokens WHERE user_id = ?", [$uid]);

        // 6. Le compte
        $stmt = $pdo->prepare("DELETE FROM qogym_users WHERE id = ?");
        $stmt->execute([$uid]);

        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        error_log('[admin delete_user ' . $uid . '] ' . $e->getMessage());
        jsonResponse([
            'error'  => 'Suppression annulée : rien n\'a été supprimé',
            'detail' => $e->getMessage(),
        ], 500);
    }

    jsonResponse([
        'success'  => true,
        'username' => $target['username'],
        'deleted'  => $deleted,
    ]);
}

jsonResponse(['error' => 'Action non reconnue'], 400);
?>
