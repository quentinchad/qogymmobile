import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '@/theme';
import { fmtClock } from '@/lib/format';
import { tap } from '@/components/ui';
import { elapsedSeconds, totalSetsOf, useActiveWorkout, useTicker } from './ActiveWorkout';

/** Bandeau "entraînement en cours" au-dessus de la barre d'onglets. */
export function MiniWorkout({ visible = true }: { visible?: boolean }) {
  const { state, hasActive } = useActiveWorkout();
  const resting = !!state.countdownEndAt && state.countdownEndAt > Date.now();
  useTicker(visible && hasActive && (state.timerActive || resting), 1000);
  if (!hasActive) return null;

  const done = Object.keys(state.validatedSets).length;
  const total = state.exercises.reduce((a, e) => a + totalSetsOf(e, state.extraSets), 0);
  const restLeft = resting ? Math.ceil((state.countdownEndAt! - Date.now()) / 1000) : 0;

  return (
    <Pressable
      onPress={() => {
        tap();
        router.push(`/workout/${state.sessionId}`);
      }}
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.9 }]}
      accessibilityLabel="Reprendre l'entraînement en cours"
    >
      <View style={[styles.dot, { backgroundColor: state.timerActive ? colors.success : colors.warning }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {state.sessionName || 'Entraînement'}
        </Text>
        <Text style={styles.meta}>
          {fmtClock(elapsedSeconds(state))}
          {total > 0 ? `  ·  ${done}/${total} séries` : ''}
        </Text>
      </View>
      {resting && (
        <View style={styles.rest}>
          <Ionicons name="hourglass-outline" size={14} color={colors.goldLight} />
          <Text style={styles.restText}>{fmtClock(restLeft)}</Text>
        </View>
      )}
      <Ionicons name="chevron-up" size={22} color={colors.goldLight} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 10,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.35)',
    elevation: 6,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { color: colors.text, fontWeight: '800', fontSize: 14 },
  meta: { color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  rest: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.goldSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  restText: { color: colors.goldLight, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] },
});
