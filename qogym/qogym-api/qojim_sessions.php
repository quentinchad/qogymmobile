<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// Fonction pour vérifier l'auth de manière optionnelle
function getOptionalUser() {
    try {
        return verifyAuth();
    } catch (Exception $e) {
        return null;
    }
}

// LISTE DES SÉANCES QOJIM PUBLIQUES (accessible sans token)
if ($method === 'GET' && !isset($_GET['id'])) {
    $user = getOptionalUser();
    
    if ($user) {
        // Utilisateur connecté : inclure le statut in_library
        $stmt = $pdo->prepare("
            SELECT ws.*, st.name as session_type_name, u.username as creator_username,
                   EXISTS(
                       SELECT 1 FROM qogym_user_library ul 
                       WHERE ul.user_id = ? AND ul.workout_session_id = ws.id
                   ) as in_library
            FROM qogym_workout_sessions ws
            INNER JOIN qogym_session_types st ON ws.session_type_id = st.id
            INNER JOIN qogym_users u ON ws.user_id = u.id
            WHERE ws.is_qojim_session = 1 AND ws.is_archived = 0
            ORDER BY ws.created_at DESC
        ");
        $stmt->execute([$user['id']]);
    } else {
        // Utilisateur non connecté : pas de statut in_library
        $stmt = $pdo->query("
            SELECT ws.*, st.name as session_type_name, u.username as creator_username,
                   0 as in_library
            FROM qogym_workout_sessions ws
            INNER JOIN qogym_session_types st ON ws.session_type_id = st.id
            INNER JOIN qogym_users u ON ws.user_id = u.id
            WHERE ws.is_qojim_session = 1 AND ws.is_archived = 0
            ORDER BY ws.created_at DESC
        ");
    }
    
    $sessions = $stmt->fetchAll();
    
    jsonResponse(['success' => true, 'sessions' => $sessions]);
}

// Pour les autres endpoints, on a besoin d'authentification
$user = verifyAuth();

// AJOUTER UNE SÉANCE QOJIM À SA BIBLIOTHÈQUE
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'add_to_library') {
    $sessionId = $input['session_id'] ?? null;
    
    if (!$sessionId) {
        jsonResponse(['error' => 'ID de séance requis'], 400);
    }
    
    // Vérifier que c'est bien une séance Qojim
    $stmt = $pdo->prepare("SELECT id FROM qogym_workout_sessions WHERE id = ? AND is_qojim_session = 1");
    $stmt->execute([$sessionId]);
    if (!$stmt->fetch()) {
        jsonResponse(['error' => 'Séance Qojim non trouvée'], 404);
    }
    
    // Vérifier si déjà dans la bibliothèque
    $stmt = $pdo->prepare("SELECT id FROM qogym_user_library WHERE user_id = ? AND workout_session_id = ?");
    $stmt->execute([$user['id'], $sessionId]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => 'Cette séance est déjà dans votre bibliothèque'], 409);
    }
    
    // Ajouter à la bibliothèque
    $stmt = $pdo->prepare("INSERT INTO qogym_user_library (user_id, workout_session_id) VALUES (?, ?)");
    $stmt->execute([$user['id'], $sessionId]);
    
    jsonResponse(['success' => true, 'message' => 'Séance ajoutée à votre bibliothèque']);
}

// RETIRER UNE SÉANCE QOJIM DE SA BIBLIOTHÈQUE
if ($method === 'DELETE') {
    // DEBUG — à retirer une fois le problème résolu
    $rawBody = file_get_contents('php://input');
    error_log('[DELETE /qojim_sessions] raw body: ' . $rawBody);
    error_log('[DELETE /qojim_sessions] parsed input: ' . json_encode($input));
    error_log('[DELETE /qojim_sessions] $_GET: ' . json_encode($_GET));
    error_log('[DELETE /qojim_sessions] Content-Type: ' . ($_SERVER['CONTENT_TYPE'] ?? 'non défini'));

    // Fallback : si $input est vide, tenter de re-parser le body brut
    if (empty($input)) {
        $input = json_decode($rawBody, true) ?? [];
        error_log('[DELETE /qojim_sessions] input après re-parse: ' . json_encode($input));
    }

    // Fallback : accepter aussi session_id en query param (?session_id=xxx)
    $sessionId = $input['session_id'] ?? $_GET['session_id'] ?? null;
    error_log('[DELETE /qojim_sessions] session_id résolu: ' . var_export($sessionId, true));

    if (!$sessionId) {
        jsonResponse(['error' => 'ID de séance requis', 'debug' => [
            'raw_body'     => $rawBody,
            'parsed_input' => $input,
            'get_params'   => $_GET,
            'content_type' => $_SERVER['CONTENT_TYPE'] ?? null,
        ]], 400);
    }
    
    // Vérifier que c'est bien une séance Qojim
    $stmt = $pdo->prepare("SELECT id FROM qogym_workout_sessions WHERE id = ? AND is_qojim_session = 1");
    $stmt->execute([$sessionId]);
    if (!$stmt->fetch()) {
        jsonResponse(['error' => 'Séance Qojim non trouvée'], 404);
    }
    
    // Vérifier que la séance est dans la bibliothèque de l'utilisateur
    $stmt = $pdo->prepare("SELECT id FROM qogym_user_library WHERE user_id = ? AND workout_session_id = ?");
    $stmt->execute([$user['id'], $sessionId]);
    if (!$stmt->fetch()) {
        jsonResponse(['error' => 'Cette séance n\'est pas dans votre bibliothèque'], 404);
    }
    
    // Supprimer de la bibliothèque
    $stmt = $pdo->prepare("DELETE FROM qogym_user_library WHERE user_id = ? AND workout_session_id = ?");
    $stmt->execute([$user['id'], $sessionId]);
    
    jsonResponse(['success' => true, 'message' => 'Séance retirée de votre bibliothèque']);
}

jsonResponse(['error' => 'Action non reconnue'], 400);