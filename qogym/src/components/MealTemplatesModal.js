import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { nutritionService } from '../services/api';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmModal';
import FoodLibraryModal from './FoodLibraryModal';
import './MealTemplatesModal.css';

/**
 * Repas types : des repas prédéfinis (ex. « Pâtes poulet » = 200 g de pâtes
 * + 400 g de poulet) qu'on ajoute au journal en un clic. Les aliments ajoutés
 * sont des entrées normales, modifiables ensuite comme les autres.
 *
 * Props :
 *   - open        : boolean
 *   - onClose     : () => void
 *   - date        : 'YYYY-MM-DD' — jour où ajouter
 *   - targetMeal  : { id, number, name } | null — ajouter dans ce repas
 *                   (null = un nouveau repas est créé, nommé comme le repas type)
 *   - seed        : { name, items } | null — ouvre directement l'éditeur
 *                   pré-rempli (« Enregistrer ce repas comme repas type »)
 *   - onApplied   : (mealId) => void — après un ajout au journal
 */

const r1 = (v) => Math.round(v * 10) / 10;

const pluralize = (label, n) => {
  if (!label) return '';
  if (n <= 1 || /[sx]$/i.test(label)) return label;
  return label + 's';
};

const fmtQty = (it) =>
  it.unit_label && it.quantity_units != null
    ? `${it.quantity_units} ${pluralize(it.unit_label, it.quantity_units)}`
    : `${Math.round(it.quantity_g)} g`;

/** Entrée / aliment de repas type → ligne de l'éditeur. */
let keySeq = 0;
const toDraftItem = (src) => {
  const isUnit = !!(src.unit_label && src.grams_per_unit && src.quantity_units != null);
  return {
    key: ++keySeq,
    food_item_id: src.food_item_id ?? null,
    name: src.name,
    unit_label: src.unit_label || null,
    grams_per_unit: src.grams_per_unit ?? null,
    kcal_per_100g: Number(src.kcal_per_100g) || 0,
    protein_per_100g: Number(src.protein_per_100g) || 0,
    carbs_per_100g: Number(src.carbs_per_100g) || 0,
    fat_per_100g: Number(src.fat_per_100g) || 0,
    mode: isUnit ? 'units' : 'grams',
    qty: String(isUnit ? src.quantity_units : Math.round(Number(src.quantity_g) * 10) / 10),
  };
};

const draftGrams = (it) => {
  const q = parseFloat(it.qty);
  if (!(q > 0)) return 0;
  return it.mode === 'units' ? q * (Number(it.grams_per_unit) || 0) : q;
};

const draftToPayload = (it) => ({
  food_item_id: it.food_item_id,
  name: it.name,
  unit_label: it.mode === 'units' ? it.unit_label : (it.unit_label || null),
  grams_per_unit: it.grams_per_unit,
  kcal_per_100g: it.kcal_per_100g,
  protein_per_100g: it.protein_per_100g,
  carbs_per_100g: it.carbs_per_100g,
  fat_per_100g: it.fat_per_100g,
  ...(it.mode === 'units' ? { quantity_units: parseFloat(it.qty) } : { quantity_g: parseFloat(it.qty) }),
});

const MealTemplatesModal = ({ open, onClose, date, targetMeal = null, seed = null, onApplied }) => {
  const { showToast } = useToast();
  const confirm = useConfirm();

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [expanded, setExpanded] = useState({});

  // Éditeur : null = liste ; sinon { id (null = création), name, items }
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await nutritionService.getMealTemplates();
      setTemplates(res.data?.templates || []);
      setUnavailable(false);
    } catch (err) {
      if (err.response?.data?.code === 'migration_needed') setUnavailable(true);
      else showToast(err.response?.data?.error || 'Erreur de chargement des repas types', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setPicking(false);
    setExpanded({});
    setEditor(seed ? { id: null, name: seed.name || '', items: (seed.items || []).map(toDraftItem) } : null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Échap ferme (sauf pendant le choix d'un aliment, géré par sa modale)
  useEffect(() => {
    if (!open || picking) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, picking, onClose]);

  const editorTotals = useMemo(() => {
    if (!editor) return null;
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    editor.items.forEach((it) => {
      const f = draftGrams(it) / 100;
      t.kcal += it.kcal_per_100g * f;
      t.protein += it.protein_per_100g * f;
      t.carbs += it.carbs_per_100g * f;
      t.fat += it.fat_per_100g * f;
    });
    return { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) };
  }, [editor]);

  if (!open) return null;

  // ── Actions ──
  const apply = async (t) => {
    setApplyingId(t.id);
    try {
      const res = await nutritionService.applyMealTemplate(t.id, date, targetMeal?.id || null);
      showToast(`${t.name} ajouté (${res.data?.added ?? t.items.length} aliments)`, 'success');
      onApplied && onApplied(res.data?.meal_id);
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || "Erreur lors de l'ajout", 'error');
    } finally {
      setApplyingId(null);
    }
  };

  const remove = async (t) => {
    const ok = await confirm({
      title: `Supprimer le repas type « ${t.name} » ?`,
      message: 'Les repas déjà ajoutés à ton journal ne sont pas touchés.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await nutritionService.deleteMealTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch (err) {
      showToast(err.response?.data?.error || 'Erreur lors de la suppression', 'error');
    }
  };

  const save = async () => {
    const name = editor.name.trim();
    if (!name) { showToast('Donne un nom à ton repas type', 'error'); return; }
    if (editor.items.length === 0) { showToast('Ajoute au moins un aliment', 'error'); return; }
    const bad = editor.items.find((it) => !(parseFloat(it.qty) > 0));
    if (bad) { showToast(`Quantité invalide pour « ${bad.name} »`, 'error'); return; }
    setSaving(true);
    try {
      const body = { name, items: editor.items.map(draftToPayload) };
      if (editor.id) await nutritionService.updateMealTemplate(editor.id, body);
      else await nutritionService.createMealTemplate(body);
      showToast(editor.id ? 'Repas type modifié' : 'Repas type créé', 'success');
      setEditor(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || "Erreur lors de l'enregistrement", 'error');
    } finally {
      setSaving(false);
    }
  };

  const setItem = (key, patch) =>
    setEditor((ed) => ({ ...ed, items: ed.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));
  const removeItem = (key) => setEditor((ed) => ({ ...ed, items: ed.items.filter((it) => it.key !== key) }));
  const moveItem = (key, delta) => setEditor((ed) => {
    const i = ed.items.findIndex((it) => it.key === key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ed.items.length) return ed;
    const items = [...ed.items];
    [items[i], items[j]] = [items[j], items[i]];
    return { ...ed, items };
  });

  const handlePick = (item, payload) => {
    setEditor((ed) => ({
      ...ed,
      items: [...ed.items, toDraftItem({
        food_item_id: item.id,
        name: item.name,
        unit_label: item.unit_label,
        grams_per_unit: item.grams_per_unit,
        kcal_per_100g: item.kcal_per_100g,
        protein_per_100g: item.protein_per_100g,
        carbs_per_100g: item.carbs_per_100g,
        fat_per_100g: item.fat_per_100g,
        quantity_units: payload.quantity_units ?? null,
        quantity_g: payload.quantity_g ?? (payload.quantity_units || 0) * (item.grams_per_unit || 0),
      })],
    }));
    setPicking(false);
  };

  const targetLabel = targetMeal
    ? `Repas ${targetMeal.number}${targetMeal.name ? ` · ${targetMeal.name}` : ''}`
    : null;

  // ── Rendu ──
  const listView = (
    <>
      <div className="adh-header">
        <h2 className="adh-title">{targetLabel ? `Repas type → ${targetLabel}` : 'Repas types'}</h2>
        <button type="button" className="adh-close" onClick={onClose} aria-label="Fermer">✕</button>
      </div>
      <div className="mtm-body">
        {loading && templates.length === 0 ? (
          <div className="loading-screen"><div className="spinner" /></div>
        ) : unavailable ? (
          <p className="mtm-empty">Les repas types ne sont pas encore disponibles (mise à jour du serveur en attente).</p>
        ) : templates.length === 0 ? (
          <div className="mtm-empty">
            <div className="mtm-empty-icon">🍱</div>
            <p>
              Crée tes repas habituels une fois (ex. « Pâtes poulet »),
              puis ajoute-les en un clic.
            </p>
            <p className="mtm-hint">
              Astuce : un repas déjà dans ton journal peut être enregistré comme
              repas type depuis son menu.
            </p>
          </div>
        ) : (
          <ul className="mtm-list">
            {templates.map((t) => (
              <li key={t.id} className="mtm-card">
                <div className="mtm-card-head">
                  <button
                    type="button"
                    className="mtm-card-main"
                    onClick={() => setExpanded((e) => ({ ...e, [t.id]: !e[t.id] }))}
                    aria-expanded={!!expanded[t.id]}
                  >
                    <span className="mtm-card-name">{t.name}</span>
                    <span className="mtm-card-stats">
                      {Math.round(t.totals.kcal)} kcal · P {t.totals.protein}g · G {t.totals.carbs}g · L {t.totals.fat}g
                    </span>
                    <span className="mtm-card-items">
                      {expanded[t.id]
                        ? null
                        : t.items.map((it) => `${it.name} ${fmtQty(it)}`).join(' · ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-small mtm-apply"
                    onClick={() => apply(t)}
                    disabled={applyingId !== null}
                  >
                    {applyingId === t.id ? '…' : '+ Ajouter'}
                  </button>
                </div>
                {expanded[t.id] && (
                  <div className="mtm-card-detail">
                    <ul className="mtm-detail-list">
                      {t.items.map((it, i) => (
                        <li key={i}>
                          <span>{it.name}</span>
                          <span className="mtm-detail-qty">{fmtQty(it)} · {Math.round(it.totals.kcal)} kcal</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mtm-card-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => setEditor({ id: t.id, name: t.name, items: t.items.map(toDraftItem) })}
                      >
                        Modifier
                      </button>
                      <button type="button" className="btn btn-danger btn-small" onClick={() => remove(t)}>
                        Supprimer
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!unavailable && (
        <div className="mtm-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setEditor({ id: null, name: '', items: [] })}
          >
            + Créer un repas type
          </button>
        </div>
      )}
    </>
  );

  const editorView = editor && (
    <>
      <div className="adh-header">
        <h2 className="adh-title">{editor.id ? 'Modifier le repas type' : 'Nouveau repas type'}</h2>
        <button type="button" className="adh-close" onClick={onClose} aria-label="Fermer">✕</button>
      </div>
      <div className="mtm-body">
        <label className="mtm-field">
          <span>Nom</span>
          <input
            type="text"
            value={editor.name}
            onChange={(e) => setEditor((ed) => ({ ...ed, name: e.target.value }))}
            placeholder="Ex. Pâtes poulet"
            maxLength={80}
            autoFocus={!seed}
          />
        </label>

        {editor.items.length === 0 ? (
          <p className="mtm-empty mtm-empty--small">Aucun aliment pour l'instant.</p>
        ) : (
          <ul className="mtm-edit-list">
            {editor.items.map((it, i) => (
              <li key={it.key} className="mtm-edit-row">
                <div className="mtm-edit-order">
                  <button type="button" onClick={() => moveItem(it.key, -1)} disabled={i === 0} aria-label="Monter">▲</button>
                  <button type="button" onClick={() => moveItem(it.key, 1)} disabled={i === editor.items.length - 1} aria-label="Descendre">▼</button>
                </div>
                <div className="mtm-edit-name">
                  <span>{it.name}</span>
                  <small>{Math.round(it.kcal_per_100g * draftGrams(it) / 100)} kcal</small>
                </div>
                <div className="mtm-edit-qty">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={it.mode === 'units' ? '0.5' : '1'}
                    value={it.qty}
                    onChange={(e) => setItem(it.key, { qty: e.target.value })}
                    aria-label={`Quantité de ${it.name}`}
                  />
                  <span>{it.mode === 'units' ? pluralize(it.unit_label, parseFloat(it.qty) || 0) : 'g'}</span>
                </div>
                <button
                  type="button"
                  className="mtm-edit-remove"
                  onClick={() => removeItem(it.key)}
                  aria-label={`Retirer ${it.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="btn btn-secondary btn-small mtm-add-item" onClick={() => setPicking(true)}>
          + Ajouter un aliment
        </button>

        {editorTotals && editor.items.length > 0 && (
          <div className="mtm-totals">
            Total : <strong>{editorTotals.kcal} kcal</strong> · P {editorTotals.protein}g · G {editorTotals.carbs}g · L {editorTotals.fat}g
          </div>
        )}
      </div>
      <div className="adh-actions mtm-footer">
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => (seed && !editor.id ? onClose() : setEditor(null))}
          disabled={saving}
        >
          {seed && !editor.id ? 'Annuler' : 'Retour'}
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={save} disabled={saving}>
          {saving ? '…' : 'Enregistrer'}
        </button>
      </div>
    </>
  );

  return (
    <>
      {ReactDOM.createPortal(
        <div
          className="adh-overlay"
          style={picking ? { display: 'none' } : undefined}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div className="adh-modal mtm-modal" data-no-swipe role="dialog" aria-modal="true">
            {editor ? editorView : listView}
          </div>
        </div>,
        document.body
      )}
      <FoodLibraryModal
        open={picking}
        mode="picker"
        onClose={() => setPicking(false)}
        onPick={handlePick}
      />
    </>
  );
};

export default MealTemplatesModal;
