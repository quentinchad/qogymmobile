import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errMsg, sessionApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { store } from '@/lib/storage';
import { fmtRest, isTrue } from '@/lib/format';
import { linkWithNext, normalizeOrphans, normSupersetGroup, unlinkAtIndex } from '@/lib/supersets';
import { colors, radius, sessionImageUrl } from '@/theme';
import { Button, Card, Chip, IconBtn, Input, Loader, ScreenHeader, T, tap } from '@/components/ui';
import { CatalogPicker } from '@/components/CatalogPicker';
import { catalogDefaults } from '@/lib/catalog';
import { RestTimePicker } from '@/components/RestTimePicker';
import { ReorderList } from '@/components/ReorderList';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Feedback';

type Ex = { name: string; sets: number; reps_min: number; reps_max: number; rest_time: number; superset_group?: number | null; id?: number; [k: string]: any };
const blankEx = (): Ex => ({ name: '', sets: 3, reps_min: 8, reps_max: 12, rest_time: 90 });

export default function EditSession() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [types, setTypes] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<string>('');
  const [isQojim, setIsQojim] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [newImage, setNewImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [exercises, setExercises] = useState<Ex[]>([]);
  const [library, setLibrary] = useState<any[]>([]);
  const [draft, setDraft] = useState<Ex>(blankEx());
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [exSheet, setExSheet] = useState(false);
  const [restPicker, setRestPicker] = useState(false);
  const [reorder, setReorder] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);

  useEffect(() => {
    sessionApi
      .types()
      .then((r) => {
        const t = r.session_types || r.types || [];
        setTypes(t);
        if (!id && t[0]) setTypeId((cur) => cur || String(t[0].id));
      })
      .catch(() => {});
    sessionApi
      .allExercises()
      .then((r) => setLibrary(r.exercises || []))
      .catch(() => {});
    if (id) {
      sessionApi
        .get(id)
        .then((r) => {
          const s = r.session;
          setName(s.name || '');
          setTypeId(String(s.session_type_id || ''));
          setIsQojim(isTrue(s.is_qojim_session));
          setImageUrl(s.image_url || '');
          setExercises(s.exercises || []);
        })
        .catch((e) => setError(errMsg(e)))
        .finally(() => setLoading(false));
    }
  }, [id]);

  // Suggestions : bibliothèque perso + catalogue embarqué (tous deux instantanés, hors ligne)
  const localMatches = useMemo(() => {
    const q = draft.name.trim().toLowerCase();
    if (!q) return [];
    return library.filter((e) => e.name?.toLowerCase().includes(q)).slice(0, 6);
  }, [draft.name, library]);
  const openExercise = (idx: number | null) => {
    setEditIdx(idx);
    setDraft(idx === null ? blankEx() : { ...exercises[idx] });
    setShowSuggest(false);
    setExSheet(true);
  };

  const saveExercise = () => {
    if (!draft.name.trim()) return;
    const ex = { ...draft, name: draft.name.trim() };
    if (editIdx === null) setExercises((p) => [...p, ex]);
    else setExercises((p) => p.map((e, i) => (i === editIdx ? ex : e)));
    setExSheet(false);
  };

  const pickImage = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.8 });
    if (!r.canceled && r.assets?.[0]) setNewImage(r.assets[0]);
  };

  const submit = async () => {
    setError('');
    if (!name.trim()) return setError('Le nom de la séance est requis');
    if (exercises.length === 0) return setError('Ajoute au moins un exercice');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('session_type_id', typeId);
      fd.append('is_qojim_session', isQojim ? '1' : '0');
      fd.append('exercises', JSON.stringify(exercises));
      if (newImage) {
        const mime = newImage.mimeType || 'image/jpeg';
        const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1] || 'jpg';
        fd.append('image', { uri: newImage.uri, name: `seance.${ext}`, type: mime } as any);
      } else fd.append('image_url', imageUrl || '');
      if (id) {
        fd.append('id', String(id));
        await sessionApi.update(fd);
      } else await sessionApi.create(fd);
      store.remove('cache:sessions');
      toast(id ? 'Séance mise à jour' : 'Séance créée', 'success');
      router.back();
    } catch (e) {
      setError(errMsg(e, 'Erreur lors de la sauvegarde'));
    } finally {
      setSaving(false);
    }
  };

  const preview = newImage?.uri || sessionImageUrl(imageUrl);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={id ? 'Modifier la séance' : 'Nouvelle séance'} />
      {loading ? (
        <Loader />
      ) : (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Card style={{ gap: 12 }}>
              <Input label="Nom de la séance" value={name} onChangeText={setName} placeholder="Ex : Jour des jambes" />
              <Text style={styles.label}>Type de séance</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {types.map((t) => (
                  <Chip key={t.id} label={t.name} active={String(t.id) === String(typeId)} onPress={() => setTypeId(String(t.id))} />
                ))}
              </View>
              <Text style={styles.label}>Image (optionnel)</Text>
              {preview ? (
                <View style={{ gap: 8 }}>
                  <Image source={{ uri: preview }} style={{ height: 150, borderRadius: radius.md }} contentFit="cover" />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button title="Changer" small variant="secondary" icon="image-outline" onPress={pickImage} />
                    <Button
                      title="Supprimer"
                      small
                      variant="danger"
                      onPress={() => {
                        setNewImage(null);
                        setImageUrl('');
                      }}
                    />
                  </View>
                </View>
              ) : (
                <Pressable style={styles.imgZone} onPress={pickImage}>
                  <Ionicons name="image-outline" size={28} color={colors.textDim} />
                  <T v="small">Choisir une image</T>
                </Pressable>
              )}
              {isTrue(user?.is_admin) && (
                <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => setIsQojim(!isQojim)}>
                  <Text style={{ color: colors.text, flex: 1 }}>Séance Qojim (publique)</Text>
                  <Switch value={isQojim} onValueChange={setIsQojim} trackColor={{ true: colors.gold, false: colors.surface3 }} thumbColor={colors.text} />
                </Pressable>
              )}
            </Card>

            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <T v="h3">Exercices ({exercises.length})</T>
                {exercises.length > 1 && <Button title="Réorganiser" small variant="ghost" icon="swap-vertical" onPress={() => setReorder(true)} />}
              </View>
              {exercises.map((ex, i) => {
                const sg = normSupersetGroup(ex.superset_group);
                const prevSg = i > 0 ? normSupersetGroup(exercises[i - 1].superset_group) : null;
                const nextSg = i < exercises.length - 1 ? normSupersetGroup(exercises[i + 1].superset_group) : null;
                const inSs = sg !== null && (prevSg === sg || nextSg === sg);
                const linked = inSs && nextSg === sg;
                return (
                  <View key={i}>
                    <Pressable style={[styles.ex, inSs && { borderLeftWidth: 3, borderLeftColor: colors.purple }]} onPress={() => openExercise(i)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.exName}>{ex.name}</Text>
                        <Text style={styles.exMeta}>
                          {ex.sets} × {ex.reps_min}
                          {ex.reps_max !== ex.reps_min ? `-${ex.reps_max}` : ''} reps · {fmtRest(Number(ex.rest_time) || 0)}
                        </Text>
                      </View>
                      {inSs ? (
                        <IconBtn name="unlink-outline" size={19} color={colors.purple} onPress={() => setExercises((p) => normalizeOrphans(unlinkAtIndex(p, i)))} label="Délier" />
                      ) : null}
                      {i < exercises.length - 1 && !linked && (
                        <IconBtn name="link-outline" size={19} color={colors.textDim} onPress={() => setExercises((p) => linkWithNext(p, i))} label="Superset avec le suivant" />
                      )}
                      <IconBtn name="trash-outline" size={19} color={colors.danger} onPress={() => setExercises((p) => normalizeOrphans(p.filter((_, k) => k !== i)))} label="Supprimer" />
                    </Pressable>
                    {linked && <Text style={styles.connector}>↻ superset — enchaîner</Text>}
                  </View>
                );
              })}
              <Button title="Ajouter un exercice" icon="add" variant="outline" onPress={() => openExercise(null)} />
            </Card>

            <Button title={id ? 'Enregistrer les modifications' : 'Créer la séance'} onPress={submit} loading={saving} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <Sheet
        visible={exSheet}
        onClose={() => setExSheet(false)}
        title={editIdx === null ? 'Ajouter un exercice' : "Modifier l'exercice"}
        footer={<Button title={editIdx === null ? 'Ajouter' : 'Mettre à jour'} onPress={saveExercise} disabled={!draft.name.trim()} />}
      >
        <Input
          label="Nom de l'exercice"
          value={draft.name}
          onChangeText={(v) => {
            setDraft({ ...draft, name: v });
            setShowSuggest(true);
          }}
          placeholder="Ex : Squat"
        />
        {showSuggest && localMatches.length > 0 && (
          <View style={styles.suggest}>
            {localMatches.map((e) => (
              <Pressable
                key={`l${e.id}`}
                style={styles.sugItem}
                onPress={() => {
                  tap();
                  setDraft({ ...draft, name: e.name, sets: e.sets || 3, reps_min: e.reps_min || 8, reps_max: e.reps_max || 12, rest_time: e.rest_time || 90 });
                  setShowSuggest(false);
                }}
              >
                <Ionicons name="person-outline" size={14} color={colors.goldLight} />
                <Text style={styles.sugText}>{e.name}</Text>
                <Text style={styles.exMeta}>
                  {e.sets}×{e.reps_min} · {fmtRest(e.rest_time || 0)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {editIdx === null && (showSuggest || !draft.name.trim()) && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.catLabel}>{draft.name.trim() ? 'Suggestions du catalogue' : 'Ou choisis dans le catalogue'}</Text>
            <CatalogPicker
              query={draft.name}
              compact={!!draft.name.trim()}
              exclude={exercises.map((e) => e.name)}
              onPick={(ex) => {
                setDraft({ ...draft, name: ex.n, ...catalogDefaults(ex) });
                setShowSuggest(false);
              }}
            />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          {(
            [
              ['sets', 'Séries'],
              ['reps_min', 'Reps min'],
              ['reps_max', 'Reps max'],
            ] as const
          ).map(([k, l]) => (
            <Input
              key={k}
              containerStyle={{ flex: 1 }}
              label={l}
              value={String(draft[k] ?? '')}
              onChangeText={(v) => setDraft({ ...draft, [k]: parseInt(v.replace(/[^0-9]/g, ''), 10) || 0 })}
              keyboardType="number-pad"
            />
          ))}
        </View>
        <Pressable style={styles.restBtn} onPress={() => setRestPicker(true)}>
          <Ionicons name="timer-outline" size={18} color={colors.goldLight} />
          <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>Repos</Text>
          <Text style={{ color: colors.goldLight, fontWeight: '800' }}>{fmtRest(draft.rest_time)}</Text>
        </Pressable>
        <View style={{ height: 8 }} />
      </Sheet>

      <RestTimePicker visible={restPicker} value={draft.rest_time} onChange={(v) => setDraft((d) => ({ ...d, rest_time: v }))} onClose={() => setRestPicker(false)} />

      <Sheet visible={reorder} onClose={() => setReorder(false)} title="Réorganiser" scroll={false} footer={<Button title="Terminé" onPress={() => setReorder(false)} />}>
        <ScrollView style={{ maxHeight: 480 }}>
          <ReorderList
            items={exercises.map((e, i) => ({ ...e, _k: `${i}-${e.name}` }))}
            keyOf={(e: any) => e._k}
            onReorder={(from, to) =>
              setExercises((prev) => {
                const arr = [...prev];
                const [m] = arr.splice(from, 1);
                arr.splice(to, 0, m);
                return normalizeOrphans(arr);
              })
            }
            render={(e: any) => (
              <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                {e.name}
              </Text>
            )}
          />
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, padding: 12, borderRadius: radius.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  imgZone: { height: 110, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 6 },
  ex: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: colors.surface2 },
  exName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  exMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  connector: { color: colors.purple, fontSize: 11, fontWeight: '700', textAlign: 'center', paddingVertical: 2 },
  suggest: { marginTop: 6, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  sugItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  catLabel: { color: colors.textDim, fontWeight: '700', fontSize: 13, marginBottom: 8 },
  sugText: { color: colors.text, flex: 1, fontWeight: '600' },
  restBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface2 },
});
