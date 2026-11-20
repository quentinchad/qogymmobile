<?php
// ============================================================================
// Séances externes (appli partenaire Recomp) affichées dans QoGym.
//
// DÉSACTIVÉ tant que config.php ne définit pas les deux constantes :
//     define('RECOMP_API_URL',     'https://…/api/partner/workouts');
//     define('RECOMP_PARTNER_KEY', '…clé partagée, hors Git…');
//
// Tout ce fichier n'est utilisé QUE par les clients qui le demandent
// explicitement (include_external=1, ids "recomp:…"). Les anciennes versions
// de l'appli et le site ne passent jamais par ici.
//
// Contrat d'API Recomp (voir RECOMP-FEED-SOLUTION.md) :
//   GET <URL>?user_ids=1,2,3&limit=20[&before=YYYY-MM-DD HH:MM:SS]
//   GET <URL>?user_id=N&id=recomp:xxx
//   Authorization: Bearer <clé>
//   → { "workouts": [ { id, user_id, name, started_at, completed_at, notes,
//                        privacy, volume_kg, duration_min,
//                        exercises: [ { name, superset, sets: [ { weight, reps, type, … } ] } ] } ] }
// ============================================================================

const EXTERNAL_SOURCE      = 'recomp';
const EXTERNAL_ID_PREFIX   = 'recomp:';
const EXTERNAL_CONNECT_TIMEOUT = 1;   // s
const EXTERNAL_TOTAL_TIMEOUT   = 2;   // s
const EXTERNAL_CACHE_TTL       = 120; // s
const EXTERNAL_MAX_USER_IDS    = 200;

function externalEnabled(): bool
{
    return defined('RECOMP_API_URL') && RECOMP_API_URL !== ''
        && defined('RECOMP_PARTNER_KEY') && RECOMP_PARTNER_KEY !== '';
}

function isExternalId($id): bool
{
    return is_string($id) && (bool)preg_match('/^recomp:[A-Za-z0-9_\-]{1,64}$/', $id);
}

function isValidCursor($before): bool
{
    return is_string($before) && (bool)preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $before);
}

// ---------------------------------------------------------------------------
// Appel HTTP à Recomp, avec cache fichier (succès uniquement) et timeouts
// courts. Renvoie ['ok' => bool, 'status' => int, 'data' => array|null].
// ---------------------------------------------------------------------------
function externalHttpGet(array $params): array
{
    if (!externalEnabled()) {
        return ['ok' => false, 'status' => 0, 'data' => null];
    }

    $url = RECOMP_API_URL . (strpos(RECOMP_API_URL, '?') === false ? '?' : '&') . http_build_query($params);

    $cacheDir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'qogym_partner_cache';
    $cacheFile = $cacheDir . DIRECTORY_SEPARATOR . sha1($url) . '.json';
    if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < EXTERNAL_CACHE_TTL) {
        $cached = json_decode((string)@file_get_contents($cacheFile), true);
        if (is_array($cached)) {
            return ['ok' => true, 'status' => 200, 'data' => $cached];
        }
    }

    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'data' => null];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => EXTERNAL_CONNECT_TIMEOUT,
        CURLOPT_TIMEOUT        => EXTERNAL_TOTAL_TIMEOUT,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . RECOMP_PARTNER_KEY,
            'Accept: application/json',
        ],
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    // (pas de curl_close : sans effet depuis PHP 8, et déprécié en 8.5)

    if ($body === false || $status !== 200) {
        return ['ok' => false, 'status' => $status, 'data' => null];
    }
    $data = json_decode($body, true);
    if (!is_array($data) || !isset($data['workouts']) || !is_array($data['workouts'])) {
        return ['ok' => false, 'status' => $status, 'data' => null];
    }

    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0700, true);
    }
    @file_put_contents($cacheFile, json_encode($data), LOCK_EX);

    return ['ok' => true, 'status' => 200, 'data' => $data];
}

// Garde uniquement les séances bien formées, terminées, non privées et
// appartenant à un des comptes demandés (défense en profondeur : on ne fait
// pas aveuglément confiance à la réponse).
function externalSanitize(array $workouts, array $allowedUserIds): array
{
    $allowed = array_flip(array_map('intval', $allowedUserIds));
    $out = [];
    foreach ($workouts as $w) {
        if (!is_array($w)) continue;
        if (!isExternalId($w['id'] ?? null)) continue;
        $uid = (int)($w['user_id'] ?? 0);
        if (!isset($allowed[$uid])) continue;
        if (!isValidCursor($w['completed_at'] ?? null)) continue;
        if (($w['privacy'] ?? 'public') === 'private') continue;
        $w['user_id'] = $uid;
        $out[] = $w;
    }
    return $out;
}

// Liste groupée. status : 'ok' | 'unavailable' | 'disabled'
function externalFetchList(array $userIds, int $limit, ?string $before): array
{
    $userIds = array_values(array_unique(array_map('intval', $userIds)));
    if (!externalEnabled()) {
        return ['status' => 'disabled', 'workouts' => []];
    }
    if (count($userIds) === 0) {
        return ['status' => 'ok', 'workouts' => []];
    }
    $userIds = array_slice($userIds, 0, EXTERNAL_MAX_USER_IDS);

    $params = ['user_ids' => implode(',', $userIds), 'limit' => $limit];
    if ($before !== null) $params['before'] = $before;

    $r = externalHttpGet($params);
    if (!$r['ok']) {
        return ['status' => 'unavailable', 'workouts' => []];
    }
    return ['status' => 'ok', 'workouts' => externalSanitize($r['data']['workouts'], $userIds)];
}

// Une séance. Renvoie ['status' => 'ok'|'not_found'|'unavailable'|'disabled', 'workout' => ?array]
function externalFetchOne(string $id, int $ownerId): array
{
    if (!externalEnabled()) {
        return ['status' => 'disabled', 'workout' => null];
    }
    $r = externalHttpGet(['user_id' => $ownerId, 'id' => $id]);
    if (!$r['ok']) {
        return ['status' => $r['status'] === 404 ? 'not_found' : 'unavailable', 'workout' => null];
    }
    foreach (externalSanitize($r['data']['workouts'], [$ownerId]) as $w) {
        if ($w['id'] === $id) {
            return ['status' => 'ok', 'workout' => $w];
        }
    }
    return ['status' => 'not_found', 'workout' => null];
}

// ---------------------------------------------------------------------------
// Droits de lecture (mêmes règles que QoGym)
// ---------------------------------------------------------------------------

// Comptes dont le lecteur peut voir les séances : lui-même + amis acceptés
// dont la visibilité est 'public'.
function visibleUserIdsForViewer(PDO $pdo, int $viewerId): array
{
    $stmt = $pdo->prepare("
        SELECT u.id
        FROM qogym_friendships f
        INNER JOIN qogym_users u
            ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
        WHERE (f.user_id = ? OR f.friend_id = ?)
          AND f.status = 'accepted'
          AND u.default_workout_privacy = 'public'
    ");
    $stmt->execute([$viewerId, $viewerId, $viewerId]);
    $ids = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    $ids[] = $viewerId;
    return array_values(array_unique($ids));
}

function canViewUserWorkouts(PDO $pdo, int $viewerId, int $ownerId): bool
{
    if ($viewerId === $ownerId) return true;
    return in_array($ownerId, visibleUserIdsForViewer($pdo, $viewerId), true);
}

// ---------------------------------------------------------------------------
// Réactions (likes / commentaires) stockées chez QoGym.
// Tolérant : si la migration n'est pas jouée, tout vaut 0.
// ---------------------------------------------------------------------------
function externalReactionCounts(PDO $pdo, array $externalIds, int $viewerId): array
{
    $counts = [];
    foreach ($externalIds as $id) {
        $counts[$id] = ['likes_count' => 0, 'comments_count' => 0, 'user_has_liked' => 0];
    }
    if (count($externalIds) === 0) return $counts;

    $ph = implode(',', array_fill(0, count($externalIds), '?'));
    try {
        $stmt = $pdo->prepare("SELECT external_id, COUNT(*) c, SUM(user_id = ?) mine
                               FROM qogym_external_likes WHERE external_id IN ($ph) GROUP BY external_id");
        $stmt->execute(array_merge([$viewerId], $externalIds));
        foreach ($stmt->fetchAll() as $r) {
            $counts[$r['external_id']]['likes_count'] = (int)$r['c'];
            $counts[$r['external_id']]['user_has_liked'] = ((int)$r['mine']) > 0 ? 1 : 0;
        }
        $stmt = $pdo->prepare("SELECT external_id, COUNT(*) c
                               FROM qogym_external_comments WHERE external_id IN ($ph) GROUP BY external_id");
        $stmt->execute($externalIds);
        foreach ($stmt->fetchAll() as $r) {
            $counts[$r['external_id']]['comments_count'] = (int)$r['c'];
        }
    } catch (PDOException $e) {
        // Tables absentes : compteurs à 0
    }
    return $counts;
}

// Infos d'affichage des propriétaires (pseudo, photo QoGym)
function usersById(PDO $pdo, array $ids): array
{
    $ids = array_values(array_unique(array_map('intval', $ids)));
    if (count($ids) === 0) return [];
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT id, username, pdp, email FROM qogym_users WHERE id IN ($ph)");
    $stmt->execute($ids);
    $out = [];
    foreach ($stmt->fetchAll() as $u) $out[(int)$u['id']] = $u;
    return $out;
}

// ---------------------------------------------------------------------------
// Conversion au format QoGym
// ---------------------------------------------------------------------------
function externalTotalSets(array $w): int
{
    $n = 0;
    foreach (($w['exercises'] ?? []) as $ex) {
        $n += is_array($ex['sets'] ?? null) ? count($ex['sets']) : 0;
    }
    return $n;
}

// Élément du fil (même forme que feed.php?feed=1)
function externalToFeedItem(array $w, array $owner, array $counts): array
{
    return [
        'id'                 => $w['id'],
        'source'             => EXTERNAL_SOURCE,
        'user_id'            => $w['user_id'],
        'workout_session_id' => null,
        'started_at'         => $w['started_at'] ?? null,
        'completed_at'       => $w['completed_at'],
        'notes'              => $w['notes'] ?? '',
        'user_username'      => $owner['username'] ?? null,
        'user_pdp'           => $owner['pdp'] ?? null,
        'session_name'       => $w['name'] ?? 'Séance',
        'session_image'      => null,
        'session_type_name'  => null,
        'likes_count'        => $counts['likes_count'],
        'comments_count'     => $counts['comments_count'],
        'user_has_liked'     => $counts['user_has_liked'],
        'participants'       => null,
        'total_sets'         => externalTotalSets($w),
        'volume_kg'          => $w['volume_kg'] ?? null,
        'duration_min'       => $w['duration_min'] ?? null,
    ];
}

// Élément d'historique de profil (même forme que user_profile.php)
function externalToHistoryItem(array $w, array $counts): array
{
    return [
        'id'                => $w['id'],
        'source'            => EXTERNAL_SOURCE,
        'completed_at'      => $w['completed_at'],
        'notes'             => $w['notes'] ?? '',
        'session_name'      => $w['name'] ?? 'Séance',
        'session_image'     => null,
        'session_type_name' => null,
        'total_sets'        => externalTotalSets($w),
        'likes_count'       => $counts['likes_count'],
        'comments_count'    => $counts['comments_count'],
        'user_has_liked'    => $counts['user_has_liked'],
        'volume_kg'         => $w['volume_kg'] ?? null,
        'duration_min'      => $w['duration_min'] ?? null,
    ];
}

// Exercices au format du détail QoGym (+ champs Recomp conservés)
function externalExercisesToDetail(array $w): array
{
    $out = [];
    foreach (array_values($w['exercises'] ?? []) as $i => $ex) {
        $sets = [];
        foreach (array_values(is_array($ex['sets'] ?? null) ? $ex['sets'] : []) as $j => $s) {
            $sets[] = array_merge($s, [
                'set_number' => $j + 1,
                'weight'     => $s['weight'] ?? null,
                'reps'       => $s['reps'] ?? 0,
            ]);
        }
        $out[] = [
            'id'             => null,
            'exercise_name'  => $ex['name'] ?? 'Exercice',
            'planned_sets'   => null,
            'reps_min'       => null,
            'reps_max'       => null,
            'rest_time'      => null,
            'exercise_order' => $i,
            'superset_group' => $ex['superset'] ?? null,
            'completed_sets' => $sets,
        ];
    }
    return $out;
}

// Fusion de deux listes triées par completed_at décroissant, coupée à $limit.
function mergeByCompletedAt(array $a, array $b, int $limit): array
{
    $all = array_merge($a, $b);
    usort($all, function ($x, $y) {
        $c = strcmp((string)$y['completed_at'], (string)$x['completed_at']);
        return $c !== 0 ? $c : strcmp((string)$y['id'], (string)$x['id']);
    });
    return array_slice($all, 0, $limit);
}

// Ids de commentaires externes : "ext:<n>" pour ne jamais croiser les ids
// numériques de qogym_workout_comments.
function externalCommentId($n): string
{
    return 'ext:' . (int)$n;
}

function parseExternalCommentId($v): ?int
{
    if (is_string($v) && preg_match('/^ext:(\d+)$/', $v, $m)) return (int)$m[1];
    return null;
}
