# QoGym — Documentation

Bienvenue. Cette documentation couvre l'ensemble du projet QoGym.

## Sommaire

| Doc | Quand la lire |
|---|---|
| **[01-architecture.md](./01-architecture.md)** | À lire en premier. Vue d'ensemble : les 3 projets, comment ils communiquent, conventions générales. |
| **[02-frontend.md](./02-frontend.md)** | Quand tu veux modifier le site web React (qogym/). Pages, composants, routing, services API, contexts. |
| **[03-backend.md](./03-backend.md)** | Quand tu veux modifier l'API PHP ou la BDD. Endpoints, schéma BDD, sécurité, migrations. |
| **[04-mobile-rebuild.md](./04-mobile-rebuild.md)** | Quand tu veux toucher à l'APK Android : icône, comportement natif, ou publier une nouvelle version. Workflow EAS Build. |

## Tu veux faire quoi exactement ?

### Modifier l'apparence ou une fonctionnalité du site
→ **[02-frontend.md](./02-frontend.md)** + déployer via `npm run build` + FTP

### Ajouter un endpoint API ou modifier la BDD
→ **[03-backend.md](./03-backend.md)** + upload PHP + jouer la migration SQL

### Changer l'icône de l'app Android
→ **[04-mobile-rebuild.md](./04-mobile-rebuild.md)** — section "Workflow de release APK"

### Publier une nouvelle version de l'APK
→ **[04-mobile-rebuild.md](./04-mobile-rebuild.md)** — section "Workflow de release APK"

### Comprendre où une donnée est stockée
→ **[03-backend.md](./03-backend.md)** — section "Base de données — schéma"

### Comprendre le système d'auto-update de l'APK
→ **[04-mobile-rebuild.md](./04-mobile-rebuild.md)** — section "Comprendre le système d'auto-update"

## Stack technique en bref

| Couche | Technos |
|---|---|
| Frontend | React 18, React Router v6, Axios, Recharts |
| Backend | PHP 8, MySQL via PDO, mail() natif |
| Mobile | React Native 0.79, Expo SDK 53, react-native-webview |
| Build mobile | EAS Build (cloud Expo) |
| Hébergement | FTP qojim.com (frontend + backend + APK) |

## URLs en prod

| URL | Quoi |
|---|---|
| `https://qojim.com/` | Site web React (qogym/) |
| `https://qojim.com/qogym-api/*.php` | API PHP (qogym-api/) |
| `https://qojim.com/qogym.apk` | APK Android |
| `https://qojim.com/version.json` | Métadonnées de version (auto-update) |
| `https://qojim.com/icones/` | Icônes de la nav et des séances |
| `https://qojim.com/imgseances/` | Images des séances |
| `https://qojim.com/pdp/` | Avatars des utilisateurs |

## Comptes / accès importants

À avoir sous la main :
- **FTP qojim.com** — pour déployer
- **MySQL qojim.com** — pour les migrations SQL et debug
- **Compte EAS / Expo** (`expo.dev`) — pour les builds APK
- **Compte email** lié aux mails `mail()` — vérifier les bounces si
  délivrabilité décroît

## Conventions de nommage

- Tables BDD : préfixées `qogym_` (snake_case)
- Composants React : PascalCase (`UpdateBanner.js`)
- Hooks React : camelCase préfixé `use` (`useRefreshOnFocus.js`)
- Services API : camelCase suffixé `Service` (`feedService`)
- Fichiers PHP : snake_case ou kebab-case (`user_profile.php`,
  `share_sessions.php`)
- Migrations SQL : `migration_<thématique>.sql`
