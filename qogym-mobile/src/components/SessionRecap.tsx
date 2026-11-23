import React, { useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library/legacy';
import { fmtDate, fmtDuration, isTrue, num, pluralize } from '@/lib/format';
import { colors, radius } from '@/theme';
import { Button } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Feedback';

/**
 * Récap d'une séance en image (format portrait 4:5, 1080 × 1350) à partager
 * ou à enregistrer dans la galerie. La carte est dessinée à CARD_W de large
 * puis capturée en 1080 px.
 */

const CARD_W = 340;
const CARD_H = Math.round((CARD_W * 5) / 4);
const MAX_EXOS = 5;

type ExoLine = { name: string; sets: number; best: string };

function summarize(w: any) {
  const exos: ExoLine[] = [];
  let sets = 0;
  let volume = 0;
  let reps = 0;
  for (const ex of w?.exercises || []) {
    const work = (ex.completed_sets || []).filter((s: any) => s.type !== 'warmup');
    if (!work.length) continue;
    let best: any = null;
    for (const s of work) {
      const kg = num(s.weight) || 0;
      const r = num(s.reps) || 0;
      sets++;
      reps += r;
      volume += kg * r;
      if (!best || kg > best.kg || (kg === best.kg && r > best.r)) best = { kg, r, pdc: isTrue(s.bodyweight) };
    }
    exos.push({
      name: ex.exercise_name || ex.name || 'Exercice',
      sets: work.length,
      best: best.kg > 0 ? `${best.kg} kg × ${best.r}` : `${best.r} reps`,
    });
  }
  const sec = Number(w?.duration_seconds) || Number(w?.duration_min) * 60 || 0;
  const vol = Number(w?.volume_kg) > 0 ? Number(w.volume_kg) : volume;
  return { exos, sets, reps, volume: Math.round(vol), duration: fmtDuration(sec) };
}

const fmtKg = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace('.', ',')} t` : `${n.toLocaleString('fr-FR')} kg`);

export function SessionRecapCard({ w }: { w: any }) {
  const r = useMemo(() => summarize(w), [w]);
  const shown = r.exos.slice(0, MAX_EXOS);
  const more = r.exos.length - shown.length;
  const stats = [
    r.duration && { icon: 'time' as const, value: r.duration, label: 'Durée' },
    r.volume > 0 && { icon: 'barbell' as const, value: fmtKg(r.volume), label: 'Soulevés' },
    { icon: 'layers' as const, value: String(r.sets), label: pluralize('Série', r.sets) },
    !r.duration && { icon: 'repeat' as const, value: String(r.reps), label: 'Reps' },
  ].filter(Boolean) as { icon: any; value: string; label: string }[];

  return (
    <View style={s.card}>
      <Svg style={StyleSheet.absoluteFill} width={CARD_W} height={CARD_H}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#1a2740" />
            <Stop offset="0.55" stopColor="#0b1322" />
            <Stop offset="1" stopColor="#1d1530" />
          </LinearGradient>
        </Defs>
        <Rect width={CARD_W} height={CARD_H} fill="url(#bg)" />
      </Svg>

      <View style={s.top}>
        <Image source={require('../../assets/icon.png')} style={s.logo} />
        <Text style={s.brand}>QoGym</Text>
        <Text style={s.date}>{fmtDate(w.completed_at)}</Text>
      </View>

      <Text style={s.title} numberOfLines={2}>
        {w.session_name || 'Entraînement'}
      </Text>
      <Text style={s.user} numberOfLines={1}>
        par <Text style={{ color: colors.goldLight, fontWeight: '800' }}>{w.user_username}</Text>
        {w.session_type_name ? ` · ${w.session_type_name}` : ''}
      </Text>

      <View style={s.stats}>
        {stats.slice(0, 3).map((st) => (
          <View key={st.label} style={s.stat}>
            <Ionicons name={st.icon} size={15} color={colors.goldLight} />
            <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {st.value}
            </Text>
            <Text style={s.statLabel}>{st.label}</Text>
          </View>
        ))}
      </View>

      <View style={s.list}>
        <View style={s.listHead}>
          <Text style={s.listTitle}>
            {r.exos.length} {pluralize('exercice', r.exos.length)}
          </Text>
          <Text style={s.listTitle}>Meilleure série</Text>
        </View>
        {shown.map((e, i) => (
          <View key={i} style={s.row}>
            <Text style={s.exName} numberOfLines={1}>
              {e.name}
            </Text>
            <Text style={s.exSets}>{e.sets} {pluralize('série', e.sets)}</Text>
            <Text style={s.exBest} numberOfLines={1}>
              {e.best}
            </Text>
          </View>
        ))}
        {more > 0 && <Text style={s.more}>+ {more} autre{more > 1 ? 's' : ''}</Text>}
        {r.exos.length === 0 && <Text style={s.more}>Aucun exercice enregistré</Text>}
      </View>

      <View style={s.footer}>
        <Text style={s.footerText}>Suivi avec QoGym · qojim.com</Text>
      </View>
    </View>
  );
}

/** Feuille avec l'aperçu du récap et les boutons Partager / Enregistrer. */
export function SessionRecapSheet({ w, visible, onClose }: { w: any; visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const ref = useRef<any>(null);
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  // L'aperçu est réduit si l'écran est étroit ; la capture reste en 1080 px.
  const scale = Math.min(1, (width - 40) / CARD_W);

  const capture = () => captureRef(ref, { format: 'png', quality: 1, width: 1080, height: 1350, result: 'tmpfile' });

  const share = async () => {
    setBusy('share');
    try {
      const uri = await capture();
      if (!(await Sharing.isAvailableAsync())) throw new Error("Le partage n'est pas disponible sur cet appareil");
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager mon récap' });
    } catch (e: any) {
      toast(e?.message || "Impossible de partager l'image", 'error');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!perm.granted) throw new Error("Autorise l'accès aux photos pour enregistrer l'image");
      await MediaLibrary.saveToLibraryAsync(await capture());
      toast('Image enregistrée dans ta galerie', 'success');
    } catch (e: any) {
      toast(e?.message || "Impossible d'enregistrer l'image", 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Récap de la séance"
      scroll={false}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Enregistrer" icon="download-outline" variant="secondary" onPress={save} loading={busy === 'save'} disabled={!!busy} style={{ flex: 1 }} />
          <Button title="Partager" icon="share-social" onPress={share} loading={busy === 'share'} disabled={!!busy} style={{ flex: 1 }} />
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 8 }}>
        <View style={{ width: CARD_W * scale, height: CARD_H * scale }}>
          <View style={{ transform: [{ scale }], transformOrigin: 'top left' }}>
            {/* collapsable={false} : la vue doit exister côté natif pour être capturée */}
            <View ref={ref} collapsable={false}>
              <SessionRecapCard w={w} />
            </View>
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  card: { width: CARD_W, height: CARD_H, padding: 22, overflow: 'hidden', backgroundColor: colors.bg, borderRadius: radius.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 28, height: 28, borderRadius: 8 },
  brand: { color: colors.text, fontWeight: '900', fontSize: 16, flex: 1 },
  date: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  title: { color: colors.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.4, marginTop: 16, lineHeight: 26 },
  user: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 14 },
  stat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '900' },
  statLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  list: { marginTop: 14, flex: 1, minHeight: 0, gap: 5, overflow: 'hidden' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  listTitle: { color: colors.gold, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exName: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  exSets: { color: colors.textFaint, fontSize: 12, fontWeight: '700' },
  exBest: { color: colors.goldLight, fontSize: 13, fontWeight: '800', minWidth: 70, textAlign: 'right' },
  more: { color: colors.textFaint, fontSize: 12, fontStyle: 'italic' },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 8, alignItems: 'center' },
  footerText: { color: colors.textFaint, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
});
