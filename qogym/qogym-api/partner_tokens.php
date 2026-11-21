<?php
// ============================================================================
// Tokens « partenaire » : sessions limitées délivrées à une appli externe
// reliée à un compte QoGym (ex. Recomp).
//
// - Un token normal (scope NULL) n'est JAMAIS concerné par ce fichier.
// - Un token partenaire (scope 'partner:<app>') ne peut appeler que les
//   endpoints listés dans partnerRequestAllowed() ; tout le reste → 403.
// - Durée de vie plus courte (PARTNER_TOKEN_EXPIRY) et révocable par
//   l'utilisateur (auth.php, action revoke_partner).
// - Délivré « en attente » (scope 'partner:<app>:pending') au login. Il est
//   activé à sa première vraie utilisation (amis, fil, profils, préférences) :
//   l'email « compte relié » part à ce moment-là. « Qui suis-je » et
//   « logout » n'activent pas. Un token en attente a les mêmes droits et
//   n'est pas listé dans les applis reliées.
//
// Inclus par config.php. Migration : sql/migration_partner_tokens_20261120.sql
// ============================================================================

// Applis partenaires autorisées : identifiant technique => nom affiché.
const PARTNER_APPS = [
    'recomp' => 'Recomp',
];

const PARTNER_TOKEN_EXPIRY = 90 * 24 * 60 * 60; // 90 jours
const PARTNER_PENDING_SUFFIX = ':pending';

// Scope du token de la requête en cours (null = token normal).
$GLOBALS['QOGYM_TOKEN_SCOPE'] = null;

function partnerScope(string $app): string
{
    return 'partner:' . $app;
}

function partnerPendingScope(string $app): string
{
    return partnerScope($app) . PARTNER_PENDING_SUFFIX;
}

function isValidPartnerApp($app): bool
{
    return is_string($app) && array_key_exists($app, PARTNER_APPS);
}

// 'partner:recomp' → ['app' => 'recomp', 'pending' => false]
// 'partner:recomp:pending' → ['app' => 'recomp', 'pending' => true]
// Autre chose (ou appli inconnue) → null
function parsePartnerScope(string $scope): ?array
{
    if (strpos($scope, 'partner:') !== 0) return null;
    $rest = substr($scope, 8);
    $pending = substr($rest, -strlen(PARTNER_PENDING_SUFFIX)) === PARTNER_PENDING_SUFFIX;
    $app = $pending ? substr($rest, 0, -strlen(PARTNER_PENDING_SUFFIX)) : $rest;
    return isValidPartnerApp($app) ? ['app' => $app, 'pending' => $pending] : null;
}

// Une requête qui « utilise » vraiment la liaison (et l'active si besoin).
// « Qui suis-je » et logout n'en font pas partie : un partenaire peut les
// appeler avant d'avoir fini sa propre inscription.
function partnerRequestActivates(string $script): bool
{
    return $script !== 'auth.php';
}

// Passe un token en attente à actif. L'email n'est envoyé qu'une fois, par la
// requête qui fait réellement la bascule (UPDATE … AND scope = pending).
function activatePartnerToken(PDO $pdo, string $token, string $app): void
{
    $stmt = $pdo->prepare("UPDATE qogym_auth_tokens SET scope = ? WHERE token = ? AND scope = ?");
    $stmt->execute([partnerScope($app), $token, partnerPendingScope($app)]);
    if ($stmt->rowCount() !== 1) return;

    $stmt = $pdo->prepare("
        SELECT u.email, u.username FROM qogym_users u
        INNER JOIN qogym_auth_tokens t ON t.user_id = u.id
        WHERE t.token = ?
    ");
    $stmt->execute([$token]);
    $u = $stmt->fetch();
    if ($u) {
        sendPartnerLinkedEmail($u['email'], $u['username'], PARTNER_APPS[$app]);
    }
}

// Email de sécurité quand une appli partenaire est reliée au compte
function sendPartnerLinkedEmail($email, $username, $appName)
{
    $subject = "Ton compte QoGym a été relié à $appName";
    $message = "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #2e7d50; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .info-box { background: white; padding: 15px; border-radius: 8px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>QoGym</h2>
                </div>
                <div class='content'>
                    <p>Salut <strong>$username</strong>,</p>
                    <p>Ton compte QoGym vient d'être relié à <strong>$appName</strong>.</p>

                    <div class='info-box'>
                        <p style='margin: 0;'><strong>Date :</strong> " . date('d/m/Y à H:i') . "</p>
                        <p style='margin: 10px 0 0 0;'>$appName peut voir et gérer tes amis, voir le fil et les profils de tes amis, liker et commenter, et changer ta visibilité. Il ne peut <strong>pas</strong> modifier tes séances, ton mot de passe ni tes autres données.</p>
                    </div>

                    <p>Si ce n'était pas toi, change ton mot de passe : ça déconnecte aussi $appName.</p>
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

// Lit le scope d'un token. Lecture volontairement tolérante (SELECT *) :
// si la migration n'a pas été jouée, la colonne n'existe pas → null, et tous
// les tokens restent des tokens normaux.
function getTokenScope(PDO $pdo, string $token): ?string
{
    $stmt = $pdo->prepare("SELECT * FROM qogym_auth_tokens WHERE token = ? LIMIT 1");
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    $scope = $row['scope'] ?? null;
    return ($scope === null || $scope === '') ? null : $scope;
}

// Liste blanche de ce qu'un token partenaire a le droit de faire.
// $script = nom du fichier PHP appelé (ex. 'friends.php').
function partnerRequestAllowed(string $script, string $method, ?array $input): bool
{
    $action = $input['action'] ?? null;

    switch ($script) {
        // Amis : recherche, demandes, acceptation, refus, retrait, liste.
        case 'friends.php':
            return true;

        // Fil, détail d'un entraînement, likes, commentaires (et suppression
        // de SES commentaires, contrôlée par feed.php).
        case 'feed.php':
            return true;

        // Profils (lecture seule).
        case 'user_profile.php':
            return $method === 'GET';

        // Qui suis-je ? + déconnexion de CE token. Pas de changement de mot
        // de passe ni de pseudo, pas de révocation.
        case 'auth.php':
            if ($method === 'GET') return true;
            return $method === 'POST' && $action === 'logout';

        // Préférences : lecture, et modification du SEUL réglage de
        // confidentialité (pas d'objectifs nutrition, pas de photo).
        case 'preferences.php':
            if ($method === 'GET') return true;
            if ($method === 'PUT') {
                if (!is_array($input) || count($input) === 0) return false;
                return count(array_diff(array_keys($input), ['default_workout_privacy'])) === 0;
            }
            return false;

        // Tout le reste (séances, entraînements, nutrition, poids, pas,
        // rapports, admin…) est interdit.
        default:
            return false;
    }
}

// Appelé par verifyAuth() une fois le token reconnu.
// Token normal → ne fait rien. Token partenaire hors périmètre → 403 et stop.
function enforceTokenScope(PDO $pdo, string $token): void
{
    $scope = getTokenScope($pdo, $token);
    $GLOBALS['QOGYM_TOKEN_SCOPE'] = $scope;

    if ($scope === null) {
        return;
    }

    $partner = parsePartnerScope($scope);
    if ($partner !== null) {
        // Le partenaire voit toujours 'partner:<app>', en attente ou non.
        $GLOBALS['QOGYM_TOKEN_SCOPE'] = partnerScope($partner['app']);

        $script = basename($_SERVER['SCRIPT_FILENAME'] ?? ($_SERVER['SCRIPT_NAME'] ?? ''));
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $input  = json_decode(file_get_contents('php://input'), true);

        if (partnerRequestAllowed($script, $method, is_array($input) ? $input : null)) {
            if ($partner['pending'] && partnerRequestActivates($script)) {
                activatePartnerToken($pdo, $token, $partner['app']);
            }
            return;
        }
    }

    // Hors périmètre, ou scope inconnu / appli retirée de PARTNER_APPS :
    // on refuse par sécurité.
    jsonResponse([
        'error' => "Action non autorisée pour une application partenaire",
        'code'  => 'PARTNER_SCOPE',
    ], 403);
}
