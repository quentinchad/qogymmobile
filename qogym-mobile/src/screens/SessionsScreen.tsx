import React, { memo, useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { errMsg, qojimApi, sessionApi, shareApi } from '@/lib/api';
import { useCached } from '@/lib/storage';
import { autoSessionName, isTrue } from '@/lib/format';
import { colors, radius, sessionImageUrl } from '@/theme';
import { Avatar, Button, Card, Empty, IconBtn, Loader, Pill, TabTitle, tap, T } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { useConfirm, useToast } from '@/components/Feedback';
import { ShareSessionSheet } from '@/components/ShareSessionSheet';
import { useStartWorkout } from '@/workout/useStartWorkout';
import type { TabScreenProps } from '@/app/index';

export default function SessionsScreen({ active }: TabScreenProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const startWorkout = useStartWorkout();
  const { data, setData, loading, refreshing, refresh, refreshIfStale } = useCached('sessions', async () => {
    const r = await sessionApi.list();
    return (r.sessions || []) as any[];
  });
  const [pendingCount, setPendingCount] = useState(0);
  const [showPending, setShowPending] = useState(false);
  const [shareTarget, setShareTarget] = useState<any>(null);
  const [menuFor, setMenuFor] = useState<any>(null);
  const [startingEmpty, setStartingEmpty] = useState(false);

  const loadPending = useCallback(() => {
    shareApi
      .pendingCount()
      .then((r) => setPendingCount(r.count || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (active) {
      refreshIfStale();
      loadPending();
    }
  }, [active, refreshIfStale, loadPending]);

  const sessions = data || [];

  const startEmpty = async () => {
    if (startingEmpty) return;
    setStartingEmpty(true);
    try {
      const t = await sessionApi.types();
      const types = t.types || t.session_types || [];
      if (!types[0]) throw new Error('Aucun type de séance disponible');
      const fd = new FormData();
      fd.append('name', autoSessionName('start'));
      fd.append('session_type_id', String(types[0].id));
      fd.append('exercises', JSON.stringify([]));
      fd.append('is_archived', '1');
      const created = await sessionApi.create(fd);
      const id = created.session_id || created.id;
      if (!id) throw new Error('Erreur lors de la création de la séance');
      await startWorkout(String(id), { isEmptyWorkout: true });
    } catch (e) {
      toast(errMsg(e, "Erreur lors du démarrage d'une séance libre"), 'error');
    } finally {
      setStartingEmpty(false);
    }
  };

  const removeSession = async (s: any) => {
    setMenuFor(null);
    const own = isTrue(s.is_owner) && !isTrue(s.is_qojim_session);
    const ok = await confirm({
      title: own ? 'Supprimer cette séance ?' : 'Retirer de ta bibliothèque ?',
      message: own ? "L'historique de tes entraînements est conservé." : undefined,
      confirmLabel: own ? 'Supprimer' : 'Retirer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      if (own) await sessionApi.remove(s.id);
      else await qojimApi.remove(s.id);
      setData((prev) => (prev || []).filter((x) => x.id !== s.id));
      toast(own ? 'Séance supprimée' : 'Séance retirée', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const header = (
    <View>
      <TabTitle
        title="Séances"
        right={
          <>
            <IconBtn name="notifications-outline" badge={pendingCount} onPress={() => setShowPending(true)} label="Séances reçues" />
            <IconBtn name="add" bg={colors.gold} color="#1a1406" onPress={() => router.push('/session/edit')} label="Créer une séance" />
          </>
        }
      />
      {pendingCount > 0 && (
        <Pressable style={styles.banner} onPress={() => setShowPending(true)}>
          <Ionicons name="gift-outline" size={20} color={colors.purple} />
          <Text style={styles.bannerText}>
            {pendingCount === 1 ? 'Un ami veut partager une séance avec toi !' : `${pendingCount} séances partagées t'attendent !`}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </Pressable>
      )}
      <Pressable
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        onPress={() => {
          tap();
          startEmpty();
        }}
        disabled={startingEmpty}
      >
        <View style={styles.ctaIcon}>
          <Ionicons name="flash" size={22} color="#1a1406" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.ctaTitle}>{startingEmpty ? 'Démarrage…' : 'Lancer une séance vide'}</Text>
          <Text style={styles.ctaSub}>Ajoute tes exercices au fur et à mesure</Text>
        </View>
        <Ionicons name="arrow-forward" size={20} color={colors.goldLight} />
      </Pressable>
    </View>
  );

  const footer = (
    <Pressable style={({ pressed }) => [styles.qojim, pressed && { opacity: 0.85 }]} onPress={() => router.push('/qojim')}>
      <Ionicons name="ribbon" size={22} color={colors.purple} />
      <View style={{ flex: 1 }}>
        <Text style={styles.ctaTitle}>Découvrir les séances Qojim</Text>
        <Text style={styles.ctaSub}>Programmes prêts à l'emploi à ajouter à ta bibliothèque</Text>
      </View>
      <Ionicons name="arrow-forward" size={20} color={colors.textDim} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      {loading ? (
        <View style={{ padding: 16 }}>
          {header}
          <Loader />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 30, gap: 12 }}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={
            <Empty
              icon="barbell-outline"
              title="Aucune séance pour le moment"
              text="Crée ta première séance ou ajoute un programme Qojim."
              action={<Button title="Créer ma première séance" onPress={() => router.push('/session/edit')} />}
            />
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh('pull')} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surface2} />}
          renderItem={({ item }) => (
            <SessionCard session={item} onStart={() => startWorkout(String(item.id))} onMenu={() => setMenuFor(item)} />
          )}
          initialNumToRender={6}
          windowSize={7}
        />
      )}

      {/* Menu d'actions d'une séance */}
      <Sheet visible={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name}>
        {menuFor && (
          <View style={{ gap: 8, paddingBottom: 8 }}>
            <MenuItem icon="eye-outline" label="Voir le détail" onPress={() => { setMenuFor(null); router.push(`/session/${menuFor.id}`); }} />
            {isTrue(menuFor.is_owner) && !isTrue(menuFor.is_qojim_session) && (
              <>
                <MenuItem icon="create-outline" label="Modifier" onPress={() => { setMenuFor(null); router.push(`/session/edit?id=${menuFor.id}`); }} />
                <MenuItem icon="share-social-outline" label="Partager avec un ami" onPress={() => { setShareTarget(menuFor); setMenuFor(null); }} />
              </>
            )}
            <MenuItem
              icon="trash-outline"
              danger
              label={isTrue(menuFor.is_owner) && !isTrue(menuFor.is_qojim_session) ? 'Supprimer' : 'Retirer de ma bibliothèque'}
              onPress={() => removeSession(menuFor)}
            />
          </View>
        )}
      </Sheet>

      <ShareSessionSheet session={shareTarget} onClose={() => setShareTarget(null)} />
      <PendingSharesSheet
        visible={showPending}
        onClose={() => setShowPending(false)}
        onChanged={() => {
          loadPending();
          refresh();
        }}
      />
    </View>
  );
}

export const MenuItem = ({ icon, label, onPress, danger }: { icon: any; label: string; onPress: () => void; danger?: boolean }) => (
  <Pressable
    onPress={() => {
      tap();
      onPress();
    }}
    android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
    style={styles.menuItem}
  >
    <Ionicons name={icon} size={21} color={danger ? colors.danger : colors.text} />
    <Text style={[styles.menuLabel, danger && { color: colors.danger }]}>{label}</Text>
  </Pressable>
);

const SessionCard = memo(function SessionCard({ session, onStart, onMenu }: { session: any; onStart: () => void; onMenu: () => void }) {
  const img = sessionImageUrl(session.image_url);
  const qojim = isTrue(session.is_qojim_session);
  return (
    <Card style={styles.card} onPress={() => router.push(`/session/${session.id}`)} onLongPress={onMenu}>
      {img ? (
        <>
          <Image source={{ uri: img }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,13,24,0.62)' }]} />
        </>
      ) : null}
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {session.name}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {!!session.session_type_name && <Pill label={session.session_type_name} />}
            {qojim && <Pill label="Certifiée Qojim" icon="ribbon" color={colors.purple} bg={colors.purpleSoft} />}
          </View>
        </View>
        <IconBtn name="ellipsis-vertical" color={colors.textDim} onPress={onMenu} label="Actions" />
      </View>
      <Button title="Démarrer" icon="play" variant="success" onPress={onStart} style={{ marginTop: 14, alignSelf: 'flex-start' }} small />
    </Card>
  );
});

function PendingSharesSheet({ visible, onClose, onChanged }: { visible: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [shares, setShares] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    setShares(null);
    shareApi
      .pending()
      .then((r) => setShares(r.pending_shares || []))
      .catch(() => setShares([]));
  }, [visible]);

  const act = async (id: number, accept: boolean) => {
    setBusy(id);
    try {
      if (accept) await shareApi.accept(id);
      else await shareApi.decline(id);
      setShares((p) => (p || []).filter((s) => s.share_id !== id));
      toast(accept ? 'Séance ajoutée à ta bibliothèque' : 'Partage refusé', 'success');
      onChanged();
    } catch (e: any) {
      const d = e?.data || {};
      if (d.share_auto_cancelled || e?.status === 404 || e?.status === 410) {
        setShares((p) => (p || []).filter((s) => s.share_id !== id));
        onChanged();
      }
      toast(errMsg(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Séances reçues">
      {shares === null ? (
        <Loader />
      ) : shares.length === 0 ? (
        <Empty icon="mail-open-outline" text="Aucun partage en attente." />
      ) : (
        <View style={{ gap: 12, paddingBottom: 10 }}>
          {shares.map((s) => (
            <View key={s.share_id} style={styles.shareItem}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Avatar name={s.sender_username} pdp={s.sender_pdp} size={36} />
                <T v="small" style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{s.sender_username}</Text> veut partager avec toi
                </T>
              </View>
              <Text style={styles.cardTitle}>{s.session_name}</Text>
              <T v="small">
                {s.session_type_name}
                {s.exercise_count > 0 ? ` · ${s.exercise_count} exercice${s.exercise_count > 1 ? 's' : ''}` : ''}
              </T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Accepter" variant="success" small icon="checkmark" loading={busy === s.share_id} onPress={() => act(s.share_id, true)} style={{ flex: 1 }} />
                <Button title="Refuser" variant="danger" small disabled={busy === s.share_id} onPress={() => act(s.share_id, false)} style={{ flex: 1 }} />
              </View>
            </View>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.purpleSoft,
    padding: 12,
    borderRadius: radius.md,
    marginBottom: 12,
  },
  bannerText: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 14 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.35)',
    marginBottom: 4,
  },
  ctaIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  ctaSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  qojim: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  card: { minHeight: 130 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 6, borderRadius: radius.md },
  menuLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  shareItem: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 14, gap: 8 },
});
