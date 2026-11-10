import React, { memo, useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';
import { formatOneRepMax } from '@/lib/oneRepMax';

// ── Anneau de progression ───────────────────────────────────────────────
export const Ring = memo(function Ring({
  size,
  stroke = 8,
  progress,
  color = colors.gold,
  track = colors.surface3,
  children,
}: {
  size: number;
  stroke?: number;
  progress: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress || 0));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - p)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
});

// ── Barre de progression ────────────────────────────────────────────────
export const Bar = ({ pct, color, height = 8 }: { pct: number; color: string; height?: number }) => (
  <View style={{ height, borderRadius: height, backgroundColor: colors.surface3, overflow: 'hidden' }}>
    <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height, borderRadius: height, backgroundColor: color }} />
  </View>
);

// ── Badge 1RM ───────────────────────────────────────────────────────────
export const OrmBadge = ({ value }: { value?: number | null }) => {
  const [open, setOpen] = useState(false);
  if (value == null) return null;
  return (
    <View>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={6} style={st.orm}>
        <Ionicons name="trophy" size={12} color={colors.goldLight} />
        <Text style={st.ormText}>{formatOneRepMax(value)} kg</Text>
      </Pressable>
      {open && <Text style={st.ormHint}>1RM estimé (formule d'Epley) à partir de la meilleure série.</Text>}
    </View>
  );
};

// ── Graphique en courbe ─────────────────────────────────────────────────
export function LineChart({
  data,
  height = 200,
  color = colors.gold,
  unit = '',
}: {
  data: { label: string; value: number; sub?: string }[];
  height?: number;
  color?: string;
  unit?: string;
}) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const pad = { l: 38, r: 10, t: 14, b: 24 };
  const geo = useMemo(() => {
    if (!w || data.length === 0) return null;
    const vals = data.map((d) => d.value);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) {
      min -= 5;
      max += 5;
    } else {
      const m = (max - min) * 0.12;
      min -= m;
      max += m;
    }
    const iw = w - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const x = (i: number) => pad.l + (data.length === 1 ? iw / 2 : (i * iw) / (data.length - 1));
    const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih;
    const pts = data.map((d, i) => [x(i), y(d.value)] as const);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${pad.t + ih} L${pts[0][0].toFixed(1)},${pad.t + ih} Z`;
    const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);
    return { pts, line, area, ticks, y, iw, ih, x };
  }, [w, data, height]);

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const step = data.length > 1 && geo ? geo.iw / (data.length - 1) : 1;
  const labelEvery = Math.max(1, Math.ceil(data.length / 5));

  return (
    <View onLayout={onLayout}>
      {geo && (
        <Pressable
          onPress={(e) => {
            const xx = e.nativeEvent.locationX - pad.l;
            const i = Math.round(xx / step);
            setSel(Math.max(0, Math.min(data.length - 1, i)));
          }}
        >
          <Svg width={w} height={height}>
            <Defs>
              <LinearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.35} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {geo.ticks.map((t, i) => (
              <G key={i}>
                <Line x1={pad.l} x2={w - pad.r} y1={geo.y(t)} y2={geo.y(t)} stroke={colors.border} strokeWidth={1} />
                <SvgText x={pad.l - 6} y={geo.y(t) + 4} fill={colors.textFaint} fontSize={10} textAnchor="end">
                  {Math.round(t)}
                </SvgText>
              </G>
            ))}
            <Path d={geo.area} fill="url(#lg)" />
            <Path d={geo.line} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {geo.pts.map((p, i) => (
              <Circle key={i} cx={p[0]} cy={p[1]} r={sel === i ? 6 : 3.5} fill={sel === i ? colors.text : color} />
            ))}
            {data.map((d, i) =>
              i % labelEvery === 0 || i === data.length - 1 ? (
                <SvgText key={`l${i}`} x={geo.x(i)} y={height - 6} fill={colors.textFaint} fontSize={10} textAnchor="middle">
                  {d.label}
                </SvgText>
              ) : null,
            )}
          </Svg>
        </Pressable>
      )}
      {sel != null && data[sel] && (
        <Text style={st.chartSel}>
          {data[sel].label} · <Text style={{ color: colors.text, fontWeight: '800' }}>{formatOneRepMax(data[sel].value)}{unit}</Text>
          {data[sel].sub ? `  (${data[sel].sub})` : ''}
        </Text>
      )}
    </View>
  );
}

// ── Graphique en barres verticales ──────────────────────────────────────
export function BarChart({ data, height = 170, color = colors.gold }: { data: { label: string; value: number }[]; height?: number; color?: string }) {
  const [w, setW] = useState(0);
  const max = Math.max(1, ...data.map((d) => d.value));
  const pb = 22;
  const bw = w && data.length ? (w / data.length) * 0.6 : 0;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {data.map((d, i) => {
            const slot = w / data.length;
            const h = ((height - pb - 14) * d.value) / max;
            const x = slot * i + (slot - bw) / 2;
            return (
              <G key={i}>
                <Rect x={x} y={height - pb - h} width={bw} height={Math.max(h, d.value ? 2 : 0)} rx={4} fill={color} opacity={d.value ? 1 : 0.25} />
                {d.value > 0 && (
                  <SvgText x={x + bw / 2} y={height - pb - h - 4} fill={colors.textDim} fontSize={10} textAnchor="middle">
                    {d.value}
                  </SvgText>
                )}
                <SvgText x={x + bw / 2} y={height - 6} fill={colors.textFaint} fontSize={10} textAnchor="middle">
                  {d.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      )}
    </View>
  );
}

// ── Barres horizontales (top exercices) ─────────────────────────────────
export const HBars = ({ data, color = colors.gold }: { data: { label: string; value: number }[]; color?: string }) => {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: 10 }}>
      {data.map((d, i) => (
        <View key={i} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>
              {d.label}
            </Text>
            <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '700' }}>{d.value}</Text>
          </View>
          <Bar pct={(d.value / max) * 100} color={color} height={7} />
        </View>
      ))}
    </View>
  );
};

const st = StyleSheet.create({
  orm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.goldSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  ormText: { color: colors.goldLight, fontSize: 12, fontWeight: '800' },
  ormHint: { color: colors.textDim, fontSize: 11, marginTop: 4, maxWidth: 220 },
  chartSel: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
