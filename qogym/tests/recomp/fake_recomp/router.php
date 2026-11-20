<?php
// Faux serveur Recomp pour les tests (contrat de RECOMP-FEED-SOLUTION.md)
file_put_contents(__DIR__ . '/calls.log', $_SERVER['REQUEST_URI'] . "\n", FILE_APPEND);
if (file_exists(__DIR__ . '/slow.flag')) sleep(4);
if (file_exists(__DIR__ . '/down.flag')) { http_response_code(500); exit; }
header('Content-Type: application/json');
$h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if ($h !== 'Bearer testkey') { http_response_code(401); echo json_encode(['error' => 'bad key']); exit; }

$W = [
    ['id' => 'recomp:a1', 'user_id' => 1, 'name' => 'Jambes R', 'started_at' => '2026-11-19 11:00:00', 'completed_at' => '2026-11-19 12:00:00', 'notes' => '', 'privacy' => 'public', 'volume_kg' => 600, 'duration_min' => 60,
        'exercises' => [
            ['name' => 'Squat (barre)', 'superset' => null, 'sets' => [['weight' => 120, 'reps' => 5, 'type' => 'normal'], ['weight' => 60, 'reps' => 10, 'type' => 'warmup']]],
            ['name' => 'Tractions', 'superset' => null, 'sets' => [['weight' => 10, 'reps' => 8, 'type' => 'normal', 'bodyweight' => true]]],
        ]],
    ['id' => 'recomp:b1', 'user_id' => 2, 'name' => 'Bras R', 'started_at' => '2026-11-18 17:00:00', 'completed_at' => '2026-11-18 18:00:00', 'notes' => '', 'privacy' => 'public', 'exercises' => []],
    ['id' => 'recomp:bpriv', 'user_id' => 2, 'name' => 'Secret', 'started_at' => '2026-11-20 08:00:00', 'completed_at' => '2026-11-20 09:00:00', 'notes' => '', 'privacy' => 'private', 'exercises' => []],
    ['id' => 'recomp:c1', 'user_id' => 3, 'name' => 'Carol R', 'started_at' => '2026-11-20 08:00:00', 'completed_at' => '2026-11-20 09:00:00', 'notes' => '', 'privacy' => 'public', 'exercises' => []],
    ['id' => 'recomp:d1', 'user_id' => 4, 'name' => 'Dave R', 'started_at' => '2026-11-20 10:00:00', 'completed_at' => '2026-11-20 11:00:00', 'notes' => '', 'privacy' => 'public', 'exercises' => []],
];

if (isset($_GET['id'])) {
    foreach ($W as $w) {
        if ($w['id'] === $_GET['id'] && $w['user_id'] == (int)($_GET['user_id'] ?? 0)) {
            echo json_encode(['workouts' => [$w]]);
            exit;
        }
    }
    http_response_code(404);
    echo json_encode(['workouts' => []]);
    exit;
}

$ids = array_map('intval', explode(',', $_GET['user_ids'] ?? ''));
// recomp:d1 est TOUJOURS renvoyée (réponse "malveillante") pour vérifier que QoGym la filtre.
// recomp:bpriv est privée mais renvoyée quand même, idem.
$out = array_values(array_filter($W, fn($w) => in_array($w['user_id'], $ids, true)));
if (!empty($_GET['before'])) {
    $out = array_values(array_filter($out, fn($w) => $w['completed_at'] < $_GET['before']));
}
usort($out, fn($a, $b) => strcmp($b['completed_at'], $a['completed_at']));
$out = array_slice($out, 0, (int)($_GET['limit'] ?? 20));
$out[] = $W[4]; // recomp:d1 (dave, non demandé) ajouté en trop : QoGym doit le filtrer
echo json_encode(['workouts' => $out]);
