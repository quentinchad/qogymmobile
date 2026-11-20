# Recomp ↔ QoGym : afficher les séances Recomp dans le fil QoGym

> Réponse au document « Recomp ↔ QoGym : ce qui est en place côté Recomp », points 3.1 et 3.2.
> La proposition est validée sur le fond. Ce document précise **comment** brancher la fusion
> sans casser les clients QoGym existants, comment éviter un appel HTTP par ami, et comment
> utiliser les **tokens partenaire limités** (§4).
>
> **État : tout ce qui est décrit ici est en place côté QoGym**, testé sur une base locale contre un
> faux serveur Recomp. Il reste à activer la liaison (URL + clé) quand ton endpoint groupé est prêt.

---

## 1. Le problème : fusionner directement dans `feed.php?feed=1` casserait l'appli installée

Le point 3.1 propose d'ajouter les séances Recomp **dans la réponse actuelle** de
`feed.php?feed=1` et de `user_profile.php`. Or les clients QoGym déjà en circulation supposent
que **l'id d'un entraînement est un nombre** :

| Client | Ce qu'il fait avec l'id | Résultat avec `"recomp:r_ea3f…"` |
|---|---|---|
| Appli Android (`workout-detail/[id].tsx`) | `feedApi.detail(Number(id))` | `Number("recomp:…")` = `NaN`, donc appel à `feed.php?workout_id=NaN` → 404 → écran d'erreur |
| Appli Android, like / commentaire | Envoie `workout_id` tel quel à `like` / `comment` | Le backend cherche `cw.id = 'recomp:…'` (MySQL convertit en 0) → « non trouvé » |
| Appli Android, « Refaire cette séance » | `clone_from_workout` avec l'id | Échec |
| Appli Android, fil et profil | Attend `session_name`, `session_image`, `likes_count`, `user_has_liked`… | Champs absents → carte incomplète |
| Site web React | Même logique d'ids numériques | Même risque |

**Pourquoi on ne peut pas simplement mettre à jour l'appli :** la mise à jour de l'APK est
**facultative** (bannière « Plus tard »). D'anciennes versions resteront donc installées pendant
des mois. Toute réponse d'endpoint existant doit rester **identique** pour elles.

---

## 2. La solution : une fusion opt-in

Le client **demande explicitement** les séances externes. Sans ce paramètre, rien ne change.

```
GET feed.php?feed=1&limit=20&include_external=1
GET user_profile.php?user_id=N&include_external=1
GET user_profile.php?user_id=N&history=1&limit=10&include_external=1
```

| Client | Paramètre envoyé | Ce qu'il reçoit |
|---|---|---|
| Ancienne APK, site actuel | aucun | **Exactement la réponse d'aujourd'hui** (aucune séance Recomp) |
| Recomp | `include_external=1` | Fusion QoGym + Recomp (Recomp ignore ses propres éléments `source: "recomp"`, comme prévu) |
| Prochaine APK QoGym | `include_external=1` | Fusion, avec badge « fait sur Recomp » et bouton « Refaire » masqué |

### Format d'un élément Recomp dans le fil fusionné

QoGym convertit chaque séance Recomp au format d'un élément du fil, pour que les clients
n'aient qu'un seul format à gérer :

| Champ du fil QoGym | Valeur pour une séance Recomp |
|---|---|
| `id` | `"recomp:r_ea3f…"` (chaîne, inchangée) |
| `source` | `"recomp"` (les éléments QoGym reçoivent `"qogym"`, **seulement** en mode `include_external`) |
| `user_id`, `user_username`, `user_pdp` | Lus dans `qogym_users`, puisque `user_id` est l'id QoGym |
| `session_name` | `name` |
| `session_image`, `session_type_name`, `workout_session_id`, `participants` | `null` |
| `started_at`, `completed_at`, `notes` | Tels quels |
| `likes_count`, `comments_count`, `user_has_liked` | Likes et commentaires des utilisateurs QoGym sur cette séance (tables `qogym_external_likes` / `qogym_external_comments`), sinon `0` |
| `total_sets` | Nombre de séries (échauffements compris) |
| `volume_kg`, `duration_min` | Repris tels quels (champs en plus) |

Réponse complète du fil fusionné :

```json
{
  "success": true,
  "workouts": [ … ],
  "next_before": "2026-11-18 10:00:00",
  "external_status": "ok"
}
```

- `next_before` : à renvoyer en `before=` pour la page suivante. `null` = dernière page.
- `external_status` :
  - `"ok"` ;
  - `"unavailable"` : Recomp n'a pas répondu à temps, on a les séances QoGym seules ;
  - `"disabled"` : liaison pas encore configurée côté QoGym.

Dans `user_profile.php` (mode `include_external`), la page initiale ajoute `next_before` et
`external_status`. La page suivante (`&history=1&before=…`) renvoie `{ history, has_more, next_before, external_status }`.

### Détail, like et commentaire (point 3.2 et 3.3) : mêmes URL, avec `owner_id`

On garde les mêmes URL et actions. Il faut seulement **ajouter l'id QoGym du propriétaire**
(`owner_id`, c'est le `user_id` de l'élément du fil), puisque l'API Recomp en a besoin :

```
GET  feed.php?workout_id=recomp:r_ea3f…&owner_id=43
POST feed.php { "action": "like",    "workout_id": "recomp:r_ea3f…", "owner_id": 43 }
POST feed.php { "action": "comment", "workout_id": "recomp:r_ea3f…", "owner_id": 43, "comment": "…", "parent_comment_id": "ext:12" }
DELETE feed.php?comment_id=ext:12
```

- Les commentaires d'une séance Recomp ont des ids **`"ext:<n>"`** (chaîne), pour ne jamais croiser
  les ids numériques des commentaires QoGym. `parent_comment_id` et la suppression utilisent ce format.
- Une réponse à une réponse est rattachée au commentaire racine (un seul niveau), comme sur QoGym.
- Supprimer un commentaire supprime aussi ses réponses. Seul son auteur peut le supprimer.
- Le propriétaire reçoit les mêmes emails de notification que pour une séance QoGym.

**Codes d'erreur :**

| Code | Signification |
|---|---|
| `400` | `owner_id` manquant |
| `403` | Pas ami, ou propriétaire en `private` |
| `404` | Séance inconnue chez Recomp, ou mauvais `owner_id` |
| `503` + `code: "external_unavailable"` | Recomp n'a pas répondu |
| `503` + `code: "migration_needed"` | Tables de réactions pas encore créées |

Pourquoi c'est sans risque : ces branches ne s'activent que pour un `workout_id` qui commence par
`recomp:` (ou un `comment_id` qui commence par `ext:`). Un ancien client **ne reçoit jamais** de tels ids,
puisqu'il n'envoie pas `include_external=1`. Les ids numériques passent par le code d'avant, qui n'a pas changé.

Pour le détail, QoGym vérifie lui-même l'amitié et la visibilité **avant** de relayer
`GET /api/partner/workouts?id=recomp:…&user_id=…`. Il renvoie ensuite le même format que le détail
d'une séance QoGym :
- `exercises[].exercise_name` ;
- `exercises[].completed_sets[{ set_number, weight, reps }]` ;
- `likes` et `comments`.

Les champs Recomp en plus (`type`, `bodyweight`, `rpe`, `reps_right`) sont conservés dans chaque série.

---

## 3. Performance : un seul appel à Recomp par chargement du fil

### Le problème

Le point 3.1 prévoit d'appeler Recomp **pour chaque ami** à chaque chargement du fil :

- 20 amis → **20 requêtes HTTP** en série depuis le PHP de QoGym. Avec environ 150 ms chacune, le fil met 3 s à s'afficher.
- Si Recomp est lent ou en panne, **le fil QoGym est bloqué** alors que ses propres données sont disponibles.
- La pagination (`limit` / `offset`) devient incohérente quand on mélange deux sources paginées séparément.

### Ce qu'on demande côté Recomp : un endpoint groupé avec curseur

```
GET /api/partner/workouts?user_ids=12,43,57&limit=20&before=2026-11-20%2012:00:00
Authorization: Bearer <QOGYM_PARTNER_KEY>
```

- `user_ids` : liste d'ids QoGym (jusqu'à 200 par exemple). Les comptes non reliés sont ignorés.
- `limit` : nombre total de séances renvoyées, **tous utilisateurs confondus**, triées par `completed_at` décroissant.
- `before` (facultatif) : ne renvoyer que les séances avec `completed_at < before`. C'est un curseur
  de date, plus fiable qu'un `offset` quand on fusionne deux sources.
- Même format de réponse qu'aujourd'hui, mêmes règles de confidentialité.
  `user_id=<id>` et `id=recomp:…` restent valables pour le détail.

### Ce que fait QoGym (en place)

Par précaution, même si la réponse de Recomp contient trop de choses, QoGym **ignore** toute séance d'un compte qu'il n'a pas demandé, marquée `private`, sans date de fin valide,
ou dont l'id ne commence pas par `recomp:`.

1. **Calcul des comptes visibles par le lecteur** : ses amis acceptés en `public` + lui-même.
   C'est QoGym qui fait ce contrôle, comme convenu.
2. **Un seul appel** à Recomp avec ces `user_ids`, `limit` et `before`.
3. **Timeout court** : 1 s pour la connexion, 2 s au total. En cas d'erreur ou de timeout, QoGym renvoie
   **ses séances seules**, avec un champ `external_status: "unavailable"`. Le fil ne casse jamais à cause de Recomp.
4. **Cache de 2 min**, par combinaison (liste d'ids, `before`, `limit`). Recharger le fil ne rappelle donc pas Recomp à chaque fois.
5. **Fusion** des deux listes par `completed_at`, puis découpe à `limit`. Le client reçoit aussi un
   `next_before` (la date de la dernière séance renvoyée) pour charger la page suivante.

En mode `include_external`, la pagination se fait par `before` au lieu de `offset`.
Le mode normal garde `offset`, comme aujourd'hui.

### Charge attendue

| | Sans regroupement | Avec regroupement |
|---|---|---|
| Appels à Recomp par chargement du fil (20 amis) | 20 | **1** (0 si le cache est valide) |
| Effet d'une panne de Recomp | Fil QoGym bloqué | Fil QoGym affiché, sans les séances Recomp |

---

## 4. Tokens partenaire : à utiliser par Recomp (déjà en place côté QoGym)

Un token QoGym « normal » est une session **complète** valable 1 an. Stocké chez Recomp, il donnerait
un accès total au compte si le serveur Recomp était compromis. QoGym délivre donc maintenant des
**tokens partenaire limités**.

### Comment en obtenir un

Ajouter `app: "recomp"` au login, dans la liaison de compte et dans « Continuer avec QoGym » :

```
POST auth.php
{ "action": "login", "email": "...", "password": "...", "app": "recomp" }
```

Réponse : la même qu'un login normal, plus deux champs :

```json
{
  "success": true,
  "user": { "id": 43, "email": "...", "username": "...", "is_admin": false },
  "token": "…",
  "token_scope": "partner:recomp",
  "expires_at": "2027-02-18 12:00:00"
}
```

- **Durée : 90 jours** (au lieu d'1 an).
- L'utilisateur reçoit un email « Ton compte QoGym a été relié à Recomp », **à la place** de l'email
  « Nouvelle connexion ». Cela règle le point « Emails » de ton §4.
- `GET auth.php` avec ce token renvoie aussi `token_scope: "partner:recomp"`.
- `app` inconnu → `400` avec `code: "UNKNOWN_APP"`.
- `503` avec `code: "migration_needed"` → la mise à jour n'est pas encore déployée côté QoGym. Réessayer plus tard.
  QoGym ne délivre **jamais** un token complet à la place.

### Ce que ce token peut faire

| Fichier | Autorisé |
|---|---|
| `friends.php` | Tout : recherche, demandes, accepter, refuser, retirer, liste |
| `feed.php` | Tout : fil, détail, like, commentaire, suppression de ses commentaires |
| `user_profile.php` | Lecture (`GET`) |
| `preferences.php` | `GET`, et `PUT` **uniquement** avec `{ "default_workout_privacy": ... }` |
| `auth.php` | `GET` (qui suis-je) et `logout` (supprime ce token) |
| **Tout le reste** | ❌ `403` avec `code: "PARTNER_SCOPE"` : séances, entraînements, nutrition, poids, pas, changement de mot de passe ou de pseudo, photo… |

Cela couvre exactement les besoins listés dans ton §1.

### Cas à gérer côté Recomp

| Situation | Réponse QoGym | À faire |
|---|---|---|
| Token expiré (90 jours) | `GET auth.php` ne renvoie plus `success: true` | Afficher « Reconnecte ton compte QoGym » |
| L'utilisateur a délié Recomp depuis QoGym | Idem | Idem |
| L'utilisateur a changé son mot de passe QoGym | Idem (tous les autres tokens sont supprimés) | Idem |
| Appel hors périmètre | `403` + `code: "PARTNER_SCOPE"` | Bug côté Recomp : ne pas réessayer |

### Migration des liaisons existantes

Les tokens **déjà stockés** par Recomp (obtenus sans `app`) restent des tokens complets jusqu'à leur
expiration. Il faut **les remplacer** :
- soit en demandant aux utilisateurs reliés de se reconnecter ;
- soit, à la prochaine connexion avec mot de passe, en refaisant un login avec `app: "recomp"`, puis un
  `logout` avec l'ancien token pour le supprimer.

Ne plus jamais appeler `login` sans `app: "recomp"` depuis Recomp.

### Côté utilisateur QoGym

- `GET auth.php?partners=1` → liste des applis reliées au compte (`app`, `name`, `active_tokens`, `expires_at`).
- `POST auth.php { "action": "revoke_partner", "app": "recomp" }` → délie Recomp : tous ses tokens pour ce
  compte sont supprimés. Cette action n'est possible qu'avec un token QoGym normal.

---

## 5. Récapitulatif

**Côté Recomp**
- [ ] Endpoint groupé : `user_ids`, `limit` global, curseur `before`
- [ ] Envoyer `include_external=1` sur `feed.php?feed=1` et `user_profile.php`
- [ ] Paginer par `next_before` en mode `include_external`
- [ ] Gérer `external_status: "unavailable"` et les 401/403 sur les tokens QoGym
- [ ] Login avec `app: "recomp"` partout, et remplacement des tokens complets déjà stockés (§4)

- [ ] Passer `owner_id` pour le détail, le like et le commentaire d'une séance Recomp ; gérer les ids de commentaire `ext:<n>` (§2)

**Côté QoGym (uniquement des ajouts)**
- [x] Tokens partenaire limités, 90 jours, révocables (§4)
- [x] Paramètre `include_external=1` sur `feed.php?feed=1` et `user_profile.php` (fusion, cache, timeout, `next_before`)
- [x] Branches `recomp:` dans `feed.php` pour le détail, les likes et les commentaires
- [x] Tables `qogym_external_likes` / `qogym_external_comments`
- [x] `user_profile.php` : un ami en `private` ne montre plus son historique (`history_private: true`)
- [ ] Activer la liaison : renseigner l'URL Recomp et la clé partagée dans la config QoGym (dès que l'endpoint groupé est prêt)
- [ ] Test réel de bout en bout avec deux comptes de test
- [ ] Plus tard : nouvelle APK (badge Recomp, « Refaire » masqué, bouton « Délier Recomp »)

> Tant que la liaison n'est pas activée, `include_external=1` répond normalement avec les seules
> séances QoGym et `external_status: "disabled"`. Recomp peut donc déjà brancher ses appels.
