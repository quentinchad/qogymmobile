<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// RÉCUPÉRER LES PRÉFÉRENCES
if ($method === 'GET') {
    $stmt = $pdo->prepare("
        SELECT id, username, email, default_workout_privacy, pdp,
               daily_kcal_target,
               daily_protein_target, daily_carbs_target, daily_fat_target
        FROM qogym_users
        WHERE id = ?
    ");
    $stmt->execute([$user['id']]);
    $preferences = $stmt->fetch();
    if ($preferences) {
        // Cast en types JSON-friendly (int pour kcal, float pour macros)
        if (isset($preferences['daily_kcal_target']) && $preferences['daily_kcal_target'] !== null) {
            $preferences['daily_kcal_target'] = (int)$preferences['daily_kcal_target'];
        }
        foreach (['daily_protein_target', 'daily_carbs_target', 'daily_fat_target'] as $k) {
            if (isset($preferences[$k]) && $preferences[$k] !== null) {
                $preferences[$k] = (float)$preferences[$k];
            }
        }
    }

    jsonResponse(['success' => true, 'preferences' => $preferences]);
}

// METTRE À JOUR LES PRÉFÉRENCES
if ($method === 'PUT') {
    $updates = [];
    $params  = [];

    // default_workout_privacy
    if (array_key_exists('default_workout_privacy', $input)) {
        $privacy = $input['default_workout_privacy'];
        if (!in_array($privacy, ['public', 'private'])) {
            jsonResponse(['error' => 'Valeur de confidentialité invalide'], 400);
        }
        $updates[] = 'default_workout_privacy = ?';
        $params[]  = $privacy;
    }

    // daily_kcal_target (peut être null pour retirer l'objectif)
    if (array_key_exists('daily_kcal_target', $input)) {
        $val = $input['daily_kcal_target'];
        if ($val === null || $val === '' || $val === 0 || $val === '0') {
            $updates[] = 'daily_kcal_target = NULL';
        } else {
            $val = (int)$val;
            if ($val < 0 || $val > 99999) {
                jsonResponse(['error' => 'Objectif calorique invalide'], 400);
            }
            $updates[] = 'daily_kcal_target = ?';
            $params[]  = $val;
        }
    }

    // daily_{protein,carbs,fat}_target (NULL = pas d'objectif sur cette macro,
    // sinon valeur en grammes). Mêmes règles que daily_kcal_target.
    foreach (['daily_protein_target', 'daily_carbs_target', 'daily_fat_target'] as $field) {
        if (!array_key_exists($field, $input)) continue;
        $val = $input[$field];
        if ($val === null || $val === '' || $val === 0 || $val === '0') {
            $updates[] = "$field = NULL";
        } else {
            $val = (float)$val;
            if (!is_finite($val) || $val < 0 || $val > 9999) {
                jsonResponse(['error' => "Objectif macro invalide ($field)"], 400);
            }
            $updates[] = "$field = ?";
            $params[]  = $val;
        }
    }

    if (empty($updates)) {
        jsonResponse(['error' => 'Aucune préférence à mettre à jour'], 400);
    }

    $params[] = $user['id'];
    $sql = 'UPDATE qogym_users SET ' . implode(', ', $updates) . ' WHERE id = ?';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    jsonResponse([
        'success' => true,
        'message' => 'Préférences mises à jour',
    ]);
}

// UPLOADER UNE PHOTO DE PROFIL
if ($method === 'POST' && isset($_FILES['pdp'])) {
    $file = $_FILES['pdp'];
    
    // Vérifier que le fichier est une image
    $allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!in_array($file['type'], $allowed_types)) {
        jsonResponse(['error' => 'Type de fichier non autorisé. Utilisez JPG, PNG, GIF ou WEBP'], 400);
    }
    
    // Vérifier la taille (max 5MB)
    $max_size = 5 * 1024 * 1024;
    if ($file['size'] > $max_size) {
        jsonResponse(['error' => 'Fichier trop volumineux. Maximum 5MB'], 400);
    }
    
    // Vérifier qu'il n'y a pas d'erreur d'upload
    if ($file['error'] !== UPLOAD_ERR_OK) {
        $error_messages = [
            UPLOAD_ERR_INI_SIZE => 'Fichier trop volumineux (dépassement ini_get)',
            UPLOAD_ERR_FORM_SIZE => 'Fichier trop volumineux (formulaire)',
            UPLOAD_ERR_PARTIAL => 'Upload partiel',
            UPLOAD_ERR_NO_FILE => 'Pas de fichier',
            UPLOAD_ERR_NO_TMP_DIR => 'Dossier temporaire manquant',
            UPLOAD_ERR_CANT_WRITE => 'Impossible d\'écrire sur le disque',
            UPLOAD_ERR_EXTENSION => 'Extension PHP bloquée'
        ];
        $error = $error_messages[$file['error']] ?? 'Erreur d\'upload inconnue';
        jsonResponse(['error' => $error], 400);
    }
    
    // Générer un nom unique avec hash
    $original_name = pathinfo($file['name'], PATHINFO_FILENAME);
    $extension = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $hash = md5($user['id'] . time() . uniqid());
    $filename = $hash . '_' . substr(preg_replace('/[^a-zA-Z0-9_-]/', '', $original_name), 0, 20) . '.' . $extension;
    
    // Vérifier que le nom n'existe pas déjà
    $stmt = $pdo->prepare("SELECT id FROM qogym_users WHERE pdp = ?");
    $stmt->execute([$filename]);
    if ($stmt->fetch()) {
        // Réessayer avec un autre hash
        $hash = md5($user['id'] . time() . uniqid() . rand());
        $filename = $hash . '_' . substr(preg_replace('/[^a-zA-Z0-9_-]/', '', $original_name), 0, 20) . '.' . $extension;
    }
    
    // Déterminer le chemin du dossier pdp
    // Utiliser __DIR__ qui est plus fiable que dirname(__FILE__)
    $pdp_dir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'pdp';
    
    // Créer le dossier s'il n'existe pas
    if (!is_dir($pdp_dir)) {
        if (!mkdir($pdp_dir, 0755, true)) {
            jsonResponse(['error' => 'Impossible de créer le dossier des photos: ' . $pdp_dir], 500);
        }
    }
    
    // Vérifier que le dossier est accessible en écriture
    if (!is_writable($pdp_dir)) {
        jsonResponse(['error' => 'Le dossier des photos n\'est pas accessible en écriture'], 500);
    }
    
    $file_path = $pdp_dir . DIRECTORY_SEPARATOR . $filename;
    
    // Déplacer le fichier uploadé vers le dossier pdp
    if (!move_uploaded_file($file['tmp_name'], $file_path)) {
        jsonResponse(['error' => 'Impossible de sauvegarder le fichier. Vérifiez les permissions du dossier ' . $pdp_dir], 500);
    }
    
    // Vérifier que le fichier a bien été copié
    if (!file_exists($file_path)) {
        jsonResponse(['error' => 'Le fichier n\'a pas été sauvegardé correctement'], 500);
    }
    
    // Obtenir la photo de profil actuelle pour la supprimer si elle existe
    $stmt = $pdo->prepare("SELECT pdp FROM qogym_users WHERE id = ?");
    $stmt->execute([$user['id']]);
    $old_pdp = $stmt->fetchColumn();
    
    // Supprimer l'ancienne photo si elle existe
    if ($old_pdp) {
        $old_file_path = $pdp_dir . DIRECTORY_SEPARATOR . $old_pdp;
        if (file_exists($old_file_path)) {
            unlink($old_file_path);
        }
    }
    
    // Mettre à jour la base de données avec le nouveau nom de fichier
    $stmt = $pdo->prepare("
        UPDATE qogym_users 
        SET pdp = ? 
        WHERE id = ?
    ");
    $stmt->execute([$filename, $user['id']]);
    
    jsonResponse([
        'success' => true, 
        'message' => 'Photo de profil mise à jour',
        'pdp' => $filename,
        'pdp_url' => 'https://qojim.com/pdp/' . $filename
    ]);
}

jsonResponse(['error' => 'Action non reconnue'], 400);
?>