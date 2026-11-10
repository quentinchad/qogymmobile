import raw from '@/data/exercises.json';

/**
 * Catalogue d'exercices embarqué (≈ 580 exercices en français, source :
 * API publique wger.de, licence CC BY-SA). Recherche locale, instantanée,
 * hors ligne. Régénérable via scripts/build-exercise-catalog.py.
 */
export type CatalogExercise = {
  n: string; // nom (FR)
  c: string; // catégorie
  m: string[]; // muscles principaux
  e: string[]; // matériel
  en?: string; // nom anglais (aide à la recherche : « squat », « curl »…)
  i?: string; // miniature (chemin relatif wger)
};

export const CATALOG = raw as CatalogExercise[];
export const CATALOG_CATEGORIES = ['Pectoraux', 'Dos', 'Épaules', 'Bras', 'Jambes', 'Abdos', 'Cardio'];
export const CATALOG_CREDIT = 'Catalogue : wger.de (CC BY-SA)';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Index pré-calculé une seule fois (évite de normaliser à chaque frappe).
let index: { ex: CatalogExercise; key: string; muscles: string }[] | null = null;
const getIndex = () =>
  (index ??= CATALOG.map((ex) => ({
    ex,
    key: norm(`${ex.n} ${ex.en ?? ''}`),
    muscles: norm(`${ex.m.join(' ')} ${ex.e.join(' ')} ${ex.c}`),
  })));

export function searchCatalog(query: string, category?: string | null, limit = 40): CatalogExercise[] {
  const words = norm(query).split(' ').filter(Boolean);
  const scored: { ex: CatalogExercise; score: number }[] = [];
  for (const it of getIndex()) {
    if (category && it.ex.c !== category) continue;
    if (!words.length) {
      scored.push({ ex: it.ex, score: 0 });
      continue;
    }
    let score = 0;
    let ok = true;
    for (const w of words) {
      if (it.key.startsWith(w)) score += 3;
      else if (it.key.includes(` ${w}`)) score += 2;
      else if (it.key.includes(w)) score += 1;
      else if (it.muscles.includes(w)) score += 0.5;
      else {
        ok = false;
        break;
      }
    }
    if (ok) scored.push({ ex: it.ex, score: score - it.ex.n.length / 200 });
  }
  if (words.length) scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.ex);
}

export const catalogImage = (ex: CatalogExercise) => (ex.i ? `https://wger.de/media/exercise-images/${ex.i}` : null);

/** Valeurs par défaut raisonnables quand on ajoute un exercice du catalogue. */
export function catalogDefaults(ex: CatalogExercise) {
  if (ex.c === 'Abdos') return { sets: 3, reps_min: 12, reps_max: 15, rest_time: 60 };
  if (ex.c === 'Cardio') return { sets: 3, reps_min: 10, reps_max: 15, rest_time: 60 };
  return { sets: 3, reps_min: 8, reps_max: 12, rest_time: 90 };
}
