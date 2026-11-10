<?php
require_once 'config.php';

$user = verifyAuth();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$pdo = getDB();

// DÉMARRER UNE SÉANCE
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'start') {
    $sessionId = $input['session_id'] ?? null;

    if (!$sessionId) {
        jsonResponse(['error' => 'ID de séance requis'], 400);
    }

    // Créer l'enregistrement
    $stmt = $pdo->prepare("
        INSERT INTO qogym_completed_workouts (user_id, workout_session_id, started_at) 
        VALUES (?, ?, NOW())
    ");
    $stmt->execute([$user['id'], $sessionId]);
    $workoutId = $pdo->lastInsertId();

    // Récupérer les dernières performances pour chaque exercice
    //
    // Pour chaque exercice, on va chercher le dernier entraînement complété
    // (de cette séance) DANS LEQUEL CET EXERCICE A ÉTÉ RÉALISÉ, plutôt que
    // de toujours pointer sur le tout dernier entraînement complété de la
    // séance. Ainsi, si l'exo n'a pas été fait la semaine dernière mais
    // l'a été il y a 2 semaines, on récupère bien la perf d'il y a 2 semaines.
    //
    // On matche par NOM (insensible à la casse), pas par exercise_id strict.
    // Un même exercice peut exister sous plusieurs lignes qogym_exercises
    // pour la même séance au fil du temps (édition de séance, régénération
    // du template...), avec des id différents à chaque fois. Un match par
    // id perdrait donc l'historique dès que l'id change, alors qu'un match
    // par nom le retrouve toujours (même logique que l'endpoint
    // `all_exercises` utilisé par la recherche manuelle).
    $stmt = $pdo->prepare("
        SELECT e.id, e.name, 
            (SELECT GROUP_CONCAT(
                CASE 
                    WHEN cs.weight IS NOT NULL THEN CONCAT(cs.weight, 'kg x ', cs.reps, ' reps')
                    ELSE CONCAT(cs.reps, ' reps')
                END
                ORDER BY cs.set_number SEPARATOR ' | '
            )
            FROM qogym_completed_sets cs
            INNER JOIN qogym_exercises ce ON ce.id = cs.exercise_id
            WHERE LOWER(TRIM(ce.name)) = LOWER(TRIM(e.name))
            AND cs.completed_workout_id = (
                SELECT cw.id
                FROM qogym_completed_workouts cw
                INNER JOIN qogym_completed_sets cs2
                    ON cs2.completed_workout_id = cw.id
                INNER JOIN qogym_exercises ce2
                    ON ce2.id = cs2.exercise_id
                WHERE cw.user_id = ?
                AND cw.workout_session_id = ?
                AND cw.completed_at IS NOT NULL
                AND LOWER(TRIM(ce2.name)) = LOWER(TRIM(e.name))
                ORDER BY cw.completed_at DESC
                LIMIT 1
            )
            ) as last_performance
        FROM qogym_exercises e
        WHERE e.workout_session_id = ?
          AND COALESCE(e.removed_from_template, 0) = 0
        ORDER BY e.exercise_order
    ");
    $stmt->execute([$user['id'], $sessionId, $sessionId]);
    $lastPerformances = $stmt->fetchAll();

    jsonResponse([
        'success' => true,
        'workout_id' => $workoutId,
        'last_performances' => $lastPerformances
    ]);
}

// CLONER UNE SÉANCE À PARTIR D'UN ENTRAÎNEMENT TERMINÉ
//
// Utilisé par le Feed et les Profils pour :
//   - "Lancer cette séance" quand la séance n'est pas directement utilisable
//     par l'utilisateur (séance d'un ami, séance supprimée depuis, séance
//     libre jamais enregistrée...) → archived = true : la copie reste cachée
//     de la galerie ; à la fin de l'entraînement l'app propose de
//     l'enregistrer (même mécanique que les séances libres).
//   - "Enregistrer dans ma bibliothèque" → archived = false.
//
// La copie est reconstruite à partir de ce qui a RÉELLEMENT été fait dans
// l'entraînement (exercices ayant des sets, ordre/supersets du snapshot),
// et pas à partir du template d'origine : celui-ci a pu être supprimé,
// modifié ou ne jamais avoir existé (séance libre). Les droits d'accès sont
// les mêmes que pour la consultation du détail dans le Feed.
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'clone_from_workout') {
    $sourceWorkoutId = $input['workout_id'] ?? null;
    $archived        = !empty($input['archived']) ? 1 : 0;

    if (!$sourceWorkoutId) {
        jsonResponse(['error' => 'ID de l\'entraînement requis'], 400);
    }

    // Entraînement source (le nom de la séance reste lisible même si elle
    // a été supprimée : le soft delete ne retire pas la ligne).
    $stmt = $pdo->prepare("
        SELECT cw.id, cw.user_id, cw.exercise_order_snapshot,
               ws.name, ws.image_url, ws.session_type_id
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
        WHERE cw.id = ?
    ");
    $stmt->execute([$sourceWorkoutId]);
    $source = $stmt->fetch();

    if (!$source) {
        jsonResponse(['error' => 'Entraînement non trouvé'], 404);
    }

    // Permissions : propriétaire, ou (profil public ET ami / participant)
    $hasAccess = ((int)$source['user_id'] === (int)$user['id']);
    if (!$hasAccess) {
        $stmt = $pdo->prepare("SELECT default_workout_privacy FROM qogym_users WHERE id = ?");
        $stmt->execute([$source['user_id']]);
        $owner = $stmt->fetch();
        if ($owner && $owner['default_workout_privacy'] === 'public') {
            $stmt = $pdo->prepare("
                SELECT 1 FROM qogym_friendships
                WHERE status = 'accepted'
                  AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
                LIMIT 1
            ");
            $stmt->execute([$user['id'], $source['user_id'], $source['user_id'], $user['id']]);
            $hasAccess = (bool)$stmt->fetch();

            if (!$hasAccess) {
                $stmt = $pdo->prepare("
                    SELECT 1 FROM qogym_workout_participants
                    WHERE completed_workout_id = ? AND user_id = ? LIMIT 1
                ");
                $stmt->execute([$sourceWorkoutId, $user['id']]);
                $hasAccess = (bool)$stmt->fetch();
            }
        }
    }
    if (!$hasAccess) {
        jsonResponse(['error' => 'Accès non autorisé'], 403);
    }

    // Exercices réellement effectués (au moins un set), avec le nombre de
    // sets faits pour retomber sur un nombre de séries correct si le
    // template n'en prévoyait aucune.
    $stmt = $pdo->prepare("
        SELECT e.id, e.name, e.sets, e.reps_min, e.reps_max, e.rest_time,
               e.exercise_order, e.superset_group,
               COUNT(*) AS done_sets
        FROM qogym_exercises e
        INNER JOIN qogym_completed_sets cs ON cs.exercise_id = e.id
        WHERE cs.completed_workout_id = ?
        GROUP BY e.id, e.name, e.sets, e.reps_min, e.reps_max, e.rest_time,
                 e.exercise_order, e.superset_group
    ");
    $stmt->execute([$sourceWorkoutId]);
    $exercises = $stmt->fetchAll();

    // Ordre + supersets : le snapshot de l'entraînement prime (modifs faites
    // pendant la séance sans propagation au template).
    $orderMap = [];
    $supersetMap = [];
    if (!empty($source['exercise_order_snapshot'])) {
        $snapshot = json_decode($source['exercise_order_snapshot'], true);
        if (is_array($snapshot)) {
            foreach ($snapshot as $snap) {
                if (!isset($snap['name'])) continue;
                if (isset($snap['display_order'])) {
                    $orderMap[$snap['name']] = $snap['display_order'];
                }
                if (array_key_exists('superset_group', $snap)) {
                    $supersetMap[$snap['name']] = $snap['superset_group'];
                }
            }
        }
    }
    foreach ($exercises as &$ex) {
        $ex['_order'] = $orderMap[$ex['name']] ?? $ex['exercise_order'];
        if (array_key_exists($ex['name'], $supersetMap)) {
            $ex['superset_group'] = $supersetMap[$ex['name']];
        }
    }
    unset($ex);
    usort($exercises, fn($a, $b) => $a['_order'] <=> $b['_order']);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("
            INSERT INTO qogym_workout_sessions
                (user_id, name, image_url, session_type_id, is_qojim_session, is_archived)
            VALUES (?, ?, ?, ?, 0, ?)
        ");
        $stmt->execute([
            $user['id'],
            $source['name'],
            $source['image_url'],
            $source['session_type_id'],
            $archived
        ]);
        $newSessionId = $pdo->lastInsertId();

        if (!empty($exercises)) {
            $stmt = $pdo->prepare("
                INSERT INTO qogym_exercises
                    (workout_session_id, name, sets, reps_min, reps_max, rest_time, exercise_order, superset_group)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($exercises as $index => $ex) {
                $sets = ((int)$ex['sets'] > 0) ? (int)$ex['sets'] : (int)$ex['done_sets'];
                $group = ($ex['superset_group'] !== null && $ex['superset_group'] !== '')
                    ? (int)$ex['superset_group']
                    : null;
                $stmt->execute([
                    $newSessionId,
                    $ex['name'],
                    max($sets, 1),
                    $ex['reps_min'],
                    $ex['reps_max'],
                    $ex['rest_time'] ?: 60,
                    $index,
                    $group
                ]);
            }
        }

        $pdo->commit();

        jsonResponse([
            'success'    => true,
            'session_id' => (int)$newSessionId,
            'archived'   => (bool)$archived,
            'exercises_count' => count($exercises),
        ]);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => 'Erreur lors de la copie de la séance'], 500);
    }
}

// ENREGISTRER UN SET
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'record_set') {
    $workoutId = $input['workout_id'] ?? null;
    $exerciseId = $input['exercise_id'] ?? null;
    $setNumber = $input['set_number'] ?? null;
    $weight = $input['weight'] ?? null;
    $reps = $input['reps'] ?? null;

    if (!$workoutId || !$exerciseId || $setNumber === null || $reps === null) {
        jsonResponse(['error' => 'Paramètres manquants'], 400);
    }

    // Vérifier que le workout appartient à l'utilisateur
    $stmt = $pdo->prepare("SELECT id FROM qogym_completed_workouts WHERE id = ? AND user_id = ?");
    $stmt->execute([$workoutId, $user['id']]);
    if (!$stmt->fetch()) {
        jsonResponse(['error' => 'Entraînement non trouvé'], 404);
    }

    // Enregistrer le set
    $stmt = $pdo->prepare("
        INSERT INTO qogym_completed_sets (completed_workout_id, exercise_id, set_number, weight, reps) 
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE weight = VALUES(weight), reps = VALUES(reps)
    ");
    $stmt->execute([$workoutId, $exerciseId, $setNumber, $weight, $reps]);

    jsonResponse(['success' => true, 'message' => 'Set enregistré']);
}

// TERMINER UNE SÉANCE
//
// /!\ Cet endpoint est "engagement final" : dès qu'il réussit, les perfs
// sont sauvegardées de manière atomique (transaction MySQL). L'application
// frontend l'appelle DÈS que l'utilisateur confirme "Terminer", AVANT de
// poser la question optionnelle "mettre à jour la séance ?". Cette
// question fait ensuite un second appel (action=apply_template_changes)
// qui est indépendant et idempotent.
//
// Payload attendu :
//   workout_id        (int, requis)
//   notes             (string)
//   participants      (int[])
//   exercise_order    (object[]) : snapshot d'ordre + supersets + sets_data
//                                  pour chaque exo. Pour les exos custom
//                                  (is_custom=true), sets_data porte les
//                                  séries saisies. Pour les non-custom,
//                                  sets_data peut aussi être renseigné
//                                  pour un commit atomique.
//   non_custom_sets   (object[]) : LEGACY/alternative — liste à plat
//                                  [{exercise_id, set_number, weight, reps}]
//                                  des sets pour les exos non-custom.
//                                  Si présent : utilisé en plus / au lieu
//                                  de l'ancienne boucle d'appels record_set
//                                  côté frontend.
//   update_template   (bool, LEGACY) : si true, propage ordre/supersets
//                                  au template + insère les exos custom
//                                  comme exos partagés. Le nouveau flux
//                                  côté frontend laisse ce champ à false
//                                  ici et utilise apply_template_changes
//                                  comme second appel pour bien dissocier
//                                  "sauvegarde des perfs" et "mise à jour
//                                  de la séance template". Conservé pour
//                                  compat avec d'anciens clients.
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'complete') {
    $workoutId = $input['workout_id'] ?? null;
    $notes = $input['notes'] ?? '';
    $participants = $input['participants'] ?? [];
    $exerciseOrder = $input['exercise_order'] ?? []; // [{id, name, display_order, is_custom, sets_data}]
    $nonCustomSets = $input['non_custom_sets'] ?? []; // [{exercise_id, set_number, weight, reps}]
    $updateTemplate = !empty($input['update_template']);

    if (!$workoutId) {
        jsonResponse(['error' => 'ID de l\'entraînement requis'], 400);
    }

    $pdo->beginTransaction();

    try {
        // Mettre à jour l'entraînement avec l'ordre des exercices
        $orderJson = !empty($exerciseOrder) ? json_encode($exerciseOrder) : null;
        $stmt = $pdo->prepare("
            UPDATE qogym_completed_workouts 
            SET completed_at = NOW(), notes = ?, exercise_order_snapshot = ?
            WHERE id = ? AND user_id = ?
        ");
        $stmt->execute([$notes, $orderJson, $workoutId, $user['id']]);

        // Récupérer le workout_session_id pour les exos custom
        $stmt2 = $pdo->prepare("SELECT workout_session_id FROM qogym_completed_workouts WHERE id = ?");
        $stmt2->execute([$workoutId]);
        $wRow = $stmt2->fetch();
        $sessionId = $wRow['workout_session_id'] ?? null;

        // ── 1) Sets des exos NON-custom (du template) ──
        // On les enregistre ici plutôt que via des appels record_set
        // successifs : un seul appel = une seule transaction = atomique.
        if (!empty($nonCustomSets)) {
            $stmtSet = $pdo->prepare("
                INSERT INTO qogym_completed_sets (completed_workout_id, exercise_id, set_number, weight, reps)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE weight = VALUES(weight), reps = VALUES(reps)
            ");
            foreach ($nonCustomSets as $s) {
                if (empty($s['exercise_id']) || !isset($s['set_number'])) continue;
                $stmtSet->execute([
                    $workoutId,
                    (int)$s['exercise_id'],
                    (int)$s['set_number'],
                    isset($s['weight']) && $s['weight'] !== '' ? (float)$s['weight'] : null,
                    isset($s['reps'])   && $s['reps']   !== '' ? (int)$s['reps']    : 0,
                ]);
            }
        }

        // ── 2) Insérer les exercices custom + leurs sets ──
        // Le flag is_workout_custom détermine si l'exo "appartient" à la
        // séance template (0) ou n'est attaché qu'à cet entraînement (1).
        $customFlag = $updateTemplate ? 0 : 1;
        foreach ($exerciseOrder as $exData) {
            if (!empty($exData['is_custom']) && !empty($exData['sets_data']) && $sessionId) {
                // Si on met à jour le template, on utilise des valeurs par
                // défaut sensées (3x8-12, repos 90s) plutôt que des zéros,
                // pour que l'exo soit ré-utilisable proprement.
                $defSets    = $updateTemplate ? 3  : 0;
                $defRepsMin = $updateTemplate ? 8  : 0;
                $defRepsMax = $updateTemplate ? 12 : 0;
                $defRest    = $updateTemplate ? 90 : 0;

                // superset_group : on ne propage en BDD que si on met à jour
                // le template. Sinon l'info reste uniquement dans le snapshot
                // pour l'affichage du Feed.
                $supersetGroup = ($updateTemplate && isset($exData['superset_group']) && $exData['superset_group'] !== null && $exData['superset_group'] !== '')
                    ? (int)$exData['superset_group']
                    : null;

                $stmtEx = $pdo->prepare("
                    INSERT INTO qogym_exercises 
                    (workout_session_id, name, sets, reps_min, reps_max, rest_time, exercise_order, is_workout_custom, superset_group)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmtEx->execute([
                    $sessionId,
                    $exData['name'],
                    $defSets,
                    $defRepsMin,
                    $defRepsMax,
                    $defRest,
                    $exData['display_order'],
                    $customFlag,
                    $supersetGroup,
                ]);
                $newExerciseId = $pdo->lastInsertId();

                // Insérer les sets
                foreach ($exData['sets_data'] as $setRow) {
                    $stmtSet = $pdo->prepare("
                        INSERT INTO qogym_completed_sets (completed_workout_id, exercise_id, set_number, weight, reps)
                        VALUES (?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE weight = VALUES(weight), reps = VALUES(reps)
                    ");
                    $stmtSet->execute([
                        $workoutId,
                        $newExerciseId,
                        $setRow['set_number'],
                        $setRow['weight'] ?? null,
                        $setRow['reps'] ?? 0
                    ]);
                }
            }
        }

        // Si l'utilisateur a accepté de mettre à jour la template,
        // propager aussi le nouvel ordre des exos (non-custom) ET leur
        // superset_group du snapshot vers qogym_exercises.
        if ($updateTemplate && $sessionId && !empty($exerciseOrder)) {
            $stmtUpd = $pdo->prepare("
                UPDATE qogym_exercises
                SET exercise_order = ?, superset_group = ?, removed_from_template = 0
                WHERE id = ? AND workout_session_id = ?
            ");
            foreach ($exerciseOrder as $exData) {
                if (empty($exData['is_custom']) && !empty($exData['id']) && isset($exData['display_order'])) {
                    $sg = (isset($exData['superset_group']) && $exData['superset_group'] !== null && $exData['superset_group'] !== '')
                        ? (int)$exData['superset_group']
                        : null;
                    $stmtUpd->execute([(int)$exData['display_order'], $sg, (int)$exData['id'], $sessionId]);
                }
            }
        }

        // Ajouter les participants si fournis
        if (!empty($participants)) {
            // Supprimer les anciens participants
            $stmt = $pdo->prepare("DELETE FROM qogym_workout_participants WHERE completed_workout_id = ?");
            $stmt->execute([$workoutId]);

            // Ajouter les nouveaux
            $stmt = $pdo->prepare("
                INSERT INTO qogym_workout_participants (completed_workout_id, user_id) 
                VALUES (?, ?)
            ");

            foreach ($participants as $participantId) {
                // Vérifier que c'est un ami
                $checkStmt = $pdo->prepare("
                    SELECT 1 FROM qogym_friendships
                    WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
                    AND status = 'accepted'
                ");
                $checkStmt->execute([$user['id'], $participantId, $participantId, $user['id']]);

                if ($checkStmt->fetch()) {
                    $stmt->execute([$workoutId, $participantId]);
                }
            }
        }

        $pdo->commit();
        jsonResponse(['success' => true, 'message' => 'Entraînement terminé']);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => 'Erreur lors de la finalisation'], 500);
    }
}

// APPLIQUER LES MODIFICATIONS À LA SÉANCE TEMPLATE
//
// Second appel optionnel après `complete`. Sépare clairement :
//   - "j'ai fini mon entraînement, sauve mes perfs"  → action=complete
//   - "ah oui, et au passage modifie aussi la séance template"
//     → action=apply_template_changes
//
// Conçu pour être IDEMPOTENT (un re-appel ne duplique rien) :
//   - Pour chaque exo NON-custom du snapshot avec un id : UPDATE direct
//     (ordre + superset_group) — idempotent par construction.
//   - Pour chaque exo CUSTOM du snapshot (qui a déjà été inséré côté
//     workout avec is_workout_custom=1) : on cherche dans la session
//     template s'il existe déjà un exo avec ce nom et
//     is_workout_custom=0. Si oui, on met juste à jour ordre + supersets.
//     Si non, on insère un nouvel exo template (3×8-12, repos 90s).
//
// Payload :
//   workout_id      (int, requis)
//   exercise_order  (object[]) : même structure que pour `complete`.
//                                On le repasse pour avoir une source de
//                                vérité (ordre + supersets + customs) au
//                                cas où le frontend ait redémarré entre
//                                les deux appels.
//   save_in_gallery (bool, optionnel) : pour les séances libres, désarchive
//                                la séance (la rend visible dans la galerie).
//                                Si false ou absent : la séance reste
//                                comme elle est.
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'apply_template_changes') {
    $workoutId     = $input['workout_id'] ?? null;
    $exerciseOrder = $input['exercise_order'] ?? [];
    $saveInGallery = !empty($input['save_in_gallery']);

    if (!$workoutId) {
        jsonResponse(['error' => 'ID de l\'entraînement requis'], 400);
    }

    // Vérifier la propriété
    $stmt = $pdo->prepare("
        SELECT workout_session_id
        FROM qogym_completed_workouts
        WHERE id = ? AND user_id = ?
    ");
    $stmt->execute([$workoutId, $user['id']]);
    $row = $stmt->fetch();
    if (!$row) {
        jsonResponse(['error' => 'Entraînement non trouvé'], 404);
    }
    $sessionId = $row['workout_session_id'];
    if (!$sessionId) {
        jsonResponse(['error' => 'Aucune séance template associée'], 400);
    }

    $pdo->beginTransaction();

    try {
        // Désarchive la séance si demandé (cas "séance libre → galerie")
        if ($saveInGallery) {
            $stmt = $pdo->prepare("
                UPDATE qogym_workout_sessions
                SET is_archived = 0
                WHERE id = ? AND user_id = ?
            ");
            $stmt->execute([$sessionId, $user['id']]);
        }

        // Préparer les statements réutilisables
        $stmtUpdNonCustom = $pdo->prepare("
            UPDATE qogym_exercises
            SET exercise_order = ?, superset_group = ?, removed_from_template = 0
            WHERE id = ? AND workout_session_id = ?
        ");
        $stmtFindByName = $pdo->prepare("
            SELECT id FROM qogym_exercises
            WHERE workout_session_id = ?
              AND name = ?
              AND COALESCE(is_workout_custom, 0) = 0
            LIMIT 1
        ");
        $stmtPromote = $pdo->prepare("
            UPDATE qogym_exercises
            SET is_workout_custom = 0,
                sets = GREATEST(sets, 3),
                reps_min = GREATEST(reps_min, 8),
                reps_max = GREATEST(reps_max, 12),
                rest_time = GREATEST(rest_time, 90),
                exercise_order = ?,
                superset_group = ?,
                removed_from_template = 0
            WHERE id = ?
        ");
        $stmtInsertTemplate = $pdo->prepare("
            INSERT INTO qogym_exercises
            (workout_session_id, name, sets, reps_min, reps_max, rest_time,
             exercise_order, is_workout_custom, superset_group)
            VALUES (?, ?, 3, 8, 12, 90, ?, 0, ?)
        ");
        $stmtFindCustomInThisWorkout = $pdo->prepare("
            SELECT e.id FROM qogym_exercises e
            INNER JOIN qogym_completed_sets cs ON cs.exercise_id = e.id
            WHERE e.workout_session_id = ?
              AND e.name = ?
              AND COALESCE(e.is_workout_custom, 0) = 1
              AND cs.completed_workout_id = ?
            LIMIT 1
        ");

        foreach ($exerciseOrder as $exData) {
            $order = isset($exData['display_order']) ? (int)$exData['display_order'] : 0;
            $sg = (isset($exData['superset_group']) && $exData['superset_group'] !== null && $exData['superset_group'] !== '')
                ? (int)$exData['superset_group']
                : null;
            $name = $exData['name'] ?? '';

            if (empty($exData['is_custom']) && !empty($exData['id'])) {
                // Exo existant du template : juste UPDATE
                $stmtUpdNonCustom->execute([$order, $sg, (int)$exData['id'], $sessionId]);
                continue;
            }

            if (!empty($exData['is_custom']) && $name !== '') {
                // Exo custom : on cherche s'il existe déjà un homonyme NON-custom
                // dans cette séance (idempotence : 2e appel ne duplique pas).
                $stmtFindByName->execute([$sessionId, $name]);
                $existing = $stmtFindByName->fetch();
                if ($existing) {
                    $stmtUpdNonCustom->execute([$order, $sg, (int)$existing['id'], $sessionId]);
                } else {
                    // Sinon, on cherche l'instance custom créée dans CE workout
                    // (insérée par `complete` plus tôt). On la "promeut" en
                    // exo template plutôt que d'en créer un nouveau, pour
                    // garder le lien direct vers les sets déjà enregistrés.
                    $stmtFindCustomInThisWorkout->execute([$sessionId, $name, $workoutId]);
                    $customRow = $stmtFindCustomInThisWorkout->fetch();
                    if ($customRow) {
                        $stmtPromote->execute([$order, $sg, (int)$customRow['id']]);
                    } else {
                        // Cas tordu : pas trouvé. On insère un exo template tout neuf.
                        $stmtInsertTemplate->execute([$sessionId, $name, $order, $sg]);
                    }
                }
            }
        }

        $pdo->commit();
        jsonResponse(['success' => true, 'message' => 'Séance mise à jour']);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => 'Erreur lors de la mise à jour de la séance'], 500);
    }
}

// HISTORIQUE DES ENTRAÎNEMENTS
if ($method === 'GET' && isset($_GET['history'])) {
    $limit  = isset($_GET['limit'])  ? max(1, (int)$_GET['limit'])  : 50;
    $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;

    $stmt = $pdo->prepare("
        SELECT cw.*, ws.name as session_name, st.name as session_type_name,
               (SELECT COUNT(*) FROM qogym_completed_sets WHERE completed_workout_id = cw.id) as total_sets
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
        INNER JOIN qogym_session_types st ON ws.session_type_id = st.id
        WHERE cw.user_id = ? AND cw.completed_at IS NOT NULL
        ORDER BY cw.completed_at DESC
        LIMIT ? OFFSET ?
    ");
    $stmt->execute([$user['id'], $limit, $offset]);
    $history = $stmt->fetchAll();

    jsonResponse([
        'success'  => true,
        'history'  => $history,
        'has_more' => count($history) === $limit,
    ]);
}

// DÉTAILS D'UN ENTRAÎNEMENT COMPLÉTÉ
if ($method === 'GET' && isset($_GET['id'])) {
    $workoutId = $_GET['id'];

    $stmt = $pdo->prepare("
        SELECT cw.*, ws.name as session_name
        FROM qogym_completed_workouts cw
        INNER JOIN qogym_workout_sessions ws ON cw.workout_session_id = ws.id
        WHERE cw.id = ? AND cw.user_id = ?
    ");
    $stmt->execute([$workoutId, $user['id']]);
    $workout = $stmt->fetch();

    if (!$workout) {
        jsonResponse(['error' => 'Entraînement non trouvé'], 404);
    }

    // Récupérer les sets
    $stmt = $pdo->prepare("
        SELECT cs.*, e.name as exercise_name
        FROM qogym_completed_sets cs
        INNER JOIN qogym_exercises e ON cs.exercise_id = e.id
        WHERE cs.completed_workout_id = ?
        ORDER BY e.exercise_order, cs.set_number
    ");
    $stmt->execute([$workoutId]);
    $sets = $stmt->fetchAll();

    $workout['sets'] = $sets;

    jsonResponse(['success' => true, 'workout' => $workout]);
}

// STATISTIQUES DE PROGRESSION
if ($method === 'GET' && isset($_GET['stats'])) {
    $exerciseId = $_GET['exercise_id'] ?? null;

    if ($exerciseId) {
        // Stats pour un exercice spécifique
        $stmt = $pdo->prepare("
            SELECT cs.*, cw.completed_at, e.name as exercise_name
            FROM qogym_completed_sets cs
            INNER JOIN qogym_completed_workouts cw ON cs.completed_workout_id = cw.id
            INNER JOIN qogym_exercises e ON cs.exercise_id = e.id
            WHERE cs.exercise_id = ? AND cw.user_id = ? AND cw.completed_at IS NOT NULL
            ORDER BY cw.completed_at DESC
            LIMIT 100
        ");
        $stmt->execute([$exerciseId, $user['id']]);
        $sets = $stmt->fetchAll();

        jsonResponse(['success' => true, 'exercise_stats' => $sets]);
    } else {
        // Stats générales
        $stmt = $pdo->prepare("
            SELECT 
                COUNT(DISTINCT cw.id) as total_workouts,
                COUNT(DISTINCT DATE(cw.completed_at)) as total_days,
                0 as total_sets,
                0 as total_reps
            FROM qogym_completed_workouts cw
            WHERE cw.user_id = ? AND cw.completed_at IS NOT NULL
        ");
        $stmt->execute([$user['id']]);
        $stats = $stmt->fetch();

        // Calcul séparé pour les sets et répétitions
        $stmt = $pdo->prepare("
            SELECT 
                COUNT(cs.id) as total_sets,
                COALESCE(SUM(cs.reps), 0) as total_reps
            FROM qogym_completed_sets cs
            INNER JOIN qogym_completed_workouts cw ON cs.completed_workout_id = cw.id
            WHERE cw.user_id = ? AND cw.completed_at IS NOT NULL
        ");
        $stmt->execute([$user['id']]);
        $setsStats = $stmt->fetch();

        $stats['total_sets'] = $setsStats['total_sets'];
        $stats['total_reps'] = $setsStats['total_reps'];

        jsonResponse(['success' => true, 'stats' => $stats]);
    }
}

// SUPPRIMER UN ENTRAÎNEMENT
if ($method === 'DELETE' && isset($input['id'])) {
    $workoutId = $input['id'];

    $pdo->beginTransaction();

    try {
        // Vérifier que l'entraînement appartient à l'utilisateur
        $stmt = $pdo->prepare("SELECT id FROM qogym_completed_workouts WHERE id = ? AND user_id = ?");
        $stmt->execute([$workoutId, $user['id']]);
        if (!$stmt->fetch()) {
            jsonResponse(['error' => 'Entraînement non trouvé'], 404);
        }

        // Supprimer les participants
        $stmt = $pdo->prepare("DELETE FROM qogym_workout_participants WHERE completed_workout_id = ?");
        $stmt->execute([$workoutId]);

        // Supprimer les sets
        $stmt = $pdo->prepare("DELETE FROM qogym_completed_sets WHERE completed_workout_id = ?");
        $stmt->execute([$workoutId]);

        // Supprimer l'entraînement
        $stmt = $pdo->prepare("DELETE FROM qogym_completed_workouts WHERE id = ? AND user_id = ?");
        $stmt->execute([$workoutId, $user['id']]);

        $pdo->commit();
        jsonResponse(['success' => true, 'message' => 'Entraînement supprimé']);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => 'Erreur lors de la suppression'], 500);
    }
}

// MODIFIER LES NOTES D'UN ENTRAÎNEMENT TERMINÉ
if ($method === 'POST' && isset($input['action']) && $input['action'] === 'update_notes') {
    $workoutId = $input['workout_id'] ?? null;
    $notes     = $input['notes'] ?? '';

    if (!$workoutId) {
        jsonResponse(['error' => 'workout_id manquant'], 400);
        exit;
    }

    // Vérifier que l'entraînement appartient à l'utilisateur courant
    $stmt = $pdo->prepare("SELECT id FROM qogym_completed_workouts WHERE id = ? AND user_id = ?");
    $stmt->execute([$workoutId, $user['id']]);
    if (!$stmt->fetch()) {
        jsonResponse(['error' => "Entraînement non trouvé"], 404);
        exit;
    }

    $stmt = $pdo->prepare("UPDATE qogym_completed_workouts SET notes = ? WHERE id = ? AND user_id = ?");
    $stmt->execute([$notes, $workoutId, $user['id']]);

    jsonResponse(['success' => true, 'notes' => $notes]);
    exit;
}

jsonResponse(['error' => 'Action non reconnue'], 400);
