import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { errMsg, friendsApi, userApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateShort } from '@/lib/format';
import { colors, radius, sessionImageUrl } from '@/theme';
import { Avatar, Button, Card, Empty, Loader, ScreenHeader, T } from '@/components/ui';
import { useConfirm, useToast } from '@/components/Feedback';

const PAGE = 10;

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [p, setP] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const r = await userApi.profile(id);
      setP(r);
      setHistory(r.history || []);
      setHasMore(!!r.history_has_more);
    } catch (e) {
      setError(errMsg(e, 'Utilisateur introuvable'));
    }
  };

  useEffect(() => {
    if (user && Number(id) === Number(user.id)) {
      router.replace('/');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const r = await userApi.moreHistory(id, PAGE, history.length);
      const seen = new Set(history.map((w) => w.id));
      setHistory([...history, ...(r.history || []).filter((w: any) => !seen.has(w.id))]);
      setHasMore(!!r.has_more);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setMoreLoading(false);
    }
  };

  if (!p) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Profil" />
        {error ? <Text style={{ color: colors.danger, padding: 20 }}>{error}</Text> : <Loader />}
      </View>
    );
  }

  const u = p.user;
  const canSee = p.is_friend || p.is_own_profile;

  const friendship = () => {
    if (p.is_friend)
      return (
        <View style={styles.banner}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text style={styles.bannerText}>Vous êtes amis</Text>
          <Button
            title="Retirer"
            small
            variant="ghost"
            disabled={busy}
            onPress={async () => {
              if (await confirm({ title: `Retirer ${u.username} de tes amis ?`, confirmLabel: 'Retirer', variant: 'danger' })) act(() => friendsApi.remove(p.friendship_id));
            }}
          />
        </View>
      );
    if (p.friendship_status === 'pending' && p.friendship_direction === 'sent')
      return (
        <View style={styles.banner}>
          <Ionicons name="hourglass-outline" size={18} color={colors.warning} />
          <Text style={styles.bannerText}>Demande envoyée</Text>
          <Button title="Annuler" small variant="ghost" disabled={busy} onPress={() => act(() => friendsApi.decline(p.friendship_id))} />
        </View>
      );
    if (p.friendship_status === 'pending')
      return (
        <View style={[styles.banner, { flexWrap: 'wrap' }]}>
          <Text style={[styles.bannerText, { width: '100%' }]}>{u.username} t'a envoyé une demande d'ami</Text>
          <Button title="Accepter" small variant="success" disabled={busy} onPress={() => act(() => friendsApi.accept(p.friendship_id))} />
          <Button title="Refuser" small variant="ghost" disabled={busy} onPress={() => act(() => friendsApi.decline(p.friendship_id))} />
        </View>
      );
    return (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>Vous n'êtes pas encore amis</Text>
        <Button title="Ajouter" small icon="person-add" loading={busy} onPress={() => act(() => friendsApi.send(Number(id)))} />
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={u.username} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <Card style={{ alignItems: 'center', gap: 8 }}>
          <Avatar name={u.username} pdp={u.pdp} size={86} />
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{u.username}</Text>
          {!!u.created_at && <T v="small">Membre depuis le {fmtDate(u.created_at)}</T>}
          {!p.is_own_profile && friendship()}
        </Card>

        <View style={styles.stats}>
          {[
            ['Entraînements', p.stats?.total_workouts],
            ['Jours actifs', p.stats?.total_days],
            ['Séries', p.stats?.total_sets],
            ['Répétitions', p.stats?.total_reps],
          ].map(([l, v]) => (
            <View key={String(l)} style={styles.stat}>
              <Text style={styles.statVal}>{Number(v) || 0}</Text>
              <Text style={styles.statLbl}>{l}</Text>
            </View>
          ))}
        </View>

        {canSee ? (
          <>
            <Button title={`Exercices de ${u.username}`} variant="outline" icon="library-outline" onPress={() => router.push(`/exercises/${id}`)} />
            <Card style={{ gap: 6 }}>
              <T v="h3">Derniers entraînements</T>
              {history.length === 0 ? (
                <T v="small">Aucun entraînement enregistré pour le moment.</T>
              ) : (
                history.map((w) => {
                  const img = sessionImageUrl(w.session_image);
                  return (
                    <Pressable key={w.id} style={styles.w} onPress={() => router.push(`/workout-detail/${w.id}`)}>
                      {img ? (
                        <Image source={{ uri: img }} style={styles.wImg} contentFit="cover" cachePolicy="memory-disk" />
                      ) : (
                        <View style={[styles.wImg, { alignItems: 'center', justifyContent: 'center' }]}>
                          <Ionicons name="barbell" size={20} color={colors.textFaint} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                          {w.session_name}
                        </Text>
                        <T v="small">{fmtDateShort(w.completed_at)}</T>
                      </View>
                      <Text style={styles.wBadge}>♥ {w.likes_count ?? 0}</Text>
                      <Text style={styles.wBadge}>💬 {w.comments_count ?? 0}</Text>
                    </Pressable>
                  );
                })
              )}
              {hasMore && <Button title="Charger plus" small variant="ghost" onPress={loadMore} loading={moreLoading} />}
            </Card>
          </>
        ) : (
          <Empty icon="lock-closed-outline" text={`Ajoute ${u.username} en ami pour voir ses entraînements`} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface2, alignSelf: 'stretch' },
  bannerText: { color: colors.text, flex: 1, fontWeight: '600' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '48%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  statVal: { color: colors.goldLight, fontSize: 24, fontWeight: '900' },
  statLbl: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  w: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  wImg: { width: 46, height: 46, borderRadius: 10, backgroundColor: colors.surface2 },
  wBadge: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
});
