import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { errMsg, weightApi } from '@/lib/api';
import { useCached } from '@/lib/storage';
import { fmtDayLabel, shiftISO, todayISO } from '@/lib/format';
import { colors, radius } from '@/theme';
import { Button, Card, Chip, IconBtn, SectionTitle, T, tap } from '@/components/ui';
import { useConfirm, useToast } from '@/components/Feedback';

/**
 * Carte « Poids » du profil — même fonctionnement que WeightSection du site :
 *  - pesée du jour ou d'un jour passé (flèches ‹ ›) ; si une pesée existe déjà
 *    ce jour-là, le champ est pré-rempli et l'enregistrement la corrige ;
 *  - objectif facultatif (ligne pointillée sur la courbe) ;
 *  - courbe Jour (pesées + tendance 7 j) / Semaine / Mois, sur 1 m → tout ;
 *  - indicateurs et historique (tap = corriger, appui long = supprimer).
 * Toutes les pesées sont chargées d'un coup (1 ligne par jour) : les agrégats
 * sont calculés ici.
 */

type Entry = { day: string; weight: number };

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const parseISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const mondayOf = (iso: string) => shiftISO(iso, -((parseISO(iso).getDay() + 6) % 7));
const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
const fmtDayShort = (iso: string) => {
  const d = parseISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};
const fmtMonth = (iso: string) => {
  const d = parseISO(iso);
  return `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};
const fmtKg = (v?: number | null) =>
  v == null || Number.isNaN(v) ? '—' : `${v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
const fmtDelta = (v?: number | null) => {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Math.round(v * 10) / 10;
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  return `${sign}${Math.abs(r).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
};
const toInput = (v: number) => String(v).replace('.', ',');
const parseKg = (s: string) => Number(s.trim().replace(',', '.'));
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round2 = (v: number) => Math.round(v * 100) / 100;

const VIEWS = [
  { key: 'day', label: 'Jour' },
  { key: 'week', label: 'Semaine' },
  { key: 'month', label: 'Mois' },
] as const;
type View_ = (typeof VIEWS)[number]['key'];
const RANGES: { key: number | null; label: string }[] = [
  { key: 30, label: '1 m' },
  { key: 90, label: '3 m' },
  { key: 180, label: '6 m' },
  { key: 365, label: '1 an' },
  { key: null, label: 'Tout' },
];
const HISTORY_PAGE = 10;

/** Vert si la variation va vers l'objectif ; neutre sans objectif. */
const deltaColor = (delta: number | null, goal: number | null, current: number | null) => {
  if (delta == null || goal == null || current == null || Math.abs(delta) < 0.05) return colors.text;
  const good = goal < current ? delta < 0 : delta > 0;
  return good ? colors.success : colors.danger;
};

export function WeightCard({ active }: { active: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, setData, loading, refreshIfStale } = useCached('weight', async () => {
    const r = await weightApi.list();
    return {
      entries: ((r.entries || []) as any[]).map((e) => ({ day: String(e.day), weight: Number(e.weight) })) as Entry[],
      goal: r.goal != null ? Number(r.goal) : null,
      migrationNeeded: !!r.migration_needed,
    };
  });
  const entries = data?.entries ?? [];
  const goal = data?.goal ?? null;

  const today = todayISO();
  const [day, setDay] = useState(today);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const [view, setView] = useState<View_>('day');
  const [rangeDays, setRangeDays] = useState<number | null>(90);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCount, setHistoryCount] = useState(HISTORY_PAGE);

  useEffect(() => {
    if (active) refreshIfStale();
  }, [active, refreshIfStale]);

  const byDay = useMemo(() => {
    const m: Record<string, number> = {};
    entries.forEach((e) => (m[e.day] = e.weight));
    return m;
  }, [entries]);
  const existing = byDay[day];

  // Changement de jour (ou chargement) : pré-remplit si une pesée existe.
  useEffect(() => {
    setValue(existing != null ? toInput(existing) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, loading]);

  const setEntries = (fn: (prev: Entry[]) => Entry[]) =>
    setData((d) => (d ? { ...d, entries: fn(d.entries) } : d));

  const save = async () => {
    const w = parseKg(value);
    if (!value || Number.isNaN(w) || w < 20 || w > 400) return toast('Poids invalide (entre 20 et 400 kg)', 'error');
    if (day > today) return toast("Choisis une date passée ou aujourd'hui", 'error');
    setSaving(true);
    try {
      const r = await weightApi.save(day, round2(w));
      const saved = Number(r.weight ?? w);
      setEntries((prev) => [...prev.filter((x) => x.day !== day), { day, weight: saved }].sort((a, b) => (a.day < b.day ? -1 : 1)));
      toast(existing != null ? 'Pesée corrigée' : 'Pesée enregistrée', 'success');
    } catch (e) {
      toast(errMsg(e, "Erreur lors de l'enregistrement"), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: string) => {
    if (!(await confirm({ title: 'Supprimer cette pesée ?', message: `${fmtDayLabel(d)} — ${fmtKg(byDay[d])}`, confirmLabel: 'Supprimer', variant: 'danger' })))
      return;
    try {
      await weightApi.remove(d);
      setEntries((prev) => prev.filter((x) => x.day !== d));
      if (d === day) setValue('');
      toast('Pesée supprimée', 'success');
    } catch (e) {
      toast(errMsg(e, 'Erreur lors de la suppression'), 'error');
    }
  };

  const saveGoal = async () => {
    const t = goalDraft.trim();
    let g: number | null = null;
    if (t) {
      g = parseKg(t);
      if (Number.isNaN(g) || g < 20 || g > 400) return toast('Objectif invalide', 'error');
    }
    try {
      const r = await weightApi.setGoal(g);
      setData((d) => (d ? { ...d, goal: r.goal != null ? Number(r.goal) : null } : d));
      setGoalOpen(false);
      toast(r.goal == null ? 'Objectif retiré' : 'Objectif enregistré', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  // ── Indicateurs ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (entries.length === 0) return null;
    const last = entries[entries.length - 1];
    const first = entries[0];
    const inWindow = (from: string, to: string) => entries.filter((e) => e.day >= from && e.day <= to).map((e) => e.weight);
    const cur7 = avg(inWindow(shiftISO(today, -6), today));
    const prev7 = avg(inWindow(shiftISO(today, -13), shiftISO(today, -7)));
    const target30 = shiftISO(last.day, -30);
    const ref30 = [...entries].reverse().find((e) => e.day <= target30);
    return {
      current: last.weight,
      currentDay: last.day,
      avg7: cur7,
      weekDelta: cur7 != null && prev7 != null ? cur7 - prev7 : null,
      delta30: ref30 ? last.weight - ref30.weight : null,
      sinceStart: entries.length > 1 ? last.weight - first.weight : null,
      startDay: first.day,
      toGoal: goal != null ? goal - last.weight : null,
    };
  }, [entries, goal, today]);

  // ── Données de la courbe ───────────────────────────────────────────────
  const chart = useMemo(() => {
    if (entries.length === 0) return [];
    const fromDay = rangeDays ? shiftISO(today, -(rangeDays - 1)) : entries[0].day;
    if (view === 'day') {
      return entries
        .map((e) => {
          const win = entries.filter((x) => x.day <= e.day && x.day > shiftISO(e.day, -7)).map((x) => x.weight);
          return { day: e.day, point: e.weight, line: round2(avg(win) ?? e.weight), count: 1 };
        })
        .filter((p) => p.day >= fromDay);
    }
    const keyFn = view === 'week' ? mondayOf : monthOf;
    const groups: Record<string, number[]> = {};
    entries.forEach((e) => (groups[keyFn(e.day)] = groups[keyFn(e.day)] || []).push(e.weight));
    const fromKey = keyFn(fromDay);
    return Object.keys(groups)
      .sort()
      .filter((k) => k >= fromKey)
      .map((k) => ({ day: k, point: null as number | null, line: round2(avg(groups[k])!), count: groups[k].length }));
  }, [entries, view, rangeDays, today]);

  const periodRows = useMemo(
    () =>
      view === 'day'
        ? []
        : chart
            .map((p, i) => ({ ...p, delta: i > 0 ? p.line - chart[i - 1].line : null }))
            .reverse()
            .slice(0, 8),
    [chart, view],
  );

  if (data?.migrationNeeded) {
    return (
      <Card style={{ gap: 6 }}>
        <SectionTitle>Poids</SectionTitle>
        <T v="small">Le suivi du poids arrive bientôt.</T>
      </Card>
    );
  }

  const historyDesc = [...entries].reverse();
  const canNext = day < today;

  return (
    <Card style={{ gap: 12 }}>
      <SectionTitle
        right={
          byDay[today] != null ? (
            <Text style={[styles.badge, { color: colors.success, backgroundColor: colors.successSoft }]}>Pesée du jour ✓</Text>
          ) : !loading ? (
            <Text style={styles.badge}>Pas encore pesé aujourd'hui</Text>
          ) : null
        }
      >
        Poids
      </SectionTitle>

      {/* Saisie / correction */}
      <View style={styles.dayNav}>
        <IconBtn name="chevron-back" size={20} onPress={() => setDay((d) => shiftISO(d, -1))} label="Jour précédent" />
        <Text style={styles.dayLabel}>{fmtDayLabel(day)}</Text>
        <IconBtn
          name="chevron-forward"
          size={20}
          color={canNext ? colors.text : colors.textFaint}
          onPress={() => canNext && setDay((d) => shiftISO(d, 1))}
          label="Jour suivant"
        />
      </View>
      <View style={styles.formRow}>
        <View style={styles.inputWrap}>
          <TextInput
            value={value}
            onChangeText={(v) => setValue(v.replace(/[^0-9.,]/g, ''))}
            placeholder="Ex. 78,4"
            placeholderTextColor={colors.textFaint}
            keyboardType="decimal-pad"
            style={styles.input}
            selectionColor={colors.gold}
            maxLength={6}
            onSubmitEditing={save}
          />
          <Text style={styles.unit}>kg</Text>
        </View>
        <Button title={existing != null ? 'Corriger' : 'Enregistrer'} small onPress={save} loading={saving} disabled={!value} />
      </View>
      <T v="tiny">
        {existing != null ? `Déjà saisi : ${fmtKg(existing)}. Modifie la valeur pour la corriger.` : 'Aucune pesée pour ce jour.'}
        {day !== today && (
          <Text style={styles.link} onPress={() => setDay(today)}>
            {'  '}Revenir à aujourd'hui
          </Text>
        )}
      </T>

      {!loading && entries.length === 0 ? (
        <T v="small">Aucune pesée pour le moment. Idéalement chaque matin, à jeun, pour une courbe fiable.</T>
      ) : stats ? (
        <>
          {/* Indicateurs */}
          <View style={styles.stats}>
            <Stat value={fmtKg(stats.current)} label={`Actuel${stats.currentDay !== today ? ` (${fmtDayShort(stats.currentDay)})` : ''}`} />
            <Stat value={fmtKg(stats.avg7)} label="Moyenne 7 j" />
            <Stat value={fmtDelta(stats.weekDelta)} label="vs semaine préc." color={deltaColor(stats.weekDelta, goal, stats.current)} />
            <Stat value={fmtDelta(stats.delta30)} label="Sur 30 jours" color={deltaColor(stats.delta30, goal, stats.current)} />
            <Stat value={fmtDelta(stats.sinceStart)} label={`Depuis le ${fmtDayShort(stats.startDay)}`} color={deltaColor(stats.sinceStart, goal, stats.current)} />
            <Stat value={goal != null ? fmtDelta(stats.toGoal) : '—'} label={goal != null ? `Reste (objectif ${fmtKg(goal)})` : "Pas d'objectif"} />
          </View>

          {/* Objectif */}
          {goalOpen ? (
            <View style={styles.formRow}>
              <View style={styles.inputWrap}>
                <TextInput
                  value={goalDraft}
                  onChangeText={(v) => setGoalDraft(v.replace(/[^0-9.,]/g, ''))}
                  placeholder="Objectif (vide = aucun)"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  selectionColor={colors.gold}
                  autoFocus
                  maxLength={6}
                />
                <Text style={styles.unit}>kg</Text>
              </View>
              <Button title="OK" small onPress={saveGoal} />
              <IconBtn name="close" size={20} color={colors.textDim} onPress={() => setGoalOpen(false)} label="Annuler" />
            </View>
          ) : (
            <Text
              style={styles.link}
              onPress={() => {
                setGoalDraft(goal != null ? toInput(goal) : '');
                setGoalOpen(true);
              }}
            >
              {goal != null ? 'Modifier mon objectif de poids' : 'Définir un objectif de poids'}
            </Text>
          )}

          {/* Courbe */}
          <View style={styles.chips}>
            {VIEWS.map((v) => (
              <Chip key={v.key} label={v.label} active={view === v.key} onPress={() => setView(v.key)} />
            ))}
          </View>
          <View style={styles.chips}>
            {RANGES.map((r) => (
              <Chip key={r.label} label={r.label} active={rangeDays === r.key} onPress={() => setRangeDays(r.key)} />
            ))}
          </View>
          {chart.length === 0 ? (
            <T v="small">Aucune pesée sur cette période.</T>
          ) : (
            <WeightChart data={chart} goal={goal} view={view} />
          )}

          {/* Moyennes par semaine / mois */}
          {periodRows.length > 0 && (
            <View>
              <Text style={styles.subtitle}>{view === 'week' ? 'Moyennes hebdomadaires' : 'Moyennes mensuelles'}</Text>
              {periodRows.map((p) => (
                <View key={p.day} style={styles.row}>
                  <Text style={styles.rowLabel}>
                    {view === 'week' ? `Sem. du ${fmtDayShort(p.day)}` : fmtMonth(p.day)}
                  </Text>
                  <Text style={styles.rowCount}>
                    {p.count} pesée{p.count > 1 ? 's' : ''}
                  </Text>
                  <Text style={styles.rowVal}>{fmtKg(p.line)}</Text>
                  <Text style={[styles.rowDelta, { color: deltaColor(p.delta, goal, p.line) }]}>{p.delta != null ? fmtDelta(p.delta) : ''}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Historique */}
          <Pressable
            style={styles.historyToggle}
            onPress={() => {
              tap();
              setHistoryOpen((o) => !o);
            }}
          >
            <Text style={styles.subtitle}>Historique des pesées ({historyDesc.length})</Text>
            <Ionicons name={historyOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textDim} />
          </Pressable>
          {historyOpen && (
            <View>
              {historyDesc.slice(0, historyCount).map((e, i) => {
                const prev = historyDesc[i + 1];
                const d = prev ? e.weight - prev.weight : null;
                return (
                  <Pressable
                    key={e.day}
                    style={[styles.row, e.day === day && { backgroundColor: colors.goldSoft }]}
                    onPress={() => setDay(e.day)}
                    onLongPress={() => remove(e.day)}
                  >
                    <Text style={styles.rowLabel}>{fmtDayLabel(e.day)}</Text>
                    <Text style={styles.rowVal}>{fmtKg(e.weight)}</Text>
                    <Text style={[styles.rowDelta, { color: colors.textDim }]}>{d != null ? fmtDelta(d) : ''}</Text>
                    <IconBtn name="trash-outline" size={17} color={colors.textFaint} onPress={() => remove(e.day)} label="Supprimer la pesée" />
                  </Pressable>
                );
              })}
              {historyDesc.length > historyCount && (
                <Button title={`Voir plus (${historyDesc.length - historyCount} restantes)`} small variant="ghost" onPress={() => setHistoryCount((c) => c + 30)} />
              )}
              <T v="tiny" style={{ textAlign: 'center', marginTop: 4 }}>
                Touche une pesée pour la corriger
              </T>
            </View>
          )}
        </>
      ) : null}
    </Card>
  );
}

const Stat = ({ value, label, color = colors.text }: { value: string; label: string; color?: string }) => (
  <View style={styles.stat}>
    <Text style={[styles.statVal, { color }]}>{value}</Text>
    <Text style={styles.statLbl} numberOfLines={2}>
      {label}
    </Text>
  </View>
);

/**
 * Courbe du poids : axe X en temps réel (les jours sans pesée laissent un
 * trou proportionnel), points = pesées (vue Jour), ligne = tendance 7 j ou
 * moyenne de la période, pointillés = objectif. Tap = valeur du point.
 */
function WeightChart({
  data,
  goal,
  view,
}: {
  data: { day: string; point: number | null; line: number; count: number }[];
  goal: number | null;
  view: View_;
}) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const height = 200;
  const pad = { l: 34, r: 10, t: 12, b: 22 };

  useEffect(() => setSel(null), [data]);

  const geo = useMemo(() => {
    if (!w || data.length === 0) return null;
    const vals: number[] = [];
    data.forEach((p) => {
      vals.push(p.line);
      if (p.point != null) vals.push(p.point);
    });
    if (goal != null) vals.push(goal);
    const lo = Math.floor(Math.min(...vals) - 1);
    const hi = Math.ceil(Math.max(...vals) + 1);
    const ts = data.map((p) => parseISO(p.day).getTime());
    const t0 = ts[0];
    const t1 = ts[ts.length - 1];
    const iw = w - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const x = (t: number) => pad.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
    const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
    const xs = ts.map(x);
    const line = data.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p.line).toFixed(1)}`).join(' ');
    const ticks = [lo, (lo + hi) / 2, hi];
    // ~4 libellés répartis sur l'axe
    const labelIdx = new Set<number>([0, data.length - 1]);
    const n = Math.min(4, data.length);
    for (let k = 1; k < n - 1; k++) labelIdx.add(Math.round((k * (data.length - 1)) / (n - 1)));
    return { xs, y, line, ticks, labelIdx };
  }, [w, data, goal]);

  const label = (iso: string) => (view === 'month' ? fmtMonth(iso) : fmtDayShort(iso));
  const p = sel != null ? data[sel] : null;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {geo && (
        <Pressable
          onPress={(e) => {
            const lx = e.nativeEvent.locationX;
            let best = 0;
            geo.xs.forEach((xx, i) => Math.abs(xx - lx) < Math.abs(geo.xs[best] - lx) && (best = i));
            setSel(best);
          }}
        >
          <Svg width={w} height={height}>
            {geo.ticks.map((t, i) => (
              <G key={i}>
                <Line x1={pad.l} x2={w - pad.r} y1={geo.y(t)} y2={geo.y(t)} stroke={colors.border} strokeWidth={1} />
                <SvgText x={pad.l - 6} y={geo.y(t) + 4} fill={colors.textFaint} fontSize={10} textAnchor="end">
                  {Math.round(t)}
                </SvgText>
              </G>
            ))}
            {goal != null && (
              <Line x1={pad.l} x2={w - pad.r} y1={geo.y(goal)} y2={geo.y(goal)} stroke={colors.success} strokeWidth={1.2} strokeDasharray="5 4" />
            )}
            {data.map((d, i) =>
              d.point != null ? <Circle key={`p${i}`} cx={geo.xs[i]} cy={geo.y(d.point)} r={2.6} fill={colors.textDim} opacity={0.7} /> : null,
            )}
            <Path d={geo.line} stroke={colors.gold} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {view !== 'day' && data.map((d, i) => <Circle key={`a${i}`} cx={geo.xs[i]} cy={geo.y(d.line)} r={3} fill={colors.gold} />)}
            {sel != null && <Circle cx={geo.xs[sel]} cy={geo.y(data[sel].point ?? data[sel].line)} r={5.5} fill={colors.text} />}
            {data.map((d, i) =>
              geo.labelIdx.has(i) ? (
                <SvgText
                  key={`l${i}`}
                  x={geo.xs[i]}
                  y={height - 6}
                  fill={colors.textFaint}
                  fontSize={10}
                  textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
                >
                  {label(d.day)}
                </SvgText>
              ) : null,
            )}
          </Svg>
        </Pressable>
      )}
      <Text style={styles.chartSel}>
        {p
          ? view === 'day'
            ? `${fmtDayLabel(p.day)} · pesée ${fmtKg(p.point)} · tendance ${fmtKg(p.line)}`
            : `${view === 'week' ? `Semaine du ${fmtDayShort(p.day)}` : fmtMonth(p.day)} · moyenne ${fmtKg(p.line)} (${p.count} pesée${p.count > 1 ? 's' : ''})`
          : view === 'day'
            ? '• pesées   — tendance (moyenne mobile 7 j)'
            : '— moyenne de la période'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    color: colors.textDim,
    backgroundColor: colors.surface2,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  dayNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayLabel: { color: colors.text, fontWeight: '800', fontSize: 15 },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  input: { flex: 1, height: 44, color: colors.text, fontSize: 17, fontWeight: '700', paddingVertical: 0 },
  unit: { color: colors.textDim, fontWeight: '700' },
  link: { color: colors.goldLight, fontWeight: '700', fontSize: 13 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '31%', flexGrow: 1, backgroundColor: colors.surface2, borderRadius: radius.md, padding: 10, gap: 2 },
  statVal: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLbl: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  subtitle: { color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8 },
  rowLabel: { color: colors.text, flex: 1, fontSize: 13 },
  rowCount: { color: colors.textFaint, fontSize: 12 },
  rowVal: { color: colors.text, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] },
  rowDelta: { width: 64, textAlign: 'right', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  historyToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  chartSel: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
