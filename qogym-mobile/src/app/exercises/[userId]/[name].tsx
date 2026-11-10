import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { errMsg, exerciseApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDayMonth, shiftISO, todayISO } from '@/lib/format';
import { formatOneRepMax } from '@/lib/oneRepMax';
import { colors, radius } from '@/theme';
import { Card, Chip, Input, Loader, ScreenHeader, T } from '@/components/ui';
import { LineChart, OrmBadge } from '@/components/Visuals';

const PRESETS = [
  { key: '90', label: '90 j' },
  { key: '180', label: '6 mois' },
  { key: '365', label: '1 an' },
  { key: 'all', label: 'Tout' },
  { key: 'custom', label: 'Dates' },
];

export default function ExerciseProgress() {
  const { userId, name } = useLocalSearchParams<{ userId: string; name: string }>();
  const exName = (() => {
    try {
      return decodeURIComponent(name || '');
    } catch {
      return name || '';
    }
  })();
  const { user } = useAuth();
  const own = user && Number(userId) === Number(user.id);
  const [preset, setPreset] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    if (preset === 'all') return [null, null] as const;
    if (preset === 'custom') {
      const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
      return [ok(from) ? from : null, ok(to) ? to : null] as const;
    }
    return [shiftISO(todayISO(), -parseInt(preset, 10)), todayISO()] as const;
  }, [preset, from, to]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    exerciseApi
      .progress(userId, exName, range[0], range[1])
      .then((r) => alive && (setData(r), setError('')))
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId, exName, range]);

  const sessions: any[] = data?.sessions || [];
  const chart = useMemo(
    () =>
      sessions
        .filter((s) => s.best_one_rep_max != null)
        .map((s) => ({ label: fmtDayMonth(s.completed_at), value: Number(s.best_one_rep_max), sub: `${s.best_weight} kg × ${s.best_reps}` })),
    [sessions],
  );
  const best = data?.all_time_best;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={exName} subtitle={!own && data?.user ? `Progression de ${data.user.username}` : undefined} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card style={styles.hero}>
          {best ? (
            <>
              <Text style={styles.heroLbl}>🏆 Meilleur 1RM estimé</Text>
              <Text style={styles.heroVal}>{formatOneRepMax(Number(best.one_rep_max))} kg</Text>
              <T v="small" style={{ textAlign: 'center' }}>
                {best.weight} kg × {best.reps} reps, le {fmtDate(best.achieved_at)}
              </T>
            </>
          ) : (
            <T v="small">Pas encore de série avec poids enregistrée pour cet exercice.</T>
          )}
        </Card>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <Chip key={p.key} label={p.label} active={preset === p.key} onPress={() => setPreset(p.key)} />
          ))}
        </View>
        {preset === 'custom' && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Input containerStyle={{ flex: 1 }} label="Du (AAAA-MM-JJ)" value={from} onChangeText={setFrom} placeholder="2026-01-01" keyboardType="numbers-and-punctuation" />
            <Input containerStyle={{ flex: 1 }} label="Au" value={to} onChangeText={setTo} placeholder={todayISO()} keyboardType="numbers-and-punctuation" />
          </View>
        )}

        <Card style={{ gap: 10 }}>
          <T v="h3">Évolution du 1RM estimé</T>
          {loading ? (
            <Loader />
          ) : error ? (
            <Text style={{ color: colors.danger }}>{error}</Text>
          ) : chart.length === 0 ? (
            <T v="small">Aucune donnée sur cette période.</T>
          ) : chart.length === 1 ? (
            <T v="small">Une seule séance ({formatOneRepMax(chart[0].value)} kg) — élargis la période pour voir une courbe.</T>
          ) : (
            <LineChart data={chart} unit=" kg" color={colors.goldLight} />
          )}
        </Card>

        <Card style={{ gap: 10 }}>
          <T v="h3">Détail des séances</T>
          {!loading && sessions.length === 0 && <T v="small">Aucune séance sur cette période.</T>}
          {[...sessions].reverse().map((s) => (
            <View key={s.workout_id} style={styles.sess}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{s.session_name}</Text>
                  <T v="small">{fmtDate(s.completed_at)}</T>
                </View>
                {s.best_one_rep_max != null && <OrmBadge value={Number(s.best_one_rep_max)} />}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {(s.sets || []).map((st: any, i: number) => (
                  <Text key={i} style={styles.chip}>
                    {st.weight != null ? `${st.weight} kg × ` : ''}
                    {st.reps}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 4, borderColor: 'rgba(212,166,74,0.3)' },
  heroLbl: { color: colors.textDim, fontWeight: '700' },
  heroVal: { color: colors.goldLight, fontSize: 38, fontWeight: '900' },
  sess: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  chip: { color: colors.text, backgroundColor: colors.surface2, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, fontSize: 12, fontWeight: '700', overflow: 'hidden' },
});
