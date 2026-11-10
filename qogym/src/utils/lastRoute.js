/**
 * Persistance de la dernière page "main" visitée.
 *
 * Problème : l'app est une WebView. Quand l'utilisateur fait un
 * pull-to-refresh (ou que la WebView est rechargée par le système), le
 * wrapper recharge typiquement l'URL racine du site. Résultat : on retombe
 * sur /feed (la redirection par défaut de App.js), peu importe la page où
 * on était (ex: Nutrition).
 *
 * Solution : on mémorise en localStorage la dernière route main visitée.
 * Au boot, App.js lit cette valeur et redirige vers elle si l'URL courante
 * est la racine / une route "neutre".
 *
 * On ne mémorise QUE les pages du carousel (feed / sessions / nutrition /
 * profile). Les routes profondes (workout, détail séance, etc.) ont leur
 * propre logique de reprise (brouillon de workout par ex.) et ne doivent
 * pas être restaurées de cette manière.
 */

const KEY = 'qogym_last_main_route';

// Doit rester synchro avec mainSlides dans App.js.
const MAIN_ROUTES = ['/feed', '/sessions', '/nutrition', '/profile'];

export const isMainRoute = (path) => MAIN_ROUTES.includes(path);

export const saveLastRoute = (path) => {
  try {
    if (isMainRoute(path)) {
      localStorage.setItem(KEY, path);
    }
  } catch (_) {
    /* localStorage indisponible : tant pis, pas bloquant */
  }
};

export const getLastRoute = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v && isMainRoute(v) ? v : null;
  } catch (_) {
    return null;
  }
};

export { MAIN_ROUTES };
