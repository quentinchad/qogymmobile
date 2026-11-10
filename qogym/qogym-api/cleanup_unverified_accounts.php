<?php
/**
 * Supprime les comptes dont l'email n'a jamais été confirmé, une fois le
 * délai EMAIL_VERIFICATION_EXPIRY dépassé (voir config.php).
 *
 * Un compte non confirmé n'a jamais pu utiliser l'appli (verifyAuth() le
 * bloque et aucun token de session ne lui est délivré tant qu'il n'est pas
 * vérifié) : il n'a donc aucune donnée liée (séances, workouts, amis...) à
 * nettoyer en cascade. Un simple DELETE sur qogym_users suffit.
 *
 * Deux façons de l'exécuter :
 *  1. En CRON côté serveur (recommandé, ex. OVH "Tâches planifiées") :
 *       php /chemin/vers/qogym-api/cleanup_unverified_accounts.php
 *     -> pas d'authentification nécessaire (accès CLI = accès serveur).
 *
 *  2. Depuis le panneau admin (comme send_reminders.php) :
 *       GET  -> nombre de comptes concernés
 *       POST -> supprime les comptes concernés
 *     -> nécessite un token admin.
 */

require_once 'config.php';

$isCli = (php_sapi_name() === 'cli');

if (!$isCli) {
    $user = verifyAuth();
    if (!$user['is_admin']) {
        jsonResponse(['error' => 'Accès non autorisé'], 403);
        exit;
    }
}

$pdo = getDB();

// Requête utilisée dans les 3 modes : s'appuie sur l'index
// (email_verified, verification_expires_at) pour rester rapide même avec
// beaucoup d'utilisateurs.
$countStmt = $pdo->query("
    SELECT COUNT(*) FROM qogym_users
    WHERE email_verified = 0
      AND verification_expires_at IS NOT NULL
      AND verification_expires_at < NOW()
");
$expiredCount = (int) $countStmt->fetchColumn();

$method = $isCli ? 'POST' : $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    jsonResponse([
        'success' => true,
        'expired_unverified' => $expiredCount,
    ]);
    exit;
}

if ($method === 'POST') {
    $stmt = $pdo->prepare("
        DELETE FROM qogym_users
        WHERE email_verified = 0
          AND verification_expires_at IS NOT NULL
          AND verification_expires_at < NOW()
    ");
    $stmt->execute();
    $deleted = $stmt->rowCount();

    if ($isCli) {
        echo "[" . date('Y-m-d H:i:s') . "] $deleted compte(s) non confirmé(s) supprimé(s).\n";
        exit;
    }

    jsonResponse([
        'success' => true,
        'deleted' => $deleted,
    ]);
    exit;
}

if (!$isCli) {
    jsonResponse(['error' => 'Méthode non supportée'], 405);
}
