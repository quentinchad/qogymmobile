import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { nutritionService, preferencesService } from '../services/api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import FoodLibraryModal from '../components/FoodLibraryModal';
import './Nutrition.css';

/**
 * Page Nutrition — journal des consommations + objectif quotidien.
 *
 * Architecture :
 *  - Date sélectionnée (par défaut aujourd'hui), navigation gauche/droite
 *  - Anneau de progression calorique vs objectif (si défini)
 *  - Trois mini-barres pour les macros (protéines / glucides / lipides)
 *  - Liste des aliments du jour : aliments seuls + repas ("Repas 1", "Repas 2"...)
 *    Un repas est un groupe dépliable contenant ses propres aliments
 *    (ajout / suppression / modification des quantités). Numéros automatiques.
 *  - On peut naviguer jusqu'à demain pour pré-remplir la journée suivante
 *  - Bouton "+ Ajouter" qui ouvre le picker
 *  - Bouton "Bibliothèque" pour gérer les items réutilisables
 *
 * Support des unités :
 *  - Un aliment peut être défini "à l'unité" (1 pomme = 180g) dans la biblio.
 *  - Picker : si à l'unité → on saisit le nombre d'unités, sinon les grammes.
 *  - Liste : on affiche "2 pommes (360g)" ou "150g" selon le cas.
 *  - Édition : la modale d'édition propose de modifier en unités si possible.
 */

const todayISO = () => {
  // YYYY-MM-DD en local (pas en UTC, sinon +/- 1 jour selon le fuseau)
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDateFr = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const tomorrow  = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (date.getTime() === today.getTime())     return "Aujourd'hui";
  if (date.getTime() === yesterday.getTime()) return 'Hier';
  if (date.getTime() === tomorrow.getTime())  return 'Demain';
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

const shiftDate = (iso, deltaDays) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Pluralisation naïve d'un libellé d'unité (ex: 2 "pommes")
const pluralize = (label, n) => {
  if (!label) return '';
  if (n <= 1) return label;
  if (/s$/i.test(label) || /x$/i.test(label)) return label;
  return label + 's';
};

// Format de la quantité affichée pour une entrée :
//   - Si l'entrée est en unités → "2 pommes (360g)"
//   - Sinon → "150g"
const formatEntryQuantity = (entry) => {
  if (entry.unit_label && entry.quantity_units != null) {
    // Affichage propre du nombre (sans virgule .0 inutile)
    const n = entry.quantity_units;
    const nStr = Number.isInteger(n) ? String(n) : String(n);
    return `${nStr} ${pluralize(entry.unit_label, n)} (${entry.quantity_g}g)`;
  }
  return `${entry.quantity_g}g`;
};

const Nutrition = ({ user }) => {
  const [date, setDate]               = useState(todayISO);
  const [entries, setEntries]         = useState([]);
  // Repas du jour : [{ id, number }] (numéro calculé par le serveur)
  const [meals, setMeals]             = useState([]);
  // Repas dépliés : { [mealId]: true }
  const [openMeals, setOpenMeals]     = useState({});
  // Repas ciblé par le picker / la saisie rapide (null = aliment seul)
  const [mealTarget, setMealTarget]   = useState(null);
  // Aliment en cours de déplacement vers un repas (ouvre la feuille de choix)
  const [movingEntry, setMovingEntry] = useState(null);
  const [totals, setTotals]           = useState({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const [loading, setLoading]         = useState(true);
  const [kcalTarget, setKcalTarget]   = useState(null);
  // Objectifs macros — un objet { protein, carbs, fat } avec null pour les
  // macros sans objectif. Les barres affichent une progression vers la cible
  // si elle est définie, sinon la part calorique relative comme avant.
  const [macroTargets, setMacroTargets] = useState({ protein: null, carbs: null, fat: null });

  // Modale bibliothèque (mode picker pour ajouter au journal, ou manage pour CRUD)
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryMode, setLibraryMode] = useState('picker');

  // Modale "ajout rapide ad-hoc" (sans passer par la biblio)
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocDraft, setAdHocDraft] = useState({
    name: '',
    use_unit: false, unit_label: '', grams_per_unit: '',
    kcal_per_100g: '', protein_per_100g: '', carbs_per_100g: '', fat_per_100g: '',
    quantity_g: '', quantity_units: '',
    saveToLibrary: false,
  });
  const [adHocSaving, setAdHocSaving] = useState(false);

  // Édition de la quantité d'une entrée existante. On garde le "mode" (g ou
  // unités) pour permettre à l'utilisateur de modifier dans l'unité d'origine.
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editingQuantity, setEditingQuantity] = useState('');

  const { showToast } = useToast();
  const { confirm }   = useConfirm();
  const navigate      = useNavigate();

  // Charge les objectifs (kcal + macros) depuis les préférences. Extrait dans
  // une fonction pour pouvoir la rappeler à chaque retour sur la page (ex.
  // après une modif depuis /profile) sans tout relire en bloc.
  const loadTargets = async () => {
    try {
      const res = await preferencesService.getPreferences();
      const p = res.data?.preferences || {};
      setKcalTarget(p.daily_kcal_target || null);
      setMacroTargets({
        protein: p.daily_protein_target != null ? Number(p.daily_protein_target) : null,
        carbs:   p.daily_carbs_target   != null ? Number(p.daily_carbs_target)   : null,
        fat:     p.daily_fat_target     != null ? Number(p.daily_fat_target)     : null,
      });
    } catch (_) { /* noop : on garde les valeurs précédentes en cas d'erreur */ }
  };

  // Premier chargement des objectifs (au mount). Skip pour les non-connectés
  // (appel API renverrait une 401 inutile).
  useEffect(() => {
    if (user) loadTargets();
  }, [user]);

  // Charge les entrées du jour à chaque changement de date / user. Pour les
  // non-connectés, on désactive juste le loading pour ne pas rester sur un
  // spinner indéfini — la page reste accessible en lecture seule.
  useEffect(() => {
    if (user) loadDay();
    else setLoading(false);
  }, [date, user]);

  // À chaque retour sur la page Nutrition (depuis /profile par exemple),
  // on recharge **et** les entrées **et** les objectifs : sans ça, modifier
  // l'objectif kcal/macros depuis le profil n'avait aucun effet visible
  // tant qu'on n'avait pas refreshé manuellement le navigateur.
  useRefreshOnFocus('/nutrition', () => {
    if (!user) return;
    loadDay();
    loadTargets();
  });

  const loadDay = async () => {
    setLoading(true);
    try {
      const res = await nutritionService.getEntries(date);
      setEntries(res.data?.entries || []);
      setMeals(res.data?.meals || []);
      setTotals(res.data?.totals || { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    } catch (err) {
      showToast('Erreur lors du chargement', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Ajouter depuis la bibliothèque ──
  // payload = { quantity_g } ou { quantity_units } selon comment l'utilisateur
  // a saisi dans le picker (les deux sont gérés par le backend).
  const openPicker = (mealId = null) => {
    setMealTarget(mealId);
    setLibraryMode('picker');
    setLibraryOpen(true);
  };
  const handlePick = async (item, payload) => {
    try {
      const body = {
        food_item_id:     item.id,
        name:             item.name,
        unit_label:       item.unit_label || null,
        grams_per_unit:   item.grams_per_unit ?? null,
        kcal_per_100g:    item.kcal_per_100g,
        protein_per_100g: item.protein_per_100g,
        carbs_per_100g:   item.carbs_per_100g,
        fat_per_100g:     item.fat_per_100g,
        consumed_at:      `${date} ${new Date().toTimeString().slice(0, 8)}`,
      };
      if (mealTarget) body.meal_id = mealTarget;
      // Le picker peut nous envoyer soit quantity_g soit quantity_units
      if (payload.quantity_units != null) body.quantity_units = payload.quantity_units;
      if (payload.quantity_g     != null) body.quantity_g     = payload.quantity_g;

      await nutritionService.createEntry(body);
      setLibraryOpen(false);
      await loadDay();
      showToast('Aliment ajouté', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors de l\'ajout', 'error');
    }
  };

  // ── Ajouter en saisie rapide (ad-hoc) ──
  const openAdHoc = (mealId = null) => {
    setMealTarget(mealId);
    setAdHocDraft({
      name: '',
      use_unit: false, unit_label: '', grams_per_unit: '',
      kcal_per_100g: '', protein_per_100g: '', carbs_per_100g: '', fat_per_100g: '',
      quantity_g: '', quantity_units: '',
      saveToLibrary: false,
    });
    setAdHocOpen(true);
  };
  const submitAdHoc = async (e) => {
    if (e) e.preventDefault();
    const name = adHocDraft.name.trim();
    if (!name) { showToast('Nom requis', 'error'); return; }

    const useUnit = adHocDraft.use_unit;
    const unitLabel = useUnit ? adHocDraft.unit_label.trim() : null;
    const gramsPerUnit = useUnit ? parseFloat(adHocDraft.grams_per_unit) : null;

    if (useUnit) {
      if (!unitLabel)              { showToast('Libellé d\'unité requis', 'error'); return; }
      if (!(gramsPerUnit > 0))     { showToast('Poids/unité invalide', 'error'); return; }
    }

    // Quantité saisie
    const quantityUnits = useUnit ? parseFloat(adHocDraft.quantity_units) : null;
    const quantityG     = useUnit ? null : parseFloat(adHocDraft.quantity_g);
    if (useUnit) {
      if (!(quantityUnits > 0)) { showToast('Nombre d\'unités invalide', 'error'); return; }
    } else {
      if (!(quantityG > 0))     { showToast('Quantité invalide', 'error'); return; }
    }

    const macros = {
      kcal_per_100g:    parseFloat(adHocDraft.kcal_per_100g)    || 0,
      protein_per_100g: parseFloat(adHocDraft.protein_per_100g) || 0,
      carbs_per_100g:   parseFloat(adHocDraft.carbs_per_100g)   || 0,
      fat_per_100g:     parseFloat(adHocDraft.fat_per_100g)     || 0,
    };

    setAdHocSaving(true);
    try {
      // Si "ajouter aussi à la biblio" : créer l'item d'abord (best-effort)
      let foodItemId = null;
      if (adHocDraft.saveToLibrary) {
        try {
          const r = await nutritionService.createLibraryItem({
            name,
            unit_label:     unitLabel,
            grams_per_unit: gramsPerUnit,
            ...macros,
          });
          foodItemId = r.data?.id || null;
        } catch (err) {
          // Conflit (déjà existant) ou erreur : on continue quand même avec l'entrée
          if (err.response?.status !== 409) {
            showToast('Aliment non ajouté à la bibliothèque, mais entrée créée', 'info');
          }
        }
      }

      const body = {
        food_item_id:     foodItemId,
        name,
        unit_label:       unitLabel,
        grams_per_unit:   gramsPerUnit,
        ...macros,
        consumed_at:      `${date} ${new Date().toTimeString().slice(0, 8)}`,
      };
      if (mealTarget) body.meal_id = mealTarget;
      if (useUnit)  body.quantity_units = quantityUnits;
      else          body.quantity_g     = quantityG;

      await nutritionService.createEntry(body);
      setAdHocOpen(false);
      await loadDay();
      showToast('Aliment ajouté', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors de l\'ajout', 'error');
    } finally {
      setAdHocSaving(false);
    }
  };

  // ── Modifier une entrée existante (juste la quantité) ──
  // Si l'entrée est en unités → on édite en unités, sinon en grammes.
  const startEditEntry = (entry) => {
    setEditingEntryId(entry.id);
    if (entry.unit_label && entry.quantity_units != null) {
      setEditingQuantity(String(entry.quantity_units));
    } else {
      setEditingQuantity(String(entry.quantity_g));
    }
  };
  const cancelEditEntry = () => { setEditingEntryId(null); setEditingQuantity(''); };
  const saveEditEntry = async () => {
    const qty = parseFloat(editingQuantity);
    if (!(qty > 0)) { showToast('Quantité invalide', 'error'); return; }
    // Récupère l'entrée concernée pour savoir si on envoie en g ou en unités
    const entry = entries.find(e => e.id === editingEntryId);
    const isUnit = !!(entry && entry.unit_label && entry.quantity_units != null);
    try {
      await nutritionService.updateEntryQuantity(editingEntryId, qty, isUnit ? 'units' : 'grams');
      cancelEditEntry();
      await loadDay();
    } catch (err) {
      showToast('Erreur', 'error');
    }
  };

  // ── Supprimer une entrée ──
  const deleteEntry = async (entry) => {
    const ok = await confirm({
      title: `Supprimer "${entry.name}" ?`,
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await nutritionService.deleteEntry(entry.id);
      await loadDay();
      showToast('Entrée supprimée', 'success');
    } catch (err) {
      showToast('Erreur', 'error');
    }
  };

  // ── Repas ──
  const createMeal = async () => {
    try {
      await nutritionService.createMeal(date);
      await loadDay();
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors de la création du repas', 'error');
    }
  };

  // Déplace un aliment vers un repas existant, vers un nouveau repas
  // (mealId === 'new') ou hors de son repas (mealId === null).
  const moveEntry = async (entry, mealId) => {
    try {
      let targetId = mealId;
      if (mealId === 'new') {
        const res = await nutritionService.createMeal(date);
        targetId = res.data?.id;
        if (!targetId) throw new Error('no id');
      }
      await nutritionService.moveEntryToMeal(entry.id, targetId);
      setMovingEntry(null);
      await loadDay();
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors du déplacement', 'error');
    }
  };

  const toggleMeal = (id) => setOpenMeals(o => ({ ...o, [id]: !o[id] }));

  const deleteMeal = async (meal) => {
    const n = meal.entries.length;
    const ok = await confirm({
      title: n > 0
        ? `Supprimer "Repas ${meal.number}" et ses ${n} aliment${n > 1 ? 's' : ''} ?`
        : `Supprimer "Repas ${meal.number}" ?`,
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await nutritionService.deleteMeal(meal.id);
      await loadDay();
      showToast('Repas supprimé', 'success');
    } catch (err) {
      showToast('Erreur', 'error');
    }
  };

  // ── Affichage ──
  // Repas du jour avec leurs aliments et leurs totaux
  const mealGroups = useMemo(() => meals.map((m) => {
    const list = entries.filter(e => e.meal_id === m.id);
    const t = list.reduce((a, e) => ({
      kcal:    a.kcal    + e.totals.kcal,
      protein: a.protein + e.totals.protein,
      carbs:   a.carbs   + e.totals.carbs,
      fat:     a.fat     + e.totals.fat,
    }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      ...m,
      entries: list,
      totals: { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) },
    };
  }), [meals, entries]);

  // Aliments seuls (hors repas). Une entrée dont le repas n'existe plus reste
  // affichée ici plutôt que de disparaître.
  const looseEntries = useMemo(() => {
    const ids = new Set(meals.map(m => m.id));
    return entries.filter(e => !e.meal_id || !ids.has(e.meal_id));
  }, [entries, meals]);

  const targetProgress = useMemo(() => {
    if (!kcalTarget || kcalTarget <= 0) return null;
    const pct = (totals.kcal / kcalTarget) * 100;
    return { pct: Math.min(100, pct), raw: pct, remaining: Math.max(0, kcalTarget - totals.kcal) };
  }, [kcalTarget, totals.kcal]);

  // Pour chaque macro, on retourne :
  //   - pct       : largeur de la barre (0-100), capée à 100 même en dépassement
  //   - rawPct    : pourcentage réel (peut dépasser 100)
  //   - hasTarget : true si l'utilisateur a défini un objectif sur cette macro
  //
  // Logique :
  //   - Objectif défini       → progression vers la cible (cohérent avec kcal)
  //   - Pas d'objectif        → part calorique relative entre les 3 macros
  //                             (comportement précédent, on garde une barre
  //                             "informative")
  const macroProgress = useMemo(() => {
    const consumed = { protein: totals.protein, carbs: totals.carbs, fat: totals.fat };
    const out = {};
    for (const macro of ['protein', 'carbs', 'fat']) {
      const target = macroTargets[macro];
      if (target && target > 0) {
        const raw = (consumed[macro] / target) * 100;
        out[macro] = {
          pct:       Math.min(100, raw),
          rawPct:    raw,
          hasTarget: true,
          target,
        };
      } else {
        // Pas d'objectif : on calcule la part calorique relative comme avant
        // pour garder une barre visuelle utile.
        const kcalProt  = totals.protein * 4;
        const kcalCarbs = totals.carbs   * 4;
        const kcalFat   = totals.fat     * 9;
        const sum = kcalProt + kcalCarbs + kcalFat;
        const share = sum > 0
          ? (macro === 'protein' ? kcalProt
            : macro === 'carbs'  ? kcalCarbs
            : kcalFat) / sum * 100
          : 0;
        out[macro] = {
          pct:       share,
          rawPct:    share,
          hasTarget: false,
          target:    null,
        };
      }
    }
    return out;
  }, [totals, macroTargets]);

  // ── Vue dégradée pour les visiteurs non-connectés ──
  // On affiche un header minimal + un visuel d'accueil + un CTA pour se
  // connecter. Pas d'appels API, pas de modale, pas de navigation par date.
  if (!user) {
    return (
      <div className="page-container nutrition-page">
        <div className="page-header">
          <h1 className="page-title">Nutrition</h1>
        </div>

        <div className="nut-summary card nut-summary--guest">
          <div className="nut-no-target">
            <div className="nut-kcal-big">🍎</div>
            <div className="nut-no-target-hint">
              Suis tes repas, calories et macros au quotidien.
            </div>
          </div>
        </div>

        <div className="card nut-guest-cta">
          <p className="nut-guest-cta-text">
            Connecte-toi pour ajouter des aliments à ton journal et suivre tes objectifs.
          </p>
          <div className="nut-guest-cta-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/login')}
            >
              Se connecter
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/register')}
            >
              Créer un compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Ligne d'un aliment (seul ou dans un repas) : quantité éditable + suppression
  const renderEntry = (entry) => {
    const isUnit = !!(entry.unit_label && entry.quantity_units != null);
    return (
        <div key={entry.id} className="nut-entry">
          <div className="nut-entry-main">
            <div className="nut-entry-name">{entry.name}</div>
            <div className="nut-entry-stats">
              {Math.round(entry.totals.kcal)} kcal · P {entry.totals.protein}g · G {entry.totals.carbs}g · L {entry.totals.fat}g
            </div>
            {editingEntryId === entry.id ? (
              <div className="nut-entry-edit">
                <input
                  type="number" inputMode="decimal" step={isUnit ? '0.5' : '1'} min="0"
                  value={editingQuantity}
                  onChange={(e) => setEditingQuantity(e.target.value)}
                  autoFocus
                />
                <span>{isUnit ? pluralize(entry.unit_label, parseFloat(editingQuantity) || 2) : 'g'}</span>
                <button type="button" className="btn btn-primary btn-small" onClick={saveEditEntry}>OK</button>
                <button type="button" className="btn btn-secondary btn-small" onClick={cancelEditEntry}>✕</button>
              </div>
            ) : (
              <div className="nut-entry-qty">
                <button type="button" className="nut-qty-btn" onClick={() => startEditEntry(entry)}>
                  {formatEntryQuantity(entry)}
                </button>
              </div>
            )}
          </div>
          <div className="nut-entry-actions">
            <button
              type="button"
              className="nut-entry-move"
              onClick={() => setMovingEntry(entry)}
              aria-label="Déplacer dans un repas"
              title="Déplacer dans un repas"
            >
              ↪
            </button>
            <button
              type="button"
              className="nut-entry-delete"
              onClick={() => deleteEntry(entry)}
              aria-label="Supprimer"
              title="Supprimer"
            >
              🗑️
            </button>
          </div>
        </div>
    );
  };

  return (
    <div className="page-container nutrition-page">
      <div className="page-header">
        <h1 className="page-title">Nutrition</h1>
        <div className="header-buttons">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setLibraryMode('manage'); setLibraryOpen(true); }}
          >
            Bibliothèque
          </button>
        </div>
      </div>

      {/* Navigation date */}
      <div className="nut-date-nav card">
        <button type="button" className="nut-date-btn" onClick={() => setDate(d => shiftDate(d, -1))} aria-label="Jour précédent">‹</button>
        <div className="nut-date-label">
          <span className="nut-date-name">{formatDateFr(date)}</span>
          {date !== todayISO() && (
            <button type="button" className="nut-date-today" onClick={() => setDate(todayISO())}>
              Revenir à aujourd'hui
            </button>
          )}
        </div>
        <button
          type="button"
          className="nut-date-btn"
          onClick={() => setDate(d => shiftDate(d, +1))}
          disabled={date >= shiftDate(todayISO(), 1)}
          aria-label="Jour suivant"
        >›</button>
      </div>

      {/* KPI calories + anneau de progression si objectif */}
      <div className="nut-summary card">
        {targetProgress ? (
          <div className="nut-ring-wrap">
            {/* SVG avec viewBox généreux (-4 -4 44 44 au lieu de 0 0 36 36)
                pour laisser de la place au glow gaussien sans clipping. Le
                cercle reste centré en (18,18) — on agrandit juste la "toile". */}
            <svg className="nut-ring" viewBox="-4 -4 44 44">
              <defs>
                {/* Glow natif SVG : le flou est appliqué au tracé du cercle
                    et fusionné par-dessus la couleur source. Contrairement à
                    `filter: drop-shadow` côté CSS qui produit un halo carré
                    sur Chromium mobile, ce filtre suit correctement la
                    courbe du cercle. */}
                <filter id="nutRingGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="0.9" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle className="nut-ring-track" cx="18" cy="18" r="15.9" />
              <circle
                className="nut-ring-fill"
                cx="18" cy="18" r="15.9"
                filter="url(#nutRingGlow)"
                style={{ strokeDashoffset: 100 - targetProgress.pct }}
              />
            </svg>
            <div className="nut-ring-center">
              <div className="nut-ring-kcal">{Math.round(totals.kcal)}</div>
              <div className="nut-ring-target">/ {kcalTarget} kcal</div>
            </div>
          </div>
        ) : (
          <div className="nut-no-target">
            <div className="nut-kcal-big">{Math.round(totals.kcal)} kcal</div>
            <div className="nut-no-target-hint">
              Définis un objectif quotidien dans ton profil pour voir ta progression.
            </div>
          </div>
        )}

        {/* Macros */}
        {/* Macros — affiche "consommé / cible" si l'utilisateur a défini un
            objectif pour cette macro, sinon juste "consommé". La barre garde
            sa couleur d'origine en cas de dépassement (juste capée à 100%
            visuellement, le label affiche la valeur réelle). */}
        <div className="nut-macros">
          <div className="nut-macro">
            <div className="nut-macro-head">
              <span>Protéines</span>
              <strong>
                {Math.round(totals.protein)}g
                {macroProgress.protein.hasTarget && (
                  <span className="nut-macro-target"> / {Math.round(macroProgress.protein.target)}g</span>
                )}
              </strong>
            </div>
            <div className="nut-macro-bar">
              <div
                className="nut-macro-fill nut-macro-fill--prot"
                style={{ width: `${macroProgress.protein.pct}%` }}
              />
            </div>
          </div>
          <div className="nut-macro">
            <div className="nut-macro-head">
              <span>Glucides</span>
              <strong>
                {Math.round(totals.carbs)}g
                {macroProgress.carbs.hasTarget && (
                  <span className="nut-macro-target"> / {Math.round(macroProgress.carbs.target)}g</span>
                )}
              </strong>
            </div>
            <div className="nut-macro-bar">
              <div
                className="nut-macro-fill nut-macro-fill--carbs"
                style={{ width: `${macroProgress.carbs.pct}%` }}
              />
            </div>
          </div>
          <div className="nut-macro">
            <div className="nut-macro-head">
              <span>Lipides</span>
              <strong>
                {Math.round(totals.fat)}g
                {macroProgress.fat.hasTarget && (
                  <span className="nut-macro-target"> / {Math.round(macroProgress.fat.target)}g</span>
                )}
              </strong>
            </div>
            <div className="nut-macro-bar">
              <div
                className="nut-macro-fill nut-macro-fill--fat"
                style={{ width: `${macroProgress.fat.pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Boutons d'ajout */}
      <div className="nut-add-row">
        <button type="button" className="btn btn-primary" onClick={() => openPicker(null)}>
          + Depuis la bibliothèque
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => openAdHoc(null)}>
          + Saisie rapide
        </button>
        <button type="button" className="btn btn-secondary" onClick={createMeal}>
          + Nouveau repas
        </button>
      </div>

      {/* Liste des entrées du jour */}
      <div className="card">
        <h3 className="card-title">Aliments du jour</h3>
        {loading ? (
          <div className="loading-screen"><div className="spinner" /></div>
        ) : entries.length === 0 && mealGroups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🍽️</div>
            <p className="empty-state-text">Aucun aliment enregistré pour cette journée.</p>
          </div>
        ) : (
          <div className="nut-entries">
            {mealGroups.map((meal) => {
              const isOpen = !!openMeals[meal.id];
              return (
                <div key={`meal-${meal.id}`} className={`nut-meal ${isOpen ? 'is-open' : ''}`}>
                  <div className="nut-meal-head">
                    <button
                      type="button"
                      className="nut-meal-toggle"
                      onClick={() => toggleMeal(meal.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="nut-meal-chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                      <span className="nut-meal-main">
                        <span className="nut-meal-name">Repas {meal.number}</span>
                        <span className="nut-meal-stats">
                          {meal.entries.length === 0
                            ? 'Vide'
                            : `${Math.round(meal.totals.kcal)} kcal · P ${meal.totals.protein}g · G ${meal.totals.carbs}g · L ${meal.totals.fat}g · ${meal.entries.length} aliment${meal.entries.length > 1 ? 's' : ''}`}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="nut-entry-delete"
                      onClick={() => deleteMeal(meal)}
                      aria-label="Supprimer le repas"
                      title="Supprimer le repas"
                    >
                      🗑️
                    </button>
                  </div>

                  {isOpen && (
                    <div className="nut-meal-body">
                      {meal.entries.length === 0 ? (
                        <div className="nut-meal-empty">Aucun aliment dans ce repas.</div>
                      ) : (
                        <div className="nut-entries">
                          {meal.entries.map(renderEntry)}
                        </div>
                      )}
                      <div className="nut-meal-add">
                        <button type="button" className="btn btn-primary btn-small" onClick={() => openPicker(meal.id)}>
                          + Bibliothèque
                        </button>
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => openAdHoc(meal.id)}>
                          + Saisie rapide
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {looseEntries.map(renderEntry)}
          </div>
        )}
      </div>

      {/* Modale bibliothèque (picker ou manage) */}
      <FoodLibraryModal
        open={libraryOpen}
        mode={libraryMode}
        onClose={() => setLibraryOpen(false)}
        onPick={handlePick}
      />

      {/* Feuille "Déplacer dans un repas" — portail pour la même raison que
          la saisie rapide (transform du SwipeShell). */}
      {movingEntry && ReactDOM.createPortal(
        <div className="adh-overlay" onClick={(e) => { if (e.target === e.currentTarget) setMovingEntry(null); }}>
          <div className="adh-modal" data-no-swipe>
            <div className="adh-header">
              <h2 className="adh-title">Déplacer « {movingEntry.name} »</h2>
              <button type="button" className="adh-close" onClick={() => setMovingEntry(null)} aria-label="Fermer">✕</button>
            </div>
            <div className="nut-move-list">
              {mealGroups.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="nut-move-option"
                  disabled={movingEntry.meal_id === m.id}
                  onClick={() => moveEntry(movingEntry, m.id)}
                >
                  <span>Repas {m.number}</span>
                  <span className="nut-move-hint">
                    {movingEntry.meal_id === m.id
                      ? 'Déjà dedans'
                      : `${m.entries.length} aliment${m.entries.length > 1 ? 's' : ''}`}
                  </span>
                </button>
              ))}
              <button type="button" className="nut-move-option nut-move-option--new" onClick={() => moveEntry(movingEntry, 'new')}>
                <span>+ Nouveau repas</span>
              </button>
              {movingEntry.meal_id && (
                <button type="button" className="nut-move-option" onClick={() => moveEntry(movingEntry, null)}>
                  <span>Sortir du repas</span>
                  <span className="nut-move-hint">aliment seul</span>
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modale saisie rapide (ad-hoc) — rendue dans un portail sur
          document.body pour échapper au transform du SwipeShell qui
          casserait position:fixed et étirait la modale sur les 4 slides. */}
      {adHocOpen && ReactDOM.createPortal(
        <div className="adh-overlay" onClick={(e) => { if (e.target === e.currentTarget) setAdHocOpen(false); }}>
          <div className="adh-modal" data-no-swipe>
            <div className="adh-header">
              <h2 className="adh-title">
                Saisie rapide
                {mealTarget && meals.find(m => m.id === mealTarget) ? ` · Repas ${meals.find(m => m.id === mealTarget).number}` : ''}
              </h2>
              <button type="button" className="adh-close" onClick={() => setAdHocOpen(false)} aria-label="Fermer">✕</button>
            </div>
            <form className="adh-body" onSubmit={submitAdHoc}>
              <label className="flm-field flm-field--name">
                <span>Nom</span>
                <input
                  type="text"
                  value={adHocDraft.name}
                  onChange={(e) => setAdHocDraft({ ...adHocDraft, name: e.target.value })}
                  placeholder="Ex. Pomme"
                  maxLength={120}
                  autoFocus
                />
              </label>

              {/* Toggle "à l'unité" */}
              <label className="flm-field flm-field--name flm-checkbox-field" style={{ marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={adHocDraft.use_unit}
                  onChange={(e) => setAdHocDraft({ ...adHocDraft, use_unit: e.target.checked })}
                />
                <span>Compter à l'unité (ex: 1 pomme, 1 oeuf)</span>
              </label>

              <div className="flm-form-grid">
                {adHocDraft.use_unit && (
                  <>
                    <label className="flm-field">
                      <span>Libellé d'unité</span>
                      <input type="text" maxLength={40}
                        value={adHocDraft.unit_label}
                        onChange={(e) => setAdHocDraft({ ...adHocDraft, unit_label: e.target.value })}
                        placeholder="Ex. pomme"
                      />
                    </label>
                    <label className="flm-field">
                      <span>Poids / unité (g)</span>
                      <input type="number" inputMode="decimal" step="0.1" min="0"
                        value={adHocDraft.grams_per_unit}
                        onChange={(e) => setAdHocDraft({ ...adHocDraft, grams_per_unit: e.target.value })}
                        placeholder="Ex. 180"
                      />
                    </label>
                  </>
                )}

                <label className="flm-field">
                  <span>Calories / 100g</span>
                  <input type="number" inputMode="decimal" step="0.1" min="0"
                    value={adHocDraft.kcal_per_100g}
                    onChange={(e) => setAdHocDraft({ ...adHocDraft, kcal_per_100g: e.target.value })}
                  />
                </label>

                {adHocDraft.use_unit ? (
                  <label className="flm-field">
                    <span>Nombre d'{adHocDraft.unit_label || 'unités'}</span>
                    <input type="number" inputMode="decimal" step="0.5" min="0"
                      value={adHocDraft.quantity_units}
                      onChange={(e) => setAdHocDraft({ ...adHocDraft, quantity_units: e.target.value })}
                      placeholder="1"
                    />
                  </label>
                ) : (
                  <label className="flm-field">
                    <span>Quantité (g)</span>
                    <input type="number" inputMode="decimal" step="1" min="0"
                      value={adHocDraft.quantity_g}
                      onChange={(e) => setAdHocDraft({ ...adHocDraft, quantity_g: e.target.value })}
                      placeholder="100"
                    />
                  </label>
                )}

                <label className="flm-field">
                  <span>Protéines / 100g</span>
                  <input type="number" inputMode="decimal" step="0.1" min="0"
                    value={adHocDraft.protein_per_100g}
                    onChange={(e) => setAdHocDraft({ ...adHocDraft, protein_per_100g: e.target.value })}
                  />
                </label>
                <label className="flm-field">
                  <span>Glucides / 100g</span>
                  <input type="number" inputMode="decimal" step="0.1" min="0"
                    value={adHocDraft.carbs_per_100g}
                    onChange={(e) => setAdHocDraft({ ...adHocDraft, carbs_per_100g: e.target.value })}
                  />
                </label>
                <label className="flm-field">
                  <span>Lipides / 100g</span>
                  <input type="number" inputMode="decimal" step="0.1" min="0"
                    value={adHocDraft.fat_per_100g}
                    onChange={(e) => setAdHocDraft({ ...adHocDraft, fat_per_100g: e.target.value })}
                  />
                </label>
              </div>
              <label className="adh-checkbox">
                <input
                  type="checkbox"
                  checked={adHocDraft.saveToLibrary}
                  onChange={(e) => setAdHocDraft({ ...adHocDraft, saveToLibrary: e.target.checked })}
                />
                <span>Ajouter aussi à ma bibliothèque pour réutilisation</span>
              </label>
              <div className="adh-actions">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setAdHocOpen(false)} disabled={adHocSaving}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary btn-small" disabled={adHocSaving}>
                  {adHocSaving ? '…' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Nutrition;