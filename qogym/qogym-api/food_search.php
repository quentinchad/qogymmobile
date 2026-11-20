<?php
require_once 'config.php';

// ----------------------------------------------------------------------------
// food_search.php — recherche de vrais produits alimentaires
//
// Proxy vers Open Food Facts (base ouverte, gratuite, sans clé API) :
//   GET ?q=nutella[&page=1]   → recherche texte (produits vendus en France)
//   GET ?q=3017620422003      → recherche par code-barres (8 à 14 chiffres)
//
// Réponse : { success, products: [{ code, name, brand, quantity, image,
//             kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
//             serving_g }], has_more }
//
// Sources, essayées dans l'ordre :
//   1. search.openfoodfacts.org ("search-a-licious") — le moteur de recherche
//      actuel d'OFF, rapide et classé par pertinence.
//   2. fr.openfoodfacts.org/cgi/search.pl — l'ancienne recherche, gardée en
//      secours (elle répond souvent 503 quand elle est surchargée).
// En cas d'échec total, la réponse 502 contient `detail` (code HTTP / erreur
// cURL de chaque source) pour diagnostiquer depuis la console du navigateur.
//
// Pourquoi passer par le serveur plutôt qu'appeler OFF depuis le navigateur :
//  - OFF demande un User-Agent identifiant l'application ;
//  - la recherche OFF est limitée en débit : un cache fichier de 24 h évite
//    de refaire la même recherche ;
//  - on renvoie un JSON réduit ;
//  - search.openfoodfacts.org n'autorise pas les appels cross-origin.
// Aucune donnée utilisateur n'est transmise à OFF, seulement le texte cherché.
// ----------------------------------------------------------------------------

try {
    verifyAuth();
} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 401);
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => 'Méthode non supportée'], 405);
}

const OFF_SEARCH_URL = 'https://search.openfoodfacts.org/search';
const OFF_BASE       = 'https://fr.openfoodfacts.org';
const OFF_UA         = 'QoGym/1.0 (qojim.com)';
const OFF_PAGE_SIZE  = 24;
const OFF_CACHE_TTL  = 86400; // 24 h
const OFF_FIELDS     = 'code,product_name,product_name_fr,generic_name,generic_name_fr,brands,quantity,image_front_small_url,image_small_url,nutriments,serving_quantity';

$q    = trim((string)($_GET['q'] ?? ''));
$page = max(1, min(20, (int)($_GET['page'] ?? 1)));

// (pas de mb_* : l'extension mbstring n'est pas garantie sur l'hébergement)
if (strlen($q) < 2) {
    jsonResponse(['error' => 'Recherche trop courte'], 400);
}
if (preg_match('/^.{0,100}/us', $q, $m)) {
    $q = $m[0]; // tronque à 100 caractères sans couper un caractère UTF-8
}

/** Erreurs rencontrées (renvoyées dans `detail` si tout échoue). */
$offErrors = [];

/**
 * GET HTTP avec cURL (ou file_get_contents en secours).
 * Retourne le JSON décodé (tableau) ou null ; l'erreur est notée dans $offErrors.
 */
function offFetchJson($label, $url)
{
    global $offErrors;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_USERAGENT      => OFF_UA,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        // (pas de curl_close : sans effet depuis PHP 8, déprécié en 8.5)
        if ($body === false || $code < 200 || $code >= 300) {
            $offErrors[] = $label . ': ' . ($err !== '' ? $err : 'HTTP ' . $code);
            return null;
        }
    } else {
        // Sans ignore_errors, file_get_contents renvoie false sur un code HTTP
        // d'erreur (4xx/5xx).
        $ctx = stream_context_create(['http' => [
            'timeout' => 20,
            'header'  => "User-Agent: " . OFF_UA . "\r\nAccept: application/json\r\n",
        ]]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) {
            $e = error_get_last();
            $offErrors[] = $label . ': ' . ($e['message'] ?? 'échec') . ' (cURL absent)';
            return null;
        }
    }
    $data = json_decode($body, true);
    if (!is_array($data)) {
        $offErrors[] = $label . ': réponse non JSON';
        return null;
    }
    return $data;
}

/** Nombre >= 0 arrondi à 1 décimale, ou null. */
function offNum($v)
{
    if ($v === null || $v === '' || !is_numeric($v)) return null;
    $f = (float)$v;
    return $f < 0 ? null : round($f, 1);
}

/** Première marque (le champ est une chaîne "A, B" ou un tableau selon la source). */
function offBrand($brands)
{
    $list = is_array($brands) ? $brands : explode(',', (string)$brands);
    foreach ($list as $b) {
        $b = trim((string)$b);
        if ($b !== '') return ucfirst($b);
    }
    return null;
}

/** Convertit un produit OFF brut en format QoGym, ou null s'il est inexploitable. */
function offMapProduct($p)
{
    $name = '';
    foreach (['product_name_fr', 'product_name', 'generic_name_fr', 'generic_name'] as $k) {
        if (!empty($p[$k]) && is_string($p[$k]) && trim($p[$k]) !== '') { $name = trim($p[$k]); break; }
    }
    if ($name === '') return null;

    $n = is_array($p['nutriments'] ?? null) ? $p['nutriments'] : [];
    $kcal = offNum($n['energy-kcal_100g'] ?? null);
    if ($kcal === null && isset($n['energy-kj_100g']) && is_numeric($n['energy-kj_100g'])) {
        $kcal = round($n['energy-kj_100g'] / 4.184, 1);
    }
    if ($kcal === null && isset($n['energy_100g']) && is_numeric($n['energy_100g'])) {
        $kcal = round($n['energy_100g'] / 4.184, 1); // energy_100g est en kJ
    }
    if ($kcal === null) return null; // sans calories, pas d'intérêt

    $image = $p['image_front_small_url'] ?? null;
    if (!$image) $image = $p['image_small_url'] ?? null;

    return [
        'code'             => (string)($p['code'] ?? ''),
        'name'             => $name,
        'brand'            => offBrand($p['brands'] ?? ''),
        'quantity'         => trim((string)($p['quantity'] ?? '')) ?: null,
        'image'            => $image ?: null,
        'kcal_per_100g'    => $kcal,
        'protein_per_100g' => offNum($n['proteins_100g'] ?? null) ?? 0,
        'carbs_per_100g'   => offNum($n['carbohydrates_100g'] ?? null) ?? 0,
        'fat_per_100g'     => offNum($n['fat_100g'] ?? null) ?? 0,
        'serving_g'        => offNum($p['serving_quantity'] ?? null),
    ];
}

function offMapList($rawList)
{
    $out = [];
    foreach ((array)$rawList as $p) {
        if (!is_array($p)) continue;
        $m = offMapProduct($p);
        if ($m) $out[] = $m;
    }
    // Produits avec photo d'abord (tri stable : l'ordre de pertinence est
    // conservé à l'intérieur de chaque groupe).
    usort($out, function ($a, $b) {
        return (int)empty($a['image']) - (int)empty($b['image']);
    });
    return $out;
}

// ── Recherche search-a-licious (texte ou requête Lucene) ─────────────────────
function offSearchNew($luceneQuery, $page)
{
    $data = offFetchJson('search.openfoodfacts.org', OFF_SEARCH_URL . '?' . http_build_query([
        'q'         => $luceneQuery,
        'langs'     => 'fr',
        'page'      => $page,
        'page_size' => OFF_PAGE_SIZE,
        'fields'    => OFF_FIELDS,
    ]));
    if ($data === null || !isset($data['hits'])) return null;
    return [
        'products' => offMapList($data['hits']),
        'has_more' => $page < (int)($data['page_count'] ?? 0),
    ];
}

// ── Ancienne recherche (secours) ────────────────────────────────────────────
function offSearchLegacy($q, $page)
{
    $data = offFetchJson('search.pl', OFF_BASE . '/cgi/search.pl?' . http_build_query([
        'search_terms'  => $q,
        'search_simple' => 1,
        'action'        => 'process',
        'json'          => 1,
        'page'          => $page,
        'page_size'     => OFF_PAGE_SIZE,
        'fields'        => OFF_FIELDS,
    ]));
    if ($data === null || !isset($data['products'])) return null;
    return [
        'products' => offMapList($data['products']),
        'has_more' => $page * OFF_PAGE_SIZE < (int)($data['count'] ?? 0),
    ];
}

// ── Cache ────────────────────────────────────────────────────────────────────
$isBarcode = (bool)preg_match('/^\d{8,14}$/', $q);
$cacheKey  = sys_get_temp_dir() . '/qogym_off2_' . md5(($isBarcode ? 'bc:' : 'q:') . strtolower($q) . ':' . $page) . '.json';

if (is_file($cacheKey) && (time() - filemtime($cacheKey)) < OFF_CACHE_TTL) {
    $cached = @file_get_contents($cacheKey);
    if ($cached !== false) {
        http_response_code(200);
        echo $cached;
        exit();
    }
}

// ── Exécution ────────────────────────────────────────────────────────────────
$result = null;

if ($isBarcode) {
    $data = offFetchJson('product API', OFF_BASE . '/api/v2/product/' . $q . '.json?fields=' . OFF_FIELDS);
    if ($data !== null) {
        $m = !empty($data['product']) ? offMapProduct($data['product'] + ['code' => $q]) : null;
        $result = ['products' => $m ? [$m] : [], 'has_more' => false];
    } else {
        $result = offSearchNew('code:"' . $q . '"', 1);
    }
} else {
    // Caractères spéciaux de la syntaxe Lucene neutralisés : on ne garde que
    // du texte libre, filtré sur les produits vendus en France.
    $terms = trim(preg_replace('/[+\-&|!(){}\[\]^"~*?:\\\\\/]+/u', ' ', $q));
    if ($terms === '') {
        jsonResponse(['success' => true, 'products' => [], 'has_more' => false]);
    }
    $result = offSearchNew($terms . ' countries_tags:"en:france"', $page);
    if ($result === null) {
        $result = offSearchLegacy($q, $page);
    }
}

if ($result === null) {
    jsonResponse([
        'error'  => 'Service Open Food Facts indisponible, réessaie dans un instant',
        'detail' => $offErrors,
    ], 502);
}

$json = json_encode(['success' => true] + $result);
@file_put_contents($cacheKey, $json);
http_response_code(200);
echo $json;
exit();
