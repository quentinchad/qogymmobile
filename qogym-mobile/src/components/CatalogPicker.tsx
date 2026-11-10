import React, { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { CATALOG_CATEGORIES, CATALOG_CREDIT, CatalogExercise, catalogImage, searchCatalog } from '@/lib/catalog';
import { colors, radius } from '@/theme';
import { Chip, tap } from './ui';

const PAGE = 25;

/**
 * Suggestions d'exercices issues du catalogue embarqué.
 * - `query` non vide : recherche (filtrée par la catégorie choisie le cas échéant)
 * - sinon : parcours par groupe musculaire via les puces
 */
export function CatalogPicker({
  query = '',
  onPick,
  exclude,
  compact = false,
}: {
  query?: string;
  onPick: (ex: CatalogExercise) => void;
  /** Noms déjà présents (affichés comme « déjà ajouté »). */
  exclude?: string[];
  /** Mode compact : pas de puces, 6 résultats max (autocomplétion). */
  compact?: boolean;
}) {
  const [cat, setCat] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const q = query.trim();
  const results = useMemo(
    () => (q || cat ? searchCatalog(q, compact ? null : cat, compact ? 6 : limit + 1) : []),
    [q, cat, limit, compact],
  );
  const taken = useMemo(() => new Set((exclude ?? []).map((n) => n.toLowerCase())), [exclude]);
  const shown = results.slice(0, compact ? 6 : limit);

  return (
    <View>
      {!compact && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {CATALOG_CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={c}
              active={cat === c}
              onPress={() => {
                setCat((cur) => (cur === c ? null : c));
                setLimit(PAGE);
              }}
            />
          ))}
        </ScrollView>
      )}
      {!compact && !q && !cat && <Text style={styles.hint}>Choisis un groupe musculaire ou tape un nom pour voir des suggestions.</Text>}
      {(q || cat) && shown.length === 0 && <Text style={styles.hint}>Aucun exercice trouvé dans le catalogue.</Text>}
      <View style={{ gap: 6 }}>
        {shown.map((ex) => (
          <CatalogRow key={ex.n} ex={ex} onPick={onPick} added={taken.has(ex.n.toLowerCase())} />
        ))}
      </View>
      {!compact && results.length > limit && (
        <Pressable style={styles.more} onPress={() => setLimit((l) => l + PAGE)}>
          <Text style={styles.moreText}>Voir plus</Text>
        </Pressable>
      )}
      {shown.length > 0 && <Text style={styles.credit}>{CATALOG_CREDIT}</Text>}
    </View>
  );
}

const CatalogRow = memo(function CatalogRow({ ex, onPick, added }: { ex: CatalogExercise; onPick: (ex: CatalogExercise) => void; added: boolean }) {
  const img = catalogImage(ex);
  const meta = [ex.m.slice(0, 2).join(', '), ex.e.filter((e) => e !== 'Poids du corps').slice(0, 2).join(', ') || (ex.e.length ? 'Poids du corps' : '')]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      onPress={() => {
        tap();
        onPick(ex);
      }}
    >
      <View style={styles.thumb}>
        {img ? (
          <Image source={img} style={styles.thumbImg} contentFit="contain" cachePolicy="disk" recyclingKey={ex.n} transition={120} />
        ) : (
          <Ionicons name="barbell-outline" size={18} color={colors.textDim} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={2}>
          {ex.n}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {ex.c}
          {meta ? ` · ${meta}` : ''}
        </Text>
      </View>
      <Ionicons name={added ? 'checkmark-circle' : 'add-circle-outline'} size={22} color={added ? colors.success : colors.goldLight} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chips: { gap: 6, paddingBottom: 10 },
  hint: { color: colors.textFaint, fontSize: 12, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface2 },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#fff1', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: 40, height: 40, backgroundColor: '#fff' },
  name: { color: colors.text, fontWeight: '700', fontSize: 14 },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  more: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  moreText: { color: colors.goldLight, fontWeight: '700' },
  credit: { color: colors.textFaint, fontSize: 10, textAlign: 'right', marginTop: 6 },
});
