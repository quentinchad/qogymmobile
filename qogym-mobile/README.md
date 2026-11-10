# QoGym — application Android native

Application 100 % native (React Native + Expo SDK 58) qui remplace l'ancienne
coque WebView. Elle utilise **exactement la même API PHP et la même base de
données** que le site : aucune donnée n'est migrée, supprimée ou modifiée.

## Ce qui change par rapport à l'ancienne APK

| | Ancienne APK | Nouvelle APK |
|---|---|---|
| Interface | Site web affiché dans une WebView | Écrans natifs Android |
| Démarrage | Charge qojim.com à chaque ouverture | Instantané (données en cache, rafraîchies en fond) |
| Entraînement en cours | Chrono figé si l'app est fermée | Chrono basé sur l'heure réelle : continue même app fermée |
| Notification | Aucune | Notification permanente : chrono de séance, repos restant, boutons « +30 s » / « Passer le repos » |
| Fin de repos | Bip seulement si le site est à l'écran | Décompte 5 → 1 + double bip (même son que le site), joué par une alarme native : app ouverte, en arrière-plan ou écran éteint ; la musique est baissée le temps du bip |
| Ajout d'exercice | Saisie manuelle | Catalogue de ≈ 580 exercices en français (wger.de), filtrable par groupe musculaire |
| Connexion | — | Reprise automatique du compte de l'ancienne app (pas besoin de se reconnecter) |

### Batterie
- Le chrono de la notification est dessiné par Android (`setUsesChronometer`) : aucun code ne tourne chaque seconde.
- Une seule alarme est programmée par repos (fin du repos).
- Les compteurs à l'écran ne tournent que si l'écran concerné est visible et l'app au premier plan.
- « Garder l'écran allumé » est désactivé par défaut (icône ☀ dans l'entraînement).

### Catalogue d'exercices
`src/data/exercises.json` est généré depuis l'API publique [wger.de](https://wger.de)
(licence CC BY-SA, crédit affiché sous les suggestions). Il est embarqué dans
l'app : recherche instantanée et hors ligne. Pour le mettre à jour :
```bash
python scripts/build-exercise-catalog.py
```

## Structure

```
qogym-mobile/
├── app.json                 ← nom, version, versionCode, icône, permissions
├── eas.json                 ← profils de build EAS (APK)
├── modules/qo-workout/      ← module natif Kotlin : notification + alarme de repos + bips
├── src/app/                 ← écrans (Expo Router : 1 fichier = 1 écran)
├── src/screens/             ← les 4 onglets (Feed, Séances, Nutrition, Profil)
├── src/workout/             ← état de l'entraînement en cours (port du contexte du site)
├── src/components/          ← composants UI (boutons, feuilles, graphiques…)
├── src/lib/api.ts           ← tous les appels à https://qojim.com/qogym-api
└── src/theme.ts             ← couleurs (palette du logo) — tout le thème est ici
```

## Publier une nouvelle version

1. Monter `version` **et** `android.versionCode` dans `app.json` (le versionCode doit toujours augmenter).
2. Build cloud (même compte Expo `qojim`, même clé de signature que l'ancienne app) :
   ```bash
   EAS_NO_VCS=1 eas build -p android --profile preview
   ```
   (seules les architectures ARM sont compilées → APK ≈ 2× plus léger)
   (sous PowerShell : `$env:EAS_NO_VCS=1; eas build -p android --profile preview`)
3. Télécharger l'APK depuis expo.dev, le renommer `qogym.apk`.
4. FTP : envoyer `qogym.apk` puis `version.json` à la racine de qojim.com.
   `latestVersionCode` = le versionCode de `app.json`.

La mise à jour est **proposée** (bannière « Nouvelle version disponible » +
bouton « Plus tard »), jamais imposée — tant que `minRequiredVersionCode` reste
bas dans `version.json`.

## Développement

```bash
npm install
npx tsc --noEmit          # vérification TypeScript
npx expo-doctor           # vérification de la config
```
Le module natif nécessite un build (EAS) : Expo Go ne suffit pas.
