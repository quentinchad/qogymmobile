<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);

// Fonction pour envoyer un email de bienvenue ou notification
function sendWelcomeEmail($email, $username, $isNewUser = true)
{
    if ($isNewUser) {
        $subject = "Bienvenue sur QoGym !";
        $message = "
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2e7d50; color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .highlight { color: #2e7d50; font-weight: bold; }
                    .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
                    .features { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                    .feature { margin: 10px 0; padding: 10px; border-left: 3px solid #2e7d50; }
                </style>
            </head>
            <body>
                <div class='container'>
                    <div class='header'>
                        <h1 style='margin: 0; font-size: 32px;'>QoGym</h1>
                        <p style='margin: 10px 0 0 0; font-size: 18px;'>Bienvenue dans la famille !</p>
                    </div>
                    <div class='content'>
                        <p>Salut <strong>$username</strong> !</p>
                        <p>Félicitations ! Ton compte QoGym a été créé avec succès.</p>
                        
                        <div class='features'>
                            <h3 style='margin-top: 0; color: #2e7d50;'>Ce que tu peux faire maintenant :</h3>
                            <div class='feature'><strong>Créer tes séances</strong> personnalisées</div>
                            <div class='feature'><strong>Suivre tes performances</strong> exercice par exercice</div>
                            <div class='feature'><strong>Ajouter des amis</strong> et partager vos entraînements</div>
                            <div class='feature'><strong>Découvrir les séances Qojim</strong> certifiées</div>
                        </div>
                        
                        <p style='text-align: center; margin-top: 30px;'>
                            <strong>Prêt à commencer ? C'est parti !</strong>
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
    } else {
        $subject = "Nouvelle connexion à QoGym";
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
                    .info-box { background: white; padding: 15px; border-radius: 8px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class='container'>
                    <div class='header'>
                        <h2>QoGym</h2>
                    </div>
                    <div class='content'>
                        <p>Salut <strong>$username</strong>,</p>
                        <p>Tu viens de te connecter à QoGym.</p>
                        
                        <div class='info-box'>
                            <p style='margin: 0;'><strong>Date :</strong> " . date('d/m/Y à H:i') . "</p>
                        </div>
                        
                        <p>Si ce n'était pas toi, change ton mot de passe immédiatement.</p>
                        <p style='margin-top: 30px;'>Bon entraînement ! 💪</p>
                    </div>
                    <div class='footer'>
                        <p>QoGym - Votre compagnon fitness quotidien</p>
                        <p>Cet email a été envoyé à <strong>$email</strong></p>
                    </div>
                </div>
            </body>
            </html>
        ";
    }

    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: QoGym <noreply@qojim.com>\r\n";
    $headers .= "Reply-To: noreply@qojim.com\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    @mail($email, $subject, $message, $headers);
}

// Fonction pour envoyer un email de changement de mot de passe
function sendPasswordChangedEmail($email, $username)
{
    $subject = "Mot de passe modifié - QoGym";
    $message = "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #E74C3C; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .highlight { color: #E74C3C; font-weight: bold; }
                .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
                .alert-box { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0; }
                .success-box { background: #d4edda; border: 1px solid #28a745; padding: 15px; border-radius: 8px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Mot de passe modifié</h2>
                </div>
                <div class='content'>
                    <p>Salut <strong>$username</strong>,</p>
                    
                    <div class='success-box'>
                        <p style='margin: 0;'><strong>✓ Ton mot de passe a été modifié avec succès</strong></p>
                    </div>
                    
                    <p><strong>Date de modification :</strong> " . date('d/m/Y à H:i') . "</p>
                    
                    <div class='alert-box'>
                        <p style='margin: 0;'><strong>Si ce n'était pas toi :</strong></p>
                        <p style='margin: 10px 0 0 0;'>Quelqu'un a peut-être accès à ton compte. Contacte-nous immédiatement et change ton mot de passe.</p>
                    </div>
                    
                    <p style='margin-top: 30px;'>Garde ton mot de passe en sécurité ! 🔒</p>
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

    @mail($email, $subject, $message, $headers);
}

// Fonction pour envoyer l'email de confirmation d'adresse
function sendVerificationEmail($email, $username, $token)
{
    $verifyLink = APP_URL . "/verify-email?token=" . $token;
    $hours = (int) round(EMAIL_VERIFICATION_EXPIRY / 3600);

    $subject = "Confirme ton adresse email - QoGym";
    $message = "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #2e7d50; color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { display: inline-block; background: #2e7d50; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
                .alert-box { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h1 style='margin: 0; font-size: 32px;'>QoGym</h1>
                    <p style='margin: 10px 0 0 0; font-size: 18px;'>Plus qu'une étape !</p>
                </div>
                <div class='content'>
                    <p>Salut <strong>$username</strong> !</p>
                    <p>Merci de ton inscription sur QoGym. Confirme ton adresse email pour activer ton compte :</p>

                    <p style='text-align: center;'>
                        <a href='$verifyLink' class='button' style='color: white;'>Confirmer mon email</a>
                    </p>

                    <div class='alert-box'>
                        <p style='margin: 0;'><strong>Ce lien expire dans $hours heures.</strong></p>
                        <p style='margin: 10px 0 0 0;'>Passé ce délai, le compte sera automatiquement supprimé et tu devras te réinscrire.</p>
                    </div>

                    <p style='font-size: 12px; color: #666; margin-top: 20px;'>
                        Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :<br>
                        <a href='$verifyLink'>$verifyLink</a>
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

// INSCRIPTION
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'register') {
    $email = trim($input['email'] ?? '');
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';

    if (empty($email) || empty($username) || empty($password)) {
        jsonResponse(['error' => 'Tous les champs sont requis'], 400);
        exit;
    }

    if (strlen($password) < 6) {
        jsonResponse(['error' => 'Le mot de passe doit contenir au moins 6 caractères'], 400);
    }

    $pdo = getDB();

    // Nettoyage à la volée : si un ancien compte non confirmé et expiré
    // occupe cet email ou ce username, on le supprime avant de continuer.
    // Ça évite qu'un compte jamais confirmé bloque définitivement une
    // adresse email/pseudo, sans dépendre uniquement du cron de nettoyage.
    $stmt = $pdo->prepare("
        DELETE FROM qogym_users
        WHERE email_verified = 0
          AND verification_expires_at IS NOT NULL
          AND verification_expires_at < NOW()
          AND (email = ? OR username = ?)
    ");
    $stmt->execute([$email, $username]);

    // Vérifier si l'email existe déjà
    $stmt = $pdo->prepare("SELECT id FROM qogym_users WHERE email = ?");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => 'Cet email est déjà utilisé'], 409);
    }

    // Vérifier si le username existe déjà
    $stmt = $pdo->prepare("SELECT id FROM qogym_users WHERE username = ?");
    $stmt->execute([$username]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => 'Ce nom d\'utilisateur est déjà pris'], 409);
    }

    // Vérifier si c'est l'admin
    $isAdmin = ($email === 'chirat.quentin@gmail.com');

    // Générer le token de confirmation d'email
    $verificationToken = generateToken(32);
    $verificationExpiresAt = date('Y-m-d H:i:s', time() + EMAIL_VERIFICATION_EXPIRY);

    // Créer l'utilisateur (non vérifié par défaut)
    $passwordHash = password_hash($password, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare("
        INSERT INTO qogym_users
            (email, username, password_hash, is_admin, email_verified, verification_token, verification_expires_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
    ");
    $stmt->execute([$email, $username, $passwordHash, $isAdmin, $verificationToken, $verificationExpiresAt]);
    $userId = $pdo->lastInsertId();

    // Pas de token de session ici : tant que l'email n'est pas confirmé,
    // l'utilisateur ne doit pas pouvoir utiliser l'appli (voir verifyAuth()).
    sendVerificationEmail($email, $username, $verificationToken);

    jsonResponse([
        'success' => true,
        'requires_verification' => true,
        'email' => $email,
        'message' => 'Compte créé. Vérifie ta boîte mail pour confirmer ton adresse.'
    ]);
}

// CONNEXION
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'login') {
    $email = trim($input['email'] ?? '');
    $password = $input['password'] ?? '';

    if (empty($email) || empty($password)) {
        jsonResponse(['error' => 'Email et mot de passe requis'], 400);
    }

    $pdo = getDB();
    $stmt = $pdo->prepare("SELECT * FROM qogym_users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        jsonResponse(['error' => 'Email ou mot de passe incorrect'], 401);
    }

    // Le compte doit être confirmé avant de pouvoir se connecter
    if (!$user['email_verified']) {
        jsonResponse([
            'error' => 'Adresse email non confirmée. Vérifie ta boîte mail (ou demande un nouvel email de confirmation).',
            'code' => 'EMAIL_NOT_VERIFIED',
            'email' => $user['email']
        ], 403);
    }

    // Générer un nouveau token
    $token = generateToken();
    $expiresAt = date('Y-m-d H:i:s', time() + TOKEN_EXPIRY);

    $stmt = $pdo->prepare("
        INSERT INTO qogym_auth_tokens (user_id, token, expires_at) 
        VALUES (?, ?, ?)
    ");
    $stmt->execute([$user['id'], $token, $expiresAt]);

    // Envoyer l'email de notification de connexion
    sendWelcomeEmail($user['email'], $user['username'], false);

    jsonResponse([
        'success' => true,
        'user' => [
            'id' => $user['id'],
            'email' => $user['email'],
            'username' => $user['username'],
            'is_admin' => (bool)$user['is_admin']
        ],
        'token' => $token
    ]);
}

// CONFIRMER L'ADRESSE EMAIL
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'verify_email') {
    $token = trim($input['token'] ?? '');

    if (empty($token)) {
        jsonResponse(['error' => 'Token manquant'], 400);
        exit;
    }

    $pdo = getDB();

    $stmt = $pdo->prepare("
        SELECT * FROM qogym_users
        WHERE verification_token = ? AND email_verified = 0
    ");
    $stmt->execute([$token]);
    $user = $stmt->fetch();

    if (!$user) {
        // Soit le token n'existe pas, soit le compte a déjà été confirmé
        jsonResponse(['error' => 'Lien de confirmation invalide ou déjà utilisé'], 400);
        exit;
    }

    if (strtotime($user['verification_expires_at']) < time()) {
        // Le compte a expiré : il sera nettoyé par le job de suppression,
        // mais on peut aussi le supprimer immédiatement ici.
        $stmt = $pdo->prepare("DELETE FROM qogym_users WHERE id = ?");
        $stmt->execute([$user['id']]);
        jsonResponse(['error' => 'Ce lien a expiré. Merci de te réinscrire.', 'code' => 'EXPIRED'], 410);
        exit;
    }

    // Valider le compte
    $stmt = $pdo->prepare("
        UPDATE qogym_users
        SET email_verified = 1, verification_token = NULL, verification_expires_at = NULL
        WHERE id = ?
    ");
    $stmt->execute([$user['id']]);

    // Connexion automatique après confirmation
    $sessionToken = generateToken();
    $expiresAt = date('Y-m-d H:i:s', time() + TOKEN_EXPIRY);
    $stmt = $pdo->prepare("
        INSERT INTO qogym_auth_tokens (user_id, token, expires_at)
        VALUES (?, ?, ?)
    ");
    $stmt->execute([$user['id'], $sessionToken, $expiresAt]);

    // Email de bienvenue, maintenant que le compte est actif
    sendWelcomeEmail($user['email'], $user['username'], true);

    jsonResponse([
        'success' => true,
        'user' => [
            'id' => $user['id'],
            'email' => $user['email'],
            'username' => $user['username'],
            'is_admin' => (bool)$user['is_admin']
        ],
        'token' => $sessionToken
    ]);
    exit;
}

// RENVOYER L'EMAIL DE CONFIRMATION
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'resend_verification') {
    $email = trim($input['email'] ?? '');

    if (empty($email)) {
        jsonResponse(['error' => 'Email requis'], 400);
        exit;
    }

    $pdo = getDB();
    $stmt = $pdo->prepare("SELECT id, username, email_verified FROM qogym_users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    // Réponse volontairement neutre si le compte n'existe pas (anti-énumération)
    if (!$user) {
        jsonResponse(['success' => true, 'message' => "Si ce compte existe et n'est pas confirmé, un email vient d'être envoyé"]);
        exit;
    }

    if ($user['email_verified']) {
        jsonResponse(['success' => true, 'already_verified' => true, 'message' => 'Ce compte est déjà confirmé, tu peux te connecter']);
        exit;
    }

    $verificationToken = generateToken(32);
    $verificationExpiresAt = date('Y-m-d H:i:s', time() + EMAIL_VERIFICATION_EXPIRY);

    $stmt = $pdo->prepare("
        UPDATE qogym_users
        SET verification_token = ?, verification_expires_at = ?
        WHERE id = ?
    ");
    $stmt->execute([$verificationToken, $verificationExpiresAt, $user['id']]);

    sendVerificationEmail($email, $user['username'], $verificationToken);

    jsonResponse(['success' => true, 'message' => 'Email de confirmation renvoyé']);
    exit;
}

// CHANGER LE MOT DE PASSE
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'change_password') {
    try {
        $user = verifyAuth();
    } catch (Exception $e) {
        jsonResponse(['error' => 'Non authentifié'], 401);
        exit;
    }

    $currentPassword = $input['current_password'] ?? '';
    $newPassword = $input['new_password'] ?? '';

    if (empty($currentPassword) || empty($newPassword)) {
        jsonResponse(['error' => 'Tous les champs sont requis'], 400);
        exit;
    }

    if (strlen($newPassword) < 6) {
        jsonResponse(['error' => 'Le nouveau mot de passe doit contenir au moins 6 caractères'], 400);
        exit;
    }

    $pdo = getDB();

    // Vérifier le mot de passe actuel
    $stmt = $pdo->prepare("SELECT password_hash, email, username FROM qogym_users WHERE id = ?");
    $stmt->execute([$user['id']]);
    $userData = $stmt->fetch();

    if (!$userData || !password_verify($currentPassword, $userData['password_hash'])) {
        jsonResponse(['error' => 'Mot de passe actuel incorrect'], 401);
        exit;
    }

    // Vérifier que le nouveau mot de passe est différent
    if (password_verify($newPassword, $userData['password_hash'])) {
        jsonResponse(['error' => 'Le nouveau mot de passe doit être différent de l\'ancien'], 400);
        exit;
    }

    // Mettre à jour le mot de passe
    $newPasswordHash = password_hash($newPassword, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare("UPDATE qogym_users SET password_hash = ? WHERE id = ?");
    $stmt->execute([$newPasswordHash, $user['id']]);

    // Récupérer le token actuel depuis le header
    $headers = getallheaders();
    $currentToken = isset($headers['Authorization']) ? str_replace('Bearer ', '', $headers['Authorization']) : null;

    // Invalider tous les AUTRES tokens (pas le token actuel pour ne pas déconnecter)
    if ($currentToken) {
        $stmt = $pdo->prepare("DELETE FROM qogym_auth_tokens WHERE user_id = ? AND token != ?");
        $stmt->execute([$user['id'], $currentToken]);
    } else {
        // Si pas de token actuel trouvé, supprimer tous les tokens
        $stmt = $pdo->prepare("DELETE FROM qogym_auth_tokens WHERE user_id = ?");
        $stmt->execute([$user['id']]);
    }

    // Envoyer l'email de notification
    sendPasswordChangedEmail($userData['email'], $userData['username']);

    jsonResponse([
        'success' => true,
        'message' => 'Mot de passe modifié avec succès'
    ]);
    exit;
}

// CHANGER LE NOM D'UTILISATEUR
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'change_username') {
    try {
        $user = verifyAuth();
    } catch (Exception $e) {
        jsonResponse(['error' => 'Non authentifié'], 401);
        exit;
    }

    $newUsername = trim($input['username'] ?? '');

    if (empty($newUsername)) {
        jsonResponse(['error' => "Le nom d'utilisateur est requis"], 400);
        exit;
    }
    if (strlen($newUsername) < 3) {
        jsonResponse(['error' => "Le nom d'utilisateur doit contenir au moins 3 caractères"], 400);
        exit;
    }
    if (strlen($newUsername) > 30) {
        jsonResponse(['error' => "Le nom d'utilisateur ne doit pas dépasser 30 caractères"], 400);
        exit;
    }
    // Caractères autorisés : lettres, chiffres, tiret, underscore, point
    if (!preg_match('/^[A-Za-z0-9_.\-]+$/', $newUsername)) {
        jsonResponse(['error' => "Le nom d'utilisateur ne peut contenir que des lettres, chiffres, tirets, underscores et points"], 400);
        exit;
    }

    $pdo = getDB();

    // Si c'est le même nom, rien à faire
    if ($newUsername === $user['username']) {
        jsonResponse(['success' => true, 'username' => $newUsername]);
        exit;
    }

    // Vérifier que ce nom n'est pas déjà pris (case-insensitive pour éviter les
    // doublons subtils du genre "Bob" vs "bob")
    $stmt = $pdo->prepare("SELECT id FROM qogym_users WHERE LOWER(username) = LOWER(?) AND id != ?");
    $stmt->execute([$newUsername, $user['id']]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => "Ce nom d'utilisateur est déjà pris"], 409);
        exit;
    }

    // Mettre à jour
    $stmt = $pdo->prepare("UPDATE qogym_users SET username = ? WHERE id = ?");
    $stmt->execute([$newUsername, $user['id']]);

    jsonResponse([
        'success'  => true,
        'username' => $newUsername,
    ]);
    exit;
}

// VÉRIFIER LE TOKEN
if ($method === 'GET') {
    $user = verifyAuth();
    jsonResponse([
        'success' => true,
        'user' => [
            'id' => $user['id'],
            'email' => $user['email'],
            'username' => $user['username'],
            'is_admin' => (bool)$user['is_admin']
        ]
    ]);
}

// DÉCONNEXION
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'logout') {
    $headers = getallheaders();
    $token = isset($headers['Authorization']) ? str_replace('Bearer ', '', $headers['Authorization']) : null;

    if ($token) {
        $pdo = getDB();
        $stmt = $pdo->prepare("DELETE FROM qogym_auth_tokens WHERE token = ?");
        $stmt->execute([$token]);
    }

    jsonResponse(['success' => true, 'message' => 'Déconnexion réussie']);
}

jsonResponse(['error' => 'Action non reconnue'], 400);
