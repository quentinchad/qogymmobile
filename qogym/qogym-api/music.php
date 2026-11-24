<?php
require_once 'config.php';
require_once __DIR__ . '/music_lib.php';

// ----------------------------------------------------------------------------
// music.php — musique d'un entraînement (façon "notes Instagram")
//
//   GET  ?q=texte              → recherche de titres Deezer avec extrait 30 s
//                                { success, tracks: [{ provider, track_id, title,
//                                  artist, cover_url, link, duration, explicit }] }
//   GET  ?preview=TRACK_ID     → lien frais de l'extrait (expire en ~15 min)
//                                { success, preview_url }
//   POST { action: 'set', workout_id, track_id }
//                              → associe le titre à SON entraînement terminé
//                                { success, music }
//   POST { action: 'remove', workout_id }
//                              → retire le son { success }
//
// Pourquoi passer par le serveur : l'API Deezer n'autorise pas les appels
// cross-origin depuis un navigateur, et un cache évite de dépasser son quota
// (50 requêtes / 5 s par IP). Seul le texte cherché est envoyé à Deezer.
// Titre / artiste / pochette sont relus chez Deezer au moment du choix :
// le client ne peut pas enregistrer de métadonnées arbitraires.
// ----------------------------------------------------------------------------

try {
    $user = verifyAuth();
} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 401);
}

$method = $_SERVER['REQUEST_METHOD'];
$input  = json_decode(file_get_contents('php://input'), true);
$pdo    = getDB();

// --- RECHERCHE ---------------------------------------------------------------
if ($method === 'GET' && isset($_GET['q'])) {
    $q = trim((string)$_GET['q']);
    if (strlen($q) < 2) {
        jsonResponse(['error' => 'Recherche trop courte'], 400);
    }
    if (preg_match('/^.{0,100}/us', $q, $m)) {
        $q = $m[0]; // 100 caractères max sans couper un caractère UTF-8
    }

    $data = deezerGet('/search?limit=25&q=' . rawurlencode($q), DEEZER_CACHE_SEARCH);
    if ($data === null) {
        jsonResponse(['error' => 'La recherche musicale est indisponible pour le moment'], 502);
    }
    $tracks = [];
    foreach (($data['data'] ?? []) as $t) {
        $item = is_array($t) ? deezerTrackToItem($t) : null;
        if ($item) $tracks[] = $item;
    }
    jsonResponse(['success' => true, 'tracks' => $tracks]);
}

// --- LIEN DE L'EXTRAIT -------------------------------------------------------
if ($method === 'GET' && isset($_GET['preview'])) {
    $trackId = $_GET['preview'];
    if (!isDeezerTrackId($trackId)) {
        jsonResponse(['error' => 'Titre invalide'], 400);
    }
    $t = deezerGet('/track/' . $trackId, DEEZER_CACHE_PREVIEW);
    if ($t === null) {
        jsonResponse(['error' => "L'extrait est indisponible pour le moment"], 502);
    }
    if (empty($t['preview'])) {
        jsonResponse(['error' => "Ce titre n'a pas d'extrait"], 404);
    }
    jsonResponse(['success' => true, 'preview_url' => $t['preview']]);
}

// --- CHOISIR / RETIRER LE SON D'UN ENTRAÎNEMENT -----------------------------
if ($method === 'POST' && is_array($input) && in_array($input['action'] ?? null, ['set', 'remove'], true)) {
    $workoutId = $input['workout_id'] ?? null;
    if (!is_numeric($workoutId) || (int)$workoutId <= 0) {
        jsonResponse(['error' => 'workout_id requis'], 400);
    }
    $workoutId = (int)$workoutId;

    $stmt = $pdo->prepare("SELECT user_id FROM qogym_completed_workouts WHERE id = ? AND completed_at IS NOT NULL");
    $stmt->execute([$workoutId]);
    $owner = $stmt->fetchColumn();
    if ($owner === false) {
        jsonResponse(['error' => 'Entraînement non trouvé'], 404);
    }
    if ((int)$owner !== (int)$user['id']) {
        jsonResponse(['error' => 'Seul l\'auteur de l\'entraînement peut choisir sa musique'], 403);
    }

    try {
        if ($input['action'] === 'remove') {
            $stmt = $pdo->prepare("DELETE FROM qogym_workout_music WHERE completed_workout_id = ?");
            $stmt->execute([$workoutId]);
            jsonResponse(['success' => true]);
        }

        $trackId = $input['track_id'] ?? null;
        if (!isDeezerTrackId($trackId)) {
            jsonResponse(['error' => 'Titre invalide'], 400);
        }
        $t = deezerGet('/track/' . $trackId, DEEZER_CACHE_PREVIEW);
        if ($t === null) {
            jsonResponse(['error' => 'Deezer est indisponible pour le moment'], 502);
        }
        $item = deezerTrackToItem($t);
        if ($item === null) {
            jsonResponse(['error' => "Ce titre n'a pas d'extrait écoutable"], 422);
        }

        $stmt = $pdo->prepare("
            INSERT INTO qogym_workout_music (completed_workout_id, provider, track_id, title, artist, cover_url, link)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE provider = VALUES(provider), track_id = VALUES(track_id),
                title = VALUES(title), artist = VALUES(artist), cover_url = VALUES(cover_url), link = VALUES(link)
        ");
        $stmt->execute([
            $workoutId, 'deezer', $item['track_id'],
            substr($item['title'], 0, 255), substr($item['artist'], 0, 255),
            $item['cover_url'] ? substr($item['cover_url'], 0, 500) : null,
            substr($item['link'], 0, 500),
        ]);

        jsonResponse(['success' => true, 'music' => [
            'provider'  => 'deezer',
            'track_id'  => $item['track_id'],
            'title'     => $item['title'],
            'artist'    => $item['artist'],
            'cover_url' => $item['cover_url'],
            'link'      => $item['link'],
        ]]);
    } catch (PDOException $e) {
        jsonResponse(['error' => 'Musique indisponible pour le moment', 'code' => 'migration_needed'], 503);
    }
}

jsonResponse(['error' => 'Requête invalide'], 400);
