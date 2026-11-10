<?php
// Configuration de la base de données
define('DB_HOST', 'CHANGE_ME');
define('DB_NAME', 'CHANGE_ME');
define('DB_USER', 'CHANGE_ME');
define('DB_PASS', 'CHANGE_ME');

// Configuration de l'application
define('JWT_SECRET', 'CHANGE_ME');
define('TOKEN_EXPIRY', 365 * 24 * 60 * 60); // 1 an en secondes
define('EMAIL_VERIFICATION_EXPIRY', 24 * 60 * 60); // 24h avant suppression du compte non confirmé
define('APP_URL', 'https://qojim.com');

// Configuration CORS
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=UTF-8');

// Gérer les requêtes OPTIONS (preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Connexion à la base de données
function getDB() {
    static $pdo = null;
    
    if ($pdo === null) {
        try {
            $pdo = new PDO(
                "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
                DB_USER,
                DB_PASS,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false
                ]
            );
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Erreur de connexion à la base de données']);
            exit();
        }
    }
    
    return $pdo;
}

// Fonction pour générer un token
function generateToken($length = 64) {
    return bin2hex(random_bytes($length));
}

// Fonction pour vérifier l'authentification
function verifyAuth() {
    $token = null;

    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (isset($headers['Authorization'])) {
            $token = str_replace('Bearer ', '', $headers['Authorization']);
        }
    }

    if (!$token && isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $token = str_replace('Bearer ', '', $_SERVER['HTTP_AUTHORIZATION']);
    }

    if (!$token) {
        throw new Exception('Token manquant');
    }

    $pdo = getDB();
    $stmt = $pdo->prepare("
        SELECT u.* 
        FROM qogym_users u
        INNER JOIN qogym_auth_tokens t ON u.id = t.user_id
        WHERE t.token = ? AND t.expires_at > NOW()
    ");
    $stmt->execute([$token]);
    $user = $stmt->fetch();

    if (!$user) {
        throw new Exception('Token invalide ou expiré');
    }

    // Filet de sécurité : un utilisateur non vérifié ne doit jamais pouvoir
    // utiliser l'appli, même si un token traînait quelque part. En temps
    // normal ce cas ne devrait pas arriver puisqu'on ne délivre pas de token
    // tant que l'email n'est pas confirmé (voir auth.php).
    if (!$user['email_verified']) {
        throw new Exception('Email non confirmé');
    }

    return $user;
}


// Fonction pour répondre en JSON
function jsonResponse($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data);
    exit();
}
?>
