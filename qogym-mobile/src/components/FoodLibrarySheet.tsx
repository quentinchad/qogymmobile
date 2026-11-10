import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { errMsg, nutritionApi } from '@/lib/api';
import { num, pluralize } from '@/lib/format';
import { colors, radius } from '@/theme';
import { Sheet } from './Sheet';
import { Button, Empty, IconBtn, Input, Loader, T, tap } from './ui';
import { useConfirm } from './Feedback';

export type FoodItem = {
  id: number;
  name: string;
  unit_label?: string | null;
  grams_per_unit?: number | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

export type FoodDraft = {
  name: string;
  use_unit: boolean;
  unit_label: string;
  grams_per_unit: string;
  kcal_per_100g: string;
  protein_per_100g: string;
  carbs_per_100g: string;
  fat_per_100g: string;
};
export const emptyFoodDraft = (): FoodDraft => ({
  name: '',
  use_unit: false,
  unit_label: '',
  grams_per_unit: '',
  kcal_per_100g: '',
  protein_per_100g: '',
  carbs_per_100g: '',
  fat_per_100g: '',
});

/** Valide un brouillon d'aliment ; renvoie le payload API ou un message d'erreur. */
export const foodPayload = (d: FoodDraft): { error?: string; payload?: any } => {
  const name = d.name.trim();
  if (!name) return { error: 'Nom requis' };
  const unitLabel = d.use_unit ? d.unit_label.trim() : null;
  const gpu = d.use_unit ? num(d.grams_per_unit) : null;
  if (d.use_unit && !unitLabel) return { error: "Libellé d'unité requis (ex : pomme)" };
  if (d.use_unit && !((gpu as number) > 0)) return { error: 'Poids par unité invalide' };
  const n = (v: string) => (Number.isFinite(num(v)) ? num(v) : 0);
  return {
    payload: {
      name,
      unit_label: unitLabel,
      grams_per_unit: gpu,
      kcal_per_100g: n(d.kcal_per_100g),
      protein_per_100g: n(d.protein_per_100g),
      carbs_per_100g: n(d.carbs_per_100g),
      fat_per_100g: n(d.fat_per_100g),
    },
  };
};

/** Formulaire partagé : bibliothèque + saisie rapide. */
export function FoodForm({ d, setD }: { d: FoodDraft; setD: (d: FoodDraft) => void }) {
  return (
    <View style={{ gap: 10 }}>
      <Input label="Nom" value={d.name} onChangeText={(v) => setD({ ...d, name: v })} placeholder="Ex. Pain de mie" maxLength={120} />
      <Pressable style={styles.switchRow} onPress={() => setD({ ...d, use_unit: !d.use_unit })}>
        <Text style={{ color: colors.text, flex: 1 }}>Compter à l'unité (1 pomme, 1 œuf…)</Text>
        <Switch
          value={d.use_unit}
          onValueChange={(v) => setD({ ...d, use_unit: v })}
          trackColor={{ true: colors.gold, false: colors.surface3 }}
          thumbColor={colors.text}
        />
      </Pressable>
      {d.use_unit && (
        <View style={styles.grid}>
          <Input containerStyle={styles.cell} label="Unité" value={d.unit_label} onChangeText={(v) => setD({ ...d, unit_label: v })} placeholder="pomme" maxLength={40} />
          <Input containerStyle={styles.cell} label="Poids / unité (g)" value={d.grams_per_unit} onChangeText={(v) => setD({ ...d, grams_per_unit: v })} keyboardType="decimal-pad" placeholder="180" />
        </View>
      )}
      <View style={styles.grid}>
        <Input containerStyle={styles.cell} label="Kcal / 100 g" value={d.kcal_per_100g} onChangeText={(v) => setD({ ...d, kcal_per_100g: v })} keyboardType="decimal-pad" />
        <Input containerStyle={styles.cell} label="Protéines / 100 g" value={d.protein_per_100g} onChangeText={(v) => setD({ ...d, protein_per_100g: v })} keyboardType="decimal-pad" />
      </View>
      <View style={styles.grid}>
        <Input containerStyle={styles.cell} label="Glucides / 100 g" value={d.carbs_per_100g} onChangeText={(v) => setD({ ...d, carbs_per_100g: v })} keyboardType="decimal-pad" />
        <Input containerStyle={styles.cell} label="Lipides / 100 g" value={d.fat_per_100g} onChangeText={(v) => setD({ ...d, fat_per_100g: v })} keyboardType="decimal-pad" />
      </View>
    </View>
  );
}

/**
 * Bibliothèque d'aliments : mode "manage" (créer/modifier/supprimer) ou
 * "picker" (choisir un aliment + quantité pour le journal).
 */
export function FoodLibrarySheet({
  visible,
  mode,
  onClose,
  onPick,
  title,
}: {
  visible: boolean;
  mode: 'manage' | 'picker';
  onClose: () => void;
  onPick?: (item: FoodItem, payload: { quantity_g?: number; quantity_units?: number }) => Promise<void> | void;
  title?: string;
}) {
  const confirm = useConfirm();
  const [items, setItems] = useState<FoodItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<FoodDraft>(emptyFoodDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<FoodItem | null>(null);
  const [qty, setQty] = useState('');

  const load = async () => {
    try {
      const r = await nutritionApi.library();
      setItems(r.items || []);
    } catch (e) {
      setItems([]);
      setError(errMsg(e));
    }
  };

  useEffect(() => {
    if (!visible) return;
    setSearch('');
    setEditing(null);
    setPicked(null);
    setQty('');
    setError('');
    load();
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items || [];
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
  }, [items, search]);

  const save = async () => {
    const { error: e, payload } = foodPayload(draft);
    if (e) return setError(e);
    setSaving(true);
    setError('');
    try {
      if (editing === 'new') await nutritionApi.createItem(payload);
      else if (typeof editing === 'number') await nutritionApi.updateItem(editing, payload);
      setEditing(null);
      await load();
    } catch (err) {
      setError(errMsg(err, 'Erreur lors de la sauvegarde'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (it: FoodItem) => {
    if (!(await confirm({ title: `Supprimer « ${it.name} » ?`, message: 'Les entrées de ton journal qui l’utilisent ne changent pas.', confirmLabel: 'Supprimer', variant: 'danger' })))
      return;
    try {
      await nutritionApi.deleteItem(it.id);
      setItems((p) => (p || []).filter((x) => x.id !== it.id));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const confirmPick = async () => {
    if (!picked) return;
    const q = num(qty);
    if (!(q > 0)) return setError('Quantité invalide');
    setSaving(true);
    try {
      await onPick?.(picked, picked.unit_label ? { quantity_units: q } : { quantity_g: q });
    } finally {
      setSaving(false);
    }
  };

  const footer =
    mode === 'picker' && picked ? (
      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>
          {picked.name}{' '}
          <Text style={{ color: colors.textDim, fontWeight: '400', fontSize: 13 }}>
            {picked.unit_label
              ? `${Math.round((picked.kcal_per_100g * (picked.grams_per_unit || 0)) / 100)} kcal / ${picked.unit_label}`
              : `${Math.round(picked.kcal_per_100g)} kcal / 100 g`}
          </Text>
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <Input
            containerStyle={{ flex: 1 }}
            label={picked.unit_label ? `Nombre de ${pluralize(picked.unit_label, 2)}` : 'Quantité (g)'}
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
            placeholder={picked.unit_label ? '1' : '100'}
            autoFocus
            onSubmitEditing={confirmPick}
          />
          <Button title="Ajouter" onPress={confirmPick} loading={saving} />
        </View>
      </View>
    ) : editing !== null ? (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Annuler" variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
        <Button title={editing === 'new' ? 'Ajouter' : 'Modifier'} onPress={save} loading={saving} style={{ flex: 1 }} />
      </View>
    ) : undefined;

  return (
    <Sheet visible={visible} onClose={onClose} title={title || (mode === 'picker' ? 'Choisir un aliment' : "Bibliothèque d'aliments")} footer={footer} maxHeight={0.92}>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {editing !== null ? (
        <FoodForm d={draft} setD={setDraft} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <Input containerStyle={{ flex: 1 }} value={search} onChangeText={setSearch} placeholder="Rechercher…" />
            {mode === 'manage' && (
              <IconBtn
                name="add"
                bg={colors.gold}
                color="#1a1406"
                onPress={() => {
                  setDraft(emptyFoodDraft());
                  setEditing('new');
                }}
                label="Nouvel aliment"
              />
            )}
          </View>
          {items === null ? (
            <Loader />
          ) : filtered.length === 0 ? (
            <Empty
              icon="nutrition-outline"
              text={search ? 'Aucun aliment ne correspond.' : mode === 'picker' ? 'Ta bibliothèque est vide. Utilise la saisie rapide ou crée des aliments depuis « Bibliothèque ».' : 'Ta bibliothèque est vide. Crée ton premier aliment !'}
            />
          ) : (
            <View style={{ gap: 8, paddingBottom: 8 }}>
              {filtered.map((it) => (
                <Pressable
                  key={it.id}
                  onPress={() => {
                    if (mode !== 'picker') return;
                    tap();
                    setPicked(it);
                    setQty('');
                    setError('');
                  }}
                  style={[styles.item, picked?.id === it.id && { borderColor: colors.gold, backgroundColor: colors.goldSoft }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{it.name}</Text>
                    <Text style={styles.itemStats}>
                      {Math.round(it.kcal_per_100g)} kcal · P {it.protein_per_100g} · G {it.carbs_per_100g} · L {it.fat_per_100g}{' '}
                      <Text style={{ color: colors.textFaint }}>/100 g</Text>
                    </Text>
                    {!!it.unit_label && (
                      <Text style={[styles.itemStats, { color: colors.goldLight }]}>
                        à l'unité · {it.grams_per_unit} g / {it.unit_label}
                      </Text>
                    )}
                  </View>
                  {mode === 'manage' && (
                    <>
                      <IconBtn
                        name="create-outline"
                        size={20}
                        color={colors.textDim}
                        onPress={() => {
                          setDraft({
                            name: it.name,
                            use_unit: !!it.unit_label,
                            unit_label: it.unit_label || '',
                            grams_per_unit: it.grams_per_unit != null ? String(it.grams_per_unit) : '',
                            kcal_per_100g: String(it.kcal_per_100g),
                            protein_per_100g: String(it.protein_per_100g),
                            carbs_per_100g: String(it.carbs_per_100g),
                            fat_per_100g: String(it.fat_per_100g),
                          });
                          setEditing(it.id);
                        }}
                      />
                      <IconBtn name="trash-outline" size={20} color={colors.danger} onPress={() => remove(it)} />
                    </>
                  )}
                </Pressable>
              ))}
            </View>
          )}
          {mode === 'picker' && !picked && (items?.length ?? 0) > 0 && <T v="tiny" style={{ textAlign: 'center', marginTop: 4 }}>Touche un aliment pour choisir la quantité.</T>}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 10 },
  cell: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  itemStats: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, padding: 10, borderRadius: radius.md, marginBottom: 10 },
});
