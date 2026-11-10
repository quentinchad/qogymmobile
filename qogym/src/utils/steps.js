/**
 * Lecture des pas du téléphone depuis la WebView.
 *
 * ⚠️ Rappel important : une page web / WebView NE PEUT PAS lire le podomètre
 * du téléphone toute seule. Il n'existe pas d'API web standard pour les pas
 * (les capteurs santé sont protégés). Il faut que le wrapper natif (l'APK)
 * lise le capteur et "injecte" la valeur dans la page.
 *
 * Comme on ne peut pas modifier le natif tout de suite, ce module est écrit
 * pour être TOLÉRANT : il tente plusieurs conventions de pont connues. Dès
 * qu'un pont fournit les pas, l'app les affiche automatiquement, sans rien
 * changer d'autre. En attendant, on a une saisie manuelle de secours côté UI.
 *
 * Conventions supportées (essayées dans l'ordre) :
 *
 *  1. window.QOGYM_STEPS
 *     Valeur (nombre) ou objet { steps, day } posée par le wrapper.
 *     C'est la convention "maison" recommandée — la plus simple à injecter.
 *
 *  2. window.QOGYM_GET_STEPS()
 *     Fonction synchrone qui retourne le nombre de pas (ou {steps, day}).
 *
 *  3. window.median / window.gonative (wrappers Median.co / GoNative)
 *     Ces wrappers exposent parfois un pont JS. Si une de leurs API
 *     "health steps" est présente on tente de l'appeler (best-effort,
 *     enveloppé dans un try/catch — l'API exacte dépend de la config du
 *     wrapper et peut être asynchrone via un callback global).
 *
 *  4. window.QOGYM_STEPS_PROMISE
 *     Une Promise (ou fonction renvoyant une Promise) — pour les ponts
 *     asynchrones. Résolue en nombre ou { steps, day }.
 *
 * Tous les chemins sont défensifs : aucune exception ne remonte, on
 * retourne simplement null si rien n'est disponible.
 */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Normalise une valeur quelconque renvoyée par un pont en
// { steps, day, source }. `source` peut être 'native' (total fiable) ou
// 'native-partial' (compteur observé app ouverte, cf. pont Option A
// expo-sensors). Le serveur applique le GREATEST du jour pour les deux,
// donc une valeur partielle n'écrase jamais un total plus élevé.
const normalize = (raw) => {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return { steps: Math.round(raw), day: todayISO(), source: 'native' };
  }
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
    const n = Number(raw);
    if (n >= 0) return { steps: Math.round(n), day: todayISO(), source: 'native' };
  }
  if (typeof raw === 'object') {
    const s = raw.steps ?? raw.count ?? raw.value;
    const n = typeof s === 'string' ? Number(s) : s;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      const day = typeof raw.day === 'string' ? raw.day : todayISO();
      const source = raw.source === 'native-partial' ? 'native-partial' : 'native';
      return { steps: Math.round(n), day, source };
    }
  }
  return null;
};

/**
 * Tente de lire les pas via toutes les conventions connues.
 * @returns {Promise<{steps:number, day:string}|null>}
 */
export const readNativeSteps = async () => {
  if (typeof window === 'undefined') return null;

  // 1. window.QOGYM_STEPS (valeur directe ou objet)
  try {
    if ('QOGYM_STEPS' in window) {
      const v = normalize(window.QOGYM_STEPS);
      if (v) return v;
    }
  } catch (_) {}

  // 2. window.QOGYM_GET_STEPS() (fonction synchrone)
  try {
    if (typeof window.QOGYM_GET_STEPS === 'function') {
      const v = normalize(window.QOGYM_GET_STEPS());
      if (v) return v;
    }
  } catch (_) {}

  // 4. window.QOGYM_STEPS_PROMISE (pont asynchrone)
  //    (testé avant Median pour privilégier la convention maison async)
  try {
    let p = window.QOGYM_STEPS_PROMISE;
    if (typeof p === 'function') p = p();
    if (p && typeof p.then === 'function') {
      const resolved = await Promise.race([
        p,
        new Promise((res) => setTimeout(() => res(null), 4000)),
      ]);
      const v = normalize(resolved);
      if (v) return v;
    }
  } catch (_) {}

  // 3. Wrappers Median / GoNative — best-effort.
  //    Leur API "health" varie selon l'abonnement/config ; on tente le
  //    pattern le plus courant (callback global). Si rien ne répond dans
  //    le délai, on abandonne silencieusement.
  try {
    const bridge = window.median || window.gonative;
    if (bridge && bridge.health && typeof bridge.health.steps === 'function') {
      const resolved = await new Promise((res) => {
        const cbName = '__qogymStepsCb_' + Date.now();
        const to = setTimeout(() => {
          try { delete window[cbName]; } catch (_) {}
          res(null);
        }, 4000);
        window[cbName] = (data) => {
          clearTimeout(to);
          try { delete window[cbName]; } catch (_) {}
          res(data);
        };
        try {
          bridge.health.steps({ callback: 'window.' + cbName });
        } catch (_) {
          clearTimeout(to);
          res(null);
        }
      });
      const v = normalize(resolved);
      if (v) return v;
    }
  } catch (_) {}

  return null;
};

/**
 * Indique si un pont de pas SEMBLE présent (pour décider si on affiche
 * "synchronisé automatiquement" vs proposer la saisie manuelle).
 * Heuristique uniquement — la vraie source de vérité est le résultat de
 * readNativeSteps().
 */
export const hasNativeStepsBridge = () => {
  if (typeof window === 'undefined') return false;
  return (
    'QOGYM_STEPS' in window ||
    typeof window.QOGYM_GET_STEPS === 'function' ||
    !!window.QOGYM_STEPS_PROMISE ||
    !!((window.median || window.gonative)?.health?.steps)
  );
};

export { todayISO };
export default readNativeSteps;
