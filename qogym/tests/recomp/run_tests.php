<?php
// Tests de bout en bout : API QoGym (copie isolée, base locale jetable) + faux Recomp
$API = getenv('QOGYM_TEST_API') ?: 'http://127.0.0.1:8793';
$MYSQL = getenv('QOGYM_TEST_MYSQL') ?: 'C:/xampp/mysql/bin/mysql.exe';
$FAKE = __DIR__ . '/fake_recomp';
$fail = 0; $n = 0;

function req($method, $path, $token = null, $body = null) {
    global $API;
    $ch = curl_init($API . $path);
    $h = ['Content-Type: application/json'];
    if ($token) $h[] = 'Authorization: Bearer ' . $token;
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 15]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $t = microtime(true);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    
    return ['code' => $code, 'json' => json_decode($raw, true), 'raw' => $raw, 'ms' => (int)((microtime(true) - $t) * 1000)];
}
function ok($label, $cond, $extra = '') {
    global $fail, $n; $n++;
    if (!$cond) $fail++;
    echo ($cond ? 'ok   ' : 'FAIL ') . $label . ($cond || $extra === '' ? '' : "  → $extra") . "\n";
}
function ids($list) { return array_map(fn($w) => (string)$w['id'], $list ?? []); }
function calls() { global $FAKE; return is_file("$FAKE/calls.log") ? count(file("$FAKE/calls.log")) : 0; }
function db($sql) { global $MYSQL; shell_exec(escapeshellarg($MYSQL) . ' -h127.0.0.1 -P3399 -uroot qogym_test -e ' . escapeshellarg($sql)); }
function clearCache() { foreach (glob(sys_get_temp_dir() . '/qogym_partner_cache/*') ?: [] as $f) @unlink($f); }

@unlink("$FAKE/calls.log"); @unlink("$FAKE/slow.flag"); @unlink("$FAKE/down.flag"); clearCache();
db("INSERT INTO qogym_auth_tokens (user_id,token,expires_at) VALUES (4,'tokD','2099-01-01')");
db("INSERT INTO qogym_auth_tokens (user_id,token,expires_at,scope) VALUES (1,'tokP','2099-01-01','partner:recomp')"); // nécessite migration_partner_tokens

echo "== A. Anciens clients : rien ne change ==\n";
$r = req('GET', '/feed.php?feed=1&limit=50&offset=0', 'tokA');
ok('fil classique 200', $r['code'] === 200, $r['raw']);
ok('fil classique : séances QoGym uniquement (2,1)', ids($r['json']['workouts']) === ['2', '1'], json_encode(ids($r['json']['workouts'])));
ok('fil classique : pas de champ source', !array_key_exists('source', $r['json']['workouts'][0] ?? []));
ok('fil classique : pas de next_before', !array_key_exists('next_before', $r['json']));
ok('aucun appel à Recomp', calls() === 0, (string)calls());
$r = req('GET', '/feed.php?workout_id=1', 'tokB');
ok('détail QoGym numérique OK', $r['code'] === 200 && (int)$r['json']['workout']['exercises'][0]['id'] === 1 && count($r['json']['workout']['exercises'][0]['completed_sets']) === 1, $r['raw']);
$r = req('POST', '/feed.php', 'tokB', ['action' => 'like', 'workout_id' => 1]);
ok('like QoGym numérique OK', $r['code'] === 200 && $r['json']['action'] === 'liked', $r['raw']);

echo "== B. Correction : historique d'un ami en 'private' ==\n";
$r = req('GET', '/user_profile.php?user_id=3', 'tokA');
ok('profil carol (privée) : historique vide', $r['code'] === 200 && $r['json']['history'] === [] && $r['json']['history_private'] === true, $r['raw']);
ok('profil carol : stats toujours visibles', isset($r['json']['stats']['total_workouts']));
$r = req('GET', '/user_profile.php?user_id=3&history=1&limit=10&offset=0', 'tokA');
ok('page suivante carol : vide', $r['code'] === 200 && $r['json']['history'] === [] && $r['json']['history_private'] === true, $r['raw']);
$r = req('GET', '/user_profile.php?user_id=3', 'tokC');
ok('carol voit son propre historique', ids($r['json']['history']) === ['3'], $r['raw']);
$r = req('GET', '/user_profile.php?user_id=2', 'tokA');
ok('profil bob (public) inchangé', ids($r['json']['history']) === ['2'] && $r['json']['history_private'] === false && !array_key_exists('source', $r['json']['history'][0]), $r['raw']);

echo "== C. Fil fusionné (include_external=1) ==\n";
$r = req('GET', '/feed.php?feed=1&include_external=1&limit=20', 'tokA');
ok('200', $r['code'] === 200, $r['raw']);
ok('ordre fusionné a1, 2, b1, 1', ids($r['json']['workouts']) === ['recomp:a1', '2', 'recomp:b1', '1'], json_encode(ids($r['json']['workouts'] ?? [])));
ok('external_status ok', ($r['json']['external_status'] ?? '') === 'ok');
$a1 = $r['json']['workouts'][0];
ok('élément Recomp au format du fil', $a1['source'] === 'recomp' && $a1['user_username'] === 'alice' && $a1['user_pdp'] === 'a.jpg' && $a1['session_name'] === 'Jambes R' && $a1['session_image'] === null && $a1['total_sets'] === 3, json_encode($a1));
ok('élément QoGym marqué source qogym', $r['json']['workouts'][1]['source'] === 'qogym');
ok('carol (privée), dave (pas ami), séance privée : absents', !array_intersect(ids($r['json']['workouts']), ['recomp:c1', 'recomp:d1', 'recomp:bpriv', '3', '4']));
$c = calls();
$r2 = req('GET', '/feed.php?feed=1&include_external=1&limit=20', 'tokA');
ok('cache : 2e chargement sans appel à Recomp', calls() === $c, calls() . " vs $c");
$p1 = req('GET', '/feed.php?feed=1&include_external=1&limit=2', 'tokA');
ok('page 1 (limit 2) = a1, 2 + next_before', ids($p1['json']['workouts']) === ['recomp:a1', '2'] && $p1['json']['next_before'] === '2026-11-19 10:00:00', $p1['raw']);
$p2 = req('GET', '/feed.php?feed=1&include_external=1&limit=2&before=' . urlencode($p1['json']['next_before']), 'tokA');
ok('page 2 = b1, 1', ids($p2['json']['workouts']) === ['recomp:b1', '1'], $p2['raw']);
$r = req('GET', '/feed.php?feed=1&include_external=1&before=hier', 'tokA');
ok('curseur invalide → 400', $r['code'] === 400);
$before = calls();
req('GET', '/feed.php?feed=1&include_external=1&limit=7', 'tokA');
ok('un seul appel groupé à Recomp par chargement', calls() === $before + 1, (calls() - $before) . ' appels');

echo "== D. Profil fusionné ==\n";
$r = req('GET', '/user_profile.php?user_id=1&include_external=1', 'tokB');
ok('profil alice vu par bob : a1 + 1', ids($r['json']['history']) === ['recomp:a1', '1'], $r['raw']);
ok('élément Recomp au format historique', $r['json']['history'][0]['source'] === 'recomp' && $r['json']['history'][0]['total_sets'] === 3);
$r = req('GET', '/user_profile.php?user_id=1&history=1&limit=1&include_external=1', 'tokB');
ok('historique paginé (curseur) page 1', ids($r['json']['history']) === ['recomp:a1'] && $r['json']['next_before'] === '2026-11-19 12:00:00' && $r['json']['has_more'] === true, $r['raw']);
$r = req('GET', '/user_profile.php?user_id=1&history=1&limit=1&include_external=1&before=' . urlencode('2026-11-19 12:00:00'), 'tokB');
ok('historique paginé page 2', ids($r['json']['history']) === ['1'], $r['raw']);
$r = req('GET', '/user_profile.php?user_id=3&include_external=1', 'tokA');
ok('carol privée : rien, même en mode externe', $r['json']['history'] === [] && $r['json']['history_private'] === true, $r['raw']);
$r = req('GET', '/user_profile.php?user_id=4&include_external=1', 'tokA');
ok('dave (pas ami) : rien', $r['json']['history'] === [], $r['raw']);

echo "== E. Détail d'une séance Recomp ==\n";
$r = req('GET', '/feed.php?workout_id=recomp:a1&owner_id=1', 'tokB');
ok('200', $r['code'] === 200, $r['raw']);
$w = $r['json']['workout'] ?? [];
ok('exercices au format QoGym', count($w['exercises'] ?? []) === 2 && $w['exercises'][0]['exercise_name'] === 'Squat (barre)' && $w['exercises'][0]['completed_sets'][1]['set_number'] === 2 && $w['exercises'][0]['completed_sets'][1]['type'] === 'warmup', json_encode($w['exercises'] ?? null));
ok('champ bodyweight conservé', ($w['exercises'][1]['completed_sets'][0]['bodyweight'] ?? null) === true);
ok('likes / commentaires vides (migration pas jouée)', $w['likes'] === [] && $w['comments'] === []);
ok('sans owner_id → 400', req('GET', '/feed.php?workout_id=recomp:a1', 'tokB')['code'] === 400);
ok('dave (pas ami) → 403', req('GET', '/feed.php?workout_id=recomp:a1&owner_id=1', 'tokD')['code'] === 403);
ok('séance de carol (privée) vue par alice → 403', req('GET', '/feed.php?workout_id=recomp:c1&owner_id=3', 'tokA')['code'] === 403);
ok('mauvais propriétaire → 404', req('GET', '/feed.php?workout_id=recomp:a1&owner_id=2', 'tokA')['code'] === 404);
ok('séance privée demandée directement → 404', req('GET', '/feed.php?workout_id=recomp:bpriv&owner_id=2', 'tokA')['code'] === 404);

echo "== F. Réactions avant migration ==\n";
$r = req('POST', '/feed.php', 'tokB', ['action' => 'like', 'workout_id' => 'recomp:a1', 'owner_id' => 1]);
ok('like → 503 migration_needed', $r['code'] === 503 && $r['json']['code'] === 'migration_needed', $r['raw']);

echo "== G. Réactions après migration ==\n";
shell_exec(escapeshellarg($MYSQL) . ' -h127.0.0.1 -P3399 -uroot qogym_test < ' . escapeshellarg(__DIR__ . '/../../sql/migration_external_reactions_20261120.sql'));
$r = req('POST', '/feed.php', 'tokB', ['action' => 'like', 'workout_id' => 'recomp:a1', 'owner_id' => 1]);
ok('like → liked', $r['code'] === 200 && $r['json']['action'] === 'liked', $r['raw']);
clearCache();
$f = req('GET', '/feed.php?feed=1&include_external=1&limit=20', 'tokB');
$a1 = array_values(array_filter($f['json']['workouts'], fn($x) => $x['id'] === 'recomp:a1'))[0] ?? null;
ok('compteur de likes dans le fil', $a1 && $a1['likes_count'] === 1 && $a1['user_has_liked'] === 1, json_encode($a1));
$r = req('POST', '/feed.php', 'tokB', ['action' => 'like', 'workout_id' => 'recomp:a1', 'owner_id' => 1]);
ok('2e like → unliked', $r['json']['action'] === 'unliked');
$c1 = req('POST', '/feed.php', 'tokB', ['action' => 'comment', 'workout_id' => 'recomp:a1', 'owner_id' => 1, 'comment' => 'Bravo']);
ok('commentaire → id ext:', $c1['code'] === 200 && strpos($c1['json']['comment_id'], 'ext:') === 0, $c1['raw']);
$c2 = req('POST', '/feed.php', 'tokA', ['action' => 'comment', 'workout_id' => 'recomp:a1', 'owner_id' => 1, 'comment' => 'Merci', 'parent_comment_id' => $c1['json']['comment_id']]);
ok('réponse rattachée au parent', $c2['code'] === 200 && $c2['json']['parent_comment_id'] === $c1['json']['comment_id'], $c2['raw']);
$c3 = req('POST', '/feed.php', 'tokB', ['action' => 'comment', 'workout_id' => 'recomp:a1', 'owner_id' => 1, 'comment' => 'De rien', 'parent_comment_id' => $c2['json']['comment_id']]);
ok('réponse à une réponse aplatie sur la racine', $c3['json']['parent_comment_id'] === $c1['json']['comment_id'], $c3['raw']);
$d = req('GET', '/feed.php?workout_id=recomp:a1&owner_id=1', 'tokA');
ok('détail : 3 commentaires, ids ext:', count($d['json']['workout']['comments']) === 3 && $d['json']['workout']['comments'][1]['parent_comment_id'] === $c1['json']['comment_id'], json_encode($d['json']['workout']['comments']));
ok('suppression par un autre → 403', req('DELETE', '/feed.php?comment_id=' . $c1['json']['comment_id'], 'tokA')['code'] === 403);
ok('suppression par l\'auteur → OK', req('DELETE', '/feed.php?comment_id=' . $c1['json']['comment_id'], 'tokB')['code'] === 200);
$d = req('GET', '/feed.php?workout_id=recomp:a1&owner_id=1', 'tokA');
ok('réponses supprimées avec la racine', $d['json']['workout']['comments'] === [], json_encode($d['json']['workout']['comments']));
ok('commentaire QoGym numérique toujours OK', req('POST', '/feed.php', 'tokB', ['action' => 'comment', 'workout_id' => 1, 'comment' => 'Top'])['code'] === 200);
ok('like sur séance de dave par alice → 403', req('POST', '/feed.php', 'tokA', ['action' => 'like', 'workout_id' => 'recomp:d1', 'owner_id' => 4])['code'] === 403);

echo "== H. Token partenaire ==\n";
ok('fil fusionné avec token partenaire → 200', req('GET', '/feed.php?feed=1&include_external=1', 'tokP')['code'] === 200);
ok('workouts.php avec token partenaire → 403', req('GET', '/workouts.php?history=1', 'tokP')['code'] === 403);

echo "== I. Recomp en panne / lent ==\n";
touch("$FAKE/down.flag"); clearCache();
$r = req('GET', '/feed.php?feed=1&include_external=1&limit=20', 'tokA');
ok('panne : fil QoGym quand même (2,1) + unavailable', $r['code'] === 200 && ids($r['json']['workouts']) === ['2', '1'] && $r['json']['external_status'] === 'unavailable', $r['raw']);
ok('panne : détail → 503', req('GET', '/feed.php?workout_id=recomp:a1&owner_id=1', 'tokA')['code'] === 503);
unlink("$FAKE/down.flag"); touch("$FAKE/slow.flag"); clearCache();
$r = req('GET', '/feed.php?feed=1&include_external=1&limit=20', 'tokA');
ok('lent (4 s) : réponse en moins de 3 s + unavailable', $r['ms'] < 3000 && $r['json']['external_status'] === 'unavailable', $r['ms'] . ' ms');
unlink("$FAKE/slow.flag");

echo "\n" . ($fail ? "$fail ÉCHEC(S) sur $n" : "TOUT OK ($n tests)") . "\n";
