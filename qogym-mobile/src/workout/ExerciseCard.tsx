import React, { memo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View, TextInputInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '@/theme';
import { fmtRest } from '@/lib/format';
import { bestOneRepMax } from '@/lib/oneRepMax';
import { supersetLetter } from '@/lib/supersets';
import { OrmBadge } from '@/components/Visuals';
import { IconBtn, tap } from '@/components/ui';
import type { Exercise, SetData } from './ActiveWorkout';

export type ExerciseCardProps = {
  exercise: Exercise;
  index: number;
  totalSets: number;
  sets: (SetData | undefined)[];
  validated: boolean[];
  effectiveRest: number;
  restModified: boolean;
  lastPerformance?: string | null;
  inSuperset: boolean;
  firstOfSuperset: boolean;
  lastOfSuperset: boolean;
  positionInSuperset: number;
  groupSize: number;
  canLinkNext: boolean;
  linkedToNext: boolean;
  onSetChange: (exId: number, setNumber: number, field: 'weight' | 'reps', v: string) => void;
  onValidate: (exId: number, setNumber: number, effectiveRest: number) => void;
  onAddSet: (exId: number) => void;
  onRemoveSet: (exId: number) => void;
  onEditRest: (restSourceId: number) => void;
  restSourceId: number;
  onLink: (exId: number) => void;
  onUnlink: (exId: number) => void;
  onRemove: (exId: number) => void;
  onOpenProgress: (name: string) => void;
  onLongPress: () => void;
};

export const ExerciseCard = memo(function ExerciseCard(p: ExerciseCardProps) {
  const ex = p.exercise;
  const orm = bestOneRepMax(p.sets.filter(Boolean));
  const repsLabel = `${ex.reps_min ?? ''}${ex.reps_max && ex.reps_max !== ex.reps_min ? `-${ex.reps_max}` : ''}`;
  const doneCount = p.validated.filter(Boolean).length;
  const allDone = doneCount === p.totalSets && p.totalSets > 0;

  return (
    <View>
      {p.firstOfSuperset && (
        <View style={styles.ssHeader}>
          <Ionicons name="link" size={14} color={colors.purple} />
          <Text style={styles.ssHeaderText}>Superset · {p.groupSize} exercices</Text>
          <Text style={styles.ssHint}>repos partagé</Text>
        </View>
      )}
      <Pressable
        onLongPress={p.onLongPress}
        delayLongPress={380}
        style={[
          styles.card,
          p.inSuperset && styles.cardSs,
          p.inSuperset && !p.firstOfSuperset && { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
          p.inSuperset && !p.lastOfSuperset && { borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
          allDone && { borderColor: 'rgba(52,199,123,0.45)' },
        ]}
      >
        <View style={styles.head}>
          {p.inSuperset ? (
            <View style={styles.letter}>
              <Text style={styles.letterText}>{supersetLetter(p.positionInSuperset)}</Text>
            </View>
          ) : (
            <View style={[styles.letter, { backgroundColor: colors.surface3 }]}>
              <Text style={[styles.letterText, { color: colors.textDim }]}>{p.index + 1}</Text>
            </View>
          )}
          <Pressable style={{ flex: 1 }} onPress={() => p.onOpenProgress(ex.name)} hitSlop={4}>
            <Text style={styles.name} numberOfLines={2}>
              {ex.name}
              {ex._custom ? <Text style={styles.custom}>  perso</Text> : null}
            </Text>
            <Text style={styles.meta}>
              {doneCount}/{p.totalSets} séries · {repsLabel} reps
            </Text>
          </Pressable>
          <IconBtn name="close" size={20} color={colors.textFaint} onPress={() => p.onRemove(ex.id)} label="Retirer l'exercice" />
        </View>

        <View style={styles.toolsRow}>
          <Pressable onPress={() => p.onEditRest(p.restSourceId)} style={[styles.tool, p.restModified && styles.toolOn]} hitSlop={4}>
            <Ionicons name="timer-outline" size={14} color={p.restModified ? colors.goldLight : colors.textDim} />
            <Text style={[styles.toolText, p.restModified && { color: colors.goldLight }]}>{fmtRest(p.effectiveRest)}</Text>
          </Pressable>
          {p.inSuperset && (
            <Pressable onPress={() => p.onUnlink(ex.id)} style={styles.tool} hitSlop={4}>
              <Ionicons name="unlink-outline" size={14} color={colors.textDim} />
              <Text style={styles.toolText}>Délier</Text>
            </Pressable>
          )}
          {p.canLinkNext && !p.linkedToNext && (
            <Pressable onPress={() => p.onLink(ex.id)} style={styles.tool} hitSlop={4}>
              <Ionicons name="link-outline" size={14} color={colors.textDim} />
              <Text style={styles.toolText}>{p.inSuperset ? 'Inclure le suivant' : 'Superset'}</Text>
            </Pressable>
          )}
          {orm && <OrmBadge value={orm.oneRepMax} />}
        </View>

        {!!p.lastPerformance && (
          <View style={styles.last}>
            <Ionicons name="time-outline" size={13} color={colors.textDim} />
            <Text style={styles.lastText} numberOfLines={2}>
              Dernière fois : <Text style={{ color: colors.text }}>{p.lastPerformance}</Text>
            </Text>
          </View>
        )}

        <View style={styles.setsHead}>
          <Text style={[styles.colLabel, { width: 46 }]}>Série</Text>
          <Text style={[styles.colLabel, { flex: 1 }]}>kg</Text>
          <Text style={[styles.colLabel, { flex: 1 }]}>Reps</Text>
          <View style={{ width: 46 }} />
        </View>
        {Array.from({ length: p.totalSets }, (_, i) => (
          <SetRow
            key={i}
            exId={ex.id}
            setNumber={i + 1}
            data={p.sets[i]}
            validated={p.validated[i]}
            effectiveRest={p.effectiveRest}
            onChange={p.onSetChange}
            onValidate={p.onValidate}
          />
        ))}

        <View style={styles.setActions}>
          <Pressable style={styles.setBtn} onPress={() => { tap(); p.onAddSet(ex.id); }}>
            <Ionicons name="add" size={16} color={colors.goldLight} />
            <Text style={[styles.setBtnText, { color: colors.goldLight }]}>Série</Text>
          </Pressable>
          {p.totalSets > 1 && (
            <Pressable style={styles.setBtn} onPress={() => { tap(); p.onRemoveSet(ex.id); }}>
              <Ionicons name="remove" size={16} color={colors.textDim} />
              <Text style={styles.setBtnText}>Série</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
      {p.linkedToNext && (
        <View style={styles.connector}>
          <Ionicons name="repeat" size={13} color={colors.purple} />
          <Text style={styles.connectorText}>enchaîner</Text>
        </View>
      )}
    </View>
  );
}, cardPropsEqual);

/** Égalité "profonde légère" : les tableaux sets/validated sont comparés élément par élément. */
function cardPropsEqual(a: ExerciseCardProps, b: ExerciseCardProps) {
  for (const k of Object.keys(a) as (keyof ExerciseCardProps)[]) {
    if (k === 'sets' || k === 'validated') continue;
    if (a[k] !== b[k]) return false;
  }
  if (a.sets.length !== b.sets.length || a.validated.length !== b.validated.length) return false;
  for (let i = 0; i < a.sets.length; i++) if (a.sets[i] !== b.sets[i]) return false;
  for (let i = 0; i < a.validated.length; i++) if (a.validated[i] !== b.validated[i]) return false;
  return true;
}

const SetRow = memo(function SetRow({
  exId,
  setNumber,
  data,
  validated,
  effectiveRest,
  onChange,
  onValidate,
}: {
  exId: number;
  setNumber: number;
  data?: SetData;
  validated: boolean;
  effectiveRest: number;
  onChange: ExerciseCardProps['onSetChange'];
  onValidate: ExerciseCardProps['onValidate'];
}) {
  const repsRef = useRef<TextInputInstance>(null);
  return (
    <View style={[styles.setRow, validated && styles.setRowDone]}>
      <Text style={[styles.setNum, validated && { color: colors.success }]}>{setNumber}</Text>
      <SetField
        style={[styles.setInput, validated && styles.setInputDone]}
        value={data?.weight ?? ''}
        onChangeText={(v) => onChange(exId, setNumber, 'weight', v.replace(',', '.'))}
        keyboardType="decimal-pad"
        returnKeyType="next"
        onSubmitEditing={() => repsRef.current?.focus()}
        maxLength={6}
      />
      <SetField
        inputRef={repsRef}
        style={[styles.setInput, validated && styles.setInputDone]}
        value={data?.reps ?? ''}
        onChangeText={(v) => onChange(exId, setNumber, 'reps', v.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        maxLength={4}
      />
      <Pressable
        onPress={() => onValidate(exId, setNumber, effectiveRest)}
        hitSlop={6}
        style={[styles.check, validated && styles.checkDone]}
        accessibilityLabel={validated ? 'Annuler la validation' : 'Valider la série'}
      >
        <Ionicons name="checkmark" size={22} color={validated ? '#04150c' : colors.textFaint} />
      </Pressable>
    </View>
  );
});

/**
 * Champ poids / reps qui ne bloque pas le défilement.
 * Sur Android, un TextInput qui reçoit le doigt empêche la liste de scroller.
 * Tant qu'il n'a pas le focus, le champ est donc « transparent » au toucher :
 * c'est un Pressable qui reçoit le doigt (la liste peut le lui reprendre pour
 * scroller) et qui donne le focus au champ sur un simple tap.
 */
function SetField({ inputRef, style, ...props }: TextInputProps & { inputRef?: React.RefObject<TextInputInstance | null> }) {
  const own = useRef<TextInputInstance>(null);
  const ref = inputRef ?? own;
  const [focused, setFocused] = useState(false);
  return (
    <Pressable style={{ flex: 1 }} onPress={() => ref.current?.focus()} disabled={focused}>
      <View pointerEvents={focused ? 'auto' : 'none'}>
        <TextInput
          ref={ref}
          {...props}
          style={[style, focused && { borderColor: colors.gold }]}
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          selectTextOnFocus
          selectionColor={colors.gold}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ssHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginBottom: 6 },
  ssHeaderText: { color: colors.purple, fontWeight: '800', fontSize: 13 },
  ssHint: { color: colors.textFaint, fontSize: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardSs: { borderLeftWidth: 3, borderLeftColor: colors.purple },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  letter: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' },
  letterText: { color: colors.purple, fontWeight: '900', fontSize: 14 },
  name: { color: colors.text, fontSize: 17, fontWeight: '800' },
  custom: { color: colors.goldLight, fontSize: 11, fontWeight: '700' },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  toolsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolOn: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  toolText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  last: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 10, backgroundColor: colors.surface2, padding: 8, borderRadius: 8 },
  lastText: { color: colors.textDim, fontSize: 12, flex: 1 },
  setsHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4 },
  colLabel: { color: colors.textFaint, fontSize: 11, fontWeight: '700', textAlign: 'center', textTransform: 'uppercase' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderRadius: 10 },
  setRowDone: { backgroundColor: 'rgba(52,199,123,0.07)' },
  setNum: { width: 46, textAlign: 'center', color: colors.textDim, fontWeight: '800', fontSize: 15 },
  setInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 0,
  },
  setInputDone: { borderColor: 'rgba(52,199,123,0.35)' },
  check: {
    width: 46,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  checkDone: { backgroundColor: colors.success, borderColor: colors.success },
  setActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  setBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface2,
  },
  setBtnText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
  connector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 3 },
  connectorText: { color: colors.purple, fontSize: 11, fontWeight: '700' },
});
