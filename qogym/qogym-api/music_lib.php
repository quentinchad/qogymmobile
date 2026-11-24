<?php
// ----------------------------------------------------------------------------
// music_lib.php — fonctions communes pour la musique des entraînements
//
// Source : API publique de Deezer (sans clé). Deezer fournit pour chaque
// titre un extrait officiel de 30 s (`preview`) que les applis tierces ont
// le droit de diffuser en streaming depuis leur CDN, avec attribution.
// On ne télécharge ni ne stocke jamais l'audio.
//
// Utilisé par music.php (recherche / extrait / choix du son) et feed.php
// (ajout du champ `music` aux entraînements).
// Table : qogym_workout_music (sql/migration_workout_music_20261124.sql).
// ----------------------------------------------------------------------------

const DEEZER_API      = 'https://api.deezer.com';
const DEEZER_UA       = 'QoGym/1.0 (qojim.com)';
const DEEZER_CACHE_SEARCH  = 3600; // 1 h : résultats de recherche
const DEEZER_CACHE_PREVIEW = 600;  // 10 min : les liens d'extrait expirent après ~15 min

/**
 * GET JSON sur l'API Deezer, avec cache fichier facultatif.
 * Retourne le tableau décodé, ou null si Deezer est injoignable / répond une erreur.
 */
function deezerGet(string $path, int $cacheTtl = 0): ?array
{
    $url = DEEZER_API . $path;
    $cacheFile = $cacheTtl > 0 ? sys_get_temp_dir() . '/qogym_dz_' . md5($url) . '.json' : null;

    if ($cacheFile && is_file($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTtl) {
        $cached = json_decode((string)@file_get_contents($cacheFile), true);
        if (is_array($cached)) return $cached;
    }

    $body = false;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_USERAGENT      => DEEZER_UA,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($code < 200 || $code >= 300) $body = false;
    } else {
        $ctx = stream_context_create(['http' => [
            'timeout' => 10,
            'header'  => "User-Agent: " . DEEZER_UA . "\r\nAccept: application/json\r\n",
        ]]);
        $body = @file_get_contents($url, false, $ctx);
    }
    if ($body === false || $body === '') return null;

    $data = json_decode($body, true);
    // Deezer répond 200 avec { error: {...} } en cas de problème (quota, id inconnu…)
    if (!is_array($data) || isset($data['error'])) return null;

    if ($cacheFile) @file_put_contents($cacheFile, json_encode($data));
    return $data;
}

/** Id de titre Deezer valide (entier positif, en chaîne). */
function isDeezerTrackId($v): bool
{
    return (is_string($v) || is_int($v)) && preg_match('/^[1-9][0-9]{0,18}$/', (string)$v) === 1;
}

/**
 * Titre Deezer → format renvoyé aux clients. null si le titre n'a pas
 * d'extrait écoutable (certains titres n'en ont pas).
 */
function deezerTrackToItem(array $t): ?array
{
    if (empty($t['id']) || empty($t['preview']) || (isset($t['readable']) && !$t['readable'])) {
        return null;
    }
    return [
        'provider' => 'deezer',
        'track_id' => (string)$t['id'],
        'title'    => (string)($t['title_short'] ?? $t['title'] ?? ''),
        'artist'   => (string)($t['artist']['name'] ?? ''),
        'cover_url'=> $t['album']['cover_medium'] ?? ($t['album']['cover_small'] ?? null),
        'link'     => $t['link'] ?? ('https://www.deezer.com/track/' . $t['id']),
        'duration' => (int)($t['duration'] ?? 0),
        'explicit' => !empty($t['explicit_lyrics']),
    ];
}

/** Ligne de qogym_workout_music → champ `music` d'un entraînement. */
function workoutMusicRowToItem(array $r): array
{
    return [
        'provider'  => $r['provider'],
        'track_id'  => (string)$r['track_id'],
        'title'     => $r['title'],
        'artist'    => $r['artist'],
        'cover_url' => $r['cover_url'],
        'link'      => $r['link'],
    ];
}

/**
 * Ajoute `music` (objet ou null) à chaque entraînement QoGym d'une liste.
 * Les séances externes (Recomp, id "recomp:…") gardent music = null.
 * Si la migration n'est pas jouée, tout reste à null sans erreur.
 */
function attachWorkoutMusic(PDO $pdo, array $workouts): array
{
    $ids = [];
    foreach ($workouts as $w) {
        if (isset($w['id']) && is_numeric($w['id'])) $ids[] = (int)$w['id'];
    }
    $byId = [];
    if ($ids) {
        try {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("SELECT * FROM qogym_workout_music WHERE completed_workout_id IN ($placeholders)");
            $stmt->execute($ids);
            foreach ($stmt->fetchAll() as $r) {
                $byId[(int)$r['completed_workout_id']] = workoutMusicRowToItem($r);
            }
        } catch (PDOException $e) {
            // Migration pas encore jouée : pas de musique
        }
    }
    foreach ($workouts as &$w) {
        $w['music'] = (isset($w['id']) && is_numeric($w['id'])) ? ($byId[(int)$w['id']] ?? null) : null;
    }
    unset($w);
    return $workouts;
}
