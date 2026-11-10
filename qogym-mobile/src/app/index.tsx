import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { store } from '@/lib/storage';
import { colors } from '@/theme';
import { tap, IconName } from '@/components/ui';
import { MiniWorkout } from '@/workout/MiniWorkout';
import { UpdateBanner } from '@/components/UpdateBanner';
import FeedScreen from '@/screens/FeedScreen';
import SessionsScreen from '@/screens/SessionsScreen';
import NutritionScreen from '@/screens/NutritionScreen';
import ProfileScreen from '@/screens/ProfileScreen';

const TABS: { key: string; label: string; icon: IconName; iconActive: IconName }[] = [
  { key: 'feed', label: 'Feed', icon: 'people-outline', iconActive: 'people' },
  { key: 'sessions', label: 'Séances', icon: 'barbell-outline', iconActive: 'barbell' },
  { key: 'nutrition', label: 'Nutrition', icon: 'nutrition-outline', iconActive: 'nutrition' },
  { key: 'profile', label: 'Profil', icon: 'person-circle-outline', iconActive: 'person-circle' },
];
const TAB_KEY = 'qg_last_tab';

export default function Main() {
  const { ready, user } = useAuth();
  const insets = useSafeAreaInsets();
  const pager = useRef<PagerView>(null);
  const [page, setPage] = useState(0);
  const [visited, setVisited] = useState<Record<number, boolean>>({ 0: true });
  const [focused, setFocused] = useState(true);
  const [restored, setRestored] = useState(false);
  const pageRef = useRef(page);
  pageRef.current = page;

  // Restaure le dernier onglet (comme le site après un rechargement)
  useEffect(() => {
    store.get<number>(TAB_KEY, 0).then((p) => {
      const idx = Math.max(0, Math.min(3, p || 0));
      setPage(idx);
      setVisited({ [idx]: true });
      setRestored(true);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      // Retour Android depuis un autre onglet que le Feed → revient au Feed.
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (pageRef.current !== 0) {
          pager.current?.setPage(0);
          return true;
        }
        return false;
      });
      return () => {
        setFocused(false);
        sub.remove();
      };
    }, []),
  );
  const goTo = (i: number) => {
    if (i === page) return;
    tap();
    pager.current?.setPage(i);
  };

  if (!ready || !user || !restored) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const screens = [FeedScreen, SessionsScreen, NutritionScreen, ProfileScreen];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <UpdateBanner />
      <PagerView
        ref={pager}
        style={{ flex: 1 }}
        initialPage={page}
        offscreenPageLimit={1}
        onPageSelected={(e) => {
          const p = e.nativeEvent.position;
          setPage(p);
          setVisited((v) => (v[p] ? v : { ...v, [p]: true }));
          store.set(TAB_KEY, p);
        }}
      >
        {screens.map((Screen, i) => (
          <View key={TABS[i].key} style={{ flex: 1 }} collapsable={false}>
            {visited[i] ? <Screen active={focused && page === i} goToTab={goTo} /> : null}
          </View>
        ))}
      </PagerView>

      <MiniWorkout visible={focused} />

      <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {TABS.map((t, i) => {
          const active = page === i;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => goTo(i)}
              android_ripple={{ color: 'rgba(255,255,255,0.08)', borderless: true }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.tabIconWrap, active && styles.tabIconActive]}>
                <Ionicons name={active ? t.iconActive : t.icon} size={23} color={active ? colors.goldLight : colors.textFaint} />
              </View>
              <Text style={[styles.tabLabel, active && { color: colors.goldLight }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export type TabScreenProps = { active: boolean; goToTab: (i: number) => void };

const styles = StyleSheet.create({
  tabbar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabIconWrap: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tabIconActive: { backgroundColor: colors.goldSoft },
  tabLabel: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
});
