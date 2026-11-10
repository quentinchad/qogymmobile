<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// Fonction pour envoyer un email de notification
function sendNotificationEmail($toEmail, $toUsername, $fromUsername, $action, $workoutName)
{
    $subject = '';
    $message = '';

    if ($action === 'like') {
        $subject = "QoGym - $fromUsername a aimé votre entraînement";
        $message = "
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2e7d50; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .highlight { color: #2e7d50; font-weight: bold; }
                    .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class='container'>
                    <div class='header'>
                        <h2>QoGym</h2>
                    </div>
                    <div class='content'>
                        <p>Salut <strong>$toUsername</strong>,</p>
                        <p><span class='highlight'>$fromUsername</span> a aimé votre entraînement :</p>
                        <p style='font-size: 18px; margin: 20px 0;'><strong>$workoutName</strong></p>
                        <p>Continuez comme ça !</p>
                    </div>
                    <div class='footer'>
                        <p>QoGym - Votre application de fitness</p>
                    </div>
                </div>
            </body>
            </html>
        ";
    } else if ($action === 'comment') {
        $subject = "QoGym - $fromUsername a commenté votre entraînement";
        $message = "
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2e7d50; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .highlight { color: #2e7d50; font-weight: bold; }
                    .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class='container'>
                    <div class='header'>
                        <h2>QoGym</h2>
                    </div>
                    <div class='content'>
                        <p>Salut <strong>$toUsername</strong>,</p>
                        <p><span class='highlight'>$fromUsername</span> a commenté votre entraînement :</p>
                        <p style='font-size: 18px; margin: 20px 0;'><strong>$workoutName</strong></p>
                        <p>Consultez l'application pour voir le commentaire !</p>
                    </div>
                    <div class='footer'>
                        <p>QoGym - Votre application de fitness</p>
                    </div>
                </div>
            </body>
            </html>
        ";
    } else if ($action === 'reply') {
        // Réponse à un commentaire — on notifie l'auteur du commentaire
        // parent. Le contexte est différent du cas "comment" : on ne parle
        // pas de "votre entraînement" mais de "votre commentaire".
        $subject = "QoGym - $fromUsername a répondu à votre commentaire";
        $message = "
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2e7d50; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .highlight { color: #2e7d50; font-weight: bold; }
                    .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class='container'>
                    <div class='header'>
                        <h2>QoGym</h2>
                    </div>
                    <div class='content'>
                        <p>Salut <strong>$toUsername</strong>,</p>
                        <p><span class='highlight'>$fromUsername</span> a répondu à votre commentaire sur l'entraînement :</p>
                        <p style='font-size: 18px; margin: 20px 0;'><strong>$workoutName</strong></p>
                        <p>Consultez l'application pour voir la réponse !</p>
                    </div>
                    <div class='footer'>
                        <p>QoGym - Votre application de fitness</p>
                    </div>
                </div>
            </body>
            </html>
        ";
    }

    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: QoGym <noreply@qojim.com>\r\n";

    // Envoyer l'email (mode silencieux, pas d'erreur si échec)
    @mail($toEmail, $subject, $message, $headers);
}

// RÉCUPÉRER LE FEED (entraînements des amis + entraînements partagés + propres entraînements)
if ($method === 'GET' && isset($_GET['feed'])) {
    $limit = $_GET['limit'] ?? 50;
    $offset = $_GET['offset'] ?? 0;

    // Récupérer les IDs des amis
    $stmt = $pdo->prepare("
        SELECT 
            CASE 
                WHEN user_id = ? THEN friend_id
                ELSE user_id
            END as friend_id
        FROM qogym_friendships
        WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
    ");
    $stmt->execute([$user['id'], $user['id'], $user['id']]);
    $friends = $stmt->fetchAll(PDO::FETCH_COLUMN);

    // Ajouter l'ID de l'utilisateur lui-même pour voir ses propres entraînements
    $allUserIds = array_merge($friends, [$user['id']]);
    $placeholders = implode(',', array_fill(0, count($allUserIds), '?'));

    // Récupérer les entraînements du feed (DISTINCT pour éviter les doublons)
    $stmt = $pdo->prepare("
        SELECT DISTINCT
            cw.id,
            cw.user_id,
            cw.workout_session_id,
            cw.started_at,
            cw.completed_at,
            cw.notes,
            u.username as user_username,
            u.pdp as user_pdp,
            ws.name as session_name,
            ws.image_url as session_image,
            st.name as session_type_name,
            (SELECT COUNT(*) FROM qogym_workout_likes WHERE completed_workout_id = cw.id) as likes_count,
            (SELECT COUNT(*) FROM qogym_workout_comments WHERE completed_workout_id = cw.id) as comments_count,
            EXISTS(SELECT 1 FROM qogym_workout_likes WHERE completed_workout_id = cw.id AND user_id = ?) as user_has_liked,
            (SELECT GROUP_CONCAT(u2.username SEPARATOR ', ') 
             FROM qogym_workout_participants wp 
             INNER JOIN qogym_users u2 ON wp.user_id = u2.id 
             WHERE wp.completed_workout_id = cw.id) as participants
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_users u ON cw.user_id = u.id
        INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
        INNER JOIN qogym_session_types st ON ws.session_type_id = st.id
        LEFT JOIN qogym_workout_participants wp ON cw.id = wp.completed_workout_id
        WHERE cw.completed_at IS NOT NULL 
        AND (
            (u.default_workout_privacy = 'public' AND cw.user_id IN ($placeholders))
            OR cw.user_id = ?
            OR wp.user_id = ?
        )
        ORDER BY cw.completed_at DESC
        LIMIT ? OFFSET ?
    ");

    $params = array_merge([$user['id']], $allUserIds, [$user['id'], $user['id'], (int)$limit, (int)$offset]);
    $stmt->execute($params);
    $workouts = $stmt->fetchAll();

    jsonResponse(['success' => true, 'workouts' => $workouts]);
}

// DÉTAILS D'UN ENTRAÎNEMENT AVEC PERFORMANCES
if ($method === 'GET' && isset($_GET['workout_id'])) {
    $workoutId = $_GET['workout_id'];

    // Récupérer l'entraînement
    $stmt = $pdo->prepare("
        SELECT 
            cw.*,
            u.username as user_username,
            u.pdp as user_pdp,
            ws.name as session_name,
            ws.image_url as session_image,
            st.name as session_type_name,
            (SELECT COUNT(*) FROM qogym_workout_likes WHERE completed_workout_id = cw.id) as likes_count,
            (SELECT COUNT(*) FROM qogym_workout_comments WHERE completed_workout_id = cw.id) as comments_count,
            EXISTS(SELECT 1 FROM qogym_workout_likes WHERE completed_workout_id = cw.id AND user_id = ?) as user_has_liked
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_users u ON cw.user_id = u.id
        INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
        INNER JOIN qogym_session_types st ON ws.session_type_id = st.id
        WHERE cw.id = ?
    ");
    $stmt->execute([$user['id'], $workoutId]);
    $workout = $stmt->fetch();

    if (!$workout) {
        jsonResponse(['error' => 'Entraînement non trouvé'], 404);
    }

    // Vérifier les permissions (amis ou participant)
    $hasAccess = false;

    // Si c'est public (selon la préférence de l'utilisateur)
    $stmt = $pdo->prepare("SELECT default_workout_privacy FROM qogym_users WHERE id = ?");
    $stmt->execute([$workout['user_id']]);
    $ownerPreferences = $stmt->fetch();
    $isPublic = $ownerPreferences && $ownerPreferences['default_workout_privacy'] === 'public';

    if ($isPublic) {
        // Vérifier si ami ou participant
        $stmt = $pdo->prepare("
            SELECT 1 FROM (
                SELECT 
                    CASE 
                        WHEN user_id = ? THEN friend_id
                        ELSE user_id
                    END as friend_id
                FROM qogym_friendships
                WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
            ) friends
            WHERE friend_id = ?
            UNION
            SELECT 1 FROM qogym_workout_participants
            WHERE completed_workout_id = ? AND user_id = ?
            LIMIT 1
        ");
        $stmt->execute([$user['id'], $user['id'], $user['id'], $workout['user_id'], $workoutId, $user['id']]);
        $hasAccess = $stmt->fetch() || $workout['user_id'] == $user['id'];
    } else {
        // Si privé, seulement le propriétaire
        $hasAccess = $workout['user_id'] == $user['id'];
    }

    if (!$hasAccess) {
        jsonResponse(['error' => 'Accès non autorisé'], 403);
    }

    // Récupérer les participants
    $stmt = $pdo->prepare("
        SELECT u.id, u.username
        FROM qogym_workout_participants wp
        INNER JOIN qogym_users u ON wp.user_id = u.id
        WHERE wp.completed_workout_id = ?
    ");
    $stmt->execute([$workoutId]);
    $workout['participants'] = $stmt->fetchAll();

    // Utiliser le snapshot d'ordre si disponible (modifs pendant séance)
    $orderSnapshot = null;
    if (!empty($workout['exercise_order_snapshot'])) {
        $orderSnapshot = json_decode($workout['exercise_order_snapshot'], true);
    }

    // Récupérer tous les exercices ayant des sets pour ce workout
    // (inclut les exos custom créés pendant la séance via is_workout_custom)
    $stmt = $pdo->prepare("
        SELECT DISTINCT
            e.id,
            e.name as exercise_name,
            e.sets as planned_sets,
            e.reps_min,
            e.reps_max,
            e.rest_time,
            e.exercise_order,
            e.superset_group
        FROM qogym_exercises e
        INNER JOIN qogym_completed_sets cs ON cs.exercise_id = e.id
        WHERE cs.completed_workout_id = ?
    ");
    $stmt->execute([$workoutId]);
    $exercises = $stmt->fetchAll();

    // Pour chaque exercice, récupérer les sets complétés
    foreach ($exercises as &$exercise) {
        $stmt = $pdo->prepare("
            SELECT set_number, weight, reps
            FROM qogym_completed_sets
            WHERE completed_workout_id = ? AND exercise_id = ?
            ORDER BY set_number
        ");
        $stmt->execute([$workoutId, $exercise['id']]);
        $exercise['completed_sets'] = $stmt->fetchAll();
    }
    unset($exercise); // bonne pratique : casser la référence

    // Filtrer ceux sans aucun set (sécurité)
    $exercises = array_values(array_filter($exercises, function ($ex) {
        return count($ex['completed_sets']) > 0;
    }));

    // Appliquer l'ordre du snapshot si disponible
    // Le snapshot peut aussi override le superset_group : si l'utilisateur
    // a modifié le groupement pendant la séance sans propager au template,
    // l'info ne vit que dans le snapshot.
    if ($orderSnapshot) {
        $orderMap = [];
        $supersetMap = [];
        foreach ($orderSnapshot as $snap) {
            $orderMap[$snap['name']] = $snap['display_order'];
            if (array_key_exists('superset_group', $snap)) {
                $supersetMap[$snap['name']] = $snap['superset_group']; // peut être null
            }
        }
        usort($exercises, function ($a, $b) use ($orderMap) {
            $oa = $orderMap[$a['exercise_name']] ?? $a['exercise_order'];
            $ob = $orderMap[$b['exercise_name']] ?? $b['exercise_order'];
            return $oa <=> $ob;
        });
        // Override superset_group depuis le snapshot
        foreach ($exercises as &$ex) {
            if (array_key_exists($ex['exercise_name'], $supersetMap)) {
                $ex['superset_group'] = $supersetMap[$ex['exercise_name']];
            }
        }
        unset($ex);
    } else {
        usort($exercises, fn($a, $b) => $a['exercise_order'] <=> $b['exercise_order']);
    }

    $workout['exercises'] = $exercises;

    // Récupérer les likes
    $stmt = $pdo->prepare("
        SELECT u.id, u.username, wl.created_at
        FROM qogym_workout_likes wl
        INNER JOIN qogym_users u ON wl.user_id = u.id
        WHERE wl.completed_workout_id = ?
        ORDER BY wl.created_at DESC
    ");
    $stmt->execute([$workoutId]);
    $workout['likes'] = $stmt->fetchAll();

    // Récupérer les commentaires (incluant les réponses, identifiables par
    // parent_comment_id non nul). On les remonte tous à plat triés par date,
    // c'est le frontend qui regroupe les réponses sous leur parent.
    $stmt = $pdo->prepare("
        SELECT wc.id, wc.comment, wc.parent_comment_id, wc.created_at, wc.updated_at,
               u.id as user_id, u.username, u.pdp as user_pdp,
               (wc.user_id = ?) as is_owner
        FROM qogym_workout_comments wc
        INNER JOIN qogym_users u ON wc.user_id = u.id
        WHERE wc.completed_workout_id = ?
        ORDER BY wc.created_at ASC
    ");
    $stmt->execute([$user['id'], $workoutId]);
    $workout['comments'] = $stmt->fetchAll();

    jsonResponse(['success' => true, 'workout' => $workout]);
}

// LIKER UN ENTRAÎNEMENT
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'like') {
    $workoutId = $input['workout_id'] ?? null;

    if (!$workoutId) {
        jsonResponse(['error' => 'ID entraînement requis'], 400);
    }

    // Récupérer les infos complètes de l'entraînement et du propriétaire
    $stmt = $pdo->prepare("
        SELECT cw.user_id, u.default_workout_privacy, u.email, u.username as owner_username, ws.name as workout_name
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_users u ON cw.user_id = u.id
        INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
        WHERE cw.id = ?
    ");
    $stmt->execute([$workoutId]);
    $workout = $stmt->fetch();

    if (!$workout) {
        jsonResponse(['error' => 'Entraînement non trouvé'], 404);
    }

    if ($workout['default_workout_privacy'] !== 'public') {
        jsonResponse(['error' => 'Entraînement privé'], 403);
    }

    // Vérifier si déjà liké
    $stmt = $pdo->prepare("SELECT id FROM qogym_workout_likes WHERE completed_workout_id = ? AND user_id = ?");
    $stmt->execute([$workoutId, $user['id']]);

    if ($stmt->fetch()) {
        // Déjà liké, on unlike (pas d'email)
        $stmt = $pdo->prepare("DELETE FROM qogym_workout_likes WHERE completed_workout_id = ? AND user_id = ?");
        $stmt->execute([$workoutId, $user['id']]);
        jsonResponse(['success' => true, 'action' => 'unliked']);
    } else {
        // Pas encore liké, on like
        $stmt = $pdo->prepare("INSERT INTO qogym_workout_likes (completed_workout_id, user_id) VALUES (?, ?)");
        $stmt->execute([$workoutId, $user['id']]);

        // Envoyer un email au propriétaire de l'entraînement (sauf si c'est lui-même)
        if ($workout['user_id'] != $user['id']) {
            sendNotificationEmail(
                $workout['email'],
                $workout['owner_username'],
                $user['username'],
                'like',
                $workout['workout_name']
            );
        }

        jsonResponse(['success' => true, 'action' => 'liked']);
    }
}

// COMMENTER UN ENTRAÎNEMENT (commentaire racine ou réponse)
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'comment') {
    $workoutId       = $input['workout_id'] ?? null;
    $comment         = trim($input['comment'] ?? '');
    // parent_comment_id optionnel : si fourni, c'est une réponse à ce
    // commentaire. NULL → commentaire racine (comportement précédent).
    $parentCommentId = isset($input['parent_comment_id']) && (int)$input['parent_comment_id'] > 0
        ? (int)$input['parent_comment_id']
        : null;

    if (!$workoutId || empty($comment)) {
        jsonResponse(['error' => 'Entraînement et commentaire requis'], 400);
    }

    // Récupérer les infos complètes de l'entraînement et du propriétaire
    $stmt = $pdo->prepare("
        SELECT cw.user_id, u.default_workout_privacy, u.email, u.username as owner_username, ws.name as workout_name
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_users u ON cw.user_id = u.id
        INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
        WHERE cw.id = ?
    ");
    $stmt->execute([$workoutId]);
    $workout = $stmt->fetch();

    if (!$workout) {
        jsonResponse(['error' => 'Entraînement non trouvé'], 404);
    }

    if ($workout['default_workout_privacy'] !== 'public') {
        jsonResponse(['error' => 'Entraînement privé'], 403);
    }

    // Si c'est une réponse, on valide :
    //   1) le parent existe et appartient au même workout
    //   2) le parent est lui-même un commentaire racine (on aplatit pour
    //      éviter les threads imbriqués infinis — pattern Instagram)
    //   3) on récupère email + username de l'auteur du parent pour la notif
    $parentCommentRow = null;
    if ($parentCommentId !== null) {
        $stmt = $pdo->prepare("
            SELECT wc.id, wc.parent_comment_id, wc.user_id AS author_user_id,
                   u.email AS author_email, u.username AS author_username
            FROM qogym_workout_comments wc
            INNER JOIN qogym_users u ON wc.user_id = u.id
            WHERE wc.id = ? AND wc.completed_workout_id = ?
        ");
        $stmt->execute([$parentCommentId, $workoutId]);
        $parentCommentRow = $stmt->fetch();
        if (!$parentCommentRow) {
            jsonResponse(['error' => 'Commentaire parent introuvable'], 404);
        }
        // Aplatissement : si on essaie de répondre à une réponse, on
        // recolle au commentaire racine pour rester sur 1 seul niveau.
        if (!empty($parentCommentRow['parent_comment_id'])) {
            $parentCommentId = (int)$parentCommentRow['parent_comment_id'];
            // Re-récupère les infos du vrai parent racine pour la notif
            $stmt = $pdo->prepare("
                SELECT wc.id, wc.user_id AS author_user_id,
                       u.email AS author_email, u.username AS author_username
                FROM qogym_workout_comments wc
                INNER JOIN qogym_users u ON wc.user_id = u.id
                WHERE wc.id = ?
            ");
            $stmt->execute([$parentCommentId]);
            $parentCommentRow = $stmt->fetch();
        }
    }

    // Insertion
    $stmt = $pdo->prepare("
        INSERT INTO qogym_workout_comments (completed_workout_id, user_id, comment, parent_comment_id) 
        VALUES (?, ?, ?, ?)
    ");
    $stmt->execute([$workoutId, $user['id'], $comment, $parentCommentId]);
    $commentId = $pdo->lastInsertId();

    // Notifications par email — la logique dépend du type :
    //
    //   - Commentaire racine sur un workout d'autrui    → notifie le owner
    //   - Réponse à un commentaire :
    //       a) notifie l'auteur du parent (si ≠ moi)
    //       b) notifie aussi le owner du workout, mais seulement si
    //          owner ≠ moi ET owner ≠ auteur du parent (sinon doublon).
    //
    // On reste en best-effort (@mail) : un échec d'envoi ne casse pas l'API.
    if ($parentCommentId === null) {
        // Cas classique : commentaire racine
        if ($workout['user_id'] != $user['id']) {
            sendNotificationEmail(
                $workout['email'],
                $workout['owner_username'],
                $user['username'],
                'comment',
                $workout['workout_name']
            );
        }
    } else {
        // Cas réponse : notifie l'auteur du parent (s'il n'est pas moi)
        if ($parentCommentRow && $parentCommentRow['author_user_id'] != $user['id']) {
            sendNotificationEmail(
                $parentCommentRow['author_email'],
                $parentCommentRow['author_username'],
                $user['username'],
                'reply',
                $workout['workout_name']
            );
        }
        // Notifie aussi le owner du workout, sauf doublon
        if ($workout['user_id'] != $user['id']
            && (!$parentCommentRow || $workout['user_id'] != $parentCommentRow['author_user_id'])) {
            sendNotificationEmail(
                $workout['email'],
                $workout['owner_username'],
                $user['username'],
                'comment',
                $workout['workout_name']
            );
        }
    }

    jsonResponse([
        'success'           => true,
        'comment_id'        => $commentId,
        'parent_comment_id' => $parentCommentId,
        'username'          => $user['username']
    ]);
}

// SUPPRIMER UN COMMENTAIRE
if ($method === 'DELETE' && isset($_GET['comment_id'])) {
    $commentId = $_GET['comment_id'];

    // Vérifier que le commentaire appartient à l'utilisateur
    $stmt = $pdo->prepare("SELECT user_id FROM qogym_workout_comments WHERE id = ?");
    $stmt->execute([$commentId]);
    $comment = $stmt->fetch();

    if (!$comment) {
        jsonResponse(['error' => 'Commentaire non trouvé'], 404);
    }

    if ($comment['user_id'] != $user['id']) {
        jsonResponse(['error' => 'Vous ne pouvez supprimer que vos propres commentaires'], 403);
    }

    // Supprimer
    $stmt = $pdo->prepare("DELETE FROM qogym_workout_comments WHERE id = ?");
    $stmt->execute([$commentId]);

    jsonResponse(['success' => true, 'message' => 'Commentaire supprimé']);
}

// RECHERCHER DES AMIS POUR AJOUTER COMME PARTICIPANTS
if ($method === 'GET' && isset($_GET['search_friends'])) {
    $search = trim($_GET['search_friends']);

    // Récupérer les amis
    $stmt = $pdo->prepare("
        SELECT 
            u.id,
            u.username
        FROM qogym_users u
        INNER JOIN qogym_friendships f ON (
            (f.user_id = u.id AND f.friend_id = ?) OR
            (f.friend_id = u.id AND f.user_id = ?)
        )
        WHERE f.status = 'accepted'
        AND u.username LIKE ?
        ORDER BY u.username
        LIMIT 20
    ");
    $stmt->execute([$user['id'], $user['id'], '%' . $search . '%']);
    $friends = $stmt->fetchAll();

    jsonResponse(['success' => true, 'friends' => $friends]);
}

jsonResponse(['error' => 'Action non reconnue'], 400);