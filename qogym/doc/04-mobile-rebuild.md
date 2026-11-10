# QoGym — Mobile (APK Android) & workflow de release

> Projet `qogym-app/` — coque React Native qui charge qojim.com en
> WebView. Build via EAS (cloud) → fichier `.apk` à uploader sur le FTP.

## Stack

- **React Native 0.79** + **Expo SDK 53**
- **expo-application** — récupérer la version installée
- **expo-file-system** — télécharger l'APK pour MAJ
- **expo-intent-launcher** — déclencher l'écran d'install Android
- **react-native-webview** — WebView qui charge qojim.com
- **expo-splash-screen** — écran de démarrage

## Quand rebuilder l'APK ?

**Pas besoin** de rebuilder si tu modifies :
- N'importe quoi côté **site web** (React, CSS, pages, composants…)
- Le **backend PHP** ou la **BDD**

→ Tes utilisateurs verront les changements **automatiquement** au prochain
lancement de l'app, parce que la WebView recharge `qojim.com`.

**Il faut rebuilder** si tu modifies :
- L'**icône** de l'app (`assets/icon.png`, `assets/adaptive-icon.png`)
- Le **nom** de l'app (`name` dans `app.json`)
- La **version** affichée dans Android Settings (`version` + `versionCode`)
- Le code natif dans **`App.tsx`** (BackHandler, auto-update, injection JS…)
- Les **permissions** Android (`permissions` dans `app.json`)
- Une **dépendance native** (ajout d'une lib Expo, etc.)

## Structure du projet APK

```
qogym-app/
├── App.tsx                   ← composant racine (WebView + BackHandler + auto-update)
├── app.json                  ← config Expo (nom, icône, version, permissions)
├── eas.json                  ← config EAS Build (profils preview/production)
├── package.json              ← dépendances
├── tsconfig.json             ← config TypeScript
├── assets/
│   ├── icon.png              ← icône classique 1024×1024
│   ├── adaptive-icon.png     ← icône adaptative Android (logo bien centré)
│   ├── splash.png            ← écran de démarrage (optionnel)
│   └── favicon.png           ← favicon web (optionnel)
└── node_modules/             ← installé par npm install (pas commit)
```

## Première installation des outils (une seule fois)

Tu n'as besoin que de **Node.js** et la CLI EAS. Pas d'Android SDK ni
d'Android Studio (le build est fait sur les serveurs Expo).

```bash
# Vérifier Node.js
node --version          # ≥ 18

# Installer la CLI EAS globalement
npm install -g eas-cli

# Se connecter à son compte Expo (compte gratuit sur expo.dev)
eas login
```

## Workflow de release APK — étape par étape

Imaginons que tu veuilles publier une nouvelle version de l'APK.

### Étape 1 — Modifier ce qu'il faut

Selon ce que tu changes, modifie `App.tsx`, l'icône, ou les fichiers de
config.

### Étape 2 — Bumper la version dans `app.json`

**Obligatoire** pour qu'Android accepte d'installer la nouvelle version
par-dessus l'ancienne (sinon il dit "déjà installée").

Ouvre `app.json` et incrémente :

```json
{
  "expo": {
    "version": "1.0.4",                ← version lisible (montée à chaque release)
    "android": {
      "versionCode": 5                  ← entier obligatoirement croissant
    }
  }
}
```

**Règle** : `versionCode` est un entier qui ne peut **que** monter. Si tu
descends, Android refuse l'install par-dessus.

### Étape 3 — Lancer le build cloud

Dans le terminal, dans le dossier `qogym-app/` :

```bash
eas build --platform android --profile preview
```

Plusieurs choses peuvent te demander confirmation :
- **"Existing EAS project found?"** → Yes (réutilise ton projet)
- **"Generate a new Android Keystore?"** → Yes la 1re fois, puis EAS le
  réutilise automatiquement (n'apparaît plus aux builds suivants)
- **"Update versionCode automatically?"** → comme tu veux. Si tu l'as déjà
  bumpé manuellement à l'étape 2, tu peux dire No. Sinon Yes et EAS s'en
  charge.

Le build se lance sur les serveurs d'Expo. Tu verras un lien comme
`https://expo.dev/accounts/qojim/projects/qogym/builds/xxxxx`. Tu peux le
suivre dans le navigateur, ça affiche les logs en temps réel.

**Durée typique : 10-15 min**. Tu peux fermer le terminal entre temps.

### Étape 4 — Récupérer l'APK

Quand le build affiche **"Finished"** sur expo.dev, tu vois un bouton
**"Download"**. Télécharge le fichier `.apk`.

### Étape 5 — Renommer + uploader

**Renomme** le fichier en `qogym.apk` (le nom attendu par le système
d'auto-update et par le composant `<AndroidAppLink />` du site web).

**Upload** sur ton FTP à la racine de qojim.com → l'APK sera accessible
à `https://qojim.com/qogym.apk`.

### Étape 6 — Mettre à jour `version.json`

**Très important** sinon le système d'auto-update ne saura pas qu'une
nouvelle version existe. Édite `version.json` à la racine de qojim.com :

```json
{
  "latestVersionCode": 5,
  "latestVersion": "1.0.4",
  "downloadUrl": "https://qojim.com/qogym.apk",
  "minRequiredVersionCode": 1,
  "releaseNotes": "Description courte de la mise à jour"
}
```

→ `latestVersionCode` doit être identique à `versionCode` dans `app.json`.

### Étape 7 — Tester

Sur ton téléphone (avec une vieille version installée) :
1. Ouvre l'app
2. La bannière verte "Nouvelle version disponible — 1.0.4" devrait
   apparaître en haut
3. Clic sur "Mettre à jour" → l'APK se télécharge
4. L'écran d'installation Android s'ouvre → "Installer"
5. L'app se ferme, se met à jour, se rouvre

Si la bannière n'apparaît pas, vérifie :
- L'URL `https://qojim.com/version.json` est bien accessible
- Le `latestVersionCode` est strictement supérieur au `versionCode`
  installé (visible dans Android Settings → Apps → QoGym → version au bas)
- Le site web a bien le composant `UpdateBanner` à jour

## Comprendre le système d'auto-update

### Côté APK (`App.tsx`)
À chaque ouverture, l'APK injecte du JS dans la WebView :
```js
window.QOGYM_IS_NATIVE_APP    = true;
window.QOGYM_APP_VERSION_CODE = 5;        // ← versionCode du build courant
window.QOGYM_APP_VERSION      = "1.0.4";
window.QOGYM_INSTALL_UPDATE   = function(url) { ... };
```

### Côté site (`UpdateBanner.js`)
1. Lit `window.QOGYM_IS_NATIVE_APP` → true → on est dans le nouvel APK
2. Fetch `https://qojim.com/version.json`
3. Compare `installedVCode` (depuis window) avec `latestVersionCode` (du JSON)
4. Si plus vieux → affiche bannière avec bouton "Mettre à jour"

### Au clic "Mettre à jour"
1. Site appelle `window.QOGYM_INSTALL_UPDATE(downloadUrl)`
2. La fonction post un message `{ type: 'install_update', url }` à React Native
3. `App.tsx.onMessage()` reçoit le message → télécharge l'APK avec
   `expo-file-system`
4. Une fois téléchargé → `expo-intent-launcher` ouvre `ACTION_INSTALL_PACKAGE`
5. Android affiche son écran natif "Installer cette application ?" →
   l'utilisateur confirme
6. La 1re fois, Android demande aussi à autoriser l'app à installer des
   APK (permission `REQUEST_INSTALL_PACKAGES`)

### Bannière "legacy" (utilisateurs sur l'ancien APK)
Pour les users qui ont l'ancien `universal.apk` (sans le système
d'auto-update), le composant `UpdateBanner` affiche aussi une bannière
**bleue** "Mise à jour majeure de l'app" avec bouton "Télécharger" qui
lance un download manuel du `.apk`. L'utilisateur installe à la main.

C'est une **bannière de migration unique** : une fois qu'il est passé sur
le nouvel APK, il n'aura plus que les bannières vertes auto-update.

Détection : Android UA + absence de `window.QOGYM_IS_NATIVE_APP`.

## Test en local pendant le développement

Pour tester `App.tsx` sans avoir à attendre 15 min de build cloud :

### Option A — Expo Go (le plus rapide)
1. Installe **Expo Go** sur ton téléphone (Play Store)
2. Dans le terminal, dans le dossier `qogym-app/` :
   ```bash
   npx expo start
   ```
3. Scanne le QR code avec Expo Go → ton app se lance en live, hot reload

⚠️ **Limites d'Expo Go** :
- `BackHandler` ne marche pas (Expo Go intercepte ses propres handlers)
- L'auto-install d'APK ne marche pas non plus (pas de permission)
- Bonne pour valider rapidement l'UI et la WebView. Pour tester ces deux
  trucs, faut faire un build EAS.

### Option B — Build de dev EAS
Si tu veux tester en conditions réelles :
```bash
eas build --platform android --profile preview
```
Pareil qu'un build de prod, juste un APK installable sans Play Store.

## Configuration EAS — `eas.json`

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "preview": {
      "android": { "buildType": "apk" }
    },
    "production": {
      "android": { "buildType": "apk" }
    }
  }
}
```

Le profil `preview` est ce qu'on utilise pour la distribution hors Play
Store. Le profil `production` est identique ici, mais on pourrait y
mettre des trucs spécifiques à une release Play Store (AAB au lieu d'APK,
optimisations, etc.).

## Si tu veux passer au Play Store un jour

Compte développeur Google Play : **25 $ une fois**. Ensuite :
1. `app.json` : passer `buildType` à `app-bundle` dans le profil `production`
2. `eas build --platform android --profile production` → fichier `.aab`
3. Upload sur la Console Google Play (interface web)
4. Review (24-72h en général)
5. Une fois publié, les MAJ se font **automatiquement** côté utilisateur,
   plus besoin de `version.json` ni d'auto-install custom

Beaucoup plus propre, mais c'est un investissement en temps + 25$.

## Troubleshooting

### "App not installed" sur Android lors de l'install
- Le `versionCode` du nouveau APK n'est pas plus grand que l'installé →
  bumper et rebuilder
- Le keystore est différent → faut désinstaller l'ancien d'abord (cas
  rare, EAS garde le keystore stable normalement)

### Le build EAS échoue sur des erreurs Kotlin / Compose
- Souvent un mismatch de versions Expo. Lance :
  ```bash
  npx expo install --check
  ```
  Et accepte les corrections suggérées.

### La WebView est blanche / ne charge pas
- Vérifie que `qojim.com` est bien en HTTPS (les WebView Android
  bloquent par défaut le HTTP non sécurisé)
- Test sur un autre réseau (parfois le WiFi domestique a un problème DNS)

### Le bouton retour ne fonctionne pas comme attendu
La logique actuelle est dans `App.tsx` : on délègue au JS de la WebView
qui regarde `window.history.length`. Si ça pose souci, on peut affiner
par exemple en ne fermant l'app que quand on est sur `/feed` (la page
d'entrée) au lieu de se fier à l'historique.

### L'auto-install échoue "Échec du téléchargement"
- Vérifie que `https://qojim.com/qogym.apk` est bien accessible (clique
  sur le lien depuis Chrome, l'APK doit se télécharger)
- Vérifie que la permission `REQUEST_INSTALL_PACKAGES` est dans
  `app.json`
- Sur Android 8+, l'utilisateur doit avoir autorisé l'app à installer
  des APK une fois (paramètre système, dialogue automatique la 1re fois)

## Workflow de release résumé (mémo)

Pour un changement **frontend uniquement** (cas le plus fréquent) :

```bash
cd qogym/                # le projet site web
# ... tes modifs sur le code ...
npm run build            # génère build/
# Upload le contenu de build/ sur ton FTP à la racine de qojim.com
```

Pour un changement **backend** :

```bash
# Si modif schéma BDD : phpMyAdmin → exécuter les ALTER TABLE
# Upload les .php modifiés sur le FTP à qojim.com/qogym-api/
```

Pour un changement **APK** (rare) :

```bash
cd qogym-app/
# ... modifs App.tsx, icône, etc. ...
# Bumper version + versionCode dans app.json
eas build --platform android --profile preview
# Télécharger l'APK depuis expo.dev, le renommer qogym.apk
# Upload qogym.apk sur le FTP
# Mettre à jour version.json sur le FTP avec le nouveau latestVersionCode
```
