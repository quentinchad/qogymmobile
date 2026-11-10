<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$pdo = getDB();

// Vérifier que l'utilisateur est admin
if (!$user['is_admin']) {
    jsonResponse(['error' => 'Accès non autorisé'], 403);
    exit;
}

// ====== Fonctions email ======

function sendInactiveReminderEmail($email, $username, $days) {
    $subject = "On te manque ! Reviens t'entraîner sur QoGym";
    $message = "
        <html><head><style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #2e7d50; color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .highlight { color: #2e7d50; font-weight: bold; font-size: 20px; }
            .button { display: inline-block; background: #2e7d50; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .stats-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2e7d50; }
            .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
        </style></head>
        <body><div class='container'>
            <div class='header'>
                <h1 style='margin:0;font-size:32px;'>QoGym</h1>
                <p style='margin:10px 0 0 0;font-size:18px;'>Ça fait un moment qu'on ne t'a pas vu !</p>
            </div>
            <div class='content'>
                <p>Salut <strong>$username</strong> !</p>
                <p>Ça fait déjà <span class='highlight'>$days jours</span> qu'on ne t'a pas vu à la salle !</p>
                <div class='stats-box'>
                    <p style='margin:0;font-size:16px;'><strong>Tu te souviens ?</strong></p>
                    <p style='margin:10px 0 0 0;'>Les progrès se construisent avec la régularité. Chaque jour compte !</p>
                </div>
                <p><strong>Pourquoi ne pas reprendre aujourd'hui ?</strong></p>
                <ul style='line-height:1.8;'>
                    <li>Choisis une de tes séances préférées</li>
                    <li>Commence doucement, à ton rythme</li>
                    <li>Track tes performances comme avant</li>
                    <li>Reprends là où tu t'étais arrêté</li>
                </ul>
                <p style='text-align:center;'>
                    <a href='https://qojim.com/sessions' class='button' style='color:white;'>Reprendre l'entraînement</a>
                </p>
                <p style='color:#666;font-size:14px;margin-top:30px;'>
                    <em>\"Le seul mauvais entraînement est celui que tu n'as pas fait.\"</em>
                </p>
            </div>
            <div class='footer'>
                <p>QoGym - Ton compagnon fitness quotidien</p>
                <p>Cet email a été envoyé à <strong>$email</strong></p>
            </div>
        </div></body></html>
    ";
    $headers  = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: QoGym <noreply@qojim.com>\r\n";
    $headers .= "Reply-To: noreply@qojim.com\r\n";
    return @mail($email, $subject, $message, $headers);
}

function sendNeverActiveReminderEmail($email, $username, $days) {
    $subject = "Commence ton aventure fitness ! QoGym t'attend";
    $message = "
        <html><head><style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #2e7d50; color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .highlight { color: #2e7d50; font-weight: bold; }
            .button { display: inline-block; background: #2e7d50; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .feature-box { background: white; padding: 15px; border-radius: 8px; margin: 10px 0; border-left: 4px solid #2e7d50; }
            .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
        </style></head>
        <body><div class='container'>
            <div class='header'>
                <h1 style='margin:0;font-size:32px;'>QoGym</h1>
                <p style='margin:10px 0 0 0;font-size:18px;'>Prêt à commencer ?</p>
            </div>
            <div class='content'>
                <p>Salut <strong>$username</strong> !</p>
                <p>Tu t'es inscrit il y a <span class='highlight'>$days jours</span>, mais tu n'as pas encore enregistré ton premier entraînement !</p>
                <p><strong>Pourquoi ne pas commencer aujourd'hui ?</strong></p>
                <div class='feature-box'>
                    <p style='margin:0;'><strong>Étape 1 : Choisis une séance</strong></p>
                    <p style='margin:5px 0 0 0;font-size:14px;'>Explore nos séances certifiées Qojim ou crée la tienne</p>
                </div>
                <div class='feature-box'>
                    <p style='margin:0;'><strong>Étape 2 : Entraîne-toi</strong></p>
                    <p style='margin:5px 0 0 0;font-size:14px;'>Suis tes exercices et enregistre tes performances</p>
                </div>
                <div class='feature-box'>
                    <p style='margin:0;'><strong>Étape 3 : Progresse</strong></p>
                    <p style='margin:5px 0 0 0;font-size:14px;'>Visualise ton évolution et partage avec tes amis</p>
                </div>
                <p style='text-align:center;'>
                    <a href='https://qojim.com/qojim' class='button' style='color:white;'>Découvrir les séances</a>
                </p>
                <p style='background:#fff3cd;padding:15px;border-radius:5px;border-left:4px solid #ffc107;margin-top:20px;'>
                    <strong>Astuce :</strong> Commence par une séance courte pour te familiariser avec l'application !
                </p>
            </div>
            <div class='footer'>
                <p>QoGym - Ton compagnon fitness quotidien</p>
                <p>Cet email a été envoyé à <strong>$email</strong></p>
            </div>
        </div></body></html>
    ";
    $headers  = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: QoGym <noreply@qojim.com>\r\n";
    $headers .= "Reply-To: noreply@qojim.com\r\n";
    return @mail($email, $subject, $message, $headers);
}

// ====== GET : statistiques ======
if ($method === 'GET') {
    $stmt = $pdo->query("
        SELECT COUNT(*) FROM (
            SELECT u.id
            FROM qogym_users u
            INNER JOIN qogym_completed_workouts cw ON u.id = cw.user_id
            GROUP BY u.id
            HAVING DATEDIFF(NOW(), MAX(cw.completed_at)) >= 7
        ) t
    ");
    $inactiveCount = (int)$stmt->fetchColumn();

    $stmt = $pdo->query("
        SELECT COUNT(*)
        FROM qogym_users u
        LEFT JOIN qogym_completed_workouts cw ON u.id = cw.user_id
        WHERE cw.id IS NULL
        AND DATEDIFF(NOW(), u.created_at) >= 1
    ");
    $neverActiveCount = (int)$stmt->fetchColumn();

    jsonResponse([
        'success'      => true,
        'inactive'     => $inactiveCount,
        'never_active' => $neverActiveCount,
    ]);
    exit;
}

// ====== POST : envoi des relances ======
if ($method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $type  = $input['type'] ?? 'all'; // 'inactive', 'never_active', ou 'all'

    $results   = [];
    $totalSent = 0;
    $totalFail = 0;

    // Inactifs
    if ($type === 'inactive' || $type === 'all') {
        $stmt = $pdo->query("
            SELECT u.email, u.username, DATEDIFF(NOW(), MAX(cw.completed_at)) as days
            FROM qogym_users u
            INNER JOIN qogym_completed_workouts cw ON u.id = cw.user_id
            GROUP BY u.id, u.email, u.username
            HAVING days >= 7
        ");
        foreach ($stmt as $u) {
            $ok = sendInactiveReminderEmail($u['email'], $u['username'], $u['days']);
            $results[] = ['username' => $u['username'], 'type' => 'inactive', 'success' => $ok];
            $ok ? $totalSent++ : $totalFail++;
        }
    }

    // Jamais actifs
    if ($type === 'never_active' || $type === 'all') {
        $stmt = $pdo->query("
            SELECT u.email, u.username, DATEDIFF(NOW(), u.created_at) as days
            FROM qogym_users u
            LEFT JOIN qogym_completed_workouts cw ON u.id = cw.user_id
            WHERE cw.id IS NULL
            AND DATEDIFF(NOW(), u.created_at) >= 1
        ");
        foreach ($stmt as $u) {
            $ok = sendNeverActiveReminderEmail($u['email'], $u['username'], $u['days']);
            $results[] = ['username' => $u['username'], 'type' => 'never_active', 'success' => $ok];
            $ok ? $totalSent++ : $totalFail++;
        }
    }

    jsonResponse([
        'success' => true,
        'sent'    => $totalSent,
        'failed'  => $totalFail,
        'results' => $results,
    ]);
    exit;
}

jsonResponse(['error' => 'Méthode non supportée'], 405);
exit;
?>