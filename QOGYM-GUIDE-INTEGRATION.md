# QoGym — Guide d'intégration pour une appli partenaire

> **À qui s'adresse ce document :** au développeur d'une autre appli de
> musculation qui veut partager avec QoGym les **comptes**, les **amis** et
> la **visibilité des entraînements**, tout en gardant ses propres données.
>
> **Ce qu'il contient :** comment QoGym fonctionne, les endpoints à appeler
> (vérifiés dans le code), les règles à respecter pour ne rien casser, et
> comment les séances de ton appli s'affichent dans QoGym (§9, détaillé dans
> `RECOMP-FEED-SOLUTION.md`).

---

## 1. Vue d'ensemble

```
   Site web React            Appli Android native         Ton appli
   (qojim.com)               (APK QoGym)                  (partenaire)
        │                          │                           │
        └──────────────┬───────────┘                           │
                       │   HTTPS + JSON                        │
                       ▼                                       │
          ┌─────────────────────────────┐   HTTPS + JSON       │
          │  API PHP QoGym              │◄─────────────────────┘
          │  https://qojim.com/qogym-api│   (comptes, amis, séances des amis)
          └──────────────┬──────────────┘
                         │ PDO
                         ▼
          ┌─────────────────────────────┐        ┌───────────────────────┐
          │  MySQL — tables qogym_*     │        │  TA base / TES tables │
          │  (comptes, amis, séances…)  │        │  (tes séances, etc.)  │
          └─────────────────────────────┘        └───────────────────────┘
```

| Brique | Techno | Rôle |
|---|---|---|
| API QoGym | PHP 8 sans framework + PDO MySQL | Toute la logique serveur, accès BDD, emails |
| Site QoGym | React | Interface web |
| Appli QoGym | React Native / Expo (Android) | Interface mobile, appelle la même API |
| Base QoGym | MySQL, tables préfixées `qogym_` | **Données de prod des utilisateurs : on ne les modifie jamais à la main** |

---

## 2. Le principe de la mutualisation

| Partagé | Pas partagé |
|---|---|
| **Les comptes** (une seule table `qogym_users` : même email, même mot de passe sur les deux applis) | Tes séances, ton format de données, tes fonctionnalités |
| **Les amitiés** (table `qogym_friendships`) | Les séances QoGym (tu les **lis** via l'API, tu ne les écris pas) |
| Le **réglage de confidentialité** de l'utilisateur | |

### Règles d'or

1. **Tu passes toujours par l'API QoGym** pour tout ce qui touche aux comptes et aux amis.
   Tu n'as pas besoin d'accès à la base QoGym pour ça, et tu ne dois pas écrire dans les tables `qogym_*`.
2. **Le `user_id` QoGym est l'identifiant commun.** Dans tes tables, chaque ligne liée à
   un utilisateur porte ce `user_id` (pas de table « users » à toi).
   Si tu as besoin de données de profil propres à ton appli, mets-les dans ta propre table
   `ma_appli_profiles (user_id, …)`.
3. **On ne modifie rien d'existant côté QoGym.** Si on a besoin de quelque chose de nouveau, on
   **ajoute** : une nouvelle table, une colonne facultative, un nouvel endpoint. Les endpoints actuels
   doivent garder exactement les mêmes réponses, car l'appli Android déjà installée en dépend.
4. **On respecte la confidentialité** choisie par l'utilisateur (voir §6) des deux côtés.

---

## 3. Conventions de l'API

- **URL de base :** `https://qojim.com/qogym-api/`. Un fichier PHP correspond à un domaine (`auth.php`, `friends.php`…).
- **Format :** JSON en entrée (`Content-Type: application/json`) et en sortie.
- **Authentification :** header `Authorization: Bearer <token>` sur toutes les requêtes, sauf inscription, connexion et reset du mot de passe.
- **Choix de l'action :**
  - en `POST`, un champ `action` dans le body JSON : `{ "action": "send_request", ... }` ;
  - en `GET`, un paramètre dans l'URL : `friends.php?list=1`.
- **Succès :** en général `{ "success": true, ... }`.
- **Erreur :** `{ "error": "message lisible en français" }` avec un code HTTP 4xx/5xx.
- **CORS :** ouvert (`Access-Control-Allow-Origin: *`). Une webapp sur un autre domaine peut appeler l'API directement depuis le navigateur.
- **Dates :** format MySQL `YYYY-MM-DD HH:MM:SS`, sans fuseau horaire (heure locale du serveur).
- **Types :** MySQL/PDO renvoie souvent les nombres **sous forme de chaînes** (`"id": "42"`) et les booléens SQL sous forme `"0"`/`"1"`. Convertis côté client.

> ⚠️ **Token invalide ou expiré.** Sur la plupart des fichiers (`friends.php`, `feed.php`,
> `user_profile.php`, `workouts.php`…), un token invalide provoque une **erreur 500** et non une 401
> (l'exception n'est pas interceptée). Pour savoir si l'utilisateur est toujours connecté, appelle
> `GET auth.php` : s'il ne renvoie pas `success: true`, considère l'utilisateur comme déconnecté.

---

## 4. Comptes et authentification (`auth.php`, `password_reset.php`)

### Fonctionnement

- Mots de passe hachés en bcrypt. Impossible (et inutile) de les lire.
- **Token de session :** chaîne aléatoire de 128 caractères hexadécimaux, stockée dans `qogym_auth_tokens`, valable **1 an**.
  - Un utilisateur peut avoir **plusieurs tokens actifs** (un par appareil ou par appli). Te connecter depuis ton appli ne déconnecte donc pas QoGym.
- **Confirmation d'email obligatoire :**
  - Tant que l'email n'est pas confirmé, la connexion est refusée et le compte n'a pas de token.
  - Un compte non confirmé est **supprimé automatiquement au bout de 24 h**.

### Endpoints

| But | Requête | Body / params | Réponse |
|---|---|---|---|
| Inscription | `POST auth.php` | `{ "action":"register", "email", "username", "password" }` (mdp ≥ 6 caractères) | `{ success, requires_verification: true, email, message }`. **Pas de token** : un email de confirmation est envoyé. 409 si l'email ou le pseudo est déjà pris. |
| Confirmer l'email | `POST auth.php` | `{ "action":"verify_email", "token" }` (token reçu dans le lien de l'email) | `{ success, user, token }` : connexion automatique. 410 + `code: "EXPIRED"` si le lien a expiré. |
| Renvoyer l'email de confirmation | `POST auth.php` | `{ "action":"resend_verification", "email" }` | `{ success, message }` (réponse neutre si le compte n'existe pas) |
| Connexion | `POST auth.php` | `{ "action":"login", "email", "password" }` | `{ success, token, user: { id, email, username, is_admin } }`. 401 si identifiants faux. 403 + `code: "EMAIL_NOT_VERIFIED"` si email non confirmé. |
| **Connexion depuis une appli partenaire** | `POST auth.php` | `{ "action":"login", "email", "password", "app":"recomp" }` | Pareil, plus `token_scope: "partner:recomp"` et `expires_at`. Le token est **limité** et valable **90 jours** (voir ci-dessous). |
| Applis reliées au compte | `GET auth.php?partners=1` + Bearer | — | `{ partners: [{ app, name, active_tokens, expires_at }] }` |
| Délier une appli partenaire | `POST auth.php` + Bearer (token normal) | `{ "action":"revoke_partner", "app":"recomp" }` | Supprime tous les tokens de cette appli pour ce compte |
| Qui est connecté ? | `GET auth.php` + Bearer | — | `{ success, user: { id, email, username, is_admin } }` |
| Déconnexion | `POST auth.php` + Bearer | `{ "action":"logout" }` | Supprime **ce** token uniquement |
| Changer le mot de passe | `POST auth.php` + Bearer | `{ "action":"change_password", "current_password", "new_password" }` | Déconnecte **tous les autres** tokens de l'utilisateur, donc aussi ses sessions QoGym |
| Changer le pseudo | `POST auth.php` + Bearer | `{ "action":"change_username", "username" }` | 3 à 30 caractères `[A-Za-z0-9_.-]`, unique sans tenir compte de la casse |
| Mot de passe oublié | `POST password_reset.php` | `{ "action":"request_reset", "email" }` | Envoie un lien valable 1 h |
| Vérifier un lien de reset | `GET password_reset.php?token=…` | — | `{ success, valid: true }` ou 400 |
| Définir le nouveau mdp | `POST password_reset.php` | `{ "action":"reset_password", "token", "new_password" }` | — |

### À savoir

- **Les emails sont à la marque QoGym**, envoyés depuis `noreply@qojim.com`. Les liens pointent vers
  `https://qojim.com/verify-email?token=…` et vers la page de reset de qojim.com.
  - Un utilisateur qui s'inscrit chez toi recevra donc un email « Bienvenue sur QoGym » et confirmera son compte sur qojim.com. Ça marche, mais c'est à savoir.
  - L'inscription et la confirmation n'ont pas encore de version « à ta marque ». Si tu en veux une, on l'ajoutera sur le modèle du paramètre `app` du login.
- **Chaque connexion envoie un email « Nouvelle connexion à QoGym ».** Avec `app: "recomp"`, c'est un
  email « Ton compte QoGym a été relié à Recomp » à la place.

### Tokens partenaire (appli externe)

Une appli partenaire qui **stocke** des tokens QoGym doit se connecter avec `app` : elle reçoit un token
limité. Seuls ces appels sont autorisés :
- `friends.php` (tout) ;
- `feed.php` (tout) ;
- `user_profile.php` en lecture ;
- `preferences.php` en lecture, et `PUT` du seul `default_workout_privacy` ;
- `auth.php` : `GET` et `logout`.

Tout le reste répond `403` avec `code: "PARTNER_SCOPE"`. Le token expire au bout de 90 jours, et
l'utilisateur peut le révoquer. Un changement de mot de passe QoGym le supprime aussi.
Liste des applis acceptées : `PARTNER_APPS` dans `qogym-api/partner_tokens.php`.
- `verifyAuth()` refuse aussi les comptes non confirmés, même avec un token valide.
- **Suppression de compte :** aucun endpoint n'existe aujourd'hui. Si on en ajoute un, il devra supprimer les données des **deux** applis. C'est à définir ensemble.

---

## 5. Profil et avatar

- `GET user_profile.php?user_id=N` + Bearer → profil public d'un utilisateur. La réponse contient :
  - `user { id, username, pdp, created_at }` ;
  - `stats` ;
  - `is_friend`, `is_own_profile`, `friendship_status`, `friendship_id`, `friendship_direction` (`"sent"` ou `"received"`) ;
  - `history` : ses entraînements QoGym, **seulement si c'est son propre profil, ou si c'est un ami en `public`** ;
  - `history_private` : `true` quand c'est un ami mais que l'historique est masqué parce qu'il est en `private`.
- **Images :** les champs ne contiennent qu'un nom de fichier, à transformer en URL.

  | Champ | URL |
  |---|---|
  | `pdp`, `user_pdp`, `friend_pdp`, `sender_pdp`, `receiver_pdp` | `https://qojim.com/pdp/<valeur>` |
  | `session_image` / `image_url` | Si la valeur commence par `http` : telle quelle. Sinon `https://qojim.com/imgseances/<valeur>` |
  | `null` | Pas d'image : afficher l'initiale du pseudo ou une image par défaut |

  Ces images sont publiques : pas besoin de token pour les afficher.
- `GET preferences.php` + Bearer → préférences de l'utilisateur connecté, dont `default_workout_privacy` et `pdp`.
- `PUT preferences.php` + Bearer, body partiel (par exemple `{ "default_workout_privacy": "private" }`) → met à jour les préférences.
- `POST preferences.php` en `multipart/form-data` avec un champ fichier `pdp` → change la photo.

---

## 6. Confidentialité

Une seule colonne : `qogym_users.default_workout_privacy`, qui vaut `'public'` ou `'private'`.

| Valeur | Qui voit les entraînements de l'utilisateur |
|---|---|
| `public` | **Ses amis acceptés** (et les participants d'une séance). Ce n'est **pas** tout le monde. |
| `private` | Lui seul |

Cette règle s'applique partout dans l'API : fil, détail d'un entraînement, likes, commentaires et
historique du profil.

**Ton appli doit appliquer la même règle** quand elle expose les séances d'un utilisateur à d'autres.
Si tu as besoin d'un réglage plus fin, on en **ajoute** un, sans changer le sens de celui-ci.

---

## 7. Amis (`friends.php`)

### Modèle de données

Table `qogym_friendships (id, user_id, friend_id, status, created_at)` :
- `user_id` = celui qui **envoie** la demande, `friend_id` = celui qui la **reçoit** ;
- `status` = `'pending'` (en attente) ou `'accepted'` (amis) ;
- une seule ligne par couple, quel que soit le sens. Refuser ou retirer un ami **supprime** la ligne.

### Endpoints (tous avec Bearer)

| But | Requête | Réponse |
|---|---|---|
| Chercher un utilisateur | `GET friends.php?search=<texte>` (≥ 2 caractères) | `{ users: [{ id, username, email, pdp }] }`, 20 max, sans soi-même |
| Envoyer une demande | `POST friends.php` `{ "action":"send_request", "friend_id": N }` | 409 si une relation existe déjà (dans un sens ou dans l'autre). Un email est envoyé au destinataire. |
| Demandes reçues | `GET friends.php?pending_received=1` | `{ pending_requests: [{ friendship_id, created_at, sender_id, sender_username, sender_pdp, sender_email }] }` |
| Demandes envoyées | `GET friends.php?pending_sent=1` | `{ sent_requests: [{ friendship_id, created_at, receiver_id, receiver_username, receiver_pdp }] }` |
| Accepter | `POST friends.php` `{ "action":"accept", "friendship_id": N }` | Seul le destinataire peut accepter (sinon 403). Un email est envoyé au demandeur. |
| Refuser / annuler | `POST friends.php` `{ "action":"decline", "friendship_id": N }` | Supprime la ligne (possible pour l'un ou l'autre des deux) |
| Retirer un ami | `DELETE friends.php?friendship_id=N` | Idem |
| Liste d'amis | `GET friends.php?list=1` | `{ friends: [{ friendship_id, created_at, friend_id, friend_username, friend_pdp }] }` |

**Comme les comptes sont communs, une amitié créée dans une appli existe aussi dans l'autre.**
Les emails envoyés sont à la marque QoGym (voir §4).

---

## 8. Comment QoGym stocke un entraînement (pour lire ceux des amis)

| Table | Contenu |
|---|---|
| `qogym_workout_sessions` | Une **séance modèle** (« Push », « Jambes »…) : nom, image, type, propriétaire |
| `qogym_session_types` | Catégorie de la séance (Push, Pull, Legs…) |
| `qogym_exercises` | Les exercices d'une séance : `name`, `sets`, `reps_min`, `reps_max`, `rest_time` (s), `exercise_order`, `superset_group` |
| `qogym_completed_workouts` | **Un entraînement réalisé** : `user_id`, `workout_session_id`, `started_at`, `completed_at` (NULL = en cours), `notes`, `exercise_order_snapshot` (JSON) |
| `qogym_completed_sets` | Les séries réalisées : `completed_workout_id`, `exercise_id`, `set_number`, `weight` (kg, peut être NULL), `reps` |
| `qogym_workout_participants` | Amis présents pendant l'entraînement |
| `qogym_workout_likes` / `qogym_workout_comments` | Réactions sur un entraînement (les commentaires peuvent avoir des réponses via `parent_comment_id`) |

Autres tables, non concernées par l'intégration : nutrition (`qogym_food_*`), pas (`qogym_daily_steps`), rapports mensuels, bibliothèque, partages de séances.

### Lire les entraînements QoGym (avec Bearer)

| But | Requête | Réponse |
|---|---|---|
| Fil d'actualité (mes séances et celles de mes amis en `public`) | `GET feed.php?feed=1&limit=20&offset=0` | `{ workouts: [{ id, user_id, user_username, user_pdp, session_name, session_image, session_type_name, started_at, completed_at, notes, likes_count, comments_count, user_has_liked, participants }] }`, du plus récent au plus ancien |
| Détail d'un entraînement | `GET feed.php?workout_id=N` | `{ workout: { …mêmes champs…, exercises: [{ id, exercise_name, planned_sets, reps_min, reps_max, rest_time, superset_group, completed_sets: [{ set_number, weight, reps }] }], likes: [...], comments: [...], participants: [...] } }`. 403 si l'utilisateur n'y a pas droit. |
| Historique d'un ami | `GET user_profile.php?user_id=N`, puis `…&history=1&limit=10&offset=20` | `history: [{ id, completed_at, notes, session_name, session_image, session_type_name, total_sets, likes_count, comments_count, user_has_liked }]`. 403 si pas ami. |
| Liker / commenter | `POST feed.php` `{ "action":"like", "workout_id" }`, ou `{ "action":"comment", "workout_id", "comment", "parent_comment_id"? }` | Envoie un email au propriétaire |

**Durée d'un entraînement** = `completed_at - started_at`.
**Volume** = somme de `weight × reps` sur les séries.

---

## 9. Afficher les séances d'une appli partenaire dans QoGym (en place)

Le détail complet (format, pagination, performance, erreurs) est dans **`RECOMP-FEED-SOLUTION.md`**.
En résumé :

- **Côté partenaire :** un endpoint de lecture appelé de serveur à serveur avec une clé partagée.
  Il accepte `user_ids=…&limit=…&before=…` et `user_id=…&id=…`, et ne renvoie jamais de séance privée.
- **Côté QoGym :** le fil et le profil fusionnent ces séances **uniquement si le client envoie
  `include_external=1`**. Les anciens clients reçoivent exactement la même réponse qu'avant.
- **Identifiants :** les séances externes ont des ids en chaîne préfixés (`recomp:…`) et un champ `source`.
  Pour le détail, le like et le commentaire, il faut ajouter `owner_id`.
- **Configuration :** la liaison s'active dans `config.php` (URL et clé du partenaire). Tant qu'elle
  n'est pas configurée, `external_status` vaut `"disabled"`.

### Faudra-t-il mettre à jour l'appli Android QoGym ?

| Fonctionnalité | Backend seul | Nouvelle version de l'APK |
|---|---|---|
| Amis communs | ✅ (rien à faire, c'est la même table) | — |
| Séances partenaire dans le fil / le profil de **l'appli partenaire** | ✅ (en place) | — |
| Séances partenaire dans l'**appli QoGym** (fil, profil, détail, like, commentaire) | ✅ côté API | ✅ (l'appli doit envoyer `include_external=1` et gérer les ids en chaîne) |
| Badge « fait sur Recomp », masquer « Refaire cette séance », bouton « Délier » | — | ✅ |

### Dans l'autre sens (QoGym → ton appli)

Rien à créer : ton appli lit les séances QoGym des amis avec les endpoints du §8, en utilisant le token de l'utilisateur.

---

## 10. Où stocker tes données

| Option | Comment | Recommandé ? |
|---|---|---|
| **A. Ta propre base / ton propre serveur** | Tes tables chez toi, avec la colonne `user_id`. Pour savoir qui est connecté, ton serveur appelle `GET auth.php` avec le token de l'utilisateur (et peut mettre la réponse en cache quelques minutes). | ✅ **Oui** : les deux bases restent isolées, une erreur d'un côté ne touche pas l'autre |
| B. Tes tables dans la base MySQL QoGym | Préfixe différent (par exemple `ma_appli_*`). Le propriétaire de QoGym te crée **un utilisateur MySQL dédié** avec des droits limités à tes tables (`GRANT … ON base.ma_appli_* …`), jamais les identifiants principaux. | Possible si même hébergement |

Dans les deux cas : **aucune écriture dans `qogym_*`**, et aucune clé étrangère de tes tables vers
`qogym_*` qui bloquerait ou supprimerait en cascade des données QoGym.

---

## 11. Checklist de démarrage

- [ ] S'accorder sur le **nom technique** de ton appli (pour `source`, les préfixes de tables, etc.)
- [ ] Brancher ton écran de connexion / inscription sur `auth.php`, puis tester avec un compte de test
- [ ] Stocker le token côté client et l'envoyer en `Authorization: Bearer …`
- [ ] Brancher l'écran amis sur `friends.php`
- [ ] Lire le fil QoGym (`feed.php?feed=1`) pour afficher les séances des amis
- [ ] Créer tes tables avec `user_id`, en appliquant la règle de confidentialité du §6
- [ ] Ensemble : valider le format du §9, le mécanisme d'id et la clé partagée
- [ ] Ensemble : décider des emails (marque QoGym ou à ta marque) et de la suppression de compte

**Pour tester sans toucher aux vrais utilisateurs :** crée des comptes de test avec de vraies
adresses email que tu contrôles (la confirmation est obligatoire). Ne fais jamais d'essai sur les
comptes ou les données d'utilisateurs réels.
