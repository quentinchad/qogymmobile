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
//
// Inclus par config.php. Migration : sql/migration_partner_tokens_20261120.sql
// ============================================================================

// Applis partenaires autorisées : identifiant technique => nom affiché.
const PARTNER_APPS = [
    'recomp' => 'Recomp',
];

const PARTNER_TOKEN_EXPIRY = 90 * 24 * 60 * 60; // 90 jours

// Scope du token de la requête en cours (null = token normal).
$GLOBALS['QOGYM_TOKEN_SCOPE'] = null;

function partnerScope(string $app): string
{
    return 'partner:' . $app;
}

function isValidPartnerApp($app): bool
{
    return is_string($app) && array_key_exists($app, PARTNER_APPS);
}

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

    if (strpos($scope, 'partner:') === 0 && isValidPartnerApp(substr($scope, 8))) {
        $script = basename($_SERVER['SCRIPT_FILENAME'] ?? ($_SERVER['SCRIPT_NAME'] ?? ''));
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $input  = json_decode(file_get_contents('php://input'), true);

        if (partnerRequestAllowed($script, $method, is_array($input) ? $input : null)) {
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
