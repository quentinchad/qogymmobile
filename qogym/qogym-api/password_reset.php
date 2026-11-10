<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// Fonction pour envoyer l'email de réinitialisation
function sendPasswordResetEmail($email, $username, $token) {
    $resetLink = "https://qojim.com/reset-password?token=" . $token;
   
    
    $subject = "Réinitialisation de votre mot de passe - QoGym";
    $message = "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #2e7d50; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { display: inline-block; background: #2e7d50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                .alert-box { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Réinitialisation de mot de passe</h2>
                </div>
                <div class='content'>
                    <p>Salut <strong>$username</strong>,</p>
                    <p>Tu as demandé à réinitialiser ton mot de passe QoGym.</p>
                    
                    <p style='text-align: center;'>
                        <a href='$resetLink' class='button' style='color: white;'>
                            Réinitialiser mon mot de passe
                        </a>
                    </p>
                    
                    <div class='alert-box'>
                        <p style='margin: 0;'><strong>Ce lien expire dans 1 heure</strong></p>
                        <p style='margin: 10px 0 0 0;'>Si tu n'as pas demandé cette réinitialisation, ignore cet email.</p>
                    </div>
                    
                    <p style='font-size: 12px; color: #666; margin-top: 20px;'>
                        Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :<br>
                        <a href='$resetLink'>$resetLink</a>
                    </p>
                </div>
                <div class='footer'>
                    <p>QoGym - Votre compagnon fitness quotidien</p>
                    <p>Cet email a été envoyé à <strong>$email</strong></p>
                </div>
            </div>
        </body>
        </html>
    ";
    
    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: QoGym <noreply@qojim.com>\r\n";
    $headers .= "Reply-To: noreply@qojim.com\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();
    
    return @mail($email, $subject, $message, $headers);
}

// DEMANDER UNE RÉINITIALISATION
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'request_reset') {
    $email = trim($input['email'] ?? '');
    
    if (empty($email)) {
        jsonResponse(['error' => 'Email requis'], 400);
        exit;
    }
    
    // Vérifier que l'utilisateur existe
    $stmt = $pdo->prepare("SELECT id, username FROM qogym_users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    
    if (!$user) {
        // Pour la sécurité, on ne dit pas que l'email n'existe pas
        jsonResponse(['success' => true, 'message' => 'Si cet email existe, un lien de réinitialisation a été envoyé']);
        exit;
    }
    
    // Générer un token unique
    $token = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', time() + 3600); // 1 heure
    
    // Invalider les anciens tokens de cet utilisateur
    $stmt = $pdo->prepare("UPDATE qogym_password_resets SET used = 1 WHERE user_id = ? AND used = 0");
    $stmt->execute([$user['id']]);
    
    // Créer le nouveau token
    $stmt = $pdo->prepare("
        INSERT INTO qogym_password_resets (user_id, token, expires_at) 
        VALUES (?, ?, ?)
    ");
    $stmt->execute([$user['id'], $token, $expiresAt]);
    
    // Envoyer l'email
    sendPasswordResetEmail($email, $user['username'], $token);
    
    jsonResponse(['success' => true, 'message' => 'Email de réinitialisation envoyé']);
    exit;
}

// VALIDER UN TOKEN
if ($method === 'GET' && isset($_GET['token'])) {
    $token = $_GET['token'];
    
    $stmt = $pdo->prepare("
        SELECT pr.*, u.email 
        FROM qogym_password_resets pr
        INNER JOIN qogym_users u ON pr.user_id = u.id
        WHERE pr.token = ? AND pr.used = 0 AND pr.expires_at > NOW()
    ");
    $stmt->execute([$token]);
    $reset = $stmt->fetch();
    
    if (!$reset) {
        jsonResponse(['error' => 'Token invalide ou expiré'], 400);
        exit;
    }
    
    jsonResponse(['success' => true, 'valid' => true]);
    exit;
}

// RÉINITIALISER LE MOT DE PASSE
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'reset_password') {
    $token = $input['token'] ?? '';
    $newPassword = $input['new_password'] ?? '';
    
    if (empty($token) || empty($newPassword)) {
        jsonResponse(['error' => 'Token et nouveau mot de passe requis'], 400);
        exit;
    }
    
    if (strlen($newPassword) < 6) {
        jsonResponse(['error' => 'Le mot de passe doit contenir au moins 6 caractères'], 400);
        exit;
    }
    
    // Vérifier le token
    $stmt = $pdo->prepare("
        SELECT pr.*, u.email, u.username 
        FROM qogym_password_resets pr
        INNER JOIN qogym_users u ON pr.user_id = u.id
        WHERE pr.token = ? AND pr.used = 0 AND pr.expires_at > NOW()
    ");
    $stmt->execute([$token]);
    $reset = $stmt->fetch();
    
    if (!$reset) {
        jsonResponse(['error' => 'Token invalide ou expiré'], 400);
        exit;
    }
    
    // Mettre à jour le mot de passe
    $newPasswordHash = password_hash($newPassword, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare("UPDATE qogym_users SET password_hash = ? WHERE id = ?");
    $stmt->execute([$newPasswordHash, $reset['user_id']]);
    
    // Marquer le token comme utilisé
    $stmt = $pdo->prepare("UPDATE qogym_password_resets SET used = 1 WHERE id = ?");
    $stmt->execute([$reset['id']]);
    
    // Invalider tous les tokens de session (déconnexion de tous les appareils)
    $stmt = $pdo->prepare("DELETE FROM qogym_auth_tokens WHERE user_id = ?");
    $stmt->execute([$reset['user_id']]);
    
    // Envoyer un email de confirmation
    $subject = "Mot de passe réinitialisé - QoGym ✓";
    $message = "
        <html>
        <body style='font-family: Arial; padding: 20px;'>
            <h2>Mot de passe réinitialisé</h2>
            <p>Salut <strong>{$reset['username']}</strong>,</p>
            <p>Ton mot de passe QoGym a été réinitialisé avec succès.</p>
            <p>Tu peux maintenant te connecter avec ton nouveau mot de passe.</p>
            <p style='color: #666; margin-top: 30px;'>Si tu n'es pas à l'origine de cette action, contacte-nous immédiatement.</p>
        </body>
        </html>
    ";
    $headers = "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nFrom: QoGym <noreply@qojim.com>\r\n";
    @mail($reset['email'], $subject, $message, $headers);
    
    jsonResponse(['success' => true, 'message' => 'Mot de passe réinitialisé avec succès']);
    exit;
}

jsonResponse(['error' => 'Action non reconnue'], 400);
exit;
?>