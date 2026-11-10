import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { exerciseApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCached } from '@/lib/storage';
import { fmtDateShort, parseDate } from '@/lib/format';
import { colors, radius } from '@/theme';
import { Chip, Empty, Input, Loader, ScreenHeader } from '@/components/ui';
import { OrmBadge } from '@/components/Visuals';

const SORTS = [
  { key: 'recent', label: 'Récent' },
  { key: 'alpha', label: 'A → Z' },
  { key: 'count', label: 'Nb de fois' },
  { key: 'orm', label: '1RM' },
] as const;

export default function ExerciseLibrary() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user } = useAuth();
  const own = user && Number(userId) === Number(user.id);
  const { data, loading } = useCached(`exlib_${userId}`, async () => exerciseApi.library(userId));
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('recent');

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    let l: any[] = data?.exercises || [];
    if (t) l = l.filter((e) => e.name.toLowerCase().includes(t));
    const s = [...l];
    if (sort === 'alpha') s.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    else if (sort === 'count') s.sort((a, b) => b.times_performed - a.times_performed);
    else if (sort === 'orm') s.sort((a, b) => (b.best_one_rep_max || 0) - (a.best_one_rep_max || 0));
    else s.sort((a, b) => (parseDate(b.last_performed_at)?.getTime() || 0) - (parseDate(a.last_performed_at)?.getTime() || 0));
    return s;
  }, [data, q, sort]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={own ? 'Mes exercices' : 'Exercices'} subtitle={!own && data?.user ? `Bibliothèque de ${data.user.username}` : undefined} />
      {loading ? (
        <Loader />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(e) => e.name}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 30 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 6 }}>
              <Input value={q} onChangeText={setQ} placeholder="Rechercher un exercice…" />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {SORTS.map((s) => (
                  <Chip key={s.key} label={s.label} active={sort === s.key} onPress={() => setSort(s.key)} />
                ))}
              </View>
            </View>
          }
          ListEmptyComponent={
            <Empty
              icon="barbell-outline"
              text={(data?.exercises || []).length === 0 ? (own ? 'Termine une séance pour commencer à suivre ta progression !' : 'Aucun exercice enregistré.') : 'Aucun résultat.'}
            />
          }
          renderItem={({ item: e }) => (
            <Pressable style={styles.item} onPress={() => router.push(`/exercises/${userId}/${encodeURIComponent(e.name)}`)}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name}>{e.name}</Text>
                <Text style={styles.meta}>
                  {e.times_performed} fois · dernière fois le {fmtDateShort(e.last_performed_at)}
                </Text>
                {e.best_one_rep_max != null && <OrmBadge value={e.best_one_rep_max} />}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  name: { color: colors.text, fontWeight: '800', fontSize: 15 },
  meta: { color: colors.textDim, fontSize: 12 },
});
