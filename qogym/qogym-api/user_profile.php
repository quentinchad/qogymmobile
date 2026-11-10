<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// =============================================================================
// HISTORIQUE PAGINÉ D'UN UTILISATEUR
// =============================================================================
// GET ?user_id=N&history=1&limit=10&offset=20
// Renvoie une page d'entraînements supplémentaires pour le bouton
// "Charger plus" sur la page profil. Les 20 premiers sont déjà renvoyés
// par l'endpoint principal ci-dessous.
// =============================================================================
if ($method === 'GET' && isset($_GET['user_id']) && isset($_GET['history'])) {
    $targetId = (int)$_GET['user_id'];
    $limit    = isset($_GET['limit'])  ? max(1, min(50, (int)$_GET['limit'])) : 10;
    $offset   = isset($_GET['offset']) ? max(0, (int)$_GET['offset'])         : 0;

    // Vérifier que l'utilisateur cible existe
    $stmt = $pdo->prepare("SELECT id FROM qogym_users WHERE id = ?");
    $stmt->execute([$targetId]);
    if (!$stmt->fetch()) {
        jsonResponse(['error' => 'Utilisateur non trouvé'], 404);
        exit;
    }

    // Vérifier la relation d'amitié — on ne révèle l'historique que si
    // c'est notre propre profil ou un ami accepté.
    $isOwnProfile = ($targetId === (int)$user['id']);
    $isFriend = false;
    if (!$isOwnProfile) {
        $stmt = $pdo->prepare("
            SELECT 1 FROM qogym_friendships
            WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
              AND status = 'accepted'
        ");
        $stmt->execute([$user['id'], $targetId, $targetId, $user['id']]);
        $isFriend = (bool)$stmt->fetch();
    }
    if (!$isOwnProfile && !$isFriend) {
        jsonResponse(['error' => 'Accès refusé'], 403);
        exit;
    }

    $stmt = $pdo->prepare("
        SELECT 
            cw.id,
            cw.completed_at,
            cw.notes,
            ws.name  as session_name,
            ws.image_url as session_image,
            st.name  as session_type_name,
            (SELECT COUNT(*) FROM qogym_completed_sets WHERE completed_workout_id = cw.id) as total_sets,
            (SELECT COUNT(*) FROM qogym_workout_likes  WHERE completed_workout_id = cw.id) as likes_count,
            (SELECT COUNT(*) FROM qogym_workout_comments WHERE completed_workout_id = cw.id) as comments_count,
            EXISTS(SELECT 1 FROM qogym_workout_likes WHERE completed_workout_id = cw.id AND user_id = ?) as user_has_liked
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
        INNER JOIN qogym_session_types   st ON ws.session_type_id = st.id
        WHERE cw.user_id = ?
          AND cw.completed_at IS NOT NULL
        ORDER BY cw.completed_at DESC
        LIMIT ? OFFSET ?
    ");
    $stmt->execute([$user['id'], $targetId, $limit, $offset]);
    $history = $stmt->fetchAll();

    jsonResponse([
        'success'  => true,
        'history'  => $history,
        // has_more = true si on a renvoyé une page pleine, indique au front
        // qu'il y a probablement plus d'entrées disponibles.
        'has_more' => count($history) === $limit,
    ]);
    exit;
}

// =============================================================================
// PROFIL D'UN UTILISATEUR (page initiale, avec premiers 20 entraînements)
// =============================================================================
if ($method === 'GET' && isset($_GET['user_id'])) {
    $targetId = (int)$_GET['user_id'];

    // Récupérer les infos de base de l'utilisateur cible
    $stmt = $pdo->prepare("
        SELECT id, username, pdp, created_at
        FROM qogym_users
        WHERE id = ?
    ");
    $stmt->execute([$targetId]);
    $targetUser = $stmt->fetch();

    if (!$targetUser) {
        jsonResponse(['error' => 'Utilisateur non trouvé'], 404);
        exit;
    }

    // Vérifier la relation d'amitié avec l'utilisateur connecté
    $stmt = $pdo->prepare("
        SELECT id, status,
               CASE WHEN user_id = ? THEN 'sent' ELSE 'received' END as direction
        FROM qogym_friendships
        WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
    ");
    $stmt->execute([$user['id'], $user['id'], $targetId, $targetId, $user['id']]);
    $friendship = $stmt->fetch();

    $friendshipStatus = null;
    $friendshipId = null;
    $friendshipDirection = null;

    if ($friendship) {
        $friendshipStatus    = $friendship['status'];
        $friendshipId        = $friendship['id'];
        $friendshipDirection = $friendship['direction'];
    }

    $isFriend = ($friendshipStatus === 'accepted');
    $isOwnProfile = ($targetId === (int)$user['id']);

    // Stats de base (toujours visibles)
    $stmt = $pdo->prepare("
        SELECT
            COUNT(DISTINCT cw.id)                     as total_workouts,
            COUNT(DISTINCT DATE(cw.completed_at))     as total_days,
            COUNT(cs.id)                              as total_sets,
            SUM(cs.reps)                              as total_reps
        FROM qogym_completed_workouts cw
        LEFT JOIN qogym_completed_sets cs ON cw.id = cs.completed_workout_id
        WHERE cw.user_id = ? AND cw.completed_at IS NOT NULL
    ");
    $stmt->execute([$targetId]);
    $stats = $stmt->fetch();

    // Historique récent — uniquement si ami ou profil propre
    $history = [];
    $hasMore = false;
    $initialLimit = 20;
    if ($isFriend || $isOwnProfile) {
        // On demande limit+1 pour savoir s'il y a une suite, puis on tronque.
        $stmt = $pdo->prepare("
            SELECT 
                cw.id,
                cw.completed_at,
                cw.notes,
                ws.name  as session_name,
                ws.image_url as session_image,
                st.name  as session_type_name,
                (SELECT COUNT(*) FROM qogym_completed_sets WHERE completed_workout_id = cw.id) as total_sets,
                (SELECT COUNT(*) FROM qogym_workout_likes  WHERE completed_workout_id = cw.id) as likes_count,
                (SELECT COUNT(*) FROM qogym_workout_comments WHERE completed_workout_id = cw.id) as comments_count,
                EXISTS(SELECT 1 FROM qogym_workout_likes WHERE completed_workout_id = cw.id AND user_id = ?) as user_has_liked
            FROM qogym_completed_workouts cw
            INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
            INNER JOIN qogym_session_types   st ON ws.session_type_id = st.id
            WHERE cw.user_id = ?
              AND cw.completed_at IS NOT NULL
            ORDER BY cw.completed_at DESC
            LIMIT ?
        ");
        $stmt->execute([$user['id'], $targetId, $initialLimit + 1]);
        $rows = $stmt->fetchAll();
        if (count($rows) > $initialLimit) {
            $hasMore = true;
            $history = array_slice($rows, 0, $initialLimit);
        } else {
            $history = $rows;
        }
    }

    jsonResponse([
        'success'              => true,
        'user'                 => $targetUser,
        'stats'                => $stats,
        'history'              => $history,
        'history_has_more'     => $hasMore,
        'is_friend'            => $isFriend,
        'is_own_profile'       => $isOwnProfile,
        'friendship_status'    => $friendshipStatus,
        'friendship_id'        => $friendshipId,
        'friendship_direction' => $friendshipDirection,
    ]);
    exit;
}

jsonResponse(['error' => 'Action non reconnue'], 400);
exit;
