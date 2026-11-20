import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { nutritionService } from '../services/api';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmModal';
import './FoodLibraryModal.css';

/**
 * Modale de gestion / sélection d'aliments de la bibliothèque.
 *
 * Deux modes :
 *  - mode="manage"  : juste gérer ses items (créer/modifier/supprimer)
 *  - mode="picker"  : sélectionner un item pour l'ajouter au journal du jour
 *                     (onPick callback déclenché)
 *
 * Props :
 *   - open         : boolean
 *   - mode         : 'manage' | 'picker'
 *   - onClose      : () => void
 *   - onPick       : (item, payload) => void   (mode picker)
 *                    payload = { quantity_g } (saisie en grammes) ou
 *                              { quantity_units } (saisie en unités)
 *
 * Support des unités :
 *   Un aliment peut être défini "à l'unité" (ex: 1 pomme = 180g, 1 oeuf = 60g)
 *   en cochant "À l'unité ?" dans le formulaire et en renseignant le label
 *   et le poids moyen d'une unité. Côté picker, la saisie se fait alors en
 *   nombre d'unités plutôt qu'en grammes.
 *
 * Recherche de vrais produits (Open Food Facts) :
 *   Depuis le champ de recherche, "Chercher dans les produits du commerce"
 *   interroge qogym-api/food_search.php. Les résultats s'affichent avec leur
 *   photo ; un clic pré-remplit le formulaire (nom, marque, macros / 100g).
 *   La photo n'est PAS stockée : elle ne sert qu'à choisir le bon produit.
 *   En mode picker, l'aliment créé est directement sélectionné pour saisir
 *   la quantité.
 */
const emptyDraft = () => ({
  name: '',
  use_unit: false,                 // si true → l'aliment se saisit à l'unité
  unit_label: '',                  // ex: "pomme", "oeuf"
  grams_per_unit: '',              // poids moyen d'une unité en grammes
  kcal_per_100g: '', protein_per_100g: '', carbs_per_100g: '', fat_per_100g: '',
});

const FoodLibraryModal = ({ open, mode = 'manage', onClose, onPick }) => {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [editingId, setEditingId] = useState(null); // id en cours d'édition (null = aucun)
  const [draft, setDraft]       = useState(emptyDraft());
  const [adding, setAdding]     = useState(false);  // formulaire de création visible
  const [saving, setSaving]     = useState(false);

  // Picker : item sélectionné + quantité saisie
  const [pickedItem, setPickedItem]       = useState(null);
  const [pickedQuantity, setPickedQuantity] = useState('');

  // Recherche produits du commerce (Open Food Facts)
  const [offQuery, setOffQuery]       = useState('');    // dernière recherche lancée
  const [offResults, setOffResults]   = useState(null);  // null = pas de recherche affichée
  const [offLoading, setOffLoading]   = useState(false);
  const [offPage, setOffPage]         = useState(1);
  const [offHasMore, setOffHasMore]   = useState(false);
  const [offError, setOffError]       = useState(null);
  const [sourceProduct, setSourceProduct] = useState(null); // produit OFF à l'origine du formulaire

  const { showToast } = useToast();
  const { confirm }   = useConfirm();

  useEffect(() => {
    if (!open) return;
    loadLibrary();
    // Reset des states transitoires à chaque ouverture
    setSearch(''); setEditingId(null); setAdding(false); setDraft(emptyDraft());
    setPickedItem(null); setPickedQuantity('');
    setOffQuery(''); setOffResults(null); setOffError(null); setSourceProduct(null);
  }, [open]);

  const loadLibrary = async () => {
    setLoading(true);
    try {
      const res = await nutritionService.getLibrary();
      const list = res.data?.items || [];
      setItems(list);
      return list;
    } catch (err) {
      showToast('Erreur lors du chargement de la bibliothèque', 'error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter(it => it.name.toLowerCase().includes(s));
  }, [items, search]);

  // ── Recherche produits du commerce ──
  const runProductSearch = async (page = 1) => {
    const q = (page === 1 ? search : offQuery).trim();
    if (q.length < 2) { showToast('Tape au moins 2 caractères', 'error'); return; }
    setOffLoading(true);
    setOffError(null);
    if (page === 1) { setOffResults([]); setOffQuery(q); }
    try {
      const res = await nutritionService.searchProducts(q, page);
      const products = res.data?.products || [];
      setOffResults(prev => (page === 1 ? products : [...(prev || []), ...products]));
      setOffHasMore(!!res.data?.has_more);
      setOffPage(page);
    } catch (err) {
      setOffError(err.response?.data?.error || 'Recherche impossible pour le moment');
    } finally {
      setOffLoading(false);
    }
  };

  const closeProductSearch = () => {
    setOffResults(null); setOffError(null); setOffQuery('');
  };

  // Nom proposé : "Nutella (Ferrero)" — on n'ajoute pas la marque si elle
  // figure déjà dans le nom du produit.
  const productDisplayName = (p) => {
    if (!p.brand || p.name.toLowerCase().includes(p.brand.toLowerCase())) return p.name;
    return `${p.name} (${p.brand})`;
  };

  const selectProduct = (p) => {
    setEditingId(null);
    setAdding(true);
    setPickedItem(null);
    setSourceProduct(p);
    setDraft({
      name: productDisplayName(p).slice(0, 120),
      use_unit: false,
      // Portion indiquée sur l'emballage : pré-remplie si l'utilisateur
      // choisit de compter à l'unité.
      unit_label: p.serving_g ? 'portion' : '',
      grams_per_unit: p.serving_g ? String(p.serving_g) : '',
      kcal_per_100g:    String(p.kcal_per_100g ?? ''),
      protein_per_100g: String(p.protein_per_100g ?? ''),
      carbs_per_100g:   String(p.carbs_per_100g ?? ''),
      fat_per_100g:     String(p.fat_per_100g ?? ''),
    });
    setOffResults(null);
  };

  // ── Création / édition ──
  const startAdding = () => {
    setAdding(true);
    setEditingId(null);
    setSourceProduct(null);
    setDraft(emptyDraft());
  };
  const startEditing = (item) => {
    setAdding(false);
    setSourceProduct(null);
    setEditingId(item.id);
    setDraft({
      name: item.name,
      use_unit: !!item.unit_label,
      unit_label: item.unit_label || '',
      grams_per_unit: item.grams_per_unit != null ? String(item.grams_per_unit) : '',
      kcal_per_100g: String(item.kcal_per_100g),
      protein_per_100g: String(item.protein_per_100g),
      carbs_per_100g: String(item.carbs_per_100g),
      fat_per_100g: String(item.fat_per_100g),
    });
  };
  const cancelEdit = () => {
    setAdding(false); setEditingId(null); setDraft(emptyDraft()); setSourceProduct(null);
  };

  const saveDraft = async () => {
    const useUnit = draft.use_unit;
    const unitLabel = useUnit ? draft.unit_label.trim() : null;
    const gramsPerUnit = useUnit ? parseFloat(draft.grams_per_unit) : null;

    if (useUnit) {
      if (!unitLabel) { showToast('Libellé de l\'unité requis (ex: pomme)', 'error'); return; }
      if (!(gramsPerUnit > 0)) { showToast('Poids par unité invalide', 'error'); return; }
    }

    const payload = {
      name: draft.name.trim(),
      unit_label:       unitLabel,
      grams_per_unit:   gramsPerUnit,
      kcal_per_100g:    parseFloat(draft.kcal_per_100g) || 0,
      protein_per_100g: parseFloat(draft.protein_per_100g) || 0,
      carbs_per_100g:   parseFloat(draft.carbs_per_100g) || 0,
      fat_per_100g:     parseFloat(draft.fat_per_100g) || 0,
    };
    if (!payload.name) { showToast('Nom requis', 'error'); return; }
    setSaving(true);
    try {
      let createdId = null;
      if (editingId) {
        await nutritionService.updateLibraryItem(editingId, payload);
        showToast('Aliment modifié', 'success');
      } else {
        const r = await nutritionService.createLibraryItem(payload);
        createdId = r.data?.id != null ? Number(r.data.id) : null;
        showToast('Aliment ajouté à la bibliothèque', 'success');
      }
      const list = await loadLibrary();
      cancelEdit();
      // Mode picker : l'aliment fraîchement créé est sélectionné directement
      // pour saisir la quantité.
      if (mode === 'picker' && createdId != null && list) {
        const created = list.find(i => Number(i.id) === createdId);
        if (created) { setPickedItem(created); setPickedQuantity(''); }
      }
    } catch (err) {
      // Déjà présent dans la biblio (même nom) : en picker on le sélectionne.
      if (err.response?.status === 409 && mode === 'picker' && !editingId) {
        const existing = items.find(i => i.name.trim().toLowerCase() === payload.name.toLowerCase());
        if (existing) {
          cancelEdit();
          setPickedItem(existing); setPickedQuantity('');
          showToast('Déjà dans ta bibliothèque, sélectionné', 'info');
          return;
        }
      }
      showToast(err.response?.data?.error || 'Erreur lors de la sauvegarde', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    const ok = await confirm({
      title: `Supprimer "${item.name}" ?`,
      message: "L'aliment sera retiré de ta bibliothèque. Les entrées de ton journal qui l'utilisent ne seront pas modifiées.",
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await nutritionService.deleteLibraryItem(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      showToast('Aliment supprimé', 'success');
    } catch (err) {
      showToast('Erreur lors de la suppression', 'error');
    }
  };

  // ── Picker ──
  const handlePickConfirm = () => {
    if (!pickedItem) return;
    const qty = parseFloat(pickedQuantity);
    if (!(qty > 0)) { showToast('Quantité invalide', 'error'); return; }
    // Si l'aliment est défini à l'unité → on envoie quantity_units, sinon
    // on envoie quantity_g comme avant.
    if (pickedItem.unit_label) {
      onPick && onPick(pickedItem, { quantity_units: qty });
    } else {
      onPick && onPick(pickedItem, { quantity_g: qty });
    }
    setPickedItem(null);
    setPickedQuantity('');
  };

  // Helper pour pluraliser un libellé d'unité (ex: 2 "pommes")
  const pluralize = (label, n) => {
    if (!label) return '';
    if (n <= 1) return label;
    // Pluriel naïf : on n'ajoute un "s" que si le mot n'en a pas déjà un.
    if (/s$/i.test(label) || /x$/i.test(label)) return label;
    return label + 's';
  };

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="flm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flm-modal" onClick={(e) => e.stopPropagation()} data-no-swipe>
        <div className="flm-header">
          <h2 className="flm-title">
            {mode === 'picker' ? 'Choisir un aliment' : 'Bibliothèque d\'aliments'}
          </h2>
          <button type="button" className="flm-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="flm-body">
          {/* Recherche */}
          <input
            type="text"
            className="flm-search"
            placeholder="Rechercher un aliment ou un produit (ex. nutella)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim().length >= 2) {
                e.preventDefault();
                runProductSearch(1);
              }
            }}
          />

          {/* Recherche dans les produits du commerce (Open Food Facts) */}
          {!adding && !editingId && search.trim().length >= 2 && offResults === null && (
            <button
              type="button"
              className="btn btn-outline flm-off-btn"
              onClick={() => runProductSearch(1)}
            >
              🔎 Chercher « {search.trim()} » dans les produits du commerce
            </button>
          )}

          {offResults !== null && (
            <div className="flm-off">
              <div className="flm-off-head">
                <span className="flm-off-title">Produits du commerce · « {offQuery} »</span>
                <button type="button" className="flm-icon-btn" onClick={closeProductSearch} title="Fermer la recherche">✕</button>
              </div>
              {offError && <div className="flm-empty">{offError}</div>}
              {!offError && !offLoading && offResults.length === 0 && (
                <div className="flm-empty">Aucun produit trouvé. Essaie un autre nom ou le code-barres.</div>
              )}
              <div className="flm-off-list">
                {offResults.map((p, idx) => (
                  <button
                    key={`${p.code}-${idx}`}
                    type="button"
                    className="flm-off-item"
                    onClick={() => selectProduct(p)}
                  >
                    <div className="flm-off-thumb">
                      {p.image
                        ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        : <span>🍽️</span>}
                    </div>
                    <div className="flm-off-info">
                      <div className="flm-item-name">{p.name}</div>
                      <div className="flm-off-meta">
                        {[p.brand, p.quantity].filter(Boolean).join(' · ')}
                      </div>
                      <div className="flm-item-stats">
                        {Math.round(p.kcal_per_100g)} kcal · P {p.protein_per_100g}g · G {p.carbs_per_100g}g · L {p.fat_per_100g}g
                        <span className="flm-item-per">/ 100g</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {offLoading && <div className="flm-loading"><div className="spinner" /></div>}
              {!offLoading && offHasMore && (
                <button type="button" className="btn btn-secondary btn-small flm-off-more" onClick={() => runProductSearch(offPage + 1)}>
                  Plus de résultats
                </button>
              )}
              <div className="flm-off-credit">Données Open Food Facts — vérifie les valeurs avant d'ajouter.</div>
            </div>
          )}

          {/* Bouton "+ Nouvel aliment" (mode manage uniquement, pour éviter
              de surcharger le picker) */}
          {!adding && !editingId && mode === 'manage' && (
            <button type="button" className="btn btn-secondary flm-add-btn" onClick={startAdding}>
              + Nouvel aliment
            </button>
          )}

          {/* Formulaire de création/édition */}
          {(adding || editingId) && (
            <div className="flm-form">
              {sourceProduct && (
                <div className="flm-form-source">
                  <div className="flm-off-thumb flm-off-thumb--lg">
                    {sourceProduct.image
                      ? <img src={sourceProduct.image} alt="" referrerPolicy="no-referrer" />
                      : <span>🍽️</span>}
                  </div>
                  <div className="flm-off-info">
                    <div className="flm-item-name">{sourceProduct.name}</div>
                    <div className="flm-off-meta">
                      {[sourceProduct.brand, sourceProduct.quantity].filter(Boolean).join(' · ')}
                    </div>
                    <div className="flm-off-meta">Valeurs pré-remplies, modifiables avant l'ajout.</div>
                  </div>
                </div>
              )}
              <div className="flm-form-grid">
                <label className="flm-field flm-field--name">
                  <span>Nom</span>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Ex. Pain de mie"
                    maxLength={120}
                    autoFocus
                  />
                </label>

                {/* Toggle "À l'unité ?" */}
                <label className="flm-field flm-field--name flm-checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.use_unit}
                    onChange={(e) => setDraft({ ...draft, use_unit: e.target.checked })}
                  />
                  <span>Compter à l'unité (ex: 1 pomme, 1 oeuf)</span>
                </label>

                {/* Champs unité (visibles seulement si toggle activé) */}
                {draft.use_unit && (
                  <>
                    <label className="flm-field">
                      <span>Libellé d'unité</span>
                      <input
                        type="text"
                        value={draft.unit_label}
                        onChange={(e) => setDraft({ ...draft, unit_label: e.target.value })}
                        placeholder="Ex. pomme, oeuf, tranche…"
                        maxLength={40}
                      />
                    </label>
                    <label className="flm-field">
                      <span>Poids moyen / unité (g)</span>
                      <input
                        type="number" inputMode="decimal" step="0.1" min="0"
                        value={draft.grams_per_unit}
                        onChange={(e) => setDraft({ ...draft, grams_per_unit: e.target.value })}
                        placeholder="Ex. 180"
                      />
                    </label>
                  </>
                )}

                <label className="flm-field">
                  <span>Calories / 100g</span>
                  <input
                    type="number" inputMode="decimal" step="0.1" min="0"
                    value={draft.kcal_per_100g}
                    onChange={(e) => setDraft({ ...draft, kcal_per_100g: e.target.value })}
                  />
                </label>
                <label className="flm-field">
                  <span>Protéines / 100g</span>
                  <input
                    type="number" inputMode="decimal" step="0.1" min="0"
                    value={draft.protein_per_100g}
                    onChange={(e) => setDraft({ ...draft, protein_per_100g: e.target.value })}
                  />
                </label>
                <label className="flm-field">
                  <span>Glucides / 100g</span>
                  <input
                    type="number" inputMode="decimal" step="0.1" min="0"
                    value={draft.carbs_per_100g}
                    onChange={(e) => setDraft({ ...draft, carbs_per_100g: e.target.value })}
                  />
                </label>
                <label className="flm-field">
                  <span>Lipides / 100g</span>
                  <input
                    type="number" inputMode="decimal" step="0.1" min="0"
                    value={draft.fat_per_100g}
                    onChange={(e) => setDraft({ ...draft, fat_per_100g: e.target.value })}
                  />
                </label>
              </div>
              <div className="flm-form-actions">
                <button type="button" className="btn btn-secondary btn-small" onClick={cancelEdit} disabled={saving}>
                  Annuler
                </button>
                <button type="button" className="btn btn-primary btn-small" onClick={saveDraft} disabled={saving}>
                  {saving ? '…' : (editingId ? 'Modifier' : 'Ajouter')}
                </button>
              </div>
            </div>
          )}

          {/* Liste des items */}
          {loading ? (
            <div className="flm-loading"><div className="spinner" /></div>
          ) : (
            <div className="flm-list">
              {filtered.length === 0 ? (
                <div className="flm-empty">
                  {search.trim()
                    ? "Aucun aliment ne correspond à ta recherche."
                    : "Ta bibliothèque est vide. Crée ton premier aliment !"}
                </div>
              ) : (
                filtered.map((item) => {
                  const hasUnit = !!item.unit_label;
                  return (
                    <div key={item.id} className="flm-item">
                      <div className="flm-item-main"
                           onClick={() => mode === 'picker' ? setPickedItem(item) : null}
                           role={mode === 'picker' ? 'button' : undefined}
                           tabIndex={mode === 'picker' ? 0 : undefined}>
                        <div className="flm-item-name">
                          {item.name}
                          {hasUnit && (
                            <span className="flm-item-unit-tag">
                              à l'unité ({item.grams_per_unit}g / {item.unit_label})
                            </span>
                          )}
                        </div>
                        <div className="flm-item-stats">
                          {Math.round(item.kcal_per_100g)} kcal · P {item.protein_per_100g}g · G {item.carbs_per_100g}g · L {item.fat_per_100g}g
                          <span className="flm-item-per">/ 100g</span>
                        </div>
                      </div>
                      {mode === 'manage' && (
                        <div className="flm-item-actions">
                          <button type="button" className="flm-icon-btn" onClick={() => startEditing(item)} title="Modifier">✏️</button>
                          <button type="button" className="flm-icon-btn flm-icon-btn--danger" onClick={() => handleDelete(item)} title="Supprimer">🗑️</button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Footer du picker — quantité à sélectionner */}
        {mode === 'picker' && pickedItem && (
          <div className="flm-picker-footer">
            <div className="flm-picker-summary">
              <strong>{pickedItem.name}</strong>
              <span className="flm-item-stats">
                {pickedItem.unit_label ? (
                  <>
                    {Math.round(pickedItem.kcal_per_100g * pickedItem.grams_per_unit / 100)} kcal / {pickedItem.unit_label}
                    <span className="flm-item-per"> · {pickedItem.grams_per_unit}g</span>
                  </>
                ) : (
                  <>{Math.round(pickedItem.kcal_per_100g)} kcal / 100g</>
                )}
              </span>
            </div>
            <div className="flm-picker-row">
              {pickedItem.unit_label ? (
                <label className="flm-field flm-field--qty">
                  <span>Nombre de {pluralize(pickedItem.unit_label, 2)}</span>
                  <input
                    type="number" inputMode="decimal" step="0.5" min="0"
                    value={pickedQuantity}
                    onChange={(e) => setPickedQuantity(e.target.value)}
                    autoFocus
                    placeholder="1"
                  />
                </label>
              ) : (
                <label className="flm-field flm-field--qty">
                  <span>Quantité (g)</span>
                  <input
                    type="number" inputMode="decimal" step="1" min="0"
                    value={pickedQuantity}
                    onChange={(e) => setPickedQuantity(e.target.value)}
                    autoFocus
                    placeholder="100"
                  />
                </label>
              )}
              <button type="button" className="btn btn-secondary btn-small" onClick={() => { setPickedItem(null); setPickedQuantity(''); }}>
                Annuler
              </button>
              <button type="button" className="btn btn-primary btn-small" onClick={handlePickConfirm}>
                Ajouter
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default FoodLibraryModal;