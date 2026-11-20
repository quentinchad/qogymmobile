<?php
// Crée une COPIE isolée de qogym-api pour les tests, branchée sur la base
// locale jetable (127.0.0.1:3399, base qogym_test) et sur le faux Recomp
// (127.0.0.1:8792). Le vrai config.php (identifiants de prod) n'est JAMAIS copié.
//
// Usage : php make_test_api.php <dossier_cible>
if ($argc < 2) {
    fwrite(STDERR, "Usage : php make_test_api.php <dossier_cible>\n");
    exit(1);
}
$src = realpath(__DIR__ . '/../../qogym-api');
$dst = rtrim($argv[1], '/\\');
if (!is_dir($dst) && !mkdir($dst, 0777, true)) {
    fwrite(STDERR, "Impossible de créer $dst\n");
    exit(1);
}
foreach (glob($src . '/*.php') as $f) {
    if (basename($f) === 'config.php' || basename($f) === 'config.example.php') continue;
    copy($f, $dst . '/' . basename($f));
}
$cfg = file_get_contents($src . '/config.example.php');
$cfg = strtr($cfg, [
    "define('DB_HOST', 'CHANGE_ME')" => "define('DB_HOST', '127.0.0.1;port=3399')",
    "define('DB_NAME', 'CHANGE_ME')" => "define('DB_NAME', 'qogym_test')",
    "define('DB_USER', 'CHANGE_ME')" => "define('DB_USER', 'root')",
    "define('DB_PASS', 'CHANGE_ME')" => "define('DB_PASS', '')",
    "// define('RECOMP_API_URL', 'https://…/api/partner/workouts');" => "define('RECOMP_API_URL', 'http://127.0.0.1:8792/api/partner/workouts');",
    "// define('RECOMP_PARTNER_KEY', '');" => "define('RECOMP_PARTNER_KEY', 'testkey');",
]);
if (strpos($cfg, "qogym_test") === false || strpos($cfg, "127.0.0.1:8792") === false) {
    fwrite(STDERR, "config.example.php a changé : remplacement impossible, vérifier make_test_api.php\n");
    exit(1);
}
file_put_contents($dst . '/config.php', $cfg);
echo "API de test prête dans $dst\n";
