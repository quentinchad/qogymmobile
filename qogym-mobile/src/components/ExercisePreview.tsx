import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { groupBySupersets, supersetLetter } from '@/lib/supersets';
import { fmtRest } from '@/lib/format';
import { colors, radius } from '@/theme';
import { T } from './ui';

const line = (ex: any) =>
  `${ex.sets} séries × ${ex.reps_min}${ex.reps_max && ex.reps_max !== ex.reps_min ? `-${ex.reps_max}` : ''} reps · ${fmtRest(Number(ex.rest_time) || 0)}`;

/** Liste d'exercices d'une séance avec les supersets regroupés. */
export function ExercisePreview({ exercises }: { exercises: any[] }) {
  if (!exercises?.length) return <T v="small">Aucun exercice dans cette séance</T>;
  return (
    <View style={{ gap: 8 }}>
      {groupBySupersets(exercises).map((b: any, bi: number) =>
        b.type === 'solo' ? (
          <View key={bi} style={styles.item}>
            <View style={styles.num}>
              <Text style={styles.numText}>{b.startIndex + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{b.exercise.name}</Text>
              <Text style={styles.meta}>{line(b.exercise)}</Text>
            </View>
          </View>
        ) : (
          <View key={bi} style={styles.ss}>
            <Text style={styles.ssHead}>
              <Ionicons name="link" size={12} color={colors.purple} /> Superset · {b.exercises.length} exercices
            </Text>
            {b.exercises.map((ex: any, i: number) => (
              <View key={ex.id ?? i} style={[styles.item, { backgroundColor: 'transparent', paddingHorizontal: 0 }]}>
                <View style={[styles.num, { backgroundColor: colors.purpleSoft }]}>
                  <Text style={[styles.numText, { color: colors.purple }]}>{supersetLetter(i)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{ex.name}</Text>
                  <Text style={styles.meta}>{line(ex)}</Text>
                </View>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface2 },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  numText: { color: colors.textDim, fontWeight: '900', fontSize: 13 },
  name: { color: colors.text, fontWeight: '700', fontSize: 15 },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  ss: { borderLeftWidth: 3, borderLeftColor: colors.purple, borderRadius: radius.md, backgroundColor: colors.surface2, padding: 10, gap: 4 },
  ssHead: { color: colors.purple, fontWeight: '800', fontSize: 12 },
});
