import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { errMsg, reportApi } from '@/lib/api';
import { MONTH_NAMES } from '@/lib/format';
import { colors, radius } from '@/theme';
import { Card, Empty, Loader, ScreenHeader, T } from '@/components/ui';
import { BarChart, HBars, LineChart } from '@/components/Visuals';

const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h === 0 ? `${m} min` : `${h}h${String(m).padStart(2, '0')}`;
};
const fmtVol = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`);

function Delta({ cur, prev }: { cur: number; prev?: number | null }) {
  if (prev == null) return <Text style={styles.deltaN}>—</Text>;
  const d = prev === 0 ? (cur > 0 ? 100 : null) : Math.round(((cur - prev) / prev) * 100);
  if (d === null) return <Text style={styles.deltaN}>—</Text>;
  if (d === 0) return <Text style={styles.deltaN}>±0 %</Text>;
  return <Text style={{ color: d > 0 ? colors.success : colors.danger, fontWeight: '800', fontSize: 12 }}>{d > 0 ? '▲' : '▼'} {Math.abs(d)} %</Text>;
}

export default function MonthlyReport() {
  const { year, month } = useLocalSearchParams<{ year: string; month: string }>();
  const [r, setR] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    reportApi
      .detail(year, month)
      .then(setR)
      .catch((e) => setError(errMsg(e)));
  }, [year, month]);

  const title = `${MONTH_NAMES[Number(month)]} ${year}`;
  const cal = useMemo(() => {
    const y = Number(year), m = Number(month);
    const set = new Set<string>(r?.current?.training_days || []);
    const start = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const days = new Date(y, m, 0).getDate();
    const cells: { d?: number; on?: boolean }[] = Array.from({ length: start }, () => ({}));
    for (let d = 1; d <= days; d++) cells.push({ d, on: set.has(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`) });
    return cells;
  }, [r, year, month]);

  if (!r) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title={`Rapport · ${title}`} />
        {error ? <Text style={{ color: colors.danger, padding: 20 }}>{error}</Text> : <Loader />}
      </View>
    );
  }
  if (!r.has_data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title={`Rapport · ${title}`} />
        <Empty icon="calendar-outline" text="Aucun entraînement sur cette période." />
      </View>
    );
  }

  const c = r.current, k = c.kpis, p = r.previous?.kpis;
  const kpis = [
    ['Entraînements', k.workouts_count, k.workouts_count, p?.workouts_count],
    ['Séries', k.sets_count, k.sets_count, p?.sets_count],
    ['Répétitions', k.total_reps, k.total_reps, p?.total_reps],
    ['Volume', fmtVol(k.total_volume_kg), k.total_volume_kg, p ? p.total_volume_kg : null],
    ['Temps total', fmtDur(k.total_seconds), k.total_seconds, p?.total_seconds],
    ['Plus longue série', `${k.longest_streak} j`, k.longest_streak, p?.longest_streak],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={`Rapport · ${title}`} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={styles.kpis}>
          {kpis.map(([label, shown, cur, prev]) => (
            <View key={String(label)} style={styles.kpi}>
              <Text style={styles.kpiVal}>{String(shown)}</Text>
              <Text style={styles.kpiLbl}>{label}</Text>
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                <Delta cur={Number(cur) || 0} prev={prev as number | null} />
                <Text style={{ color: colors.textFaint, fontSize: 10 }}>vs M-1</Text>
              </View>
            </View>
          ))}
        </View>

        <Card style={{ gap: 10 }}>
          <T v="h3">Calendrier</T>
          <View style={styles.cal}>
            {DOW.map((d) => (
              <Text key={d} style={styles.dow}>
                {d}
              </Text>
            ))}
            {cal.map((x, i) => (
              <View key={i} style={[styles.day, x.on && styles.dayOn, !x.d && { backgroundColor: 'transparent' }]}>
                {!!x.d && <Text style={[styles.dayText, x.on && { color: '#1a1406', fontWeight: '900' }]}>{x.d}</Text>}
              </View>
            ))}
          </View>
        </Card>

        {(c.top_exercises || []).length > 0 && (
          <Card style={{ gap: 12 }}>
            <T v="h3">Exercices favoris (séries)</T>
            <HBars data={c.top_exercises.map((e: any) => ({ label: e.name, value: Number(e.sets) }))} />
          </Card>
        )}

        {(c.by_week || []).length > 1 && (
          <Card style={{ gap: 10 }}>
            <T v="h3">Volume soulevé par semaine</T>
            <LineChart data={c.by_week.map((w: any, i: number) => ({ label: `S${i + 1}`, value: Math.round(Number(w.volume_kg)) }))} unit=" kg" />
          </Card>
        )}

        <Card style={{ gap: 10 }}>
          <T v="h3">Quels jours t'entraînes-tu ?</T>
          <BarChart data={(c.by_day_of_week || []).map((v: number, i: number) => ({ label: DOW[i], value: Number(v) }))} />
        </Card>

        {(c.personal_records || []).length > 0 && (
          <Card style={{ gap: 8 }}>
            <T v="h3">Records personnels battus 🏆</T>
            {c.personal_records.map((pr: any) => (
              <View key={pr.name} style={styles.pr}>
                <Text style={{ color: colors.text, flex: 1, fontWeight: '600' }}>{pr.name}</Text>
                <Text style={{ color: colors.goldLight, fontWeight: '900' }}>{pr.max_weight} kg</Text>
                {pr.previous_max !== null && <Text style={{ color: colors.textFaint, fontSize: 12 }}> (avant {pr.previous_max})</Text>}
              </View>
            ))}
          </Card>
        )}

        {(c.by_session_type || []).length > 0 && (
          <Card style={{ gap: 8 }}>
            <T v="h3">Types de séances</T>
            {c.by_session_type.map((t: any) => (
              <View key={t.name} style={styles.pr}>
                <Text style={{ color: colors.text, flex: 1 }}>{t.name}</Text>
                <Text style={{ color: colors.textDim, fontWeight: '700' }}>
                  {t.workouts} séance{t.workouts > 1 ? 's' : ''}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { width: '48%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, gap: 2, borderWidth: 1, borderColor: colors.border },
  kpiVal: { color: colors.goldLight, fontSize: 22, fontWeight: '900' },
  kpiLbl: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  deltaN: { color: colors.textFaint, fontSize: 12, fontWeight: '700' },
  cal: { flexDirection: 'row', flexWrap: 'wrap' },
  dow: { width: `${100 / 7}%`, textAlign: 'center', color: colors.textFaint, fontSize: 11, fontWeight: '700', marginBottom: 6 },
  day: { width: `${100 / 7 - 1.4}%`, aspectRatio: 1, margin: '0.7%', borderRadius: 8, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.gold },
  dayText: { color: colors.textDim, fontSize: 12 },
  pr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
});
