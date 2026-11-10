<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// Fonction pour vérifier l'auth de manière optionnelle
function getOptionalUser()
{
    try {
        return verifyAuth();
    } catch (Exception $e) {
        return null;
    }
}

/**
 * Upload une image dans /imgseances et retourne l'URL publique.
 * Retourne null si aucun fichier n'est fourni ou en cas d'erreur.
 */
function uploadSessionImage(): ?string
{
    if (!isset($_FILES['image']) || $_FILES['image']['error'] === UPLOAD_ERR_NO_FILE) {
        return null;
    }

    $file = $_FILES['image'];

    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new Exception('Erreur lors de la réception du fichier image (code ' . $file['error'] . ')');
    }

    // Vérification du type MIME réel (pas seulement l'extension)
    $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']);

    if (!in_array($mimeType, $allowedMimes)) {
        throw new Exception('Format d\'image non supporté. Utilisez JPG, PNG, GIF ou WebP.');
    }

    // Vérification de la taille (max 5 Mo)
    if ($file['size'] > 5 * 1024 * 1024) {
        throw new Exception('L\'image ne doit pas dépasser 5 Mo.');
    }

    // Déterminer l'extension à partir du MIME
    $extensions = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/gif'  => 'gif',
        'image/webp' => 'webp',
    ];
    $ext = $extensions[$mimeType];

    // Dossier de destination sur le serveur
    $uploadDir = rtrim($_SERVER['DOCUMENT_ROOT'], '/') . '/imgseances/';

    if (!is_dir($uploadDir)) {
        if (!mkdir($uploadDir, 0755, true)) {
            throw new Exception('Impossible de créer le dossier d\'upload.');
        }
    }

    // Nom de fichier unique
    $filename = uniqid('session_', true) . '.' . $ext;
    $destination = $uploadDir . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        throw new Exception('Échec du déplacement du fichier uploadé.');
    }

    // URL publique
    return 'https://qojim.com/imgseances/' . $filename;
}

/**
 * Supprime un fichier image uploadé à partir de son URL publique.
 * Ne fait rien si l'URL ne correspond pas au domaine qojim.com/imgseances.
 */
function deleteSessionImage(?string $imageUrl): void
{
    if (!$imageUrl) return;

    $prefix = 'https://qojim.com/imgseances/';
    if (strpos($imageUrl, $prefix) !== 0) return;

    $filename = basename($imageUrl);
    // Sécurité : pas de chemin traversal
    if ($filename !== basename($filename) || strpos($filename, '..') !== false) return;

    $filePath = rtrim($_SERVER['DOCUMENT_ROOT'], '/') . '/imgseances/' . $filename;
    if (file_exists($filePath)) {
        @unlink($filePath);
    }
}

// TYPES DE SÉANCES (PUBLIC - pas besoin d'auth)
if ($method === 'GET' && isset($_GET['types'])) {
    $stmt = $pdo->query("
        SELECT id, name 
        FROM qogym_session_types 
        ORDER BY id
    ");
    $types = $stmt->fetchAll();

    jsonResponse(['success' => true, 'session_types' => $types]);
}

// DÉTAILS D'UNE SÉANCE (PUBLIC - mais avec info différente selon auth)
if ($method === 'GET' && isset($_GET['id'])) {
    $user = getOptionalUser();
    $userId = $user ? $user['id'] : 0;
    $sessionId = $_GET['id'];

    $stmt = $pdo->prepare("
        SELECT ws.*, st.name as session_type_name,
               CASE WHEN ws.user_id = ? THEN 1 ELSE 0 END as is_owner,
               EXISTS(
                   SELECT 1 FROM qogym_user_library ul 
                   WHERE ul.user_id = ? AND ul.workout_session_id = ws.id
               ) as in_library
        FROM qogym_workout_sessions ws
        LEFT JOIN qogym_session_types st ON ws.session_type_id = st.id
        WHERE ws.id = ? AND ws.deleted_at IS NULL
    ");
    $stmt->execute([$userId, $userId, $sessionId]);
    $session = $stmt->fetch();

    if (!$session) {
        jsonResponse(['error' => 'Séance non trouvée'], 404);
    }

    // Charger les exercices (exclut les exos créés en cours de séance qui
    // n'ont pas été propagés à la template, ainsi que ceux retirés du
    // template depuis mais conservés pour l'historique passé).
    $stmt = $pdo->prepare("
        SELECT * FROM qogym_exercises 
        WHERE workout_session_id = ?
          AND COALESCE(is_workout_custom, 0) = 0
          AND COALESCE(removed_from_template, 0) = 0
        ORDER BY exercise_order
    ");
    $stmt->execute([$sessionId]);
    $session['exercises'] = $stmt->fetchAll();

    jsonResponse(['success' => true, 'session' => $session]);
}

// TOUS LES EXERCICES de l'utilisateur (pour le picker pendant un workout)
// Agrège les exos de toutes les séances accessibles (les siennes + sa
// bibliothèque), dédoublonnés par nom (case-insensitive), avec une priorité
// donnée aux exos provenant de ses propres séances non-custom.
if ($method === 'GET' && isset($_GET['all_exercises'])) {
    $user = verifyAuth();

    // NB: on ne renvoie pas superset_group ici — le picker pendant un
    //     workout sert à ajouter UN exo à la fois ; le superset est défini
    //     par l'utilisateur après-coup en regroupant des cards adjacentes.
    $stmt = $pdo->prepare("
        SELECT e.id, e.name, e.sets, e.reps_min, e.reps_max, e.rest_time,
               e.workout_session_id, ws.user_id AS session_user_id,
               COALESCE(e.is_workout_custom, 0) AS is_workout_custom
        FROM qogym_exercises e
        INNER JOIN qogym_workout_sessions ws ON ws.id = e.workout_session_id
        LEFT JOIN qogym_user_library ul
               ON ul.workout_session_id = ws.id AND ul.user_id = ?
        WHERE ws.deleted_at IS NULL
          AND COALESCE(e.removed_from_template, 0) = 0
          AND (
                (ws.user_id = ? AND ws.is_archived = 0)
             OR ul.user_id IS NOT NULL
          )
        ORDER BY
            CASE WHEN ws.user_id = ? THEN 0 ELSE 1 END,
            COALESCE(e.is_workout_custom, 0) ASC,
            e.id DESC
    ");
    $stmt->execute([$user['id'], $user['id'], $user['id']]);
    $rows = $stmt->fetchAll();

    // Dédoublonnage par nom (insensible à la casse). Le ORDER BY garantit
    // qu'on garde en premier la version la plus "propre" (séance personnelle,
    // non créée pendant un workout).
    $seen = [];
    $exercises = [];
    foreach ($rows as $row) {
        $key = mb_strtolower(trim($row['name']));
        if ($key === '' || isset($seen[$key])) continue;
        $seen[$key] = true;
        $exercises[] = $row;
    }

    // Dernière performance pour chaque exercice (toutes séances confondues).
    // On matche par NOM (insensible à la casse) car un même exercice peut
    // exister sous plusieurs lignes qogym_exercises (une par séance, ou des
    // exos custom créés pendant un workout précédent), avec des exercise_id
    // différents. On cherche donc le dernier entraînement complété de
    // l'utilisateur contenant un exercice portant ce nom, puis on récupère
    // les sets enregistrés pour cet exercice ce jour-là.
    $stmtLastPerf = $pdo->prepare("
        SELECT GROUP_CONCAT(
            CASE 
                WHEN cs.weight IS NOT NULL THEN CONCAT(cs.weight, 'kg x ', cs.reps, ' reps')
                ELSE CONCAT(cs.reps, ' reps')
            END
            ORDER BY cs.set_number SEPARATOR ' | '
        ) as last_performance
        FROM qogym_completed_sets cs
        INNER JOIN qogym_exercises e ON e.id = cs.exercise_id
        WHERE LOWER(TRIM(e.name)) = LOWER(TRIM(?))
        AND cs.completed_workout_id = (
            SELECT cw.id
            FROM qogym_completed_workouts cw
            INNER JOIN qogym_completed_sets cs2 ON cs2.completed_workout_id = cw.id
            INNER JOIN qogym_exercises e2 ON e2.id = cs2.exercise_id
            WHERE cw.user_id = ?
              AND cw.completed_at IS NOT NULL
              AND LOWER(TRIM(e2.name)) = LOWER(TRIM(?))
            ORDER BY cw.completed_at DESC
            LIMIT 1
        )
    ");

    foreach ($exercises as &$ex) {
        $stmtLastPerf->execute([$ex['name'], $user['id'], $ex['name']]);
        $perfRow = $stmtLastPerf->fetch();
        $ex['last_performance'] = $perfRow['last_performance'] ?? null;
    }
    unset($ex);

    jsonResponse(['success' => true, 'exercises' => $exercises]);
}

// RECHERCHE EXTERNE D'EXERCICES (base wger.de)
//
// Proxy server-side vers l'API publique wger.de — une base d'exercices de
// musculation open-source et gratuite, sans clé API requise en lecture.
// On passe par le backend plutôt que d'appeler wger.de directement depuis
// le front pour deux raisons : éviter les soucis CORS/CSP dans la WebView
// de l'app mobile, et garder le contrôle (auth qojim requise, timeout,
// dégradation silencieuse si wger est indisponible).
//
// NB: wger ne connaît pas de séries/reps/repos (ce sont des paramètres
// d'entraînement propres à qojim, pas des propriétés intrinsèques de
// l'exercice) — on ne renvoie donc que nom + catégorie, à charge du
// front de compléter avec des valeurs par défaut.
if ($method === 'GET' && isset($_GET['external_exercise_search'])) {
    verifyAuth(); // garde l'auth qojim pour éviter que le proxy soit ouvert à tous

    $term = trim($_GET['term'] ?? '');
    if ($term === '' || mb_strlen($term) < 2) {
        jsonResponse(['success' => true, 'results' => []]);
    }

    $results = [];

    if (function_exists('curl_init')) {
        $url = 'https://wger.de/api/v2/exercise/search/?term=' . urlencode($term)
             . '&language=french&format=json';

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 4,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'QoGym/1.0 (+https://qojim.com)',
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response !== false && $httpCode === 200) {
            $data = json_decode($response, true);
            $seen = [];
            foreach (($data['suggestions'] ?? []) as $s) {
                $d = $s['data'] ?? [];
                $name = trim($d['name'] ?? '');
                if ($name === '') continue;
                $key = mb_strtolower($name);
                if (isset($seen[$key])) continue; // wger renvoie parfois des doublons multi-langue
                $seen[$key] = true;
                $results[] = [
                    'id' => $d['id'] ?? null,
                    'name' => $name,
                    'category' => $d['category'] ?? null,
                ];
            }
        }
        // Si wger ne répond pas / timeout / erreur : $results reste [],
        // on renvoie une liste vide plutôt qu'une erreur bloquante — la
        // recherche externe est un bonus, pas une dépendance critique.
    }

    jsonResponse(['success' => true, 'results' => $results]);
}

// LISTE DES SÉANCES (nécessite auth)
if ($method === 'GET' && !isset($_GET['id']) && !isset($_GET['types']) && !isset($_GET['all_exercises']) && !isset($_GET['external_exercise_search'])) {
    $user = verifyAuth(); // Auth requise pour cette route

    $stmt = $pdo->prepare("
        SELECT DISTINCT ws.*, st.name as session_type_name,
               CASE WHEN ws.user_id = ? THEN 1 ELSE 0 END as is_owner
        FROM qogym_workout_sessions ws
        INNER JOIN qogym_session_types st ON ws.session_type_id = st.id
        LEFT JOIN qogym_user_library ul ON ws.id = ul.workout_session_id AND ul.user_id = ?
        WHERE ws.deleted_at IS NULL
          AND (
                (ws.user_id = ? AND ws.is_archived = 0)
             OR ul.user_id IS NOT NULL
          )
        ORDER BY ws.created_at DESC
    ");
    $stmt->execute([$user['id'], $user['id'], $user['id']]);
    $sessions = $stmt->fetchAll();

    jsonResponse(['success' => true, 'sessions' => $sessions]);
}

// CRÉER UNE SÉANCE (nécessite auth)
// Le formulaire arrive en multipart/form-data à cause de l'upload d'image
// On exclut les POST avec _method=PUT qui sont des mises à jour déguisées
if ($method === 'POST' && !isset($input['action']) && ($_POST['_method'] ?? '') !== 'PUT') {
    $user = verifyAuth(); // Auth requise

    // Lire les champs depuis $_POST (multipart) ou $input (JSON sans image)
    $name          = trim($_POST['name'] ?? $input['name'] ?? '');
    $sessionTypeId = $_POST['session_type_id'] ?? $input['session_type_id'] ?? null;
    $exercisesRaw  = $_POST['exercises'] ?? null;
    $exercises     = $exercisesRaw ? json_decode($exercisesRaw, true) : ($input['exercises'] ?? []);
    $isQojimSession = ($user['is_admin'] && (
        (isset($_POST['is_qojim_session']) && $_POST['is_qojim_session'] === '1') ||
        (isset($input['is_qojim_session']) && $input['is_qojim_session'])
    ));
    // Utilisé pour les "séances libres" : on crée la séance template
    // directement archivée, et on la désarchive plus tard SI l'utilisateur
    // demande à la garder en galerie. Garantit qu'une fermeture d'app au
    // milieu du flux laisse une galerie propre.
    $isArchived = (
        (isset($_POST['is_archived']) && $_POST['is_archived'] === '1') ||
        (isset($input['is_archived']) && $input['is_archived'])
    ) ? 1 : 0;

    if (empty($name) || !$sessionTypeId) {
        jsonResponse(['error' => 'Nom et type de séance requis'], 400);
    }

    // Upload de l'image si fournie
    try {
        $imageUrl = uploadSessionImage();
        // Si pas de nouveau fichier, utiliser image_url fournie (cas sans upload)
        if ($imageUrl === null) {
            $rawUrl = $_POST['image_url'] ?? $input['image_url'] ?? '';
            $imageUrl = (isset($rawUrl) && trim($rawUrl)) ? trim($rawUrl) : null;
        }
    } catch (Exception $e) {
        jsonResponse(['error' => $e->getMessage()], 400);
    }

    $pdo->beginTransaction();

    try {
        // Créer la séance
        $stmt = $pdo->prepare("
            INSERT INTO qogym_workout_sessions (user_id, name, image_url, session_type_id, is_qojim_session, is_archived) 
            VALUES (?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([$user['id'], $name, $imageUrl, $sessionTypeId, $isQojimSession, $isArchived]);
        $sessionId = $pdo->lastInsertId();

        // Ajouter les exercices
        if (!empty($exercises)) {
            $stmt = $pdo->prepare("
                INSERT INTO qogym_exercises 
                (workout_session_id, name, sets, reps_min, reps_max, rest_time, exercise_order, superset_group) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ");

            foreach ($exercises as $index => $exercise) {
                $supersetGroup = isset($exercise['superset_group']) && $exercise['superset_group'] !== null && $exercise['superset_group'] !== ''
                    ? (int)$exercise['superset_group']
                    : null;
                $stmt->execute([
                    $sessionId,
                    $exercise['name'],
                    $exercise['sets'] ?? 1,
                    $exercise['reps_min'] ?? null,
                    $exercise['reps_max'] ?? null,
                    $exercise['rest_time'] ?? 60,
                    $index,
                    $supersetGroup
                ]);
            }
        }

        $pdo->commit();

        jsonResponse([
            'success' => true,
            'session_id' => $sessionId,
            'message' => 'Séance créée avec succès'
        ]);
    } catch (Exception $e) {
        $pdo->rollBack();
        // Supprimer l'image uploadée si la transaction a échoué
        deleteSessionImage($imageUrl);
        jsonResponse(['error' => 'Erreur lors de la création de la séance'], 500);
    }
}

// METTRE À JOUR UNE SÉANCE (nécessite auth)
// Peut arriver en multipart/form-data avec _method=PUT (upload image) ou en PUT JSON classique
if (($method === 'POST' && isset($_POST['_method']) && $_POST['_method'] === 'PUT')
    || $method === 'PUT'
) {

    $user = verifyAuth(); // Auth requise

    // Support multipart PUT via POST + _method=PUT (nécessaire pour FormData)
    $isMultipart = ($method === 'POST');

    $sessionId     = $_POST['id'] ?? $input['id'] ?? null;
    $name          = isset($_POST['name']) ? trim($_POST['name']) : (isset($input['name']) ? trim($input['name']) : null);
    $sessionTypeId = $_POST['session_type_id'] ?? $input['session_type_id'] ?? null;
    $exercisesRaw  = $_POST['exercises'] ?? null;
    $exercises     = $exercisesRaw ? json_decode($exercisesRaw, true) : ($input['exercises'] ?? null);

    if (!$sessionId) {
        jsonResponse(['error' => 'ID de séance requis'], 400);
    }

    // Vérifier les permissions
    $stmt = $pdo->prepare("SELECT user_id, is_qojim_session, image_url, deleted_at FROM qogym_workout_sessions WHERE id = ?");
    $stmt->execute([$sessionId]);
    $session = $stmt->fetch();

    if (!$session || $session['deleted_at'] !== null) {
        jsonResponse(['error' => 'Séance non trouvée'], 404);
    }

    // Les utilisateurs ne peuvent pas modifier les séances Qojim
    if (!$user['is_admin'] && $session['is_qojim_session']) {
        jsonResponse(['error' => 'Les séances Qojim ne peuvent pas être modifiées'], 403);
    }

    // Vérifier que c'est le propriétaire OU un admin qui modifie is_archived
    $isOwner = $session['user_id'] == $user['id'];
    $isAdminArchiving = $user['is_admin'] && isset($input['is_archived']) && !isset($input['name']) && !isset($input['session_type_id']) && !isset($input['image_url']) && !isset($input['exercises']);

    if (!$isOwner && !$isAdminArchiving) {
        jsonResponse(['error' => 'Vous n\'avez pas la permission de modifier cette séance'], 403);
    }

    // Gérer l'image
    $newImageUrl = null;
    $oldImageUrl = $session['image_url'];
    $imageChanged = false;

    try {
        $uploadedUrl = uploadSessionImage();

        if ($uploadedUrl !== null) {
            // Nouvelle image uploadée
            $newImageUrl = $uploadedUrl;
            $imageChanged = true;
        } elseif ($isMultipart) {
            // Multipart mais pas de nouveau fichier : utiliser image_url transmise
            $rawUrl = $_POST['image_url'] ?? '';
            $newImageUrl = trim($rawUrl) !== '' ? trim($rawUrl) : null;
            // Si l'ancienne URL était hébergée sur qojim et qu'elle est supprimée
            $imageChanged = ($newImageUrl !== $oldImageUrl);
        } elseif (array_key_exists('image_url', $input ?? [])) {
            $rawUrl = $input['image_url'];
            $newImageUrl = (isset($rawUrl) && trim($rawUrl)) ? trim($rawUrl) : null;
            $imageChanged = ($newImageUrl !== $oldImageUrl);
        }
    } catch (Exception $e) {
        jsonResponse(['error' => $e->getMessage()], 400);
    }

    $pdo->beginTransaction();

    try {
        $updates = [];
        $params = [];

        if ($name !== null) {
            $updates[] = "name = ?";
            $params[] = $name;
        }
        if ($sessionTypeId !== null) {
            $updates[] = "session_type_id = ?";
            $params[] = $sessionTypeId;
        }
        if ($imageChanged) {
            $updates[] = "image_url = ?";
            $params[] = $newImageUrl;
        }
        // is_archived est modifiable par un admin OU par le propriétaire
        // de la séance (utile pour les "séances libres" qu'on n'enregistre
        // pas dans la galerie : on les archive plutôt que de casser
        // l'historique).
        if (isset($input['is_archived']) && ($user['is_admin'] || $isOwner)) {
            $updates[] = "is_archived = ?";
            $params[] = $input['is_archived'] ? 1 : 0;
        }

        if (!empty($updates)) {
            $params[] = $sessionId;
            $stmt = $pdo->prepare("
                UPDATE qogym_workout_sessions 
                SET " . implode(', ', $updates) . " 
                WHERE id = ?
            ");
            $stmt->execute($params);
        }

        // Mettre à jour les exercices si fournis
        if ($exercises !== null) {
            // Récupérer les exercices existants avec leur id, nom et ordre
            // (exclut les exos custom-during-workout pour ne pas les
            // confondre avec les exos template lors du diff).
            $stmt = $pdo->prepare("
                SELECT id, name, exercise_order 
                FROM qogym_exercises 
                WHERE workout_session_id = ?
                  AND COALESCE(is_workout_custom, 0) = 0
                  AND COALESCE(removed_from_template, 0) = 0
                ORDER BY exercise_order
            ");
            $stmt->execute([$sessionId]);
            $existingExercises = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // Construire un index des exercices existants par nom
            // En cas de doublons de nom, on indexe aussi par ordre pour les distinguer
            $existingByName = [];
            foreach ($existingExercises as $ex) {
                $key = strtolower(trim($ex['name']));
                if (!isset($existingByName[$key])) {
                    $existingByName[$key] = [];
                }
                $existingByName[$key][] = $ex; // tableau pour gérer les doublons
            }

            $matchedIds   = []; // IDs existants qu'on va garder (pour savoir lesquels supprimer)
            $toInsert     = []; // nouveaux exercices à insérer

            foreach ($exercises as $index => $exercise) {
                if (!isset($exercise['name']) || trim($exercise['name']) === '') {
                    continue;
                }

                $newName = trim($exercise['name']);
                $key     = strtolower($newName);

                // Chercher une correspondance par nom dans les existants
                if (!empty($existingByName[$key])) {
                    // Prendre le premier disponible (FIFO)
                    $matched = array_shift($existingByName[$key]);
                    if (empty($existingByName[$key])) {
                        unset($existingByName[$key]);
                    }

                    $matchedIds[] = $matched['id'];

                    // Mettre à jour sets/reps/rest/order/superset_group sans changer l'id
                    $stmtUpd = $pdo->prepare("
                        UPDATE qogym_exercises
                        SET name           = ?,
                            sets           = ?,
                            reps_min       = ?,
                            reps_max       = ?,
                            rest_time      = ?,
                            exercise_order = ?,
                            superset_group = ?
                        WHERE id = ?
                    ");
                    $supersetGroup = isset($exercise['superset_group']) && $exercise['superset_group'] !== null && $exercise['superset_group'] !== ''
                        ? (int)$exercise['superset_group']
                        : null;
                    $stmtUpd->execute([
                        $newName,
                        intval($exercise['sets'] ?? 1),
                        !empty($exercise['reps_min']) ? intval($exercise['reps_min']) : null,
                        !empty($exercise['reps_max']) ? intval($exercise['reps_max']) : null,
                        intval($exercise['rest_time'] ?? 60),
                        $index,
                        $supersetGroup,
                        $matched['id']
                    ]);
                } else {
                    // Exercice nouveau : à insérer
                    $supersetGroup = isset($exercise['superset_group']) && $exercise['superset_group'] !== null && $exercise['superset_group'] !== ''
                        ? (int)$exercise['superset_group']
                        : null;
                    $toInsert[] = [
                        'name'     => $newName,
                        'sets'     => intval($exercise['sets'] ?? 1),
                        'reps_min' => !empty($exercise['reps_min']) ? intval($exercise['reps_min']) : null,
                        'reps_max' => !empty($exercise['reps_max']) ? intval($exercise['reps_max']) : null,
                        'rest_time' => intval($exercise['rest_time'] ?? 60),
                        'order'    => $index,
                        'superset_group' => $supersetGroup,
                    ];
                }
            }

            // Retirer les exercices qui ne sont plus dans la liste soumise.
            //
            // /!\ On ne supprime PLUS jamais physiquement un exercice qui a
            // déjà été réalisé au moins une fois (il a des séries dans
            // qogym_completed_sets) : le supprimer effacerait aussi cet
            // exercice de tout l'historique passé (feed, profil...), alors
            // que l'utilisateur veut seulement le retirer du template pour
            // les FUTURES séances. On le marque donc simplement comme
            // "retiré du template" (removed_from_template = 1), ce qui le
            // masque des vues actives (détail de séance, picker d'exercices,
            // diff d'édition) tout en le laissant pleinement joignable pour
            // l'affichage de l'historique existant.
            //
            // Seuls les exercices JAMAIS réalisés (aucune série enregistrée)
            // sont réellement supprimés, pour ne pas laisser traîner des
            // lignes inutiles issues de simples erreurs de saisie.
            $allExistingIds = array_column($existingExercises, 'id');
            $idsToDelete    = array_diff($allExistingIds, $matchedIds);

            if (!empty($idsToDelete)) {
                $placeholders = implode(',', array_fill(0, count($idsToDelete), '?'));

                // Quels ids ont déjà des séries enregistrées (= un historique
                // à préserver) ?
                $stmt = $pdo->prepare("
                    SELECT DISTINCT exercise_id FROM qogym_completed_sets
                    WHERE exercise_id IN ($placeholders)
                ");
                $stmt->execute(array_values($idsToDelete));
                $idsWithHistory = array_column($stmt->fetchAll(), 'exercise_id');

                $idsToSoftDelete = array_intersect($idsToDelete, $idsWithHistory);
                $idsToHardDelete = array_diff($idsToDelete, $idsWithHistory);

                if (!empty($idsToSoftDelete)) {
                    $ph = implode(',', array_fill(0, count($idsToSoftDelete), '?'));
                    $stmt = $pdo->prepare("
                        UPDATE qogym_exercises SET removed_from_template = 1
                        WHERE id IN ($ph)
                    ");
                    $stmt->execute(array_values($idsToSoftDelete));
                }

                if (!empty($idsToHardDelete)) {
                    // Aucune série enregistrée pour ces ids : rien à préserver,
                    // suppression physique classique.
                    $ph = implode(',', array_fill(0, count($idsToHardDelete), '?'));
                    $stmt = $pdo->prepare("DELETE FROM qogym_exercises WHERE id IN ($ph)");
                    $stmt->execute(array_values($idsToHardDelete));
                }
            }

            // Insérer les nouveaux exercices
            if (!empty($toInsert)) {
                $stmtIns = $pdo->prepare("
                    INSERT INTO qogym_exercises 
                    (workout_session_id, name, sets, reps_min, reps_max, rest_time, exercise_order, superset_group) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ");
                foreach ($toInsert as $ex) {
                    $stmtIns->execute([
                        $sessionId,
                        $ex['name'],
                        $ex['sets'],
                        $ex['reps_min'],
                        $ex['reps_max'],
                        $ex['rest_time'],
                        $ex['order'],
                        $ex['superset_group'] ?? null
                    ]);
                }
            }
        }

        $pdo->commit();

        // Supprimer l'ancienne image hébergée sur qojim si elle a été remplacée ou supprimée
        if ($imageChanged && $oldImageUrl) {
            deleteSessionImage($oldImageUrl);
        }

        jsonResponse(['success' => true, 'message' => 'Séance mise à jour avec succès']);
    } catch (Exception $e) {
        $pdo->rollBack();
        // Supprimer la nouvelle image uploadée si la transaction a échoué
        if ($newImageUrl && $newImageUrl !== $oldImageUrl) {
            deleteSessionImage($newImageUrl);
        }
        jsonResponse(['error' => 'Erreur lors de la mise à jour de la séance: ' . $e->getMessage()], 500);
    }
}

// SUPPRIMER UNE SÉANCE (nécessite auth)
//
// /!\ "Suppression" = SOFT DELETE (deleted_at). La séance disparaît de la
// bibliothèque/galerie de l'utilisateur, mais TOUT l'historique déjà
// enregistré à partir d'elle (entraînements complétés, séries, exercices)
// reste intact et continue de s'afficher normalement dans le feed et le
// profil, exactement comme il a été fait — c'est tout l'intérêt : on ne
// réécrit pas le passé parce qu'on supprime un template pour l'avenir.
if ($method === 'DELETE') {
    $user = verifyAuth(); // Auth requise
    $sessionId = $input['id'] ?? null;

    if (!$sessionId) {
        jsonResponse(['error' => 'ID de séance requis'], 400);
    }

    $stmt = $pdo->prepare("SELECT user_id, deleted_at FROM qogym_workout_sessions WHERE id = ?");
    $stmt->execute([$sessionId]);
    $session = $stmt->fetch();

    if (!$session || $session['deleted_at'] !== null) {
        jsonResponse(['error' => 'Séance non trouvée'], 404);
    }

    if ($session['user_id'] != $user['id']) {
        jsonResponse(['error' => 'Vous n\'avez pas la permission de supprimer cette séance'], 403);
    }

    try {
        $pdo->beginTransaction();

        // Retirer la séance de la bibliothèque des utilisateurs qui l'ont
        // ajoutée (elle ne doit plus être "active" nulle part), sans
        // toucher aux entraînements déjà complétés ni aux exercices.
        $stmt = $pdo->prepare("DELETE FROM qogym_user_library WHERE workout_session_id = ?");
        $stmt->execute([$sessionId]);

        // Marquer la séance comme supprimée plutôt que la supprimer
        // réellement — l'historique (qogym_completed_workouts,
        // qogym_completed_sets, qogym_exercises) est volontairement
        // conservé tel quel.
        $stmt = $pdo->prepare("UPDATE qogym_workout_sessions SET deleted_at = NOW() WHERE id = ?");
        $stmt->execute([$sessionId]);

        // Nettoyer les invitations de partage pendantes vers/depuis cette
        // séance (sinon on a des "shares fantômes" qui apparaissent dans le
        // badge mais sont masqués dans la liste à cause des INNER JOIN, ce
        // qui empêche le receiver de les accepter ou refuser).
        // Les shares déjà acceptés/refusés sont conservés pour l'historique.
        $stmt = $pdo->prepare("DELETE FROM qogym_session_shares WHERE session_id = ? AND status = 'pending'");
        $stmt->execute([$sessionId]);

        $pdo->commit();

        // NB : on ne supprime plus le fichier image — il reste potentiellement
        // affiché dans l'historique (feed/profil) des entraînements passés.

        jsonResponse(['success' => true, 'message' => 'Séance supprimée avec succès']);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => 'Erreur lors de la suppression: ' . $e->getMessage()], 500);
    }
}

jsonResponse(['error' => 'Action non reconnue'], 400);