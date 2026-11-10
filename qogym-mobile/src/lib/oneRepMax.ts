// Port direct de qogym/src/utils/oneRepMax.js (formule d'Epley).
// @ts-nocheck
/**
 * utils/oneRepMax.js
 *
 * Calcul du "1RM" (one-rep max / charge maximale théorique sur une seule
 * répétition), estimé à partir d'une série (poids x reps) via la formule
 * d'Epley — la plus courante pour ce type d'estimation :
 *
 *     1RM = poids × (1 + reps / 30)
 *
 * Pour reps = 1, on renvoie directement le poids (pas besoin d'extrapoler).
 * Cette estimation n'a de sens que pour des séries "à l'échec" ou proches ;
 * elle reste indicative mais c'est un standard largement utilisé (Strong,
 * Hevy, etc.) et suffisant pour suivre une tendance de progression.
 */

/**
 * Calcule le 1RM estimé pour une série donnée.
 * @param {number|string} weight poids soulevé (kg)
 * @param {number|string} reps   nombre de répétitions
 * @returns {number|null} 1RM estimé (arrondi à 0.1 kg près), ou null si la
 *   série n'est pas exploitable (poids ou reps manquant/nul/invalide).
 */
export function computeOneRepMax(weight, reps) {
  const w = typeof weight === 'number' ? weight : parseFloat(weight);
  const r = typeof reps === 'number' ? reps : parseInt(reps, 10);

  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(r) || r <= 0) {
    return null;
  }
  if (r === 1) {
    return Math.round(w * 10) / 10;
  }
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

/**
 * Trouve la meilleure série (celle donnant le 1RM estimé le plus élevé)
 * parmi une liste de séries.
 * @param {Array<{weight?: number|string, reps?: number|string}>} sets
 * @returns {{ oneRepMax: number, weight: number, reps: number } | null}
 */
export function bestOneRepMax(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return null;

  let best = null;
  for (const set of sets) {
    if (!set) continue;
    const orm = computeOneRepMax(set.weight, set.reps);
    if (orm !== null && (best === null || orm > best.oneRepMax)) {
      best = {
        oneRepMax: orm,
        weight: typeof set.weight === 'number' ? set.weight : parseFloat(set.weight),
        reps: typeof set.reps === 'number' ? set.reps : parseInt(set.reps, 10),
      };
    }
  }
  return best;
}

/**
 * Formatte un 1RM pour l'affichage (retire les décimales inutiles).
 * @param {number} value
 * @returns {string}
 */
export function formatOneRepMax(value) {
  if (value === null || value === undefined) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}