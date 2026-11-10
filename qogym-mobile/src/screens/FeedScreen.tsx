import React, { memo, useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { feedApi, friendsApi, reportApi } from '@/lib/api';
import { useCached, store } from '@/lib/storage';
import { fmtDateTime, isTrue, MONTH_NAMES } from '@/lib/format';
import { colors, radius, sessionImageUrl } from '@/theme';
import { Avatar, Button, Card, Empty, IconBtn, Loader, TabTitle } from '@/components/ui';
import { FriendsSheet } from '@/components/FriendsSheet';
import type { TabScreenProps } from '@/app/index';

const LIMIT = 10;

export default function FeedScreen({ active, goToTab }: TabScreenProps) {
  const { data, setData, loading, refreshing, refresh, refreshIfStale } = useCached('feed', async () => {
    const r = await feedApi.feed(LIMIT, 0);
    return { workouts: (r.workouts || []) as any[], hasMore: (r.workouts || []).length === LIMIT };
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingFriends, setPendingFriends] = useState(0);
  const [pendingReport, setPendingReport] = useState<{ year: number; month: number } | null>(null);
  const [showFriends, setShowFriends] = useState(false);

  const loadSide = useCallback(() => {
    friendsApi
      .received()
      .then((r) => setPendingFriends((r.pending_requests || []).length))
      .catch(() => {});
    reportApi
      .pending()
      .then((r) => setPendingReport(r.pending || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;
    // Un entraînement vient d'être terminé → refresh immédiat
    store.get<number>('qg_needs_refresh', 0).then((t) => {
      if (t) {
        store.remove('qg_needs_refresh');
        refresh();
      } else refreshIfStale();
    });
    loadSide();
  }, [active, refresh, refreshIfStale, loadSide]);

  const workouts = data?.workouts || [];

  const loadMore = async () => {
    if (loadingMore || !data?.hasMore) return;
    setLoadingMore(true);
    try {
      const r = await feedApi.feed(LIMIT, workouts.length);
      const more = r.workouts || [];
      setData((d) => {
        const seen = new Set((d?.workouts || []).map((w: any) => w.id));
        return { workouts: [...(d?.workouts || []), ...more.filter((w: any) => !seen.has(w.id))], hasMore: more.length === LIMIT };
      });
    } catch {
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleLike = useCallback(
    (w: any) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const liked = isTrue(w.user_has_liked);
      // Optimiste : l'UI répond instantanément
      setData((d) =>
        d
          ? {
              ...d,
              workouts: d.workouts.map((x: any) =>
                x.id === w.id ? { ...x, user_has_liked: !liked, likes_count: Number(x.likes_count) + (liked ? -1 : 1) } : x,
              ),
            }
          : d,
      );
      feedApi.toggleLike(w.id).catch(() => refresh());
    },
    [setData, refresh],
  );

  const header = (
    <View>
      <TabTitle
        title="Feed"
        right={
          <>
            <IconBtn name="people" badge={pendingFriends} onPress={() => setShowFriends(true)} label="Amis" />
            <Button title="S'entraîner" small icon="barbell" onPress={() => goToTab(1)} />
          </>
        }
      />
      {pendingReport && (
        <Pressable style={styles.report} onPress={() => router.push(`/report/${pendingReport.year}/${pendingReport.month}`)}>
          <Ionicons name="stats-chart" size={20} color={colors.goldLight} />
          <Text style={styles.reportText}>
            Ton rapport de <Text style={{ fontWeight: '800' }}>{MONTH_NAMES[pendingReport.month]?.toLowerCase()} {pendingReport.year}</Text> est disponible !
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </Pressable>
      )}
    </View>
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
          data={workouts}
          keyExtractor={(w) => String(w.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 30, gap: 12 }}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <Empty
              icon="people-outline"
              title="Rien à afficher pour l'instant"
              text="Ajoute des amis pour suivre leurs entraînements 💪"
              action={<Button title="Trouver des amis" variant="secondary" icon="person-add" onPress={() => setShowFriends(true)} />}
            />
          }
          renderItem={({ item }) => <FeedCard w={item} onLike={toggleLike} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={loadingMore ? <Loader /> : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                refresh('pull');
                loadSide();
              }}
              tintColor={colors.gold}
              colors={[colors.gold]}
              progressBackgroundColor={colors.surface2}
            />
          }
          initialNumToRender={5}
          windowSize={9}
        />
      )}
      <FriendsSheet
        visible={showFriends}
        onClose={() => {
          setShowFriends(false);
          loadSide();
        }}
      />
    </View>
  );
}

const FeedCard = memo(function FeedCard({ w, onLike }: { w: any; onLike: (w: any) => void }) {
  const img = sessionImageUrl(w.session_image);
  const liked = isTrue(w.user_has_liked);
  return (
    <Card style={{ padding: 0 }} onPress={() => router.push(`/workout-detail/${w.id}`)}>
      <View style={styles.cardHead}>
        <Avatar name={w.user_username} pdp={w.user_pdp} size={42} onPress={() => router.push(`/user/${w.user_id}`)} />
        <View style={{ flex: 1 }}>
          <Text style={styles.user} onPress={() => router.push(`/user/${w.user_id}`)}>
            {w.user_username}
          </Text>
          <Text style={styles.time}>{fmtDateTime(w.completed_at)}</Text>
        </View>
      </View>
      {img && <Image source={{ uri: img }} style={styles.img} contentFit="cover" cachePolicy="memory-disk" transition={150} recyclingKey={String(w.id)} />}
      <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 4 }}>
        <Text style={styles.session}>{w.session_name}</Text>
        {!!w.session_type_name && <Text style={styles.type}>{w.session_type_name}</Text>}
        {!!w.participants && (
          <Text style={styles.type}>
            <Ionicons name="people" size={12} color={colors.textDim} /> Avec {w.participants}
          </Text>
        )}
        {!!w.notes && (
          <Text style={styles.notes} numberOfLines={3}>
            « {w.notes} »
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable onPress={() => onLike(w)} hitSlop={8} style={styles.action}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? colors.danger : colors.textDim} />
          <Text style={[styles.actionText, liked && { color: colors.danger }]}>{w.likes_count}</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/workout-detail/${w.id}`)} hitSlop={8} style={styles.action}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.textDim} />
          {w.comments_count != null && <Text style={styles.actionText}>{w.comments_count}</Text>}
        </Pressable>
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  report: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.goldSoft,
    padding: 12,
    borderRadius: radius.md,
    marginBottom: 12,
  },
  reportText: { flex: 1, color: colors.text, fontSize: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingBottom: 0 },
  user: { color: colors.text, fontWeight: '800', fontSize: 15 },
  time: { color: colors.textDim, fontSize: 12 },
  img: { height: 170, marginTop: 12, backgroundColor: colors.surface2 },
  session: { color: colors.text, fontSize: 18, fontWeight: '800' },
  type: { color: colors.textDim, fontSize: 13 },
  notes: { color: colors.text, fontStyle: 'italic', marginTop: 4, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 22, paddingHorizontal: 14, paddingVertical: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border, marginHorizontal: 0 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { color: colors.textDim, fontWeight: '700', fontSize: 14 },
});
