import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { authApi, errMsg, prefsApi, reportApi, workoutApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { store, useCached } from '@/lib/storage';
import { useUpdate } from '@/lib/update';
import { fmtDateTime, isTrue, MONTH_NAMES } from '@/lib/format';
import { colors, QOJIM, radius } from '@/theme';
import { Avatar, Button, Card, IconBtn, Input, Loader, Pill, SectionTitle, TabTitle, T, tap } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { useConfirm, useToast } from '@/components/Feedback';
import type { TabScreenProps } from '@/app/index';

const PAGE = 10;

export default function ProfileScreen({ active }: TabScreenProps) {
  const { user, logout, updateUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const upd = useUpdate();

  const main = useCached('profile_main', async () => {
    const [stats, hist, prefs, reports] = await Promise.all([
      workoutApi.stats().then((r) => r.stats || null),
      workoutApi.history(PAGE, 0),
      prefsApi.get().then((r) => r.preferences || {}),
      reportApi.list().then((r) => r.reports || []).catch(() => []),
    ]);
    return { stats, history: hist.history || [], hasMore: !!hist.has_more, prefs, reports };
  });
  const data = main.data;
  const [loadingMore, setLoadingMore] = useState(false);
  const [editName, setEditName] = useState(false);
  const [goals, setGoals] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!active) return;
    store.get<number>('qg_needs_refresh_profile', 0).then(() => main.refreshIfStale());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const loadMore = async () => {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await workoutApi.history(PAGE, data.history.length);
      const more = r.history || [];
      main.setData((d) => {
        if (!d) return d;
        const seen = new Set(d.history.map((w: any) => w.id));
        return { ...d, history: [...d.history, ...more.filter((w: any) => !seen.has(w.id))], hasMore: !!r.has_more };
      });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const setPrivacy = async (v: 'public' | 'private') => {
    const prev = data?.prefs?.default_workout_privacy;
    main.setData((d) => (d ? { ...d, prefs: { ...d.prefs, default_workout_privacy: v } } : d));
    try {
      await prefsApi.update({ default_workout_privacy: v });
      toast('Préférence enregistrée', 'success');
    } catch (e) {
      main.setData((d) => (d ? { ...d, prefs: { ...d.prefs, default_workout_privacy: prev } } : d));
      toast(errMsg(e), 'error');
    }
  };

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setUploading(true);
    try {
      const r = await prefsApi.uploadPdp(a.uri, a.mimeType || 'image/jpeg');
      const pdp = r?.pdp || r?.filename || r?.preferences?.pdp;
      if (pdp) updateUser({ pdp });
      await main.refresh();
      const fresh = await prefsApi.get().catch(() => null);
      if (fresh?.preferences?.pdp) updateUser({ pdp: fresh.preferences.pdp });
      toast('Photo de profil mise à jour', 'success');
    } catch (e) {
      toast(errMsg(e, "Erreur lors de l'envoi"), 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeWorkout = async (id: number) => {
    if (!(await confirm({ title: 'Supprimer cet entraînement ?', confirmLabel: 'Supprimer', variant: 'danger' }))) return;
    try {
      await workoutApi.remove(id);
      main.setData((d) => (d ? { ...d, history: d.history.filter((w: any) => w.id !== id) } : d));
      main.refresh();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const doLogout = async () => {
    if (await confirm({ title: 'Se déconnecter ?', confirmLabel: 'Déconnexion', variant: 'danger' })) logout();
  };

  if (!user) return null;
  const pdp = data?.prefs?.pdp ?? user.pdp;
  const privacy = data?.prefs?.default_workout_privacy || 'public';
  const s = data?.stats;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
      refreshControl={<RefreshControl refreshing={main.refreshing} onRefresh={() => main.refresh('pull')} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surface2} />}
    >
      <TabTitle title="Profil" right={<IconBtn name="log-out-outline" color={colors.danger} onPress={doLogout} label="Déconnexion" />} />

      {/* Identité */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Pressable onPress={pickPhoto} disabled={uploading}>
          <Avatar name={user.username} pdp={pdp} size={72} />
          <View style={styles.camera}>{uploading ? <Loader style={{ padding: 0 }} /> : <Ionicons name="camera" size={14} color="#1a1406" />}</View>
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Pressable onPress={() => setEditName(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.username} numberOfLines={1}>
              {user.username}
            </Text>
            <Ionicons name="pencil" size={14} color={colors.textDim} />
          </Pressable>
          <T v="small" numberOfLines={1}>
            {user.email}
          </T>
          {isTrue(user.is_admin) && <Pill label="Administrateur" icon="shield-checkmark" color={colors.purple} bg={colors.purpleSoft} />}
        </View>
      </Card>

      {/* Stats */}
      {main.loading ? (
        <Loader />
      ) : (
        <View style={styles.stats}>
          {[
            ['Entraînements', s?.total_workouts],
            ["Jours d'activité", s?.total_days],
            ['Séries', s?.total_sets],
            ['Répétitions', s?.total_reps],
          ].map(([l, v]) => (
            <View key={String(l)} style={styles.stat}>
              <Text style={styles.statVal}>{Number(v) || 0}</Text>
              <Text style={styles.statLbl}>{l}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Raccourcis */}
      <View style={{ gap: 8 }}>
        <Row icon="library-outline" label="Mes exercices & progression" onPress={() => router.push(`/exercises/${user.id}`)} />
        <Row icon="nutrition-outline" label="Objectifs nutrition" onPress={() => setGoals(true)} />
        <Row icon="lock-closed-outline" label="Modifier le mot de passe" onPress={() => router.push('/change-password')} />
        {isTrue(user.is_admin) && <Row icon="shield-outline" label="Espace admin (site web)" onPress={() => Linking.openURL(`${QOJIM}/admin`)} />}
      </View>

      {/* Confidentialité */}
      <Card style={{ gap: 10 }}>
        <SectionTitle>Confidentialité des entraînements</SectionTitle>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(
            [
              ['public', 'earth', 'Public', 'Tes amis voient tes séances'],
              ['private', 'lock-closed', 'Privé', 'Personne ne les voit'],
            ] as const
          ).map(([k, icon, label, desc]) => (
            <Pressable
              key={k}
              onPress={() => {
                tap();
                setPrivacy(k);
              }}
              style={[styles.privacy, privacy === k && styles.privacyOn]}
            >
              <Ionicons name={icon} size={20} color={privacy === k ? colors.goldLight : colors.textDim} />
              <Text style={[styles.privacyTitle, privacy === k && { color: colors.goldLight }]}>{label}</Text>
              <Text style={styles.privacyDesc}>{desc}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {/* Rapports mensuels */}
      <Card style={{ gap: 6 }}>
        <SectionTitle>Rapports mensuels</SectionTitle>
        {(data?.reports || []).length === 0 ? (
          <T v="small">Aucun rapport pour le moment. Ils sont générés au début de chaque mois.</T>
        ) : (
          data!.reports.map((r: any) => (
            <Pressable key={`${r.year}-${r.month}`} style={styles.reportRow} onPress={() => router.push(`/report/${r.year}/${r.month}`)}>
              <Ionicons name="stats-chart-outline" size={18} color={colors.goldLight} />
              <Text style={{ color: colors.text, flex: 1, fontWeight: '600' }}>
                {MONTH_NAMES[r.month]} {r.year}
              </Text>
              {!isTrue(r.viewed) && !r.viewed_at && <Pill label="Nouveau" color="#1a1406" bg={colors.gold} />}
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          ))
        )}
      </Card>

      {/* Historique */}
      <Card style={{ gap: 4 }}>
        <SectionTitle>Derniers entraînements</SectionTitle>
        {(data?.history || []).length === 0 ? (
          <T v="small">Aucun entraînement terminé pour le moment. Lance ta première séance !</T>
        ) : (
          data!.history.map((w: any) => (
            <Pressable key={w.id} style={styles.hist} onPress={() => router.push(`/workout-detail/${w.id}`)} onLongPress={() => removeWorkout(w.id)}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                  {w.session_name}
                </Text>
                <T v="small">{fmtDateTime(w.completed_at)}</T>
              </View>
              <Pill label={`${w.total_sets ?? 0} séries`} />
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          ))
        )}
        {data?.hasMore && <Button title="Charger plus" variant="ghost" small onPress={loadMore} loading={loadingMore} />}
        {(data?.history || []).length > 0 && <T v="tiny" style={{ textAlign: 'center', marginTop: 4 }}>Appui long sur un entraînement pour le supprimer</T>}
      </Card>

      {/* Application */}
      <Card style={{ gap: 8 }}>
        <SectionTitle>Application</SectionTitle>
        <T v="small">QoGym {upd.installedVersion}</T>
        {upd.available ? (
          <Button
            title={upd.progress !== null ? `Téléchargement… ${Math.round(upd.progress * 100)} %` : `Installer la version ${upd.info?.latestVersion ?? ''}`}
            icon="download-outline"
            small
            onPress={upd.install}
            disabled={upd.progress !== null}
          />
        ) : (
          <Button title="Rechercher une mise à jour" small variant="secondary" icon="refresh" onPress={() => { upd.check(true); toast('Vérification…', 'info'); }} />
        )}
      </Card>

      <UsernameSheet visible={editName} onClose={() => setEditName(false)} current={user.username} onSaved={(u) => updateUser({ username: u })} />
      <GoalsSheet visible={goals} onClose={() => setGoals(false)} prefs={data?.prefs} onSaved={() => main.refresh()} />
    </ScrollView>
  );
}

const Row = ({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) => (
  <Pressable
    onPress={() => {
      tap();
      onPress();
    }}
    android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
    style={styles.row}
  >
    <Ionicons name={icon} size={20} color={colors.goldLight} />
    <Text style={{ color: colors.text, fontWeight: '600', flex: 1, fontSize: 15 }}>{label}</Text>
    <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
  </Pressable>
);

function UsernameSheet({ visible, onClose, current, onSaved }: { visible: boolean; onClose: () => void; current: string; onSaved: (u: string) => void }) {
  const [v, setV] = useState(current);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) {
      setV(current);
      setErr('');
    }
  }, [visible, current]);
  const save = async () => {
    const t = v.trim();
    if (!t || t === current) return onClose();
    setSaving(true);
    try {
      const r = await authApi.changeUsername(t);
      onSaved(r?.username || t);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Nom d'utilisateur" footer={<Button title="Enregistrer" onPress={save} loading={saving} />}>
      {!!err && <Text style={{ color: colors.danger, marginBottom: 8 }}>{err}</Text>}
      <Input value={v} onChangeText={setV} maxLength={30} autoCapitalize="none" autoFocus onSubmitEditing={save} />
      <T v="tiny" style={{ marginTop: 6, marginBottom: 10 }}>
        3 à 30 caractères : lettres, chiffres, tirets, underscores et points.
      </T>
    </Sheet>
  );
}

function GoalsSheet({ visible, onClose, prefs, onSaved }: { visible: boolean; onClose: () => void; prefs: any; onSaved: () => void }) {
  const toast = useToast();
  const [g, setG] = useState({ kcal: '', protein: '', carbs: '', fat: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!visible) return;
    const p = prefs || {};
    const s = (x: any) => (x != null && x !== '' ? String(x) : '');
    setG({ kcal: s(p.daily_kcal_target), protein: s(p.daily_protein_target), carbs: s(p.daily_carbs_target), fat: s(p.daily_fat_target) });
    setErr('');
  }, [visible, prefs]);

  const parse = (raw: string, int: boolean) => {
    const t = raw.trim().replace(',', '.');
    if (!t) return null;
    const n = int ? parseInt(t, 10) : parseFloat(t);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const save = useCallback(async () => {
    const vals = { daily_kcal_target: parse(g.kcal, true), daily_protein_target: parse(g.protein, false), daily_carbs_target: parse(g.carbs, false), daily_fat_target: parse(g.fat, false) };
    if (Object.values(vals).some((v) => Number.isNaN(v as number))) return setErr('Un objectif est invalide');
    setSaving(true);
    try {
      await prefsApi.update(vals);
      store.remove('cache:nut_targets');
      toast('Objectifs enregistrés', 'success');
      onSaved();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  }, [g, onClose, onSaved, toast]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Objectifs nutrition" footer={<Button title="Enregistrer" onPress={save} loading={saving} />}>
      <T v="small" style={{ marginBottom: 12 }}>
        Laisse vide pour ne pas suivre un objectif.
      </T>
      {!!err && <Text style={{ color: colors.danger, marginBottom: 8 }}>{err}</Text>}
      <View style={{ gap: 10, paddingBottom: 10 }}>
        <Input label="Calories (kcal)" value={g.kcal} onChangeText={(v) => setG({ ...g, kcal: v })} keyboardType="number-pad" placeholder="Ex. 2200" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Input containerStyle={{ flex: 1 }} label="Protéines (g)" value={g.protein} onChangeText={(v) => setG({ ...g, protein: v })} keyboardType="decimal-pad" placeholder="150" />
          <Input containerStyle={{ flex: 1 }} label="Glucides (g)" value={g.carbs} onChangeText={(v) => setG({ ...g, carbs: v })} keyboardType="decimal-pad" placeholder="250" />
          <Input containerStyle={{ flex: 1 }} label="Lipides (g)" value={g.fat} onChangeText={(v) => setG({ ...g, fat: v })} keyboardType="decimal-pad" placeholder="70" />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  camera: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  username: { color: colors.text, fontSize: 20, fontWeight: '800', flexShrink: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '48%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  statVal: { color: colors.goldLight, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLbl: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  privacy: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, gap: 4 },
  privacyOn: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  privacyTitle: { color: colors.text, fontWeight: '800' },
  privacyDesc: { color: colors.textDim, fontSize: 12 },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  hist: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
});
