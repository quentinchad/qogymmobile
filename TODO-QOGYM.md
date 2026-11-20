# QoGym — Ce qu'il reste à faire (reprise de travail)

> Document de reprise, pour continuer le travail (avec Claude ou non) sur un autre ordinateur.
> **À lire en entier avant de toucher au code.** Dernière mise à jour : 20/11/2026.

---

## 0. Règles à respecter absolument

1. **Ne jamais toucher à la base de données de prod.**
   - Les utilisateurs doivent garder leurs entraînements et toutes leurs données.
   - Une migration SQL ne fait que **des ajouts** : nouvelles tables, ou colonnes facultatives.
   - Les migrations sont exécutées **par le propriétaire** dans phpMyAdmin, jamais par un script automatique.
2. **Ne rien pousser sur GitHub sans confirmation explicite** du propriétaire.
3. **Pas de build d'APK sans demande explicite.**
4. **Les endpoints existants doivent garder exactement la même réponse.**
   - L'appli Android déjà installée en dépend, et sa mise à jour est **facultative** : de vieilles versions restent en circulation des mois.
   - Toute nouveauté passe par un **paramètre opt-in** (ex. `include_external=1`), un nouveau fichier ou une nouvelle action.
5. **`qogym/qogym-api/config.php` contient les identifiants de prod.**
   - Il est dans le `.gitignore` : ne jamais le committer, ne jamais afficher son contenu.
   - Le modèle est `config.example.php`.
6. **`qogym/sql/import_poids_user1_20261120.sql`** contient des données personnelles. Il n'est pas commité, volontairement.

---

## 1. Le projet en bref

| Dossier | Quoi | Déploiement |
|---|---|---|
| `qogym/` | Site web React (qojim.com) | `npm ci && npm run build`, puis FTP du dossier `build/` |
| `qogym/qogym-api/` | API PHP 8 + PDO MySQL (`https://qojim.com/qogym-api/`) | FTP des fichiers PHP modifiés |
| `qogym/sql/` | Migrations SQL (ajouts uniquement) | Exécutées à la main dans phpMyAdmin, **avant** le PHP qui en dépend |
| `qogym-mobile/` | Appli Android native (Expo SDK 58 / React Native, Expo Router) | Build EAS → APK → FTP (voir §6) |
| `deploy/` | `qogym.apk` + `version.json` (mise à jour proposée dans l'appli) | FTP à la racine de qojim.com |
| `qogym/tests/recomp/` | Tests de bout en bout de la liaison Recomp (base locale jetable + faux Recomp) | — |

- **Repo :** `github.com/quentinchad/qogymmobile` (branche `main`).
- **Ancien dossier :** `C:\Users\qchirat\cb\godzilla\qogym\qogymappli` est obsolète, ne plus travailler dedans.

**Documents pour le développeur de Recomp** (l'appli partenaire) :
- `QOGYM-GUIDE-INTEGRATION.md` : comment fonctionne l'API QoGym ;
- `RECOMP-FEED-SOLUTION.md` : le contrat entre les deux applis (fil fusionné, tokens partenaire, réactions).

---

## 2. Contexte : la liaison avec Recomp

Recomp est une appli de musculation faite par un collègue. Il garde sa propre table d'utilisateurs,
mais **relie** chaque compte Recomp à un compte QoGym. L'id QoGym sert d'identifiant commun.

- **Amis :** une seule liste, celle de QoGym (`qogym_friendships`). Recomp la gère via `friends.php`.
- **Tokens :** Recomp se connecte au nom de l'utilisateur avec `login` + `app: "recomp"`. Il reçoit un
  **token partenaire limité** (90 jours, accès restreint, révocable).
- **Séances :**
  - chaque appli garde les siennes ;
  - QoGym appelle l'API de Recomp de serveur à serveur, avec une clé partagée, pour afficher les séances Recomp des amis ;
  - Recomp lit les séances QoGym via `feed.php` et `user_profile.php`.
- **Confidentialité :** `qogym_users.default_workout_privacy` vaut `public` (visible par les amis) ou `private` (visible par soi seul). La règle s'applique partout.

---

## 3. Ce qui est FAIT (commit `dddc95d`, pas encore poussé à la date de rédaction)

### Backend (`qogym/qogym-api/`)

| Fichier | Contenu |
|---|---|
| `partner_tokens.php` (nouveau) | Tokens partenaire : liste blanche des endpoints autorisés, durée de 90 jours, `PARTNER_APPS = ['recomp' => 'Recomp']` |
| `config.php` / `config.example.php` | `require_once partner_tokens.php`, et `enforceTokenScope()` appelé à la fin de `verifyAuth()` (sans effet pour un token normal) |
| `auth.php` | `login` avec `app` facultatif → token limité + email « compte relié » ; `GET ?partners=1` ; action `revoke_partner` ; `GET` renvoie `token_scope` pour un token partenaire |
| `partner_external.php` (nouveau) | Appels à Recomp : appel groupé, timeout 1 s / 2 s, cache fichier de 2 min, filtrage, conversion au format QoGym, droits de lecture |
| `feed.php` | Branches **opt-in** ajoutées **avant** le code existant : `?feed=1&include_external=1` (fil fusionné, curseur `before` / `next_before`) ; `?workout_id=recomp:…&owner_id=N` (détail) ; `like` / `comment` avec `workout_id: "recomp:…"` + `owner_id` ; `DELETE ?comment_id=ext:N` |
| `user_profile.php` | **Correction :** un ami en `private` ne montre plus son historique (`history_private: true`). Mode `include_external=1` sur la page initiale et sur `&history=1` (curseur `before`) |

### Migrations (`qogym/sql/`)
- `migration_partner_tokens_20261120.sql` : colonne `scope` (NULL par défaut) dans `qogym_auth_tokens`. **Déjà exécutée en prod** d'après le propriétaire. À vérifier avec le §4.1.
- `migration_external_reactions_20261120.sql` : tables `qogym_external_likes` et `qogym_external_comments`. **Pas encore exécutée.**

### Ce qui a été vérifié
- 56 tests de bout en bout sur une base locale jetable + faux Recomp (§7) : tous OK.
- Réponses des endpoints classiques comparées avec l'ancienne version : identiques. Seule différence voulue : le champ `history_private` en plus dans `user_profile.php`.
- **Pas testé :** sur le serveur OVH, ni avec le vrai Recomp.

### Activation
La liaison est **désactivée** tant que `config.php` (prod) ne contient pas ces deux lignes :
```php
define('RECOMP_API_URL', 'https://…/api/partner/workouts');
define('RECOMP_PARTNER_KEY', '…');
```
Tant qu'elle est désactivée, `include_external=1` renvoie les seules séances QoGym avec `external_status: "disabled"`.

---

## 4. À FAIRE — Déploiement du backend déjà écrit

### 4.1 Vérifier les tokens partenaire (déjà déployés selon le propriétaire)
- [ ] phpMyAdmin : `qogym_auth_tokens` a bien une colonne `scope`.
- [ ] Login partenaire avec un **compte de test**. On doit obtenir `"token_scope":"partner:recomp"` :
  ```bash
  curl -s -X POST https://qojim.com/qogym-api/auth.php -H "Content-Type: application/json" -d '{"action":"login","email":"EMAIL_TEST","password":"MDP_TEST","app":"recomp"}'
  ```
- [ ] `friends.php?list=1` avec ce token → OK ; `workouts.php?history=1` → `PARTNER_SCOPE` (403).
- [ ] Puis `logout` avec ce token pour le supprimer.

### 4.2 Déployer la fusion et les réactions
1. [ ] phpMyAdmin : exécuter `qogym/sql/migration_external_reactions_20261120.sql`.
2. [ ] FTP dans `qogym-api/` : `partner_external.php` **d'abord**, puis `feed.php` et `user_profile.php`.
3. [ ] Vérifier sur le site et dans l'appli que le fil, le détail d'une séance, un like, un commentaire et un profil d'ami marchent comme avant.
4. [ ] Vérifier qu'un ami en `private` n'affiche plus son historique.

### 4.3 Pousser sur GitHub
- [ ] **Seulement après accord du propriétaire :** `git push origin main`.

---

## 5. À FAIRE — Activation avec Recomp (dépend du collègue)

Ce qu'attend QoGym de son côté (détails dans `RECOMP-FEED-SOLUTION.md`, §5) :
- [ ] Endpoint groupé : `GET …/api/partner/workouts?user_ids=1,2,3&limit=20&before=…` (et `?user_id=N&id=recomp:…` pour le détail).
- [ ] Login avec `app: "recomp"`, et remplacement des tokens complets déjà stockés.
- [ ] `owner_id` pour le détail, le like et le commentaire ; ids de commentaire `ext:N`.

Ensuite, côté QoGym :
- [ ] Échanger hors Git l'URL de prod et la clé partagée (≥ 32 caractères aléatoires).
- [ ] Ajouter les 2 lignes `RECOMP_API_URL` / `RECOMP_PARTNER_KEY` dans le `config.php` **de prod** (pas dans Git).
- [ ] Test réel avec deux comptes de test (un QoGym relié à un Recomp, amis entre eux) :
  - [ ] `feed.php?feed=1&include_external=1` contient les séances Recomp, avec `external_status: "ok"` ;
  - [ ] détail, like et commentaire sur une séance Recomp ;
  - [ ] passer le compte en `private` → plus rien n'est visible pour l'ami.

---

## 6. À FAIRE — Appli Android QoGym (nouvelle APK)

But : afficher les séances Recomp dans l'appli. **À faire quand la liaison est validée en réel**
(§5), ou avant si on garde l'affichage inactif tant que `external_status` vaut `"disabled"`.

> **FAIT dans l'APK 2.1.0 (versionCode 15)**, en même temps que la carte « Poids » du profil
> (`components/WeightCard.tsx`, API `weight.php`) et l'annonce du partenariat affichée une fois
> (`components/Partner.tsx`, clé `qg_announce_recomp_v1`). L'appli envoie toujours
> `include_external=1` et s'adapte au backend : curseur `next_before` si la réponse contient
> `external_status`, sinon pagination par `offset` comme avant. Elle marche donc avant et après le
> déploiement du §4.2. Reste à tester avec de vraies séances Recomp (§5).
> L'historique de son propre profil passe maintenant par `user_profile.php?history=1` (au lieu de `workouts.php?history=1`).

### Fichiers concernés (`qogym-mobile/src/`)

| Fichier | Changement |
|---|---|
| `lib/api.ts` | `feedApi.feed` : ajouter `include_external=1` et paginer par `before` (`next_before`) au lieu de `offset`. `detail`, `toggleLike` et `comment` : accepter `workoutId: number \| string` et envoyer `owner_id` quand l'id commence par `recomp:`. `deleteComment` : accepter `number \| string` (`ext:N`). `profile` / `history` : `include_external=1` + `before` |
| `screens/FeedScreen.tsx` | Pagination par `next_before` ; badge « Recomp » si `source === 'recomp'` ; navigation vers le détail avec l'id texte **et** `owner_id` (= `user_id` de l'élément) |
| `app/workout-detail/[id].tsx` | Ligne `feedApi.detail(Number(id))` : **ne plus convertir en nombre** si l'id commence par `recomp:` ; lire `owner_id` dans les paramètres de route ; masquer « Refaire cette séance » et « Enregistrer dans ma bibliothèque » (`cloneFromWorkout`) pour une séance Recomp ; afficher les champs en plus des séries (`type: warmup`…, `bodyweight`, `rpe`) si utile |
| `app/user/[id].tsx` | Historique : `include_external=1`, pagination `before`, badge, message si `history_private` |
| `screens/ProfileScreen.tsx` | Son propre historique : mêmes changements ; ajouter « Applis reliées » (`GET auth.php?partners=1`) avec un bouton « Délier » (`POST auth.php {action:'revoke_partner', app}`) |

Points d'attention :
- **Les ids peuvent être des chaînes.** Chercher tous les `Number(`, `parseInt(` et les types `number` sur les ids d'entraînement ou de commentaire.
- **Images :** une séance Recomp a `session_image: null`. Il faut une image par défaut.
- Ne rien changer au comportement pour les séances QoGym.

### Vérification et build
```bash
cd qogym-mobile
npx tsc --noEmit
npx expo-doctor
```
- [ ] Monter `version` (ex. 2.1.0) **et** `android.versionCode` (14) dans `app.json`.
- [ ] Build (**seulement si demandé**), avec le même compte Expo `qojim` et la même clé de signature :
  ```bash
  EAS_NO_VCS=1 npx eas-cli@latest build -p android --profile preview --non-interactive
  ```
- [ ] Télécharger l'APK → `deploy/qogym.apk`. Mettre à jour `deploy/version.json` (`latestVersionCode`, `latestVersion`, `releaseNotes`). Laisser `minRequiredVersionCode` à 1 pour que la mise à jour reste facultative.
- [ ] FTP : `qogym.apk` **puis** `version.json` à la racine de qojim.com.

Plus de détails dans `qogym-mobile/README.md`.

---

## 7. Tester le backend en local (sans jamais toucher la prod)

Prérequis : XAMPP (PHP 8 avec `curl` et `pdo_mysql`, MariaDB). Toutes les commandes sont lancées depuis `qogym/tests/recomp/`.

1. **Base MariaDB jetable** sur le port 3399, dans un dossier temporaire :
   ```bash
   C:/xampp/mysql/bin/mysql_install_db.exe --datadir=C:/temp/qogym_testdb --port=3399
   C:/xampp/mysql/bin/mysqld.exe --defaults-file=C:/temp/qogym_testdb/my.ini --console
   ```
2. **Schéma de test**, puis la migration des tokens. Ne pas jouer la migration des réactions : le test le fait lui-même.
   ```bash
   C:/xampp/mysql/bin/mysql.exe -h127.0.0.1 -P3399 -uroot < schema_test.sql
   C:/xampp/mysql/bin/mysql.exe -h127.0.0.1 -P3399 -uroot qogym_test < ../../sql/migration_partner_tokens_20261120.sql
   ```
3. **Copie isolée de l'API.** Le vrai `config.php` n'est jamais copié.
   ```bash
   php make_test_api.php C:/temp/qogym_test_api
   ```
4. **Les deux serveurs**, dans deux terminaux :
   ```bash
   php -S 127.0.0.1:8792 fake_recomp/router.php
   php -d extension=pdo_mysql -d extension=curl -S 127.0.0.1:8793 -t C:/temp/qogym_test_api
   ```
5. **Lancer les tests** (attendu : `TOUT OK (56 tests)`) :
   ```bash
   php run_tests.php
   ```
6. **Pour relancer**, refaire les étapes 2 et 5.

Pièges :
- Sans `-d extension=pdo_mysql`, toutes les requêtes échouent avec « Erreur de connexion ».
- En PHP 8.5, tout avertissement (`Deprecated`) affiché casse le JSON. Ne pas utiliser `curl_close()`.

---

## 8. À FAIRE — Plus tard / à décider avec le collègue

- [ ] **Site qojim.com** (`qogym/src/services/api.js`, `pages/Feed.js`, `pages/UserProfile.js`, `components/WorkoutDetailModal.js`, `components/WorkoutLaunchActions.js`) : mêmes changements que l'appli (§6), si on veut voir les séances Recomp sur le site. Sinon, rien à faire : il continue de n'afficher que QoGym.
- [ ] **Images Recomp → QoGym :** Recomp pourrait ajouter un champ `image_url` (séance) et/ou `avatar_url` (compte) ; QoGym les utiliserait quand il n'a rien.
- [ ] **Suppression de compte :** aucun endpoint aujourd'hui. Décider ce qui se passe des deux côtés. `owner_id` et `user_id` dans les tables `qogym_external_*` permettent de nettoyer.
- [ ] **Emails d'inscription « à la marque » de l'appli partenaire :** possible sur le modèle du paramètre `app`.
- [ ] **Token invalide → 500 au lieu de 401** sur la plupart des fichiers (exception non interceptée dans `verifyAuth`). Facultatif. Si on corrige, vérifier que l'appli et le site gèrent bien un 401.
- [ ] **Ancienne doc** `qogym/doc/` : contient des erreurs (durée du token, noms d'actions…). Se fier au code et à `QOGYM-GUIDE-INTEGRATION.md`.

---

## 9. Pour Claude : comment reprendre

- Lire ce fichier, puis `RECOMP-FEED-SOLUTION.md` et `QOGYM-GUIDE-INTEGRATION.md`.
- Vérifier l'état avec `git log --oneline -5` et `git status` : le commit `dddc95d` doit être présent, éventuellement déjà poussé.
- Demander au propriétaire ce qui est **déjà déployé** (§4) avant de proposer quoi que ce soit.
- Suivre les règles du §0, en particulier : aucune requête vers la base de prod, aucun push et aucun build sans accord, et des réponses d'endpoints existants inchangées.
- Pour tester une modification du backend : la procédure du §7, puis comparer les réponses avant et après sur les requêtes classiques.
