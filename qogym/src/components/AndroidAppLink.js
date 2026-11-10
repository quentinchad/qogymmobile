import React from 'react';
import './AndroidAppLink.css';

/**
 * Lien de téléchargement de l'APK Android.
 *
 * Comportement :
 *   - Sur Android (UA contient "Android" et pas "wv" pour exclure les WebViews
 *     de l'app elle-même) → on affiche le lien.
 *   - Partout ailleurs (iOS, desktop, dans l'app native via WebView) → on
 *     n'affiche rien : pas de pollution de l'UI quand le téléchargement
 *     n'a aucun sens (iOS) ou est redondant (déjà dans l'app).
 *
 * Props :
 *   - variant : "auth" (sous les formulaires Login/Register) ou "card"
 *               (carte autonome dans Profile). Juste un toggle de style.
 *
 * URL de l'APK : https://qojim.com/universal.apk — servie en HTTPS pour
 * éviter le blocage "mixed content download" des navigateurs modernes
 * (Chrome 88+, etc.) quand le site lui-même est en HTTPS.
 */
const APK_URL = 'https://qojim.com/qogym.apk';

const isAndroid = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // "Android" suffit pour Chrome / Firefox / Samsung Internet / etc.
  // On exclut "; wv)" qui est le marqueur des WebViews — pas pertinent
  // dans l'app native qui consomme déjà l'APK.
  return /Android/i.test(ua) && !/; wv\)/i.test(ua);
};

const AndroidAppLink = ({ variant = 'auth' }) => {
  if (!isAndroid()) return null;

  const className = variant === 'card'
    ? 'android-app-link android-app-link--card'
    : 'android-app-link android-app-link--auth';

  // Cliquer ouvre le téléchargement. On garde un <a href> standard pour le
  // bénéfice clavier/accessibilité, mais on ajoute :
  //   - target="_blank" + rel="noopener" : si jamais l'attribut `download`
  //     est ignoré (cross-origin par exemple), au moins l'utilisateur voit
  //     que quelque chose se passe — pas de "rien ne se passe" silencieux.
  //   - onClick qui ne fait rien d'extra : on laisse le navigateur gérer le
  //     download natif. Inutile de window.open() en plus, ça déclencherait
  //     les bloqueurs de popup.
  return (
    <a
      className={className}
      href={APK_URL}
      // L'attribut `download` impose un nom de fichier propre et oriente
      // vers un téléchargement plutôt qu'une navigation (only honoré si
      // l'URL est same-origin avec la page courante — ce qui est notre cas
      // puisque l'APK est sur qojim.com).
      download="qojim.apk"
      target="_blank"
      rel="noopener"
    >
      <span className="android-app-link-icon" aria-hidden="true">📱</span>
      <span className="android-app-link-text">
        <strong>Télécharger l'app Android</strong>
        <small>Installation directe (.apk)</small>
      </span>
      <span className="android-app-link-chevron" aria-hidden="true">→</span>
    </a>
  );
};

export default AndroidAppLink;