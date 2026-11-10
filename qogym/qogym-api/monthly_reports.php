<?php
require_once 'config.php';

// ----------------------------------------------------------------------------
// monthly_reports.php
//
// Endpoint Rapports Mensuels :
//   - POST ?action=generate         (admin)  — crée la notif pour M-1 + email
//   - GET  ?action=pending          (user)   — y a-t-il un rapport non vu ?
//   - GET  ?action=list             (user)   — tous mes rapports (méta)
//   - GET  ?action=detail&year=&month=  (user) — stats complètes du mois
//
// Important : aucune statistique n'est stockée. Tout est recalculé à la volée.
// ----------------------------------------------------------------------------

$user   = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input  = json_decode(file_get_contents('php://input'), true);
$pdo    = getDB();

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Calcule les bornes [start, end) d'un mois donné (Y-m).
 * end est exclusif : début du mois suivant.
 */
function monthBounds($year, $month) {
    $start = sprintf('%04d-%02d-01 00:00:00', $year, $month);
    $next  = (new DateTime($start))->modify('+1 month');
    return [$start, $next->format('Y-m-d H:i:s')];
}

/**
 * Le mois "M-1" relatif à aujourd'hui. Si on est le 1er ou le 5 mars,
 * on retourne février.
 */
function previousMonth() {
    $now = new DateTime('now');
    $now->modify('first day of last month');
    return [(int)$now->format('Y'), (int)$now->format('m')];
}

/**
 * Calcule l'agrégat des stats d'un user pour un mois donné.
 * Retourne null si l'utilisateur n'a aucun entraînement ce mois-là.
 */
function computeMonthStats(PDO $pdo, $userId, $year, $month) {
    [$start, $end] = monthBounds($year, $month);

    // ---- KPIs globaux ----
    $stmt = $pdo->prepare("
        SELECT
            COUNT(*)                                          AS workouts_count,
            COALESCE(SUM(TIMESTAMPDIFF(SECOND, started_at, completed_at)), 0)
                                                              AS total_seconds
        FROM qogym_completed_workouts
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND completed_at >= ? AND completed_at < ?
    ");
    $stmt->execute([$userId, $start, $end]);
    $kpis = $stmt->fetch(PDO::FETCH_ASSOC) ?: ['workouts_count' => 0, 'total_seconds' => 0];

    if ((int)$kpis['workouts_count'] === 0) {
        return null;
    }

    // ---- Volume + nombre de sets ----
    // Volume = somme(weight * reps). Pour les sets sans poids (poids du corps),
    // on compte 0 — c'est la convention la plus sûre, on pourrait à terme
    // injecter le poids de l'utilisateur.
    $stmt = $pdo->prepare("
        SELECT
            COUNT(*)                                                  AS sets_count,
            COALESCE(SUM(cs.reps), 0)                                 AS total_reps,
            COALESCE(SUM(IFNULL(cs.weight, 0) * cs.reps), 0)          AS total_volume_kg
        FROM qogym_completed_sets cs
        INNER JOIN qogym_completed_workouts cw ON cw.id = cs.completed_workout_id
        WHERE cw.user_id = ?
          AND cw.completed_at IS NOT NULL
          AND cw.completed_at >= ? AND cw.completed_at < ?
    ");
    $stmt->execute([$userId, $start, $end]);
    $vol = $stmt->fetch(PDO::FETCH_ASSOC) ?: ['sets_count' => 0, 'total_reps' => 0, 'total_volume_kg' => 0];

    // ---- Top exercices par fréquence ----
    $stmt = $pdo->prepare("
        SELECT
            e.name                                              AS name,
            COUNT(DISTINCT cw.id)                               AS workouts,
            COUNT(*)                                            AS sets,
            COALESCE(SUM(cs.reps), 0)                           AS reps,
            COALESCE(SUM(IFNULL(cs.weight, 0) * cs.reps), 0)    AS volume_kg
        FROM qogym_completed_sets cs
        INNER JOIN qogym_completed_workouts cw ON cw.id = cs.completed_workout_id
        INNER JOIN qogym_exercises e            ON e.id = cs.exercise_id
        WHERE cw.user_id = ?
          AND cw.completed_at IS NOT NULL
          AND cw.completed_at >= ? AND cw.completed_at < ?
        GROUP BY e.name
        ORDER BY workouts DESC, sets DESC
        LIMIT 5
    ");
    $stmt->execute([$userId, $start, $end]);
    $topExercises = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // ---- Records personnels battus ce mois ----
    // Pour chaque exo travaillé ce mois, on regarde le poids max ce mois
    // et le compare au poids max de tous les entraînements antérieurs au mois.
    $stmt = $pdo->prepare("
        SELECT
            e.name                          AS name,
            MAX(cs.weight)                  AS max_weight_this_month,
            (SELECT MAX(cs2.weight)
             FROM qogym_completed_sets cs2
             INNER JOIN qogym_completed_workouts cw2 ON cw2.id = cs2.completed_workout_id
             INNER JOIN qogym_exercises e2 ON e2.id = cs2.exercise_id
             WHERE cw2.user_id = ?
               AND cw2.completed_at IS NOT NULL
               AND cw2.completed_at < ?
               AND e2.name = e.name)       AS max_weight_before
        FROM qogym_completed_sets cs
        INNER JOIN qogym_completed_workouts cw ON cw.id = cs.completed_workout_id
        INNER JOIN qogym_exercises e            ON e.id = cs.exercise_id
        WHERE cw.user_id = ?
          AND cw.completed_at IS NOT NULL
          AND cw.completed_at >= ? AND cw.completed_at < ?
          AND cs.weight IS NOT NULL
        GROUP BY e.name
        HAVING max_weight_this_month IS NOT NULL
           AND (max_weight_before IS NULL OR max_weight_this_month > max_weight_before)
        ORDER BY (max_weight_this_month - IFNULL(max_weight_before, 0)) DESC
        LIMIT 8
    ");
    $stmt->execute([$userId, $start, $userId, $start, $end]);
    $personalRecords = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // ---- Calendrier (jours d'entraînement du mois) ----
    $stmt = $pdo->prepare("
        SELECT DISTINCT DATE(completed_at) AS day
        FROM qogym_completed_workouts
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND completed_at >= ? AND completed_at < ?
        ORDER BY day
    ");
    $stmt->execute([$userId, $start, $end]);
    $trainingDays = array_map(fn($r) => $r['day'], $stmt->fetchAll(PDO::FETCH_ASSOC));

    // ---- Plus longue série de jours consécutifs (streak) ----
    $longestStreak = 0;
    if (!empty($trainingDays)) {
        $current = 1;
        $longestStreak = 1;
        for ($i = 1; $i < count($trainingDays); $i++) {
            $d1 = new DateTime($trainingDays[$i - 1]);
            $d2 = new DateTime($trainingDays[$i]);
            $diff = (int)$d1->diff($d2)->days;
            if ($diff === 1) {
                $current++;
                if ($current > $longestStreak) $longestStreak = $current;
            } else {
                $current = 1;
            }
        }
    }

    // ---- Distribution par jour de la semaine ----
    // 1 = lundi … 7 = dimanche (ISO).
    $stmt = $pdo->prepare("
        SELECT
            WEEKDAY(completed_at) AS dow,  -- 0=lundi, 6=dimanche
            COUNT(*)              AS workouts
        FROM qogym_completed_workouts
        WHERE user_id = ?
          AND completed_at IS NOT NULL
          AND completed_at >= ? AND completed_at < ?
        GROUP BY WEEKDAY(completed_at)
    ");
    $stmt->execute([$userId, $start, $end]);
    $byDow = array_fill(0, 7, 0);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $byDow[(int)$r['dow']] = (int)$r['workouts'];
    }

    // ---- Volume par semaine du mois ----
    $stmt = $pdo->prepare("
        SELECT
            YEARWEEK(cw.completed_at, 3)                              AS yw,
            MIN(DATE(cw.completed_at))                                AS week_start,
            COUNT(DISTINCT cw.id)                                     AS workouts,
            COALESCE(SUM(IFNULL(cs.weight, 0) * cs.reps), 0)          AS volume_kg
        FROM qogym_completed_workouts cw
        LEFT JOIN qogym_completed_sets cs ON cs.completed_workout_id = cw.id
        WHERE cw.user_id = ?
          AND cw.completed_at IS NOT NULL
          AND cw.completed_at >= ? AND cw.completed_at < ?
        GROUP BY YEARWEEK(cw.completed_at, 3)
        ORDER BY yw
    ");
    $stmt->execute([$userId, $start, $end]);
    $byWeek = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // ---- Distribution par type de séance ----
    $stmt = $pdo->prepare("
        SELECT
            COALESCE(st.name, 'Sans type')                AS type_name,
            COUNT(DISTINCT cw.id)                         AS workouts
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_workout_sessions ws ON ws.id = cw.workout_session_id
        LEFT JOIN qogym_session_types st ON st.id = ws.session_type_id
        WHERE cw.user_id = ?
          AND cw.completed_at IS NOT NULL
          AND cw.completed_at >= ? AND cw.completed_at < ?
        GROUP BY st.id, st.name
        ORDER BY workouts DESC
    ");
    $stmt->execute([$userId, $start, $end]);
    $byType = $stmt->fetchAll(PDO::FETCH_ASSOC);

    return [
        'period' => ['year' => (int)$year, 'month' => (int)$month],
        'kpis' => [
            'workouts_count'   => (int)$kpis['workouts_count'],
            'sets_count'       => (int)$vol['sets_count'],
            'total_reps'       => (int)$vol['total_reps'],
            'total_volume_kg'  => (float)$vol['total_volume_kg'],
            'total_seconds'    => (int)$kpis['total_seconds'],
            'longest_streak'   => $longestStreak,
        ],
        'top_exercises'    => array_map(fn($r) => [
            'name'      => $r['name'],
            'workouts'  => (int)$r['workouts'],
            'sets'      => (int)$r['sets'],
            'reps'      => (int)$r['reps'],
            'volume_kg' => (float)$r['volume_kg'],
        ], $topExercises),
        'personal_records' => array_map(fn($r) => [
            'name'              => $r['name'],
            'max_weight'        => (float)$r['max_weight_this_month'],
            'previous_max'      => $r['max_weight_before'] !== null ? (float)$r['max_weight_before'] : null,
        ], $personalRecords),
        'training_days'    => $trainingDays,
        'by_day_of_week'   => $byDow,
        'by_week'          => array_map(fn($r) => [
            'week_start' => $r['week_start'],
            'workouts'   => (int)$r['workouts'],
            'volume_kg'  => (float)$r['volume_kg'],
        ], $byWeek),
        'by_session_type'  => array_map(fn($r) => [
            'name'     => $r['type_name'],
            'workouts' => (int)$r['workouts'],
        ], $byType),
    ];
}

/**
 * Envoie l'email de notification "rapport disponible".
 * Aucun emoji dans le contenu pour éviter les filtres anti-spam.
 */
function sendReportEmail($email, $username, $year, $month) {
    $months = ['', 'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
               'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
    $monthName = $months[(int)$month] ?? '';
    $subject = "Votre rapport mensuel QoGym de $monthName $year est disponible";

    $safeUser  = htmlspecialchars($username, ENT_QUOTES, 'UTF-8');
    $safeEmail = htmlspecialchars($email,    ENT_QUOTES, 'UTF-8');
    $safeMonth = htmlspecialchars($monthName,ENT_QUOTES, 'UTF-8');

    $message = "
        <html>
        <head><meta charset='UTF-8'></head>
        <body style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;'>
            <div style='background-color: #2e7d50; color: #ffffff; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;'>
                <h1 style='margin: 0; font-size: 22px;'>QoGym</h1>
                <p style='margin: 6px 0 0 0; opacity: 0.9;'>Votre rapport mensuel</p>
            </div>
            <div style='background-color: #f9f9f9; padding: 25px; border-radius: 0 0 8px 8px;'>
                <p>Bonjour $safeUser,</p>
                <p>Votre rapport d'entrainement pour le mois de <strong>$safeMonth $year</strong> est maintenant disponible sur QoGym.</p>
                <p>Vous y trouverez : nombre d'entrainements, volume souleve, exercices preferes, records personnels et plus encore.</p>
                <div style='text-align: center; margin: 25px 0;'>
                    <a href='https://qojim.com/profile' style='background-color: #2e7d50; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;'>Consulter mon rapport</a>
                </div>
                <p style='font-size: 13px; color: #666;'>Vous recevez cet email parce que vous avez un compte QoGym a l'adresse $safeEmail.</p>
            </div>
        </body>
        </html>
    ";

    $headers  = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: QoGym <noreply@qojim.com>\r\n";
    $headers .= "Reply-To: noreply@qojim.com\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    return @mail($email, $subject, $message, $headers);
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

// 1) GENERATE — admin uniquement
if ($method === 'POST' && (($input['action'] ?? '') === 'generate')) {
    if (!$user['is_admin']) {
        jsonResponse(['error' => 'Accès non autorisé'], 403);
    }

    [$year, $month] = previousMonth();
    [$start, $end]  = monthBounds($year, $month);

    // Lister les utilisateurs ayant au moins un entraînement le mois cible
    $stmt = $pdo->prepare("
        SELECT DISTINCT u.id, u.username, u.email
        FROM qogym_users u
        INNER JOIN qogym_completed_workouts cw ON cw.user_id = u.id
        WHERE cw.completed_at IS NOT NULL
          AND cw.completed_at >= ? AND cw.completed_at < ?
    ");
    $stmt->execute([$start, $end]);
    $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $created = 0;
    $skipped = 0;
    $emailed = 0;
    $emailErrors = 0;

    foreach ($users as $u) {
        // INSERT IGNORE : si la notif existe déjà pour ce user/mois, on ne
        // la recrée pas — et donc on ne ré-envoie pas l'email non plus.
        $stmt = $pdo->prepare("
            INSERT IGNORE INTO qogym_monthly_reports (user_id, year, month, generated_at)
            VALUES (?, ?, ?, NOW())
        ");
        $stmt->execute([$u['id'], $year, $month]);
        if ($stmt->rowCount() > 0) {
            $created++;
            // Envoi de l'email — non bloquant
            if (!empty($u['email'])) {
                if (sendReportEmail($u['email'], $u['username'], $year, $month)) {
                    $emailed++;
                } else {
                    $emailErrors++;
                }
            }
        } else {
            $skipped++;
        }
    }

    jsonResponse([
        'success'      => true,
        'period'       => ['year' => $year, 'month' => $month],
        'eligible'     => count($users),
        'created'      => $created,
        'skipped'      => $skipped, // déjà notifiés pour ce mois
        'emailed'      => $emailed,
        'email_errors' => $emailErrors,
    ]);
}

// 2) PENDING — y a-t-il un rapport non vu ?
if ($method === 'GET' && (($_GET['action'] ?? '') === 'pending')) {
    $stmt = $pdo->prepare("
        SELECT id, year, month, generated_at
        FROM qogym_monthly_reports
        WHERE user_id = ? AND viewed_at IS NULL
        ORDER BY year DESC, month DESC
        LIMIT 1
    ");
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    jsonResponse([
        'success' => true,
        'pending' => $row ? [
            'year'  => (int)$row['year'],
            'month' => (int)$row['month'],
        ] : null,
    ]);
}

// 3) LIST — tous mes rapports
if ($method === 'GET' && (($_GET['action'] ?? '') === 'list')) {
    $stmt = $pdo->prepare("
        SELECT year, month, generated_at, viewed_at
        FROM qogym_monthly_reports
        WHERE user_id = ?
        ORDER BY year DESC, month DESC
    ");
    $stmt->execute([$user['id']]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    jsonResponse([
        'success' => true,
        'reports' => array_map(fn($r) => [
            'year'         => (int)$r['year'],
            'month'        => (int)$r['month'],
            'generated_at' => $r['generated_at'],
            'viewed'       => $r['viewed_at'] !== null,
        ], $rows),
    ]);
}

// 4) DETAIL — calcule les stats du mois
//    Effet de bord : marque le rapport comme vu (viewed_at = NOW()).
if ($method === 'GET' && (($_GET['action'] ?? '') === 'detail')) {
    $year  = isset($_GET['year'])  ? (int)$_GET['year']  : 0;
    $month = isset($_GET['month']) ? (int)$_GET['month'] : 0;
    if ($year < 2020 || $month < 1 || $month > 12) {
        jsonResponse(['error' => 'Paramètres invalides'], 400);
    }

    // Vérifier que le rapport existe pour ce user. On autorise le calcul
    // même si la ligne n'existe pas (cas où l'utilisateur consulte un
    // rapport directement via URL alors qu'aucune notif n'a été créée),
    // mais dans ce cas on ne marque rien.
    $stmt = $pdo->prepare("
        SELECT id, viewed_at FROM qogym_monthly_reports
        WHERE user_id = ? AND year = ? AND month = ?
    ");
    $stmt->execute([$user['id'], $year, $month]);
    $reportRow = $stmt->fetch(PDO::FETCH_ASSOC);

    // Stats du mois courant
    $current = computeMonthStats($pdo, $user['id'], $year, $month);

    // Stats du mois précédent (M-2 par rapport au mois consulté), pour le delta
    $prevDate = new DateTime(sprintf('%04d-%02d-01', $year, $month));
    $prevDate->modify('-1 month');
    $previous = computeMonthStats($pdo, $user['id'], (int)$prevDate->format('Y'), (int)$prevDate->format('m'));

    // Marquer la notif comme vue (idempotent)
    if ($reportRow && $reportRow['viewed_at'] === null) {
        $stmt = $pdo->prepare("UPDATE qogym_monthly_reports SET viewed_at = NOW() WHERE id = ?");
        $stmt->execute([$reportRow['id']]);
    }

    jsonResponse([
        'success'  => true,
        'current'  => $current,
        'previous' => $previous,
        'has_data' => $current !== null,
    ]);
}

jsonResponse(['error' => 'Action inconnue'], 400);
