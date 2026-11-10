<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// Vérifier que l'utilisateur est admin
if (!$user['is_admin']) {
    jsonResponse(['error' => 'Accès non autorisé'], 403);
}

// STATISTIQUES GÉNÉRALES
if ($method === 'GET' && isset($_GET['stats'])) {
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM qogym_users");
    $totalUsers = $stmt->fetch()['total'];
    
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM qogym_workout_sessions WHERE is_qojim_session = 1");
    $totalQojimSessions = $stmt->fetch()['total'];
    
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM qogym_completed_workouts WHERE completed_at IS NOT NULL");
    $totalWorkouts = $stmt->fetch()['total'];
    
    jsonResponse([
        'success' => true,
        'stats' => [
            'total_users' => $totalUsers,
            'total_qojim_sessions' => $totalQojimSessions,
            'total_completed_workouts' => $totalWorkouts
        ]
    ]);
}

// LISTE DES UTILISATEURS
if ($method === 'GET' && isset($_GET['users'])) {
    $stmt = $pdo->query("
        SELECT id, email, username, is_admin, created_at,
               (SELECT COUNT(*) FROM qogym_completed_workouts WHERE user_id = qogym_users.id AND completed_at IS NOT NULL) as total_workouts
        FROM qogym_users
        ORDER BY created_at DESC
    ");
    $users = $stmt->fetchAll();
    
    jsonResponse(['success' => true, 'users' => $users]);
}

// TYPES DE SÉANCES
if ($method === 'GET' && isset($_GET['session_types'])) {
    $stmt = $pdo->query("
        SELECT st.*, COUNT(ws.id) as usage_count
        FROM qogym_session_types st
        LEFT JOIN qogym_workout_sessions ws ON st.id = ws.session_type_id
        GROUP BY st.id
        ORDER BY st.name
    ");
    $types = $stmt->fetchAll();
    
    jsonResponse(['success' => true, 'session_types' => $types]);
}

// CRÉER UN TYPE DE SÉANCE
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'create_type') {
    $name = trim($input['name'] ?? '');
    
    if (empty($name)) {
        jsonResponse(['error' => 'Nom du type requis'], 400);
    }
    
    $stmt = $pdo->prepare("INSERT INTO qogym_session_types (name) VALUES (?)");
    $stmt->execute([$name]);
    
    jsonResponse(['success' => true, 'type_id' => $pdo->lastInsertId()]);
}

// METTRE À JOUR UN TYPE DE SÉANCE
if ($method === 'PUT' && isset($input['action']) && $input['action'] === 'update_type') {
    $typeId = $input['type_id'] ?? null;
    $name = trim($input['name'] ?? '');
    
    if (!$typeId || empty($name)) {
        jsonResponse(['error' => 'ID et nom requis'], 400);
    }
    
    $stmt = $pdo->prepare("UPDATE qogym_session_types SET name = ? WHERE id = ?");
    $stmt->execute([$name, $typeId]);
    
    jsonResponse(['success' => true, 'message' => 'Type mis à jour']);
}

// SUPPRIMER UN TYPE DE SÉANCE
if ($method === 'DELETE' && isset($_GET['type_id'])) {
    $typeId = $_GET['type_id'];
    
    // Vérifier qu'il n'est pas utilisé
    $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM qogym_workout_sessions WHERE session_type_id = ?");
    $stmt->execute([$typeId]);
    if ($stmt->fetch()['count'] > 0) {
        jsonResponse(['error' => 'Ce type est utilisé par des séances'], 409);
    }
    
    $stmt = $pdo->prepare("DELETE FROM qogym_session_types WHERE id = ?");
    $stmt->execute([$typeId]);
    
    jsonResponse(['success' => true, 'message' => 'Type supprimé']);
}

// LISTE DES SÉANCES QOJIM (incluant archivées)
if ($method === 'GET' && isset($_GET['qojim_sessions'])) {
    $stmt = $pdo->query("
        SELECT ws.*, st.name as session_type_name,
               (SELECT COUNT(*) FROM qogym_user_library WHERE workout_session_id = ws.id) as users_count
        FROM qogym_workout_sessions ws
        INNER JOIN qogym_session_types st ON ws.session_type_id = st.id
        WHERE ws.is_qojim_session = 1
        ORDER BY ws.is_archived, ws.created_at DESC
    ");
    $sessions = $stmt->fetchAll();
    
    jsonResponse(['success' => true, 'sessions' => $sessions]);
}

jsonResponse(['error' => 'Action non reconnue'], 400);
?>
