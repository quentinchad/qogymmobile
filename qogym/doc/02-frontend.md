# QoGym — Frontend (site React)

> Projet `qogym/` — site web React qui sert d'UI. Hébergé sur qojim.com.

## Stack

- **React 18** (CRA — `react-scripts`)
- **react-router-dom v6**
- **axios** pour les appels API
- **recharts** pour les graphiques (page Profile)
- CSS classique, un fichier `.css` par page/composant
- **localStorage** pour persister token + état du workout en cours

## Structure de fichiers

```
qogym/
├── public/                      ← static assets (favicon, index.html, icônes)
├── src/
│   ├── App.js                   ← routing principal, providers
│   ├── App.css                  ← styles globaux (boutons, badges, cards…)
│   ├── index.js                 ← entry point React
│   ├── index.css                ← reset CSS + variables CSS globales
│   │
│   ├── pages/                   ← une page = une route
│   ├── components/              ← composants réutilisables
│   ├── contexts/                ← providers React Context
│   ├── hooks/                   ← hooks custom
│   ├── services/                ← appels API centralisés
│   └── styles/                  ← styles partagés (FriendsModal.css)
│
└── package.json                 ← deps frontend uniquement
```

## Routing — `App.js`

Trois "modes" coexistent :

1. **Carousel principal** (`SwipeShell`) — pages swipables horizontalement
   pour les utilisateurs connectés : Feed → Séances → Nutrition → Profile
2. **Routes classiques non-swipables** — Workout en cours, SessionDetail,
   Admin, ChangePassword, Qojim, Login/Register, etc.
3. **Routes publiques** — accessibles sans login : Feed (vue dégradée),
   Sessions, Nutrition (vue dégradée invitant à se connecter)

Le choix entre carousel et route classique se fait dans `AppShell` selon
qu'un `user` est présent. Sans user → toutes les routes sont classiques
(pas de carousel).

## Pages — détail

| Fichier | Route | Description |
|---|---|---|
| `Feed.js` | `/feed` | Timeline des workouts publics des amis. Like, commentaires + réponses (1 niveau de profondeur), modale détail. Bannière report mensuel + pastille notif amis. |
| `Sessions.js` | `/sessions` | Bibliothèque de séances de l'utilisateur (créées + ajoutées depuis Qojim ou partagées). Bouton "Lancer", bouton "Découvrir Qojim". Modales partage + retraits. |
| `QojimSessions.js` | `/qojim` | Catalogue des séances officielles "Qojim". Bouton retour vers Séances. Pas dans le carousel pour alléger la nav. |
| `CreateSession.js` | `/create-session` | Formulaire de création/édition d'une séance avec ses exercices. Admin peut cocher "Qojim". |
| `SessionDetail.js` | `/session/:id` | Détail d'une séance avant de la lancer (liste exercices, durée estimée, bouton "Démarrer"). |
| `Workout.js` | `/workout` | **Page critique** — workout en cours avec validation des séries, countdown de repos, persistance via `ActiveWorkoutContext`. |
| `Profile.js` | `/profile` | Profil propre : avatar, stats, historique paginé (10 par page), graphique récents, objectifs nutrition (kcal + macros), modifier privacy/PDP, déconnexion. |
| `UserProfile.js` | `/user/:id` | Profil d'un autre utilisateur. Stats publiques, historique si ami, gestion demande d'amitié. |
| `Nutrition.js` | `/nutrition` | Journal calorique avec anneau de progression kcal + barres macros (4 cibles individuelles configurables). Saisie via bibliothèque ou ad-hoc. Vue dégradée pour visiteurs non-connectés. |
| `Admin.js` | `/admin` | Espace admin : gestion users, créer types de séance. |
| `MonthlyReport.js` | `/monthly-report/:year/:month` | Rapport mensuel généré côté serveur (stats sur 30j). Marqué comme vu au chargement. |
| `Login.js` / `Register.js` | `/login` / `/register` | Auth. Inclut `<AndroidAppLink />` pour proposer le téléchargement APK. |
| `ForgotPassword.js` / `ResetPassword.js` | | Reset de mot de passe par email. |
| `ChangePassword.js` | `/change-password` | Modifier mot de passe une fois loggé. |

## Composants — détail

### Layout & navigation
- **`SwipeShell.js`** — carousel horizontal swipable. Reçoit `mainSlides`
  et les rend dans des `<div>` côte à côte ; les swipes appellent
  `navigate()` pour synchroniser l'URL.
- **`SwipeContainer.js`** — primitive de swipe (touch events, threshold,
  animation) — utilisée par SwipeShell.
- **`BottomNav.js`** — barre de nav du bas, items : Feed, Séances,
  Nutrition, Profile (+ Admin si admin). Qojim a été retiré.
- **`PagePreview.js`** — composant unique pour précharger les pages du
  carousel (sinon swipe = écran blanc).

### Modales
- **`WorkoutDetailModal.js`** — détail d'un workout (séries, like,
  commentaires + réponses, édition de notes pour le proprio).
  Utilisée dans Feed, Profile, UserProfile.
- **`FriendsModal.js`** — gestion des amis (recherche, demandes
  reçues/envoyées, liste d'amis, suppression).
- **`FoodLibraryModal.js`** — gestion bibliothèque d'aliments. Mode
  `manage` (CRUD) ou `picker` (sélectionner pour le journal). Supporte
  aliments à l'unité (1 pomme = 180g).
- **`ConfirmModal.js`** — boîte de dialogue de confirmation, exposée via
  `useConfirm()` hook (provider dans App.js).
- **`ShareSessionModal.js`** — partager une séance à un ami.
- **`Toast.js`** — système de toasts (success, error, info), exposé via
  `useToast()` hook.

### Workout
- **`MiniWorkout.js`** — bandeau persistant en bas d'écran quand un
  workout est en cours mais qu'on a navigué ailleurs. Affiche timer,
  permet de revenir à `/workout`.
- **`RestTimePicker.js`** — wheel picker pour choisir un temps de repos.

### Mises à jour APK
- **`UpdateBanner.js`** — affichage conditionnel selon User-Agent et
  variable native injectée. Mode `native` (auto-install) ou `legacy`
  (téléchargement manuel).
- **`AndroidAppLink.js`** — lien de téléchargement de l'APK affiché sur
  les pages Login, Register, Profile (uniquement sur Android navigateur).

## Contexts

### `ActiveWorkoutContext.js`
État global du workout en cours, **persisté en localStorage** sous la
clé `qogym-active-workout`. Le state contient :
- `sessionId` — id de la séance en cours
- `completedWorkoutId` — id de la ligne en BDD
- `startedAt` — timestamp de démarrage (pour calculer la durée)
- `validatedSets` — Map des séries validées
- `restOverrides` — temps de repos custom par exercice
- `countdownEndAt` / `countdownDuration` — countdown actif

Les fonctions exposées : `start`, `ensureSessionLoaded`, `validateSet`,
`startCountdown`, `dismissCountdown`, `finish`, `reset`. **Toute** la
logique du workout passe par ce context — la page Workout n'est qu'une
vue, le state vit ailleurs pour pouvoir survivre à un changement de page.

## Hooks

### `useRefreshOnFocus.js`
Hook qui exécute un callback à chaque retour sur une route donnée. Utile
pour rafraîchir les données quand on revient sur Feed, Nutrition, etc.
Détection via React Router `useLocation` + comparaison du pathname.

```js
useRefreshOnFocus('/nutrition', () => {
  loadDay();
  loadTargets();
});
```

## Services API — `src/services/api.js`

Toutes les fonctions d'appel API sont là. Organisées par domaine :

- `authService` — login, register, getMe, logout, password reset
- `workoutService` — sessions, exercises, completed_workouts, getStats,
  getHistory(limit, offset)
- `feedService` — getFeed, getWorkoutDetail, like, addComment, deleteComment
- `friendsService` — search, list, pending_received/sent, sendRequest,
  accept, decline, removeFriend
- `qojimService` — getAll, addToLibrary, removeFromLibrary
- `userProfileService` — getProfile(userId), getMoreHistory(userId, limit, offset)
- `monthlyReportService` — getList, getReport, getPending, markAsViewed
- `preferencesService` — getPreferences, updatePreferences
- `nutritionService` — getLibrary, createLibraryItem, updateLibraryItem,
  deleteLibraryItem, getEntries(date), createEntry, updateEntryQuantity,
  deleteEntry
- `shareSessionService` — sendShare, listIncoming, listOutgoing,
  acceptShare, declineShare

L'instance `axios` configurée :
- `baseURL = 'https://qojim.com/qogym-api'`
- Intercepteur request : ajoute `Authorization: Bearer <token>` si
  présent en localStorage
- Intercepteur response : si 401, vide localStorage et redirige `/login`

## Scripts npm

```bash
npm install      # première fois ou après modif package.json
npm start        # dev server (http://localhost:3000)
npm run build    # build prod → dossier build/
```

Pour déployer : copier le contenu de `build/` (généré par `npm run build`)
sur ton FTP à la racine de qojim.com (écrase `index.html`, `static/`,
`asset-manifest.json`).

## Variables CSS importantes

Définies dans `index.css` :
- `--success-color` — vert principal (#2ecc71)
- `--bg-color` — fond sombre principal
- `--text-primary` / `--text-secondary` — couleurs texte
- `--border-color` — bordures subtiles

Les nouveaux composants doivent utiliser ces variables pour rester
cohérents avec le thème.
