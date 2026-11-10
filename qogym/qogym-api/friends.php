<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// Fonction pour envoyer un email de notification d'amitié
function sendFriendshipNotificationEmail($toEmail, $toUsername, $fromUsername, $action)
{
    $subject = '';
    $message = '';

    if ($action === 'request') {
        $subject = "QoGym - $fromUsername veut être votre ami";
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
                        <p><span class='highlight'>$fromUsername</span> souhaite devenir votre ami sur QoGym !</p>
                        <p style='font-size: 18px; margin: 20px 0;'><strong>Nouvelle demande d'ami</strong></p>
                        <p>Connectez-vous à l'application pour accepter ou refuser cette demande.</p>
                    </div>
                    <div class='footer'>
                        <p>QoGym - Votre application de fitness</p>
                    </div>
                </div>
            </body>
            </html>
        ";
    } else if ($action === 'accepted') {
        $subject = "QoGym - $fromUsername a accepté votre demande d'ami";
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
                        <p><span class='highlight'>$fromUsername</span> a accepté votre demande d'ami !</p>
                        <p style='font-size: 18px; margin: 20px 0;'><strong>Vous êtes maintenant amis</strong></p>
                        <p>Vous pouvez maintenant voir les entraînements de $fromUsername et interagir avec lui/elle.</p>
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

// --- 1. RECHERCHER UN UTILISATEUR ---
if ($method === 'GET' && isset($_GET['search'])) {
    $searchTerm = trim($_GET['search']);
    if (strlen($searchTerm) < 2) {
        jsonResponse(['error' => 'Minimum 2 caractères'], 400);
    }
    
    $stmt = $pdo->prepare("SELECT id, username, email, pdp FROM qogym_users WHERE username LIKE ? AND id != ? LIMIT 20");
    $stmt->execute(['%' . $searchTerm . '%', $user['id']]);
    jsonResponse(['success' => true, 'users' => $stmt->fetchAll()]);
}

// --- 2. ENVOYER UNE DEMANDE ---
// LOGIQUE : user_id = MOI (celui qui envoie), friend_id = L'AUTRE (celui qui reçoit)
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'send_request') {
    $targetId = $input['friend_id'] ?? null;
    
    if (!$targetId || $targetId == $user['id']) {
        jsonResponse(['error' => 'Action invalide'], 400);
    }
    
    // Vérifier si une relation existe déjà (dans n'importe quel sens)
    $stmt = $pdo->prepare("SELECT status FROM qogym_friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)");
    $stmt->execute([$user['id'], $targetId, $targetId, $user['id']]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => 'Une relation existe déjà'], 409);
    }
    
    // INSERTION : MOI -> L'AUTRE
    $stmt = $pdo->prepare("INSERT INTO qogym_friendships (user_id, friend_id, status) VALUES (?, ?, 'pending')");
    $stmt->execute([$user['id'], $targetId]);
    
    // Récupérer les infos du destinataire pour envoyer un email
    $stmt = $pdo->prepare("SELECT username, email FROM qogym_users WHERE id = ?");
    $stmt->execute([$targetId]);
    $targetUser = $stmt->fetch();
    
    // Envoyer un email au destinataire (sauf si c'est lui-même)
    if ($targetUser && $targetId != $user['id']) {
        sendFriendshipNotificationEmail(
            $targetUser['email'],
            $targetUser['username'],
            $user['username'],
            'request'
        );
    }
    
    jsonResponse(['success' => true, 'message' => 'Demande envoyée']);
}

// --- 3. DEMANDES REÇUES ---
// LOGIQUE : Je suis le destinataire (friend_id), l'expéditeur est user_id
if ($method === 'GET' && isset($_GET['pending_received'])) {
    $stmt = $pdo->prepare("
        SELECT f.id as friendship_id, f.created_at, 
               u.id as sender_id, u.username as sender_username, u.pdp as sender_pdp, u.email as sender_email
        FROM qogym_friendships f
        INNER JOIN qogym_users u ON f.user_id = u.id -- L'expéditeur est user_id
        WHERE f.friend_id = ? AND f.status = 'pending' -- Je suis friend_id
        ORDER BY f.created_at DESC
    ");
    $stmt->execute([$user['id']]);
    jsonResponse(['success' => true, 'pending_requests' => $stmt->fetchAll()]);
}

// --- 4. DEMANDES ENVOYÉES ---
// LOGIQUE : Je suis l'expéditeur (user_id), le destinataire est friend_id
if ($method === 'GET' && isset($_GET['pending_sent'])) {
    $stmt = $pdo->prepare("
        SELECT f.id as friendship_id, f.created_at, 
               u.id as receiver_id, u.username as receiver_username, u.pdp as receiver_pdp
        FROM qogym_friendships f
        INNER JOIN qogym_users u ON f.friend_id = u.id -- Le destinataire est friend_id
        WHERE f.user_id = ? AND f.status = 'pending' -- Je suis user_id
        ORDER BY f.created_at DESC
    ");
    $stmt->execute([$user['id']]);
    jsonResponse(['success' => true, 'sent_requests' => $stmt->fetchAll()]);
}

// --- 5. ACCEPTER UNE DEMANDE ---
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'accept') {
    $friendshipId = $input['friendship_id'] ?? null;
    
    $stmt = $pdo->prepare("SELECT friend_id, status, user_id FROM qogym_friendships WHERE id = ?");
    $stmt->execute([$friendshipId]);
    $f = $stmt->fetch();
    
    if (!$f) jsonResponse(['error' => 'Demande non trouvée'], 404);
    
    // Vérification : Seul le destinataire (celui qui a reçu, donc friend_id) peut accepter
    if ($f['friend_id'] != $user['id']) {
        jsonResponse(['error' => 'Vous ne pouvez pas accepter votre propre demande'], 403);
    }
    
    $stmt = $pdo->prepare("UPDATE qogym_friendships SET status = 'accepted' WHERE id = ?");
    $stmt->execute([$friendshipId]);
    
    // Récupérer les infos de l'expéditeur pour envoyer un email
    $stmt = $pdo->prepare("SELECT username, email FROM qogym_users WHERE id = ?");
    $stmt->execute([$f['user_id']]);
    $senderUser = $stmt->fetch();
    
    // Envoyer un email à l'expéditeur (sauf si c'est lui-même)
    if ($senderUser && $f['user_id'] != $user['id']) {
        sendFriendshipNotificationEmail(
            $senderUser['email'],
            $senderUser['username'],
            $user['username'],
            'accepted'
        );
    }
    
    jsonResponse(['success' => true, 'message' => 'Demande acceptée']);
}

// --- 6. LISTE D'AMIS (ACCEPTÉS) ---
if ($method === 'GET' && isset($_GET['list'])) {
    $stmt = $pdo->prepare("
        SELECT f.id as friendship_id, f.created_at,
               CASE WHEN f.user_id = ? THEN u2.id ELSE u1.id END as friend_id,
               CASE WHEN f.user_id = ? THEN u2.username ELSE u1.username END as friend_username,
               CASE WHEN f.user_id = ? THEN u2.pdp ELSE u1.pdp END as friend_pdp
        FROM qogym_friendships f
        INNER JOIN qogym_users u1 ON f.user_id = u1.id
        INNER JOIN qogym_users u2 ON f.friend_id = u2.id
        WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
    ");
    $stmt->execute([$user['id'], $user['id'], $user['id'], $user['id'], $user['id']]);
    jsonResponse(['success' => true, 'friends' => $stmt->fetchAll()]);
}

// --- 7. SUPPRIMER / REFUSER ---
if (($method === 'POST' && isset($input['action']) && $input['action'] === 'decline') || $method === 'DELETE') {
    $friendshipId = ($method === 'DELETE') ? ($_GET['friendship_id'] ?? null) : ($input['friendship_id'] ?? null);
    
    $stmt = $pdo->prepare("SELECT user_id, friend_id FROM qogym_friendships WHERE id = ?");
    $stmt->execute([$friendshipId]);
    $f = $stmt->fetch();
    
    if (!$f) jsonResponse(['error' => 'Non trouvé'], 404);
    if ($f['user_id'] != $user['id'] && $f['friend_id'] != $user['id']) {
        jsonResponse(['error' => 'Non autorisé'], 403);
    }

    $stmt = $pdo->prepare("DELETE FROM qogym_friendships WHERE id = ?");
    $stmt->execute([$friendshipId]);
    jsonResponse(['success' => true, 'message' => 'Supprimé']);
}

jsonResponse(['error' => 'Action non reconnue'], 400);