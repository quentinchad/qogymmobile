import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errMsg, nutritionApi, prefsApi } from '@/lib/api';
import { store } from '@/lib/storage';
import { fmtDayLabel, num, pluralize, shiftISO, todayISO } from '@/lib/format';
import { colors, radius } from '@/theme';
import { Button, Card, Empty, IconBtn, Input, Loader, TabTitle, T, tap } from '@/components/ui';
import { Bar, Ring } from '@/components/Visuals';
import { Sheet } from '@/components/Sheet';
import { useConfirm, useToast } from '@/components/Feedback';
import { emptyFoodDraft, FoodDraft, FoodForm, FoodItem, FoodLibrarySheet, foodPayload } from '@/components/FoodLibrarySheet';
import type { TabScreenProps } from '@/app/index';

type Totals = { kcal: number; protein: number; carbs: number; fat: number };
type Targets = { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };

const nowTime = () => new Date().toTimeString().slice(0, 8);

export default function NutritionScreen({ active }: TabScreenProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [date, setDate] = useState(todayISO);
  const [entries, setEntries] = useState<any[]>([]);
  const [meals, setMeals] = useState<any[]>([]);
  const [totals, setTotals] = useState<Totals>({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const [targets, setTargets] = useState<Targets>({ kcal: null, protein: null, carbs: null, fat: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openMeals, setOpenMeals] = useState<Record<number, boolean>>({});
  const [mealTarget, setMealTarget] = useState<number | null>(null);
  const [library, setLibrary] = useState<'manage' | 'picker' | null>(null);
  const [adHoc, setAdHoc] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [moving, setMoving] = useState<any>(null);

  const loadTargets = useCallback(async () => {
    try {
      const r = await prefsApi.get();
      const p = r.preferences || {};
      const t = {
        kcal: p.daily_kcal_target ? Number(p.daily_kcal_target) : null,
        protein: p.daily_protein_target != null ? Number(p.daily_protein_target) : null,
        carbs: p.daily_carbs_target != null ? Number(p.daily_carbs_target) : null,
        fat: p.daily_fat_target != null ? Number(p.daily_fat_target) : null,
      };
      setTargets(t);
      store.set('cache:nut_targets', t);
    } catch {}
  }, []);

  const loadDay = useCallback(
    async (d = date) => {
      try {
        const r = await nutritionApi.entries(d);
        setEntries(r.entries || []);
        setMeals(r.meals || []);
        setTotals(r.totals || { kcal: 0, protein: 0, carbs: 0, fat: 0 });
        store.set(`cache:nut_${d}`, r);
      } catch (e) {
        toast(errMsg(e, 'Erreur lors du chargement'), 'error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [date, toast],
  );

  // Chargement instantané depuis le cache, puis réseau
  useEffect(() => {
    let alive = true;
    store.get<any>(`cache:nut_${date}`, null).then((c) => {
      if (!alive) return;
      if (c) {
        setEntries(c.entries || []);
        setMeals(c.meals || []);
        setTotals(c.totals || { kcal: 0, protein: 0, carbs: 0, fat: 0 });
        setLoading(false);
      } else setLoading(true);
      loadDay(date);
    });
    return () => {
      alive = false;
    };
  }, [date, loadDay]);

  useEffect(() => {
    store.get<Targets | null>('cache:nut_targets', null).then((t) => t && setTargets(t));
  }, []);
  useEffect(() => {
    if (active) {
      loadTargets();
      loadDay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const mealGroups = useMemo(
    () =>
      meals.map((m) => {
        const list = entries.filter((e) => e.meal_id === m.id);
        const t = list.reduce(
          (a, e) => ({ kcal: a.kcal + e.totals.kcal, protein: a.protein + e.totals.protein, carbs: a.carbs + e.totals.carbs, fat: a.fat + e.totals.fat }),
          { kcal: 0, protein: 0, carbs: 0, fat: 0 },
        );
        const r1 = (v: number) => Math.round(v * 10) / 10;
        return { ...m, entries: list, totals: { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) } };
      }),
    [meals, entries],
  );
  const loose = useMemo(() => {
    const ids = new Set(meals.map((m) => m.id));
    return entries.filter((e) => !e.meal_id || !ids.has(e.meal_id));
  }, [entries, meals]);

  const macro = (k: 'protein' | 'carbs' | 'fat') => {
    const t = targets[k];
    if (t && t > 0) return { pct: (totals[k] / t) * 100, target: t };
    const kp = totals.protein * 4, kc = totals.carbs * 4, kf = totals.fat * 9;
    const sum = kp + kc + kf;
    const share = sum > 0 ? ((k === 'protein' ? kp : k === 'carbs' ? kc : kf) / sum) * 100 : 0;
    return { pct: share, target: null };
  };

  const addFromLibrary = async (item: FoodItem, payload: { quantity_g?: number; quantity_units?: number }) => {
    try {
      const body: any = {
        food_item_id: item.id,
        name: item.name,
        unit_label: item.unit_label || null,
        grams_per_unit: item.grams_per_unit ?? null,
        kcal_per_100g: item.kcal_per_100g,
        protein_per_100g: item.protein_per_100g,
        carbs_per_100g: item.carbs_per_100g,
        fat_per_100g: item.fat_per_100g,
        consumed_at: `${date} ${nowTime()}`,
        ...payload,
      };
      if (mealTarget) body.meal_id = mealTarget;
      await nutritionApi.createEntry(body);
      setLibrary(null);
      await loadDay();
      toast('Aliment ajouté', 'success');
    } catch (e) {
      toast(errMsg(e, "Erreur lors de l'ajout"), 'error');
    }
  };

  const createMeal = async () => {
    try {
      const r = await nutritionApi.createMeal(date);
      if (r?.id) setOpenMeals((o) => ({ ...o, [r.id]: true }));
      await loadDay();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const deleteEntry = async (e: any) => {
    if (!(await confirm({ title: `Supprimer « ${e.name} » ?`, confirmLabel: 'Supprimer', variant: 'danger' }))) return;
    try {
      await nutritionApi.deleteEntry(e.id);
      await loadDay();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const deleteMeal = async (m: any) => {
    const n = m.entries.length;
    if (!(await confirm({ title: n ? `Supprimer « Repas ${m.number} » et ses ${n} aliment${n > 1 ? 's' : ''} ?` : `Supprimer « Repas ${m.number} » ?`, confirmLabel: 'Supprimer', variant: 'danger' })))
      return;
    try {
      await nutritionApi.deleteMeal(m.id);
      await loadDay();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const moveEntry = async (e: any, mealId: number | 'new' | null) => {
    try {
      let target = mealId;
      if (mealId === 'new') {
        const r = await nutritionApi.createMeal(date);
        target = r?.id;
        if (!target) throw new Error('Erreur');
      }
      await nutritionApi.moveEntry(e.id, target as number | null);
      setMoving(null);
      await loadDay();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const openAdd = (mealId: number | null, kind: 'picker' | 'adhoc') => {
    setMealTarget(mealId);
    if (kind === 'picker') setLibrary('picker');
    else setAdHoc(true);
  };

  const renderEntry = (e: any) => {
    const isUnit = !!(e.unit_label && e.quantity_units != null);
    return (
      <View key={e.id} style={styles.entry}>
        <Pressable style={{ flex: 1 }} onPress={() => setEditing(e)}>
          <Text style={styles.entryName} numberOfLines={1}>
            {e.name}
          </Text>
          <Text style={styles.entryStats}>
            {Math.round(e.totals.kcal)} kcal · P {e.totals.protein} · G {e.totals.carbs} · L {e.totals.fat}
          </Text>
          <Text style={styles.qty}>{isUnit ? `${e.quantity_units} ${pluralize(e.unit_label, e.quantity_units)} (${e.quantity_g} g)` : `${e.quantity_g} g`}</Text>
        </Pressable>
        <IconBtn name="return-down-forward" size={19} color={colors.textDim} onPress={() => setMoving(e)} label="Déplacer dans un repas" />
        <IconBtn name="trash-outline" size={19} color={colors.danger} onPress={() => deleteEntry(e)} label="Supprimer" />
      </View>
    );
  };

  const kcalPct = targets.kcal ? totals.kcal / targets.kcal : 0;
  const over = targets.kcal ? totals.kcal > targets.kcal : false;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 30, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadDay();
              loadTargets();
            }}
            tintColor={colors.gold}
            colors={[colors.gold]}
            progressBackgroundColor={colors.surface2}
          />
        }
      >
        <TabTitle title="Nutrition" right={<Button title="Bibliothèque" small variant="secondary" icon="library-outline" onPress={() => setLibrary('manage')} />} />

        <View style={styles.dateNav}>
          <IconBtn name="chevron-back" onPress={() => setDate((d) => shiftISO(d, -1))} label="Jour précédent" />
          <Pressable style={{ flex: 1, alignItems: 'center' }} onPress={() => setDate(todayISO())}>
            <Text style={styles.dateLabel}>{fmtDayLabel(date)}</Text>
            {date !== todayISO() && <Text style={styles.today}>Revenir à aujourd'hui</Text>}
          </Pressable>
          <IconBtn
            name="chevron-forward"
            color={date >= shiftISO(todayISO(), 1) ? colors.textFaint : colors.text}
            onPress={() => date < shiftISO(todayISO(), 1) && setDate((d) => shiftISO(d, 1))}
            label="Jour suivant"
          />
        </View>

        <Card style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          {targets.kcal ? (
            <Ring size={124} stroke={11} progress={Math.min(1, kcalPct)} color={over ? colors.danger : colors.gold}>
              <Text style={styles.kcal}>{Math.round(totals.kcal)}</Text>
              <Text style={styles.kcalSub}>/ {targets.kcal} kcal</Text>
            </Ring>
          ) : (
            <View style={{ width: 124, alignItems: 'center' }}>
              <Text style={styles.kcal}>{Math.round(totals.kcal)}</Text>
              <Text style={styles.kcalSub}>kcal</Text>
              <Text style={[styles.kcalSub, { textAlign: 'center', marginTop: 6 }]}>Objectif à définir dans ton profil</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 12 }}>
            {(
              [
                ['protein', 'Protéines', colors.protein],
                ['carbs', 'Glucides', colors.carbs],
                ['fat', 'Lipides', colors.fat],
              ] as const
            ).map(([k, label, color]) => {
              const m = macro(k);
              return (
                <View key={k} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.textDim, fontSize: 12, fontWeight: '700' }}>{label}</Text>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
                      {Math.round(totals[k])} g{m.target ? <Text style={{ color: colors.textFaint }}> / {Math.round(m.target)} g</Text> : null}
                    </Text>
                  </View>
                  <Bar pct={m.pct} color={color} height={7} />
                </View>
              );
            })}
          </View>
        </Card>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Bibliothèque" icon="add" small onPress={() => openAdd(null, 'picker')} style={{ flex: 1 }} />
          <Button title="Saisie rapide" icon="flash-outline" small variant="secondary" onPress={() => openAdd(null, 'adhoc')} style={{ flex: 1 }} />
          <Button title="Repas" icon="restaurant-outline" small variant="secondary" onPress={createMeal} style={{ flex: 1 }} />
        </View>

        <Card style={{ gap: 6 }}>
          <T v="h3" style={{ marginBottom: 4 }}>
            Aliments du jour
          </T>
          {loading ? (
            <Loader />
          ) : entries.length === 0 && mealGroups.length === 0 ? (
            <Empty icon="restaurant-outline" text="Aucun aliment enregistré pour cette journée." />
          ) : (
            <>
              {mealGroups.map((m) => {
                const open = !!openMeals[m.id];
                return (
                  <View key={`m${m.id}`} style={styles.meal}>
                    <Pressable
                      style={styles.mealHead}
                      onPress={() => {
                        tap();
                        setOpenMeals((o) => ({ ...o, [m.id]: !o[m.id] }));
                      }}
                    >
                      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.goldLight} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mealName}>Repas {m.number}</Text>
                        <Text style={styles.entryStats}>
                          {m.entries.length === 0
                            ? 'Vide'
                            : `${m.totals.kcal} kcal · P ${m.totals.protein} · G ${m.totals.carbs} · L ${m.totals.fat} · ${m.entries.length} aliment${m.entries.length > 1 ? 's' : ''}`}
                        </Text>
                      </View>
                      <IconBtn name="trash-outline" size={19} color={colors.danger} onPress={() => deleteMeal(m)} label="Supprimer le repas" />
                    </Pressable>
                    {open && (
                      <View style={{ paddingLeft: 8, gap: 2 }}>
                        {m.entries.length === 0 ? <T v="small" style={{ padding: 8 }}>Aucun aliment dans ce repas.</T> : m.entries.map(renderEntry)}
                        <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 8 }}>
                          <Button title="Bibliothèque" small icon="add" onPress={() => openAdd(m.id, 'picker')} style={{ flex: 1 }} />
                          <Button title="Saisie rapide" small variant="secondary" onPress={() => openAdd(m.id, 'adhoc')} style={{ flex: 1 }} />
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
              {loose.map(renderEntry)}
            </>
          )}
        </Card>
      </ScrollView>

      <FoodLibrarySheet
        visible={library !== null}
        mode={library || 'manage'}
        onClose={() => setLibrary(null)}
        onPick={addFromLibrary}
        title={library === 'picker' && mealTarget ? `Ajouter · Repas ${meals.find((m) => m.id === mealTarget)?.number ?? ''}` : undefined}
      />
      <AdHocSheet
        visible={adHoc}
        onClose={() => setAdHoc(false)}
        date={date}
        mealId={mealTarget}
        onDone={() => {
          setAdHoc(false);
          loadDay();
          toast('Aliment ajouté', 'success');
        }}
      />
      <EditQtySheet entry={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadDay(); }} />
      <Sheet visible={!!moving} onClose={() => setMoving(null)} title={moving ? `Déplacer « ${moving.name} »` : ''}>
        <View style={{ gap: 8, paddingBottom: 10 }}>
          {mealGroups.map((m) => (
            <Pressable key={m.id} disabled={moving?.meal_id === m.id} onPress={() => moveEntry(moving, m.id)} style={[styles.moveOpt, moving?.meal_id === m.id && { opacity: 0.4 }]}>
              <Text style={styles.mealName}>Repas {m.number}</Text>
              <Text style={styles.entryStats}>{moving?.meal_id === m.id ? 'Déjà dedans' : `${m.entries.length} aliment${m.entries.length > 1 ? 's' : ''}`}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => moveEntry(moving, 'new')} style={[styles.moveOpt, { borderColor: colors.gold }]}>
            <Text style={[styles.mealName, { color: colors.goldLight }]}>+ Nouveau repas</Text>
          </Pressable>
          {!!moving?.meal_id && (
            <Pressable onPress={() => moveEntry(moving, null)} style={styles.moveOpt}>
              <Text style={styles.mealName}>Sortir du repas</Text>
              <Text style={styles.entryStats}>aliment seul</Text>
            </Pressable>
          )}
        </View>
      </Sheet>
    </View>
  );
}

function AdHocSheet({ visible, onClose, date, mealId, onDone }: { visible: boolean; onClose: () => void; date: string; mealId: number | null; onDone: () => void }) {
  const [d, setD] = useState<FoodDraft>(emptyFoodDraft());
  const [qty, setQty] = useState('');
  const [saveLib, setSaveLib] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setD(emptyFoodDraft());
      setQty('');
      setSaveLib(false);
      setError('');
    }
  }, [visible]);

  const submit = async () => {
    const { error: e, payload } = foodPayload(d);
    if (e) return setError(e);
    const q = num(qty);
    if (!(q > 0)) return setError(d.use_unit ? "Nombre d'unités invalide" : 'Quantité invalide');
    setSaving(true);
    setError('');
    try {
      let foodItemId: number | null = null;
      if (saveLib) {
        try {
          const r = await nutritionApi.createItem(payload);
          foodItemId = r?.id || null;
        } catch {}
      }
      const body: any = { ...payload, food_item_id: foodItemId, consumed_at: `${date} ${nowTime()}` };
      if (mealId) body.meal_id = mealId;
      if (d.use_unit) body.quantity_units = q;
      else body.quantity_g = q;
      await nutritionApi.createEntry(body);
      onDone();
    } catch (err) {
      setError(errMsg(err, "Erreur lors de l'ajout"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Saisie rapide" maxHeight={0.94} footer={<Button title="Ajouter" onPress={submit} loading={saving} />}>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <FoodForm d={d} setD={setD} />
      <Input
        containerStyle={{ marginTop: 10 }}
        label={d.use_unit ? `Nombre de ${d.unit_label ? pluralize(d.unit_label, 2) : 'unités'}` : 'Quantité mangée (g)'}
        value={qty}
        onChangeText={setQty}
        keyboardType="decimal-pad"
        placeholder={d.use_unit ? '1' : '100'}
      />
      <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }} onPress={() => setSaveLib(!saveLib)}>
        <Text style={{ color: colors.text, flex: 1 }}>Ajouter aussi à ma bibliothèque</Text>
        <Switch value={saveLib} onValueChange={setSaveLib} trackColor={{ true: colors.gold, false: colors.surface3 }} thumbColor={colors.text} />
      </Pressable>
    </Sheet>
  );
}

function EditQtySheet({ entry, onClose, onSaved }: { entry: any; onClose: () => void; onSaved: () => void }) {
  const isUnit = !!(entry?.unit_label && entry?.quantity_units != null);
  const [qty, setQty] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (entry) {
      setQty(String(isUnit ? entry.quantity_units : entry.quantity_g));
      setError('');
    }
  }, [entry, isUnit]);
  const save = async () => {
    const q = num(qty);
    if (!(q > 0)) return setError('Quantité invalide');
    try {
      await nutritionApi.updateEntryQty(entry.id, q, isUnit ? 'units' : 'grams');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <Sheet visible={!!entry} onClose={onClose} title={entry?.name} footer={<Button title="Enregistrer" onPress={save} />}>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Input
        label={isUnit ? `Nombre de ${pluralize(entry?.unit_label || '', 2)}` : 'Quantité (g)'}
        value={qty}
        onChangeText={setQty}
        keyboardType="decimal-pad"
        autoFocus
        onSubmitEditing={save}
      />
      <View style={{ height: 12 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  dateNav: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 6, borderWidth: 1, borderColor: colors.border },
  dateLabel: { color: colors.text, fontWeight: '800', fontSize: 16, textTransform: 'capitalize' },
  today: { color: colors.goldLight, fontSize: 12, fontWeight: '600', marginTop: 2 },
  kcal: { color: colors.text, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  kcalSub: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  entry: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  entryName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  entryStats: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  qty: { color: colors.goldLight, fontSize: 12, fontWeight: '700', marginTop: 3 },
  meal: { backgroundColor: colors.surface2, borderRadius: radius.md, paddingHorizontal: 8, marginBottom: 6 },
  mealHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  mealName: { color: colors.text, fontWeight: '800', fontSize: 15 },
  moveOpt: { padding: 14, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, padding: 10, borderRadius: radius.md, marginBottom: 10 },
});
