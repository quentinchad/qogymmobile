<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// -------------------------------------------------------
// Envoie un email de notification de partage
// -------------------------------------------------------
function sendShareNotificationEmail($toEmail, $toUsername, $fromUsername, $sessionName)
{
    $subject = "QoGym - $fromUsername vous a partagé une séance";
    $message = "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #2e7d50; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .highlight { color: #2e7d50; font-weight: bold; }
                .session-box { background: #fff; border: 2px solid #2e7d50; border-radius: 8px; padding: 15px; margin: 20px 0; text-align: center; }
                .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>QoGym 💪</h2>
                </div>
                <div class='content'>
                    <p>Salut <strong>$toUsername</strong>,</p>
                    <p><span class='highlight'>$fromUsername</span> vous a partagé une séance d'entraînement !</p>
                    <div class='session-box'>
                        <h3>🏋️ $sessionName</h3>
                    </div>
                    <p>Connectez-vous à QoGym pour accepter ou refuser cette séance.<br>
                    Si vous acceptez, elle sera ajoutée à votre bibliothèque et vous pourrez l'utiliser comme si vous l'aviez créée vous-même.</p>
                </div>
                <div class='footer'>
                    <p>QoGym - Votre application de fitness</p>
                </div>
            </div>
        </body>
        </html>
    ";

    $headers  = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: QoGym <noreply@qojim.com>\r\n";

    @mail($toEmail, $subject, $message, $headers);
}

// -------------------------------------------------------
// POST action=share  →  partager une séance avec des amis
// -------------------------------------------------------
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'share') {
    $sessionId  = $input['session_id']  ?? null;
    $friendIds  = $input['friend_ids']  ?? [];

    if (!$sessionId || empty($friendIds) || !is_array($friendIds)) {
        jsonResponse(['error' => 'session_id et friend_ids requis'], 400);
    }

    // Vérifier que la séance appartient bien à l'utilisateur courant et
    // n'est pas une séance Qojim ni archivée.
    $stmt = $pdo->prepare("SELECT id, name, is_qojim_session, is_archived FROM qogym_workout_sessions WHERE id = ? AND user_id = ? AND deleted_at IS NULL");
    $stmt->execute([$sessionId, $user['id']]);
    $session = $stmt->fetch();

    if (!$session) {
        jsonResponse(['error' => 'Séance non trouvée ou non autorisée'], 404);
    }
    if ($session['is_qojim_session']) {
        jsonResponse(['error' => 'Impossible de partager une séance Qojim'], 403);
    }
    if (!empty($session['is_archived'])) {
        jsonResponse(['error' => "Impossible de partager une séance archivée"], 400);
    }

    $shared  = [];
    $skipped = [];

    foreach ($friendIds as $friendId) {
        $friendId = (int) $friendId;

        // Vérifier que c'est bien un ami accepté
        $stmt = $pdo->prepare("
            SELECT id FROM qogym_friendships
            WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
              AND status = 'accepted'
        ");
        $stmt->execute([$user['id'], $friendId, $friendId, $user['id']]);
        if (!$stmt->fetch()) {
            $skipped[] = $friendId;
            continue;
        }

        // Vérifier qu'un partage pending n'existe pas déjà pour ce duo session/ami
        $stmt = $pdo->prepare("
            SELECT id FROM qogym_session_shares
            WHERE session_id = ? AND sender_id = ? AND receiver_id = ? AND status = 'pending'
        ");
        $stmt->execute([$sessionId, $user['id'], $friendId]);
        if ($stmt->fetch()) {
            $skipped[] = $friendId;
            continue;
        }

        // Créer l'invitation
        $stmt = $pdo->prepare("
            INSERT INTO qogym_session_shares (session_id, sender_id, receiver_id, status)
            VALUES (?, ?, ?, 'pending')
        ");
        $stmt->execute([$sessionId, $user['id'], $friendId]);

        // Récupérer les infos du destinataire pour l'email
        $stmt = $pdo->prepare("SELECT username, email FROM qogym_users WHERE id = ?");
        $stmt->execute([$friendId]);
        $friend = $stmt->fetch();

        if ($friend) {
            sendShareNotificationEmail(
                $friend['email'],
                $friend['username'],
                $user['username'],
                $session['name']
            );
        }

        $shared[] = $friendId;
    }

    jsonResponse([
        'success' => true,
        'shared'  => $shared,
        'skipped' => $skipped,
        'message' => count($shared) . ' partage(s) envoyé(s)'
    ]);
}

// -------------------------------------------------------
// GET ?pending  →  partages reçus en attente
// -------------------------------------------------------
if ($method === 'GET' && isset($_GET['pending'])) {
    // 1) Nettoyer les invitations orphelines (session supprimée/introuvable
    //    ou expéditeur supprimé). Sans ça, le badge de comptage affiche des
    //    partages qui ne peuvent ni être acceptés ni refusés (car l'INNER
    //    JOIN plus bas les filtrerait). On les marque 'declined' silencieusement (statut existant qui les retire de la liste).
    $stmt = $pdo->prepare("
        UPDATE qogym_session_shares ss
        LEFT JOIN qogym_workout_sessions ws ON ss.session_id = ws.id
        LEFT JOIN qogym_users            u  ON ss.sender_id  = u.id
        SET ss.status = 'declined'
        WHERE ss.receiver_id = ?
          AND ss.status = 'pending'
          AND (ws.id IS NULL OR ws.deleted_at IS NOT NULL OR u.id IS NULL)
    ");
    $stmt->execute([$user['id']]);

    // 2) Lister les pending vraiment exploitables (= session ET expéditeur
    //    encore présents). On utilise donc des INNER JOIN ici, c'est OK
    //    parce que le pas (1) a éliminé les orphelins.
    $stmt = $pdo->prepare("
        SELECT
            ss.id            AS share_id,
            ss.created_at,
            ss.session_id,
            ws.name          AS session_name,
            ws.image_url     AS session_image,
            st.name          AS session_type_name,
            u.id             AS sender_id,
            u.username       AS sender_username,
            u.pdp            AS sender_pdp,
            (SELECT COUNT(*) FROM qogym_exercises WHERE workout_session_id = ws.id AND COALESCE(is_workout_custom, 0) = 0 AND COALESCE(removed_from_template, 0) = 0) AS exercise_count
        FROM qogym_session_shares ss
        INNER JOIN qogym_workout_sessions ws ON ss.session_id = ws.id
        LEFT JOIN  qogym_session_types    st ON ws.session_type_id = st.id
        INNER JOIN qogym_users            u  ON ss.sender_id = u.id
        WHERE ss.receiver_id = ? AND ss.status = 'pending' AND ws.deleted_at IS NULL
        ORDER BY ss.created_at DESC
    ");
    $stmt->execute([$user['id']]);
    $pending = $stmt->fetchAll();

    jsonResponse(['success' => true, 'pending_shares' => $pending]);
}

// -------------------------------------------------------
// GET ?count  →  nombre de partages en attente (badge)
// -------------------------------------------------------
if ($method === 'GET' && isset($_GET['count'])) {
    // Même nettoyage qu'au-dessus pour que le badge soit cohérent avec
    // la liste affichée par getPending.
    $stmt = $pdo->prepare("
        UPDATE qogym_session_shares ss
        LEFT JOIN qogym_workout_sessions ws ON ss.session_id = ws.id
        LEFT JOIN qogym_users            u  ON ss.sender_id  = u.id
        SET ss.status = 'declined'
        WHERE ss.receiver_id = ?
          AND ss.status = 'pending'
          AND (ws.id IS NULL OR ws.deleted_at IS NOT NULL OR u.id IS NULL)
    ");
    $stmt->execute([$user['id']]);

    $stmt = $pdo->prepare("SELECT COUNT(*) as cnt FROM qogym_session_shares WHERE receiver_id = ? AND status = 'pending'");
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch();

    jsonResponse(['success' => true, 'count' => (int) $row['cnt']]);
}

// -------------------------------------------------------
// POST action=accept  →  accepter un partage (crée une copie)
// -------------------------------------------------------
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'accept') {
    $shareId = $input['share_id'] ?? null;

    if (!$shareId) {
        jsonResponse(['error' => 'share_id requis'], 400);
    }

    // Récupérer le partage. LEFT JOIN pour gérer le cas où la séance source
    // a été supprimée par l'expéditeur entre-temps : on attrape le share
    // même orphelin pour pouvoir le nettoyer proprement.
    $stmt = $pdo->prepare("
        SELECT ss.*, ws.name, ws.image_url, ws.session_type_id, ws.deleted_at
        FROM qogym_session_shares ss
        LEFT JOIN qogym_workout_sessions ws ON ss.session_id = ws.id
        WHERE ss.id = ? AND ss.receiver_id = ? AND ss.status = 'pending'
    ");
    $stmt->execute([$shareId, $user['id']]);
    $share = $stmt->fetch();

    if (!$share) {
        jsonResponse(['error' => 'Partage non trouvé ou déjà traité'], 404);
    }

    // Cas où la séance source n'existe plus, ou a été supprimée par
    // l'expéditeur entre-temps (soft delete). On marque le share comme
    // 'declined' pour le retirer de la liste, et on retourne un message
    // d'erreur informatif (pas un 500).
    if (empty($share['name']) || !empty($share['deleted_at'])) {
        $stmt = $pdo->prepare("UPDATE qogym_session_shares SET status = 'declined' WHERE id = ?");
        $stmt->execute([$shareId]);
        jsonResponse([
            'error'                 => "Cette séance n'est plus disponible (l'expéditeur l'a supprimée).",
            'share_auto_cancelled'  => true,
        ], 410); // 410 Gone
    }

    $pdo->beginTransaction();
    try {
        // Récupérer les exercices de la séance originale (exclut les exos
        // custom-during-workout : ils ne font pas partie de la "template").
        $stmt = $pdo->prepare("
            SELECT name, sets, reps_min, reps_max, rest_time, exercise_order
            FROM qogym_exercises
            WHERE workout_session_id = ?
              AND COALESCE(is_workout_custom, 0) = 0
              AND COALESCE(removed_from_template, 0) = 0
            ORDER BY exercise_order
        ");
        $stmt->execute([$share['session_id']]);
        $exercises = $stmt->fetchAll();

        // Créer une copie de la séance pour le receiver
        $stmt = $pdo->prepare("
            INSERT INTO qogym_workout_sessions (user_id, name, image_url, session_type_id, is_qojim_session)
            VALUES (?, ?, ?, ?, 0)
        ");
        $stmt->execute([
            $user['id'],
            $share['name'],
            $share['image_url'],
            $share['session_type_id']
        ]);
        $newSessionId = $pdo->lastInsertId();

        // Copier les exercices
        if (!empty($exercises)) {
            $stmt = $pdo->prepare("
                INSERT INTO qogym_exercises (workout_session_id, name, sets, reps_min, reps_max, rest_time, exercise_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($exercises as $ex) {
                $stmt->execute([
                    $newSessionId,
                    $ex['name'],
                    $ex['sets'],
                    $ex['reps_min'],
                    $ex['reps_max'],
                    $ex['rest_time'],
                    $ex['exercise_order']
                ]);
            }
        }

        // Marquer le partage comme accepté
        $stmt = $pdo->prepare("UPDATE qogym_session_shares SET status = 'accepted' WHERE id = ?");
        $stmt->execute([$shareId]);

        $pdo->commit();

        jsonResponse([
            'success'        => true,
            'new_session_id' => $newSessionId,
            'message'        => 'Séance ajoutée à votre bibliothèque'
        ]);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => 'Erreur lors de l\'acceptation: ' . $e->getMessage()], 500);
    }
}

// -------------------------------------------------------
// POST action=decline  →  refuser un partage
// -------------------------------------------------------
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'decline') {
    $shareId = $input['share_id'] ?? null;

    if (!$shareId) {
        jsonResponse(['error' => 'share_id requis'], 400);
    }

    $stmt = $pdo->prepare("SELECT id FROM qogym_session_shares WHERE id = ? AND receiver_id = ? AND status = 'pending'");
    $stmt->execute([$shareId, $user['id']]);
    if (!$stmt->fetch()) {
        jsonResponse(['error' => 'Partage non trouvé ou déjà traité'], 404);
    }

    $stmt = $pdo->prepare("UPDATE qogym_session_shares SET status = 'declined' WHERE id = ?");
    $stmt->execute([$shareId]);

    jsonResponse(['success' => true, 'message' => 'Partage refusé']);
}

jsonResponse(['error' => 'Action non reconnue'], 400);
