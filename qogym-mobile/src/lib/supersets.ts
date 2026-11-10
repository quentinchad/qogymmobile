// Port direct de qogym/src/utils/supersets.js (même logique que le site).
/* eslint-disable */
// @ts-nocheck
/**
 * Helpers pour gérer les supersets (groupes d'exercices enchaînés sans repos
 * entre eux). Un superset est une suite d'exercices qui partagent la même
 * valeur `superset_group` (entier non nul) **et qui se suivent dans la liste**.
 *
 * Conventions :
 *   - `superset_group` peut être null/undefined → exo solo.
 *   - Deux exos avec la même valeur mais NON-CONSÉCUTIFS sont traités comme
 *     deux supersets distincts (rare mais robuste face aux réordonnancements).
 *   - Les valeurs n'ont pas besoin d'être contiguës (1, 2, 3…) : on regroupe
 *     simplement par égalité.
 */

/**
 * Normalise une valeur de superset_group : retourne un entier ou null.
 * Accepte string, number, undefined.
 */
export const normSupersetGroup = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Découpe une liste plate d'exercices (dans l'ordre d'affichage) en blocs.
 * Chaque bloc est :
 *   { type: 'solo',     exercise: {...}, startIndex: i }
 *   { type: 'superset', exercises: [...], startIndex: i, group: G }
 *
 * `startIndex` est la position du premier exo du bloc dans la liste plate
 * d'origine, utile pour calculer les numéros affichés (1, 2, 3 incrémentaux,
 * indépendants de la structure superset).
 */
export const groupBySupersets = (exercises) => {
  const blocks = [];
  let i = 0;
  while (i < exercises.length) {
    const ex = exercises[i];
    const sg = normSupersetGroup(ex.superset_group);
    if (sg === null) {
      blocks.push({ type: 'solo', exercise: ex, startIndex: i });
      i += 1;
      continue;
    }
    // Avancer tant que le suivant a la même superset_group ET est consécutif
    const group = [ex];
    let j = i + 1;
    while (j < exercises.length && normSupersetGroup(exercises[j].superset_group) === sg) {
      group.push(exercises[j]);
      j += 1;
    }
    if (group.length === 1) {
      // Exo solo "déguisé" : un seul exo a un superset_group mais sans
      // voisin partageant la même valeur. On le traite comme solo pour
      // l'affichage (tout en gardant la valeur — l'utilisateur peut
      // vouloir lier plus tard).
      blocks.push({ type: 'solo', exercise: ex, startIndex: i });
    } else {
      blocks.push({ type: 'superset', exercises: group, startIndex: i, group: sg });
    }
    i = j;
  }
  return blocks;
};

/**
 * Génère un nouvel identifiant de groupe non utilisé dans la liste.
 * On prend max + 1.
 */
export const nextSupersetGroupId = (exercises) => {
  let max = 0;
  for (const ex of exercises) {
    const g = normSupersetGroup(ex.superset_group);
    if (g !== null && g > max) max = g;
  }
  return max + 1;
};

/**
 * Retourne une nouvelle liste où l'exo à l'index `index` est lié à l'exo
 * suivant en superset.
 *   - Si l'exo suivant a déjà un superset_group : on adopte le sien.
 *   - Si l'exo courant a déjà un superset_group : on l'étend au suivant.
 *   - Sinon : on crée un nouveau groupe partagé entre les deux.
 *
 * Si index est le dernier ou hors-bornes : no-op.
 */
export const linkWithNext = (exercises, index) => {
  if (index < 0 || index >= exercises.length - 1) return exercises;
  const cur  = exercises[index];
  const next = exercises[index + 1];
  const curG  = normSupersetGroup(cur.superset_group);
  const nextG = normSupersetGroup(next.superset_group);

  let targetGroup;
  if (curG !== null && nextG !== null) {
    // Deux groupes existants : on fusionne en gardant celui de l'exo courant.
    // (éventuellement on devrait remapper toute la séance pour fusionner
    //  proprement, mais 99% des cas sont plus simples — l'utilisateur
    //  empile linéairement)
    targetGroup = curG;
  } else if (curG !== null) {
    targetGroup = curG;
  } else if (nextG !== null) {
    targetGroup = nextG;
  } else {
    targetGroup = nextSupersetGroupId(exercises);
  }
  return exercises.map((ex, i) => {
    if (i === index || i === index + 1) {
      return { ...ex, superset_group: targetGroup };
    }
    // Cas fusion de groupes : remap nextG → targetGroup pour rester cohérent
    if (curG !== null && nextG !== null && nextG !== targetGroup) {
      const g = normSupersetGroup(ex.superset_group);
      if (g === nextG) return { ...ex, superset_group: targetGroup };
    }
    return ex;
  });
};

/**
 * Délie l'exo à l'index `index` du superset auquel il appartient.
 * Comportement :
 *   - Si l'exo n'est pas dans un superset (groupe null ou seul de son groupe),
 *     no-op.
 *   - Si l'exo est au milieu d'un superset, on coupe : tous les exos de la
 *     même groupe À PARTIR DE LUI prennent un nouveau groupe (ou null s'il
 *     ne resterait qu'un seul exo après lui).
 *   - Si l'exo est en bord du superset (premier ou dernier), il devient solo
 *     (superset_group = null) et le reste du groupe n'est pas affecté.
 */
export const unlinkAtIndex = (exercises, index) => {
  if (index < 0 || index >= exercises.length) return exercises;
  const target = exercises[index];
  const targetG = normSupersetGroup(target.superset_group);
  if (targetG === null) return exercises;

  // Trouver les bornes du superset (suite consécutive qui partage targetG)
  let start = index;
  while (start > 0 && normSupersetGroup(exercises[start - 1].superset_group) === targetG) {
    start -= 1;
  }
  let end = index;
  while (end < exercises.length - 1 && normSupersetGroup(exercises[end + 1].superset_group) === targetG) {
    end += 1;
  }

  const groupSize = end - start + 1;
  if (groupSize <= 1) {
    // Pas vraiment dans un groupe (l'exo est seul à partager cette valeur
    // dans la suite consécutive). On reset son superset_group à null.
    return exercises.map((ex, i) => i === index ? { ...ex, superset_group: null } : ex);
  }

  // L'exo cible quitte le groupe.
  // Cas 1 : il est en bord (premier ou dernier) → null pour lui, le reste reste groupé.
  if (index === start || index === end) {
    return exercises.map((ex, i) => i === index ? { ...ex, superset_group: null } : ex);
  }

  // Cas 2 : il est au milieu → on coupe. Le bloc avant (start..index-1) garde
  // targetG, et le bloc après (index+1..end) prend un nouveau groupe.
  // L'exo cible lui-même devient solo.
  const newG = nextSupersetGroupId(exercises);
  return exercises.map((ex, i) => {
    if (i === index) return { ...ex, superset_group: null };
    if (i > index && i <= end) return { ...ex, superset_group: newG };
    return ex;
  });
};

/**
 * Renvoie true si l'exo à l'index `index` est suivi par un autre exo du même
 * superset (utile pour décider "trigger rest timer ou pas" à la validation
 * d'une série).
 */
export const isFollowedBySupersetPartner = (exercises, index) => {
  if (index < 0 || index >= exercises.length - 1) return false;
  const g = normSupersetGroup(exercises[index].superset_group);
  if (g === null) return false;
  return normSupersetGroup(exercises[index + 1].superset_group) === g;
};

/**
 * Retourne la liste des exercices (objets) qui composent le superset auquel
 * appartient l'exo à l'index `index` — c.-à-d. la suite consécutive qui
 * partage la même superset_group. Si l'exo est solo (ou seul à porter sa
 * valeur dans la suite), retourne juste [exercices[index]].
 *
 * Sert à raisonner "par round" : un round de superset = une série de CHAQUE
 * exo du groupe. Le repos ne se déclenche qu'une fois le round complété,
 * peu importe l'ordre dans lequel l'utilisateur valide les exos.
 */
export const getSupersetMembers = (exercises, index) => {
  if (index < 0 || index >= exercises.length) return [];
  const g = normSupersetGroup(exercises[index].superset_group);
  if (g === null) return [exercises[index]];

  let start = index;
  while (start > 0 && normSupersetGroup(exercises[start - 1].superset_group) === g) {
    start -= 1;
  }
  let end = index;
  while (end < exercises.length - 1 && normSupersetGroup(exercises[end + 1].superset_group) === g) {
    end += 1;
  }
  if (end === start) return [exercises[index]]; // solo "déguisé"
  return exercises.slice(start, end + 1);
};

/**
 * Lettres pour libeller les exos dans un superset : A, B, C, ...
 */
export const supersetLetter = (idx) => {
  // A..Z, puis AA, AB... (ultra-edge case)
  if (idx < 26) return String.fromCharCode(65 + idx);
  const first = Math.floor(idx / 26) - 1;
  const second = idx % 26;
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
};

/**
 * Nettoyage post-réorganisation : un exo qui porte une superset_group mais
 * qui n'a aucun voisin (gauche ou droite) avec la même valeur est un
 * "orphelin" — on remet sa superset_group à null pour éviter les états
 * fantômes (un exo "marqué" mais affiché solo). À appeler après tout
 * drag-drop ou suppression.
 */
export const normalizeOrphans = (exercises) => {
  return exercises.map((ex, i) => {
    const g = normSupersetGroup(ex.superset_group);
    if (g === null) return ex;
    const prev = i > 0 ? normSupersetGroup(exercises[i - 1].superset_group) : null;
    const next = i < exercises.length - 1 ? normSupersetGroup(exercises[i + 1].superset_group) : null;
    if (prev === g || next === g) return ex;
    return { ...ex, superset_group: null };
  });
};
