/**
 * Helpers de détection "on tourne dans l'app native (WebView)".
 *
 * L'app Android n'est pas une vraie app : c'est un wrapper qui ouvre le site
 * dans une WebView plein écran. Le wrapper injecte des globales avant le
 * chargement de la page (cf. UpdateBanner.js qui lit window.QOGYM_IS_NATIVE_APP).
 *
 * On centralise ici la détection pour que tout le code (pull-to-refresh,
 * compteur de pas, etc.) parte de la même source de vérité.
 *
 * Détection, par ordre de fiabilité :
 *   1. window.QOGYM_IS_NATIVE_APP === true  → injecté par le NOUVEL APK.
 *   2. UA contient "; wv)"                  → marqueur standard d'une WebView
 *      Android (vrai pour la quasi-totalité des wrappers, y compris les
 *      générateurs type WebIntoApp / GoNative / Median).
 *
 * Le cas (2) est un filet de sécurité : même sans le nouvel APK, on peut
 * activer le pull-to-refresh JS dans une WebView "legacy".
 */

export const isNewNativeApp = () =>
  typeof window !== 'undefined' && window.QOGYM_IS_NATIVE_APP === true;

export const isAndroidWebView = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua) && /;\s*wv\)/i.test(ua);
};

/**
 * "On est dans un contexte app" = nouvel APK OU WebView Android legacy.
 * C'est la condition à utiliser pour activer les comportements "type app"
 * (pull-to-refresh, lecture des pas, etc.) — jamais sur navigateur desktop
 * ni Chrome mobile classique.
 */
export const isNativeAppContext = () => isNewNativeApp() || isAndroidWebView();

export default isNativeAppContext;
