import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errMsg, nutritionApi, type MealTemplate, type MealTemplateItemInput } from '@/lib/api';
import { pluralize } from '@/lib/format';
import { colors, radius } from '@/theme';
import { Button, IconBtn, Input, T, tap } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { useConfirm, useToast } from '@/components/Feedback';
import { FoodItem, FoodLibrarySheet } from '@/components/FoodLibrarySheet';

/**
 * Repas types : des repas prédéfinis (ex. « Pâtes poulet » = 200 g de pâtes
 * + 400 g de poulet) ajoutés au journal en un appui. Les aliments ajoutés sont
 * des entrées normales, modifiables ensuite comme les autres.
 *
 * - targetMeal : ajouter dans ce repas (sinon un nouveau repas est créé,
 *   nommé comme le repas type)
 * - seed : ouvre directement l'éditeur pré-rempli (« Enregistrer comme repas type »)
 */

type Target = { id: number; number: number; name?: string | null } | null;
type Seed = { name: string; items: any[] } | null;

type DraftItem = {
  key: number;
  food_item_id: number | null;
  name: string;
  unit_label: string | null;
  grams_per_unit: number | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  mode: 'grams' | 'units';
  qty: string;
};
type Editor = { id: number | null; name: string; items: DraftItem[] } | null;

let keySeq = 0;
const toDraft = (src: any): DraftItem => {
  const isUnit = !!(src.unit_label && src.grams_per_unit && src.quantity_units != null);
  return {
    key: ++keySeq,
    food_item_id: src.food_item_id ?? null,
    name: src.name,
    unit_label: src.unit_label || null,
    grams_per_unit: src.grams_per_unit != null ? Number(src.grams_per_unit) : null,
    kcal_per_100g: Number(src.kcal_per_100g) || 0,
    protein_per_100g: Number(src.protein_per_100g) || 0,
    carbs_per_100g: Number(src.carbs_per_100g) || 0,
    fat_per_100g: Number(src.fat_per_100g) || 0,
    mode: isUnit ? 'units' : 'grams',
    qty: String(isUnit ? src.quantity_units : Math.round(Number(src.quantity_g) * 10) / 10),
  };
};
const qtyNum = (s: string) => parseFloat(s.replace(',', '.'));
const draftGrams = (it: DraftItem) => {
  const q = qtyNum(it.qty);
  if (!(q > 0)) return 0;
  return it.mode === 'units' ? q * (it.grams_per_unit || 0) : q;
};
const toPayload = (it: DraftItem): MealTemplateItemInput => ({
  food_item_id: it.food_item_id,
  name: it.name,
  unit_label: it.unit_label,
  grams_per_unit: it.grams_per_unit,
  kcal_per_100g: it.kcal_per_100g,
  protein_per_100g: it.protein_per_100g,
  carbs_per_100g: it.carbs_per_100g,
  fat_per_100g: it.fat_per_100g,
  ...(it.mode === 'units' ? { quantity_units: qtyNum(it.qty) } : { quantity_g: qtyNum(it.qty) }),
});
const fmtQty = (it: { unit_label: string | null; quantity_units: number | null; quantity_g: number }) =>
  it.unit_label && it.quantity_units != null ? `${it.quantity_units} ${pluralize(it.unit_label, it.quantity_units)}` : `${Math.round(it.quantity_g)} g`;

export function MealTemplatesSheet({
  visible,
  onClose,
  date,
  targetMeal,
  seed,
  onApplied,
}: {
  visible: boolean;
  onClose: () => void;
  date: string;
  targetMeal: Target;
  seed: Seed;
  onApplied: (mealId: number | null) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<MealTemplate[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [applying, setApplying] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await nutritionApi.templates();
      setTemplates(r.templates || []);
      setUnavailable(false);
    } catch (e: any) {
      if (e?.data?.code === 'migration_needed') setUnavailable(true);
      else toast(errMsg(e, 'Erreur de chargement des repas types'), 'error');
      setTemplates((t) => t ?? []);
    }
  }, [toast]);

  // À chaque ouverture : liste fraîche, ou éditeur pré-rempli
  const [openedFor, setOpenedFor] = useState<boolean>(false);
  if (visible !== openedFor) {
    setOpenedFor(visible);
    if (visible) {
      setPicking(false);
      setExpanded({});
      setEditor(seed ? { id: null, name: seed.name || '', items: seed.items.map(toDraft) } : null);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() ne met l'état à jour qu'après la réponse réseau
    if (visible) load();
  }, [visible, load]);

  const totals = useMemo(() => {
    if (!editor) return null;
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    editor.items.forEach((it) => {
      const f = draftGrams(it) / 100;
      t.kcal += it.kcal_per_100g * f;
      t.protein += it.protein_per_100g * f;
      t.carbs += it.carbs_per_100g * f;
      t.fat += it.fat_per_100g * f;
    });
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) };
  }, [editor]);

  const apply = async (t: MealTemplate) => {
    setApplying(t.id);
    try {
      const r = await nutritionApi.applyTemplate(t.id, date, targetMeal?.id ?? null);
      toast(`${t.name} ajouté (${r.added} aliment${r.added > 1 ? 's' : ''})`, 'success');
      onApplied(r.meal_id ?? null);
      onClose();
    } catch (e) {
      toast(errMsg(e, "Erreur lors de l'ajout"), 'error');
    } finally {
      setApplying(null);
    }
  };

  const remove = async (t: MealTemplate) => {
    if (!(await confirm({ title: `Supprimer « ${t.name} » ?`, message: 'Les repas déjà ajoutés à ton journal ne sont pas touchés.', confirmLabel: 'Supprimer', variant: 'danger' })))
      return;
    try {
      await nutritionApi.deleteTemplate(t.id);
      setTemplates((prev) => (prev || []).filter((x) => x.id !== t.id));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const save = async () => {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) return toast('Donne un nom à ton repas type', 'error');
    if (!editor.items.length) return toast('Ajoute au moins un aliment', 'error');
    const bad = editor.items.find((it) => !(qtyNum(it.qty) > 0));
    if (bad) return toast(`Quantité invalide pour « ${bad.name} »`, 'error');
    setSaving(true);
    try {
      const body = { name, items: editor.items.map(toPayload) };
      if (editor.id) await nutritionApi.updateTemplate(editor.id, body);
      else await nutritionApi.createTemplate(body);
      toast(editor.id ? 'Repas type modifié' : 'Repas type créé', 'success');
      setEditor(null);
      load();
    } catch (e) {
      toast(errMsg(e, "Erreur lors de l'enregistrement"), 'error');
    } finally {
      setSaving(false);
    }
  };

  const setItem = (key: number, patch: Partial<DraftItem>) =>
    setEditor((ed) => (ed ? { ...ed, items: ed.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) } : ed));
  const removeItem = (key: number) => setEditor((ed) => (ed ? { ...ed, items: ed.items.filter((it) => it.key !== key) } : ed));

  const onPick = (item: FoodItem, payload: { quantity_g?: number; quantity_units?: number }) => {
    setEditor((ed) =>
      ed
        ? {
            ...ed,
            items: [
              ...ed.items,
              toDraft({
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
              }),
            ],
          }
        : ed,
    );
    setPicking(false);
  };

  const targetLabel = targetMeal ? `Repas ${targetMeal.number}${targetMeal.name ? ` · ${targetMeal.name}` : ''}` : null;

  const listContent = (
    <View style={{ gap: 10, paddingBottom: 8 }}>
      {templates === null ? (
        <ActivityIndicator color={colors.gold} style={{ padding: 24 }} />
      ) : unavailable ? (
        <T v="small" style={{ textAlign: 'center', padding: 12 }}>
          Les repas types ne sont pas encore disponibles (mise à jour du serveur en attente).
        </T>
      ) : templates.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="fast-food-outline" size={30} color={colors.gold} />
          <Text style={styles.emptyText}>Crée tes repas habituels une fois (ex. « Pâtes poulet »), puis ajoute-les en un appui.</Text>
          <T v="small" style={{ textAlign: 'center' }}>
            Astuce : un repas de ton journal peut aussi être enregistré comme repas type.
          </T>
        </View>
      ) : (
        templates.map((t) => {
          const open = !!expanded[t.id];
          return (
            <View key={t.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => {
                    tap();
                    setExpanded((e) => ({ ...e, [t.id]: !e[t.id] }));
                  }}
                >
                  <Text style={styles.cardName}>{t.name}</Text>
                  <Text style={styles.cardStats}>
                    {Math.round(t.totals.kcal)} kcal · P {t.totals.protein} · G {t.totals.carbs} · L {t.totals.fat}
                  </Text>
                  {!open && (
                    <Text style={styles.cardItems} numberOfLines={1}>
                      {t.items.map((it) => `${it.name} ${fmtQty(it)}`).join(' · ')}
                    </Text>
                  )}
                </Pressable>
                <Button title="Ajouter" icon="add" small onPress={() => apply(t)} loading={applying === t.id} disabled={applying !== null} />
              </View>
              {open && (
                <View style={{ gap: 6, paddingTop: 8 }}>
                  {t.items.map((it, i) => (
                    <View key={i} style={styles.detailRow}>
                      <Text style={styles.detailName} numberOfLines={1}>
                        {it.name}
                      </Text>
                      <Text style={styles.detailQty}>
                        {fmtQty(it)} · {Math.round(it.totals.kcal)} kcal
                      </Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <Button title="Modifier" small variant="secondary" icon="create-outline" onPress={() => setEditor({ id: t.id, name: t.name, items: t.items.map(toDraft) })} style={{ flex: 1 }} />
                    <Button title="Supprimer" small variant="danger" icon="trash-outline" onPress={() => remove(t)} style={{ flex: 1 }} />
                  </View>
                </View>
              )}
            </View>
          );
        })
      )}
    </View>
  );

  const editorContent = editor && (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <Input label="Nom" value={editor.name} onChangeText={(v) => setEditor((ed) => (ed ? { ...ed, name: v } : ed))} placeholder="Ex. Pâtes poulet" maxLength={80} />
      {editor.items.length === 0 ? (
        <T v="small">Aucun aliment pour l’instant.</T>
      ) : (
        editor.items.map((it) => (
          <View key={it.key} style={styles.editRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.detailName} numberOfLines={1}>
                {it.name}
              </Text>
              <Text style={styles.cardItems}>{Math.round((it.kcal_per_100g * draftGrams(it)) / 100)} kcal</Text>
            </View>
            <TextInput
              value={it.qty}
              onChangeText={(v) => setItem(it.key, { qty: v })}
              keyboardType="decimal-pad"
              style={styles.qtyInput}
              selectionColor={colors.gold}
              accessibilityLabel={`Quantité de ${it.name}`}
            />
            <Text style={styles.unit}>{it.mode === 'units' ? pluralize(it.unit_label || '', qtyNum(it.qty) || 0) : 'g'}</Text>
            <IconBtn name="close" size={18} color={colors.danger} onPress={() => removeItem(it.key)} label={`Retirer ${it.name}`} />
          </View>
        ))
      )}
      <Button title="Ajouter un aliment" icon="add" small variant="secondary" onPress={() => setPicking(true)} />
      {!!totals && editor.items.length > 0 && (
        <View style={styles.totals}>
          <Text style={styles.totalsText}>
            Total : <Text style={{ color: colors.text, fontWeight: '800' }}>{totals.kcal} kcal</Text> · P {totals.protein} · G {totals.carbs} · L {totals.fat}
          </Text>
        </View>
      )}
    </View>
  );

  const fromSeed = !!seed && !editor?.id;
  const footer = editor ? (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Button title={fromSeed ? 'Annuler' : 'Retour'} variant="secondary" onPress={() => (fromSeed ? onClose() : setEditor(null))} style={{ flex: 1 }} disabled={saving} />
      <Button title="Enregistrer" onPress={save} loading={saving} style={{ flex: 1 }} />
    </View>
  ) : unavailable ? undefined : (
    <Button title="Créer un repas type" icon="add" variant="secondary" onPress={() => setEditor({ id: null, name: '', items: [] })} />
  );

  return (
    <>
      <Sheet
        visible={visible && !picking}
        onClose={onClose}
        title={editor ? (editor.id ? 'Modifier le repas type' : 'Nouveau repas type') : targetLabel ? `Repas type → ${targetLabel}` : 'Repas types'}
        footer={footer}
        maxHeight={0.92}
      >
        {editor ? editorContent : listContent}
      </Sheet>
      <FoodLibrarySheet visible={visible && picking} mode="picker" onClose={() => setPicking(false)} onPick={onPick} title="Ajouter au repas type" />
    </>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 8, padding: 16 },
  emptyText: { color: colors.text, textAlign: 'center', fontSize: 15, lineHeight: 21 },
  card: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardName: { color: colors.text, fontWeight: '800', fontSize: 16 },
  cardStats: { color: colors.goldLight, fontSize: 12, fontWeight: '700', marginTop: 2 },
  cardItems: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailName: { color: colors.text, fontWeight: '700', fontSize: 14, flexShrink: 1 },
  detailQty: { color: colors.textDim, fontSize: 13 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface2, borderRadius: radius.md, paddingVertical: 6, paddingLeft: 12, paddingRight: 4 },
  qtyInput: {
    width: 70,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    color: colors.text,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
  },
  unit: { color: colors.textDim, fontSize: 13, minWidth: 18 },
  totals: { backgroundColor: colors.goldSoft, borderRadius: radius.md, padding: 10 },
  totalsText: { color: colors.textDim, fontSize: 13 },
});
