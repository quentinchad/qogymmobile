# QoGym — Backend (PHP) + Base de données

> Projet `qogym-api/` — API REST PHP servie par Apache à
> `https://qojim.com/qogym-api/*.php`. Pas de framework, juste du PHP nu
> + PDO MySQL.

## Stack

- **PHP 8.x** (testé en 8.3)
- **PDO MySQL** (pas mysqli, pas d'ORM)
- **`mail()` natif** pour les emails (pas de PHPMailer/SMTP authentifié)
- Authentification par token Bearer en BDD

## Structure

```
qogym-api/
├── config.php               ← connexion BDD, helpers, verifyAuth, jsonResponse
├── auth.php                 ← login, register, getMe, logout
├── password_reset.php       ← demande + validation reset
├── debug-auth.php           ← ⚠️ outil de debug, à retirer en prod
│
├── workouts.php             ← séances, exercices, workouts complétés
├── sessions.php             ← gestion séances (alias / partage interne)
├── qojim_sessions.php       ← catalogue Qojim
├── share_sessions.php       ← partages entre utilisateurs
│
├── feed.php                 ← timeline + likes + commentaires + emails
├── friends.php / friends2.php ← gestion amis (deux fichiers historiques)
├── user_profile.php         ← profil public d'un autre utilisateur
│
├── nutrition.php            ← bibliothèque + journal alimentaire
├── preferences.php          ← objectifs kcal/macros, privacy, PDP
├── monthly_reports.php      ← génération + consultation rapports mensuels
├── send_reminders.php       ← cron qui envoie des rappels par email
│
├── admin.php                ← endpoints admin (gestion users, types séance)
└── test_php.php             ← endpoint sanity check
```

## Convention API

Toutes les requêtes répondent en **JSON**. Pattern récurrent :

```php
$user = verifyAuth();                                     // 401 si pas de token valide
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$action = $_GET['action'] ?? null;

if ($action === 'foo' && $method === 'POST') {
    // ... logique ...
    jsonResponse(['success' => true, 'data' => ...]);
}

jsonResponse(['error' => 'Action non reconnue'], 400);
```

Les helpers `verifyAuth()`, `jsonResponse()`, `getDB()` sont définis dans
`config.php`. **Tous** les fichiers commencent par `require_once 'config.php'`.

## Authentification

### Login (`auth.php`)
1. POST `/auth.php?action=login` avec `{ email, password }`
2. Backend vérifie `password_verify()` contre le hash stocké
3. Génère un token via `bin2hex(random_bytes(32))`
4. Insère dans `qogym_auth_tokens` avec `expires_at` (30 jours)
5. Renvoie `{ success: true, token, user }`

### Vérification (`config.php` — `verifyAuth()`)
1. Lit le header `Authorization: Bearer <token>`
2. Vérifie qu'il existe dans `qogym_auth_tokens` et que `expires_at > NOW()`
3. JOIN sur `qogym_users` pour récupérer le user complet
4. Retourne le tableau user, ou émet 401 + die() si invalide

### Logout
DELETE le token de la BDD. Le frontend vide aussi son localStorage.

## Base de données — schéma

Toutes les tables sont préfixées `qogym_`. Voici les principales :

### `qogym_users`
Utilisateurs. Champs principaux : `id`, `username`, `email`, `password`
(hashé bcrypt), `is_admin`, `default_workout_privacy` (`'public'`|
`'friends'`|`'private'`), `pdp` (filename de l'avatar dans
qojim.com/pdp/), `daily_kcal_target`, `daily_protein_target`,
`daily_carbs_target`, `daily_fat_target`, `created_at`.

### `qogym_auth_tokens`
Tokens d'auth. `id`, `user_id`, `token`, `expires_at`, `created_at`.

### `qogym_password_resets`
Tokens de reset. `id`, `user_id`, `token`, `expires_at`, `used`,
`created_at`.

### `qogym_session_types`
Catégories de séances (Push, Pull, Legs…). `id`, `name`, `created_at`.

### `qogym_workout_sessions`
Définition d'une séance (template, pas un workout effectué). `id`,
`name`, `description`, `image_url`, `session_type_id`, `created_by`,
`is_qojim_session`, `created_at`. Une séance peut être :
- **Personnelle** (created_by = user, is_qojim_session = 0)
- **Qojim** (created_by = admin, is_qojim_session = 1) — visible par tous

### `qogym_exercises`
Exercices d'une séance. `id`, `workout_session_id`, `name`, `default_sets`,
`default_reps`, `default_weight`, `default_rest_seconds`, `order_index`,
`notes`.

### `qogym_user_library`
Lien utilisateur ↔ séance (qui a quelle séance dans sa biblio).
`id`, `user_id`, `workout_session_id`, `added_at`.

### `qogym_completed_workouts`
**Un workout effectué** (instance d'une séance). `id`, `user_id`,
`workout_session_id`, `started_at`, `completed_at` (NULL = en cours),
`notes`, `created_at`.

### `qogym_completed_sets`
Séries validées d'un workout. `id`, `completed_workout_id`, `exercise_id`,
`set_number`, `weight`, `reps`, `completed_at`.

### `qogym_workout_likes`
Likes sur un workout terminé. `id`, `completed_workout_id`, `user_id`,
`created_at`. Unique (workout_id, user_id).

### `qogym_workout_comments`
Commentaires + réponses. `id`, `completed_workout_id`, `user_id`,
`comment`, `parent_comment_id` (NULL = racine, sinon réponse),
`created_at`, `updated_at`. ON DELETE CASCADE sur parent_comment_id.

### `qogym_workout_participants`
Participants à un workout (workout en groupe). `id`,
`completed_workout_id`, `user_id`.

### `qogym_friendships`
Relations d'amitié. `id`, `user_id` (demandeur), `friend_id` (cible),
`status` (`'pending'`|`'accepted'`|`'declined'`), `created_at`.

### `qogym_session_shares`
Partages de séance entre utilisateurs. `id`, `session_id`, `sender_id`,
`receiver_id`, `status` (`'pending'`|`'accepted'`|`'declined'`),
`created_at`.

### `qogym_food_items`
Bibliothèque d'aliments. `id`, `user_id`, `name`, `unit_label` (NULL=
en grammes, sinon ex "pomme"), `grams_per_unit` (NULL ou poids unité),
`kcal_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g`,
`created_at`. Unique (user_id, name).

### `qogym_food_entries`
Journal alimentaire. `id`, `user_id`, `food_item_id` (peut devenir NULL
si item supprimé), `name_snapshot`, `unit_label`, `grams_per_unit`,
`quantity_units`, `quantity_g`, `kcal_per_100g`, `protein_per_100g`,
`carbs_per_100g`, `fat_per_100g`, `consumed_at`, `created_at`.

> Snapshot pattern : on stocke les valeurs nutritionnelles au moment de la
> consommation. Si l'utilisateur modifie ensuite l'aliment dans sa biblio,
> les anciennes entrées du journal gardent les valeurs qu'elles avaient.

### `qogym_monthly_reports`
Rapports mensuels pré-générés (cron). `id`, `user_id`, `year`, `month`,
`data` (JSON avec stats), `viewed_at`, `created_at`.

## Endpoints — par domaine

### `auth.php`
| Action | Méthode | Body | Description |
|---|---|---|---|
| `login` | POST | `{ email, password }` | Login → renvoie token + user |
| `register` | POST | `{ username, email, password }` | Création de compte |
| `me` | GET | — | Récupère le user à partir du token |
| `logout` | POST | — | Invalide le token courant |

### `workouts.php`
| Action | Méthode | Description |
|---|---|---|
| `?list=1` | GET | Liste des séances de la biblio + Qojim |
| `?details=N` | GET | Détail d'une séance (avec exercices) |
| `?start` | POST | Démarre un workout (crée ligne completed_workouts) |
| `?add_set` | POST | Valide une série |
| `?finish` | POST | Termine un workout (set completed_at) |
| `?history=1&limit=10&offset=0` | GET | Historique paginé du user |
| `?stats[&exercise_id=N]` | GET | Stats agrégées (total/exo) |
| `?notes&id=N` | PUT | Modifie les notes d'un workout |
| `?id=N` | DELETE | Supprime un workout |

### `feed.php`
| Action | Méthode | Description |
|---|---|---|
| `?feed=1&limit=N&offset=N` | GET | Timeline des amis (et public) |
| `?workout_id=N` | GET | Détail d'un workout (séries + comments) |
| body `{action: 'like', workout_id: N}` | POST | Toggle like, envoie email |
| body `{action: 'comment', workout_id, comment, parent_comment_id?}` | POST | Ajoute commentaire ou réponse |
| `?comment_id=N` | DELETE | Supprime un commentaire (et ses réponses via cascade) |

Les actions `like` et `comment` envoient un **email** au propriétaire du
workout via `mail()` PHP natif (template HTML inline dans la fonction
`sendNotificationEmail`). Pour une réponse à un commentaire, l'auteur du
commentaire parent est aussi notifié.

### `friends.php` (et `friends2.php`)
| Action | Méthode | Description |
|---|---|---|
| `?search=...` | GET | Cherche des users par username |
| `?list=1` | GET | Liste des amis acceptés |
| `?pending_received=1` | GET | Demandes reçues à traiter |
| `?pending_sent=1` | GET | Demandes envoyées en attente |
| body `{action: 'send_request', friend_id}` | POST | Envoyer une demande |
| body `{action: 'accept', friendship_id}` | POST | Accepter |
| body `{action: 'decline', friendship_id}` | POST | Refuser/annuler |
| `?friendship_id=N` | DELETE | Retirer un ami |

### `nutrition.php`
| Action | Méthode | Description |
|---|---|---|
| `?action=library` | GET | Liste de la biblio de l'user |
| `?action=library` | POST | Crée un aliment |
| `?action=library&id=N` | PUT | Modifie un aliment |
| `?action=library&id=N` | DELETE | Supprime |
| `?action=entries&date=YYYY-MM-DD` | GET | Entrées d'un jour + agrégats |
| `?action=entries` | POST | Ajoute une consommation (`quantity_g` ou `quantity_units`) |
| `?action=entries&id=N` | PUT | Modifie quantité |
| `?action=entries&id=N` | DELETE | Supprime |

### `preferences.php`
| Méthode | Description |
|---|---|
| GET | Renvoie les préférences (privacy, kcal target, macros targets, pdp) |
| PUT | Met à jour partiellement (envoyer uniquement les champs à modifier) |

### `user_profile.php`
| Méthode + params | Description |
|---|---|
| `?user_id=N` | Profil public + stats + 20 premiers workouts si ami |
| `?user_id=N&history=1&limit=10&offset=20` | Page suivante de l'historique |

### `qojim_sessions.php`
| Action | Description |
|---|---|
| `?action=list` | Liste des séances officielles Qojim |
| `?action=add_to_library&session_id=N` | Ajoute à sa biblio |
| `?action=remove_from_library&session_id=N` | Retire |

### `share_sessions.php`
Partages de séances entre amis. Endpoints `incoming`, `outgoing`,
`accept`, `decline`, `send`.

### `monthly_reports.php`
Génère des rapports mensuels avec stats. Endpoints `list`, `get`,
`pending` (rapport non lu), `mark_as_viewed`.

### `admin.php`
Endpoints admin uniquement (vérification `is_admin = 1` au début).
Gestion users, types de séance, modération.

### `send_reminders.php`
**Pas un endpoint API** mais un script cron à appeler quotidiennement
pour envoyer des emails de rappel aux users inactifs. À configurer dans
le cron de l'hébergeur :

```
0 18 * * * curl https://qojim.com/qogym-api/send_reminders.php
```

## Configuration — `config.php`

Variables à adapter selon l'environnement :

```php
// Connexion BDD
$DB_HOST = 'localhost';
$DB_NAME = 'qojim_qogym';
$DB_USER = 'qojim_user';
$DB_PASS = '...';

// Constantes mail
const FROM_EMAIL = 'noreply@qojim.com';
const FROM_NAME  = 'QoGym';
```

## Sécurité

### Ce qui est en place
- Mots de passe hashés via `password_hash()` (bcrypt)
- Tokens d'auth en table avec expiration
- PDO en mode prepared statements partout (pas de SQL injection)
- `verifyAuth()` au début de chaque endpoint
- Vérifications d'ownership systématiques (ex: `WHERE id = ? AND user_id = ?`)

### Ce qui pourrait être amélioré
- `mail()` natif → délivrabilité moyenne (passer à PHPMailer + SMTP)
- Pas de rate limiting (un user peut spammer l'API)
- Pas de validation CSRF sur les requêtes (mais pas de cookies non plus,
  c'est du token Bearer donc moindre risque)
- `debug-auth.php` doit être supprimé en prod si pas déjà fait
- Les uploads PDP (avatars) ne sont pas dans le code fourni, à vérifier
  qu'ils valident bien le type de fichier (PHP injection via PNG falsifié)

## Migrations SQL

Quand tu modifies le schéma de BDD, garde un fichier `.sql` versionné
dans `sql/` du projet. Convention : nommer
`migration_<thématique>_<aaaammjj>.sql`.

Migrations existantes (incluses dans ce livrable) :
- `migration_nutrition_units.sql` — ajout colonnes unit_label/grams_per_unit
- `migration_macro_targets.sql` — ajout colonnes daily_*_target sur users
- `migration_comment_replies.sql` — ajout parent_comment_id

À jouer **avant** de déployer le code qui les utilise, sinon erreurs SQL.

## Déploiement backend

C'est juste un FTP de fichiers PHP, pas de build. Pour déployer :

1. Test localement avec un serveur PHP (`php -S localhost:8000` dans le
   dossier `qogym-api/`) si tu as PHP installé. Sinon test direct en prod
   avec un fichier en backup.
2. Upload les fichiers modifiés sur ton FTP à `qojim.com/qogym-api/`
3. Vide les caches OPcache si activés (généralement automatique avec un
   restart Apache, mais sur certains hébergements mutualisés tu n'as pas
   la main)
