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

  const { showToast } = useToast();
  const { confirm }   = useConfirm();

  useEffect(() => {
    if (!open) return;
    loadLibrary();
    // Reset des states transitoires à chaque ouverture
    setSearch(''); setEditingId(null); setAdding(false); setDraft(emptyDraft());
    setPickedItem(null); setPickedQuantity('');
  }, [open]);

  const loadLibrary = async () => {
    setLoading(true);
    try {
      const res = await nutritionService.getLibrary();
      setItems(res.data?.items || []);
    } catch (err) {
      showToast('Erreur lors du chargement de la bibliothèque', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter(it => it.name.toLowerCase().includes(s));
  }, [items, search]);

  // ── Création / édition ──
  const startAdding = () => {
    setAdding(true);
    setEditingId(null);
    setDraft(emptyDraft());
  };
  const startEditing = (item) => {
    setAdding(false);
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
    setAdding(false); setEditingId(null); setDraft(emptyDraft());
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
      if (editingId) {
        await nutritionService.updateLibraryItem(editingId, payload);
        showToast('Aliment modifié', 'success');
      } else {
        await nutritionService.createLibraryItem(payload);
        showToast('Aliment ajouté à la bibliothèque', 'success');
      }
      await loadLibrary();
      cancelEdit();
    } catch (err) {
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
            placeholder="Rechercher dans la bibliothèque…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

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