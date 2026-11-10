# QoGym — Architecture générale

> Vue d'ensemble de comment toutes les briques s'imbriquent. Lis-moi en premier
> pour comprendre où chaque chose vit avant d'aller dans le détail.

## Les trois projets

QoGym est composé de **trois projets indépendants** mais qui travaillent
ensemble :

```
┌─────────────────────────────────────────────────────────────────┐
│                     Utilisateur final                            │
└─────────────────────────────────────────────────────────────────┘
              │                      │                       │
       ┌──────▼──────┐        ┌──────▼──────┐         ┌──────▼──────┐
       │  Navigateur │        │  APK (RN)   │         │  Navigateur │
       │  (desktop)  │        │  Android    │         │  (mobile)   │
       └──────┬──────┘        └──────┬──────┘         └──────┬──────┘
              │                      │ WebView               │
              └──────────┬───────────┴───────────────────────┘
                         │
                         ▼
              ┌────────────────────────┐
              │  Site web React        │   ← projet "qogym"
              │  https://qojim.com     │     (frontend)
              └──────────┬─────────────┘
                         │ API REST (JSON)
                         ▼
              ┌────────────────────────┐
              │  Backend PHP           │   ← projet "qogym-api"
              │  https://qojim.com/    │     (backend)
              │  qogym-api/*.php       │
              └──────────┬─────────────┘
                         │ PDO MySQL
                         ▼
              ┌────────────────────────┐
              │  MySQL                 │
              │  Tables qogym_*        │
              └────────────────────────┘
```

| Projet | Stack | Hébergement | Rôle |
|---|---|---|---|
| **qogym** (site web React) | React + React Router + Recharts | qojim.com (FTP) | UI utilisateur, toute la logique métier côté client |
| **qogym-api** (backend) | PHP 8 + PDO MySQL | qojim.com/qogym-api/ (FTP) | API REST stateless, accès BDD, envoi emails |
| **qogym-app** (APK) | React Native + Expo + WebView | EAS Build → qogym.apk | Coque mobile qui charge qojim.com en WebView |

**Idée clé** : l'APK n'est qu'une fenêtre vers le site web. Toutes les
modifs du frontend sont visibles **automatiquement** dans l'APK sans avoir
à le rebuilder. On ne rebuild l'APK que si on touche à la coque elle-même
(icône, version, comportement natif comme le bouton retour ou l'auto-update).

## Flux utilisateur typique : un workout terminé

1. **APK** ouvre `https://qojim.com` dans sa WebView, avec injection de
   `window.QOGYM_IS_NATIVE_APP = true` et `window.QOGYM_APP_VERSION_CODE`
2. **Site web** détecte qu'il y a un `userToken` en localStorage → loggé
3. L'utilisateur navigue dans `Sessions`, choisit une séance, lance un
   workout qui appelle `workoutService.startWorkout()` → `POST /workouts.php?action=start`
4. **Backend** crée une ligne dans `qogym_completed_workouts` (sans
   `completed_at`)
5. L'utilisateur valide ses séries → `POST /workouts.php?action=add_set`
   qui insère dans `qogym_completed_sets`
6. À la fin → `POST /workouts.php?action=finish` qui set `completed_at`
7. Si la séance est publique, le feed des amis voit l'entraînement via
   `feed.php` (utilise `qogym_friendships` pour filtrer)
8. Un ami like/commente → `feed.php` envoie un email au propriétaire via
   `mail()` PHP natif

## Authentification

- Stateless via **token** dans le header `Authorization: Bearer <token>`
- Tokens stockés en BDD (`qogym_auth_tokens`) avec `expires_at`
- Côté frontend, le token est en `localStorage` (clé `userToken`)
- L'intercepteur Axios (`src/services/api.js`) ajoute le header à toutes
  les requêtes ; si une réponse 401 arrive, il vide le storage et
  redirige vers `/login`

## Conventions importantes

- **Toutes les tables BDD** sont préfixées `qogym_` (un seul projet
  partage la base avec d'autres apps potentielles)
- **Toutes les routes API** sont des fichiers PHP individuels avec un
  paramètre `action=...` en query string ou dans le body JSON. Pas de
  framework, juste du PHP nu + PDO. Voir `04-backend.md` pour le détail.
- **Tous les composants React** utilisent du CSS classique (pas de
  Tailwind ni styled-components) — un fichier `.css` à côté du `.js`
- **Formatage UTF-8** partout, dates au format MySQL `YYYY-MM-DD HH:MM:SS`
  côté serveur, ISO côté client

## Fichiers clés à connaître

| Fichier | Pourquoi il est important |
|---|---|
| `qogym-api/config.php` | Connexion BDD, fonction `verifyAuth()`, `jsonResponse()`, helpers communs |
| `qogym-api/feed.php` | Le plus gros fichier, gère like/comment/feed avec emails |
| `src/App.js` | Routing, montage des contexts (Toast, Confirm, ActiveWorkout), choix carousel vs route classique selon login |
| `src/services/api.js` | Tous les appels API centralisés, intercepteurs Axios |
| `src/contexts/ActiveWorkoutContext.js` | État global du workout en cours, persisté en localStorage |
| `src/components/SwipeShell.js` | Le carousel horizontal Feed↔Sessions↔Nutrition↔Profile |
| `qogym-app/App.tsx` | La coque mobile, gère retour matériel + auto-update APK |

## Pour la suite

- **`02-frontend.md`** — détail des pages, composants, contexts, routing
- **`03-backend.md`** — endpoints API, authentification, BDD
- **`04-mobile-rebuild.md`** — comment rebuilder l'APK et publier une MAJ
