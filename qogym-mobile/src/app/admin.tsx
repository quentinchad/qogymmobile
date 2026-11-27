import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { adminApi, errMsg, sessionApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, isTrue, MONTH_NAMES } from '@/lib/format';
import { colors, radius } from '@/theme';
import { Button, Card, Empty, Input, Loader, Pill, ScreenHeader, T, tap } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { useConfirm, useToast } from '@/components/Feedback';

/**
 * Espace admin natif (mêmes fonctions que la page /admin du site, via
 * admin.php & co). Accessible depuis le Profil pour les comptes admin ;
 * l'API refuse de toute façon les autres comptes (403).
 */

type Tab = 'stats' | 'users' | 'types' | 'qojim' | 'reminders' | 'unverified' | 'reports';
const TABS: { key: Tab; label: string }[] = [
  { key: 'stats', label: 'Stats' },
  { key: 'users', label: 'Utilisateurs' },
  { key: 'types', label: 'Types' },
  { key: 'qojim', label: 'Séances Qojim' },
  { key: 'reminders', label: 'Relances' },
  { key: 'unverified', label: 'Non confirmés' },
  { key: 'reports', label: 'Rapports' },
];

type AdminUser = { id: number; username: string; email: string; is_admin: any; created_at: string; total_workouts: any };

export default function AdminScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isAdmin = isTrue(user?.is_admin);

  const [tab, setTab] = useState<Tab>('stats');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [qojim, setQojim] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [newType, setNewType] = useState('');
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const [reminderStats, setReminderStats] = useState<any>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderResult, setReminderResult] = useState<any>(null);
  const [cleanupStats, setCleanupStats] = useState<any>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportResult, setReportResult] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [s, u, t, q] = await Promise.all([adminApi.stats(), adminApi.users(), adminApi.sessionTypes(), adminApi.qojimSessions()]);
      setStats(s.stats);
      setUsers(u.users || []);
      setTypes(t.session_types || []);
      setQojim(q.sessions || []);
    } catch (e) {
      toast(errMsg(e, 'Erreur de chargement'), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() ne met l'état à jour qu'après la réponse réseau
    if (isAdmin) load();
  }, [isAdmin, load]);

  const openTab = (k: Tab) => {
    tap();
    setTab(k);
    if (k === 'reminders' && !reminderStats) adminApi.reminderStats().then(setReminderStats).catch((e) => toast(errMsg(e), 'error'));
    if (k === 'unverified') adminApi.cleanupStats().then(setCleanupStats).catch((e) => toast(errMsg(e), 'error'));
  };

  const filteredUsers = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return users;
    return users.filter((u) => u.username?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s));
  }, [users, search]);

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Administration" />
        <Empty icon="lock-closed-outline" title="Accès réservé" text="Cette page est réservée aux administrateurs." />
      </View>
    );
  }

  // ── Actions ──
  const createType = async () => {
    const name = newType.trim();
    if (!name) return;
    try {
      await adminApi.createType(name);
      setNewType('');
      load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const deleteType = async (t: any) => {
    if (!(await confirm({ title: `Supprimer le type « ${t.name} » ?`, confirmLabel: 'Supprimer', variant: 'danger' }))) return;
    try {
      await adminApi.deleteType(Number(t.id));
      load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const toggleArchive = async (s: any) => {
    const archived = isTrue(s.is_archived);
    if (!(await confirm({ title: `${archived ? 'Désarchiver' : 'Archiver'} « ${s.name} » ?`, confirmLabel: archived ? 'Désarchiver' : 'Archiver' }))) return;
    try {
      await sessionApi.patch(s.id, { is_archived: archived ? 0 : 1 });
      setQojim((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_archived: archived ? 0 : 1 } : x)));
    } catch (e) {
      toast(errMsg(e, "Erreur lors de l'archivage"), 'error');
    }
  };
  const sendReminders = async (type: 'all' | 'inactive' | 'never_active') => {
    const labels = { all: 'tous les utilisateurs concernés', inactive: 'les inactifs (+7 jours)', never_active: 'les jamais actifs' };
    if (!(await confirm({ title: `Envoyer les relances à ${labels[type]} ?`, confirmLabel: 'Envoyer' }))) return;
    setReminderBusy(true);
    setReminderResult(null);
    try {
      setReminderResult(await adminApi.sendReminders(type));
      adminApi.reminderStats().then(setReminderStats).catch(() => {});
    } catch (e) {
      toast(errMsg(e, "Erreur lors de l'envoi"), 'error');
    } finally {
      setReminderBusy(false);
    }
  };
  const runCleanup = async () => {
    const n = cleanupStats?.expired_unverified ?? 0;
    if (!(await confirm({ title: `Supprimer ${n} compte${n > 1 ? 's' : ''} non confirmé${n > 1 ? 's' : ''} ?`, message: 'Action irréversible.', confirmLabel: 'Supprimer', variant: 'danger' })))
      return;
    setCleanupBusy(true);
    try {
      const r = await adminApi.runCleanup();
      toast(`${r.deleted} compte${r.deleted > 1 ? 's' : ''} supprimé${r.deleted > 1 ? 's' : ''}`, 'success');
      setCleanupStats(await adminApi.cleanupStats());
      load();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setCleanupBusy(false);
    }
  };
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const reportLabel = `${MONTH_NAMES[prev.getMonth() + 1].toLowerCase()} ${prev.getFullYear()}`; // MONTH_NAMES commence à l'index 1
  const generateReports = async () => {
    if (!(await confirm({ title: `Générer les rapports de ${reportLabel} ?`, message: 'Une notification et un email pour chaque utilisateur actif ce mois-là. Les déjà notifiés sont ignorés.', confirmLabel: 'Générer' })))
      return;
    setReportBusy(true);
    setReportResult(null);
    try {
      setReportResult(await adminApi.generateReports());
    } catch (e) {
      toast(errMsg(e, 'Erreur lors de la génération'), 'error');
    } finally {
      setReportBusy(false);
    }
  };

  // ── Rendu des onglets ──
  const statTile = (value: any, label: string) => (
    <View key={label} style={styles.stat}>
      <Text style={styles.statVal}>{Number(value) || 0}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );

  const body = () => {
    if (loading) return <Loader />;
    switch (tab) {
      case 'stats':
        return (
          <View style={styles.statsRow}>
            {statTile(stats?.total_users, 'Utilisateurs')}
            {statTile(stats?.total_qojim_sessions, 'Séances Qojim')}
            {statTile(stats?.total_completed_workouts, 'Entraînements')}
          </View>
        );

      case 'users':
        return (
          <View style={{ gap: 10 }}>
            <Input value={search} onChangeText={setSearch} placeholder="Rechercher (pseudo ou email)…" autoCapitalize="none" />
            <T v="small">
              {filteredUsers.length} utilisateur{filteredUsers.length > 1 ? 's' : ''}
            </T>
            {filteredUsers.map((u) => {
              const admin = isTrue(u.is_admin);
              const me = Number(u.id) === Number(user?.id);
              return (
                <Card key={u.id} style={styles.userCard}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {u.username}
                      </Text>
                      {admin && <Pill label="Admin" color={colors.purple} bg={colors.purpleSoft} />}
                    </View>
                    <Text style={styles.userMeta} numberOfLines={1}>
                      {u.email}
                    </Text>
                    <Text style={styles.userMeta}>
                      {Number(u.total_workouts) || 0} entraînement{Number(u.total_workouts) > 1 ? 's' : ''} · inscrit le {fmtDate(u.created_at)}
                    </Text>
                  </View>
                  {!admin && !me && (
                    <Pressable onPress={() => setDeleting(u)} hitSlop={8} style={styles.trash} accessibilityRole="button" accessibilityLabel={`Supprimer ${u.username}`}>
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </Pressable>
                  )}
                </Card>
              );
            })}
          </View>
        );

      case 'types':
        return (
          <View style={{ gap: 10 }}>
            <Card style={{ gap: 8 }}>
              <T v="h3">Créer un type de séance</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Input containerStyle={{ flex: 1 }} value={newType} onChangeText={setNewType} placeholder="Ex. Yoga" maxLength={50} />
                <Button title="Créer" onPress={createType} disabled={!newType.trim()} />
              </View>
            </Card>
            {types.map((t) => (
              <Card key={t.id} style={styles.userCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{t.name}</Text>
                  <Text style={styles.userMeta}>
                    {Number(t.usage_count) || 0} séance{Number(t.usage_count) > 1 ? 's' : ''}
                  </Text>
                </View>
                {Number(t.usage_count) === 0 && <Button title="Supprimer" small variant="danger" onPress={() => deleteType(t)} />}
              </Card>
            ))}
          </View>
        );

      case 'qojim':
        return qojim.length === 0 ? (
          <Empty icon="barbell-outline" text="Aucune séance Qojim" />
        ) : (
          <View style={{ gap: 10 }}>
            {qojim.map((s) => {
              const archived = isTrue(s.is_archived);
              return (
                <Card key={s.id} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.userName, { flex: 1 }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    {archived && <Pill label="Archivée" color={colors.warning} bg="rgba(245,165,36,0.15)" />}
                  </View>
                  <Text style={styles.userMeta}>
                    {s.session_type_name} · {Number(s.users_count) || 0} utilisateur{Number(s.users_count) > 1 ? 's' : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button title="Modifier" small variant="secondary" icon="create-outline" onPress={() => router.push(`/session/edit?id=${s.id}`)} style={{ flex: 1 }} />
                    <Button title={archived ? 'Désarchiver' : 'Archiver'} small variant="outline" icon={archived ? 'folder-open-outline' : 'archive-outline'} onPress={() => toggleArchive(s)} style={{ flex: 1 }} />
                  </View>
                </Card>
              );
            })}
          </View>
        );

      case 'reminders':
        return (
          <View style={{ gap: 10 }}>
            {reminderStats ? (
              <View style={styles.statsRow}>
                {statTile(reminderStats.inactive, 'Inactifs 7+ j')}
                {statTile(reminderStats.never_active, 'Jamais actifs')}
                {statTile((Number(reminderStats.inactive) || 0) + (Number(reminderStats.never_active) || 0), 'Total')}
              </View>
            ) : (
              <ActivityIndicator color={colors.gold} />
            )}
            <Button title="Relancer les inactifs (+7 jours)" variant="secondary" onPress={() => sendReminders('inactive')} disabled={reminderBusy} />
            <Button title="Relancer les jamais actifs" variant="secondary" onPress={() => sendReminders('never_active')} disabled={reminderBusy} />
            <Button title="Envoyer à tous" onPress={() => sendReminders('all')} loading={reminderBusy} />
            {reminderResult && (
              <Card style={{ gap: 4 }}>
                <T v="h3">
                  {reminderResult.sent} envoyé{reminderResult.sent > 1 ? 's' : ''}
                  {reminderResult.failed > 0 ? `, ${reminderResult.failed} échec${reminderResult.failed > 1 ? 's' : ''}` : ''}
                </T>
                {(reminderResult.results || []).slice(0, 50).map((r: any, i: number) => (
                  <Text key={i} style={styles.userMeta}>
                    {r.success ? '✅' : '❌'} {r.username} — {r.type === 'inactive' ? 'inactif' : 'jamais actif'}
                  </Text>
                ))}
              </Card>
            )}
          </View>
        );

      case 'unverified':
        return (
          <View style={{ gap: 10 }}>
            <T v="small">
              Comptes créés il y a plus de 24 h dont l’email n’a jamais été confirmé. Ils n’ont pas pu se connecter : les supprimer ne fait perdre aucune donnée.
            </T>
            {cleanupStats ? <View style={styles.statsRow}>{statTile(cleanupStats.expired_unverified, 'Comptes expirés')}</View> : <ActivityIndicator color={colors.gold} />}
            <Button
              title={`Supprimer les comptes expirés${cleanupStats?.expired_unverified ? ` (${cleanupStats.expired_unverified})` : ''}`}
              variant="danger"
              onPress={runCleanup}
              loading={cleanupBusy}
              disabled={!cleanupStats?.expired_unverified}
            />
          </View>
        );

      case 'reports':
        return (
          <View style={{ gap: 10 }}>
            <T v="small">
              Génère le rapport mensuel de {reportLabel} : une notification et un email pour chaque utilisateur ayant au moins un entraînement ce mois-là. Les utilisateurs déjà
              notifiés sont ignorés, l’action peut donc être relancée sans risque.
            </T>
            <Button title={`Générer les rapports — ${reportLabel}`} onPress={generateReports} loading={reportBusy} />
            {reportResult && (
              <Card style={{ gap: 4 }}>
                <T v="h3">Résultats</T>
                <Text style={styles.userMeta}>Éligibles : {reportResult.eligible}</Text>
                <Text style={styles.userMeta}>Notifications créées : {reportResult.created}</Text>
                <Text style={styles.userMeta}>Déjà notifiés : {reportResult.skipped}</Text>
                <Text style={styles.userMeta}>
                  Emails envoyés : {reportResult.emailed}
                  {reportResult.email_errors > 0 ? ` (${reportResult.email_errors} échec${reportResult.email_errors > 1 ? 's' : ''})` : ''}
                </Text>
              </Card>
            )}
          </View>
        );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Administration" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={{ flexGrow: 0 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => openTab(t.key)} style={[styles.tab, tab === t.key && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.gold}
            colors={[colors.gold]}
            progressBackgroundColor={colors.surface2}
          />
        }
      >
        {body()}
      </ScrollView>

      <DeleteUserSheet
        target={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(u) => {
          setDeleting(null);
          setUsers((prev) => prev.filter((x) => x.id !== u.id));
          setStats((s: any) => (s ? { ...s, total_users: Math.max(0, Number(s.total_users) - 1) } : s));
          toast(`${u.username} a été supprimé`, 'success');
        }}
      />
    </View>
  );
}

/** Confirmation de suppression : aperçu de ce qui part + pseudo à retaper. */
function DeleteUserSheet({ target, onClose, onDeleted }: { target: AdminUser | null; onClose: () => void; onDeleted: (u: AdminUser) => void }) {
  const [counts, setCounts] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  // Réinitialise à chaque nouvel utilisateur ciblé
  const [current, setCurrent] = useState<number | null>(null);
  const targetId = target ? Number(target.id) : null;
  if (targetId !== current) {
    setCurrent(targetId);
    setCounts(null);
    setError(null);
    setTyped('');
    setBusy(false);
  }

  useEffect(() => {
    if (targetId == null) return;
    let cancelled = false;
    adminApi
      .deletePreview(targetId)
      .then((r) => {
        if (!cancelled) setCounts(r.counts);
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e, 'Impossible de préparer la suppression'));
      });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const ok = !!target && typed === target.username;
  const submit = async () => {
    if (!target || !ok) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.deleteUser(Number(target.id), typed);
      onDeleted(target);
    } catch (e) {
      setError(errMsg(e, 'Erreur lors de la suppression'));
      setBusy(false);
    }
  };

  const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n > 1 ? p : s}`;

  return (
    <Sheet
      visible={!!target}
      onClose={busy ? () => {} : onClose}
      title={target ? `Supprimer « ${target.username} » ?` : ''}
      footer={<Button title="Supprimer définitivement" variant="danger" icon="trash" onPress={submit} loading={busy} disabled={!ok} />}
    >
      {target && (
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Text style={styles.warn}>
            Le compte <Text style={{ fontWeight: '800', color: colors.text }}>{target.email}</Text> et toutes ses données seront supprimés de la base.{' '}
            <Text style={{ fontWeight: '800', color: colors.danger }}>C’est définitif.</Text>
          </Text>
          {counts ? (
            <View style={styles.counts}>
              <Text style={styles.userMeta}>• {plural(counts.workouts, 'entraînement')}</Text>
              <Text style={styles.userMeta}>• {plural(counts.sessions, 'séance créée', 'séances créées')}</Text>
              <Text style={styles.userMeta}>• {plural(counts.friends, 'ami')}</Text>
              <Text style={styles.userMeta}>• {plural(counts.food_entries, 'aliment', 'aliments')} dans le journal</Text>
              <Text style={styles.userMeta}>• {plural(counts.comments, 'commentaire')}</Text>
            </View>
          ) : (
            !error && <ActivityIndicator color={colors.gold} />
          )}
          <Input
            label={`Pour confirmer, tape son pseudo : ${target.username}`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          {!!error && <Text style={{ color: colors.danger }}>{error}</Text>}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  tabOn: { backgroundColor: colors.gold },
  tabText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
  tabTextOn: { color: '#1a1406' },
  statsRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center', gap: 4 },
  statVal: { color: colors.goldLight, fontSize: 24, fontWeight: '900' },
  statLbl: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  userName: { color: colors.text, fontWeight: '800', fontSize: 15, flexShrink: 1 },
  userMeta: { color: colors.textDim, fontSize: 13 },
  trash: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft },
  warn: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  counts: { gap: 2, backgroundColor: colors.surface2, borderRadius: radius.md, padding: 10 },
});
