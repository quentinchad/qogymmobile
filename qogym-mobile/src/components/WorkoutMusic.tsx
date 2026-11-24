import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { errMsg, musicApi, type MusicTrack, type WorkoutMusicInfo } from '@/lib/api';
import { store } from '@/lib/storage';
import { colors, radius } from '@/theme';
import { Input, T } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Feedback';

/**
 * Musique d'un entraînement, façon "notes Instagram".
 *
 * L'auteur peut associer (facultatif) un titre Deezer à son entraînement.
 * Sur l'écran de détail, l'extrait officiel de 30 s joue en boucle tant que
 * l'écran est affiché et l'appli au premier plan. Son coupé = lecture en
 * pause (on rend la main à la musique de l'utilisateur) ; ce choix est
 * retenu sur l'appareil.
 *
 * L'audio est lu directement depuis le CDN Deezer : rien n'est téléchargé ni
 * stocké chez QoGym. Le lien de l'extrait expire (~15 min) : il est redemandé
 * à chaque ouverture.
 */

const MUTE_KEY = 'qg_music_muted';

let audioModeSet = false;
const ensureAudioMode = () => {
  if (audioModeSet) return;
  audioModeSet = true;
  // 'doNotMix' : la musique de l'utilisateur se met en pause le temps de
  // l'extrait (comme Instagram) et peut reprendre ensuite.
  setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' }).catch(() => {
    audioModeSet = false;
  });
};

// Le lecteur est un objet natif impératif : on règle la boucle hors du composant.
const setLoop = (p: AudioPlayer) => {
  p.loop = true;
};

export const isMusicSupported = (w: any) => !!w && /^\d+$/.test(String(w.id));

export function WorkoutMusic({
  w,
  isOwn,
  onChange,
}: {
  w: any;
  isOwn: boolean;
  onChange: (music: WorkoutMusicInfo | null) => void;
}) {
  const toast = useToast();
  const supported = isMusicSupported(w);
  const music: WorkoutMusicInfo | null = supported ? w.music || null : null;
  const trackId = music?.track_id ?? null;

  const [muted, setMuted] = useState<boolean | null>(null); // null = pas encore lu
  const [preview, setPreview] = useState<{ trackId: string; url: string | null } | null>(null);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerKey, setPickerKey] = useState(0); // nouvelle recherche vide à chaque ouverture
  const openPicker = () => {
    setPickerKey((k) => k + 1);
    setPicking(true);
  };

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    store.get<boolean>(MUTE_KEY, false).then(setMuted);
  }, []);

  // Écran quitté (profil, exercice…) → pause ; retour → reprise
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Lien frais de l'extrait à chaque changement de titre. Le résultat est
  // rangé avec l'id du titre : un ancien résultat est ignoré sans reset.
  useEffect(() => {
    if (!trackId) return;
    let cancelled = false;
    musicApi
      .preview(trackId)
      .then((r) => {
        if (!cancelled) setPreview({ trackId, url: r.preview_url || null });
      })
      .catch(() => {
        if (!cancelled) setPreview({ trackId, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);
  const current = trackId && preview?.trackId === trackId ? preview : null;
  const url = current?.url ?? null;
  const failed = !!current && !current.url;

  useEffect(() => {
    if (!url) {
      player.pause();
      return;
    }
    player.replace({ uri: url });
    setLoop(player);
  }, [url, player]);

  const shouldPlay = !!url && focused && appActive && muted === false && !picking;
  useEffect(() => {
    if (shouldPlay) {
      ensureAudioMode();
      player.play();
    } else {
      player.pause();
    }
  }, [shouldPlay, url, player]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    store.set(MUTE_KEY, next);
  };

  const pick = async (t: MusicTrack) => {
    setBusy(true);
    try {
      const r = await musicApi.setForWorkout(Number(w.id), t.track_id);
      onChange(r.music || null);
      setPicking(false);
    } catch (e) {
      toast(errMsg(e, "Impossible d'ajouter ce son"), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await musicApi.removeFromWorkout(Number(w.id));
      onChange(null);
    } catch (e) {
      toast(errMsg(e, 'Impossible de retirer le son'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!supported || (!music && !isOwn)) return null;

  const picker = <MusicPickerSheet key={pickerKey} visible={picking} onClose={() => setPicking(false)} onPick={pick} busy={busy} />;

  if (!music) {
    return (
      <>
        <Pressable style={styles.add} onPress={openPicker} accessibilityRole="button">
          <Ionicons name="musical-notes-outline" size={16} color={colors.textDim} />
          <Text style={styles.addText}>Ajouter un son</Text>
        </Pressable>
        {picker}
      </>
    );
  }

  const playing = status.playing && muted === false;
  const loading = !failed && muted === false && (!url || status.isBuffering || !status.isLoaded);

  return (
    <>
      <View style={[styles.card, playing && styles.cardPlaying]}>
        {music.cover_url ? (
          <Image source={{ uri: music.cover_url }} style={styles.cover} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.cover, styles.coverEmpty]}>
            <Ionicons name="musical-notes" size={20} color={colors.textDim} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {music.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {music.artist}
            {!!music.link && (
              <Text style={styles.source} onPress={() => Linking.openURL(music.link!)}>
                {'  ·  Deezer'}
              </Text>
            )}
          </Text>
          {isOwn && (
            <View style={styles.ownerActions}>
              <Text style={[styles.ownerAction, busy && { opacity: 0.5 }]} onPress={busy ? undefined : openPicker}>
                Changer
              </Text>
              <Text style={[styles.ownerAction, busy && { opacity: 0.5 }]} onPress={busy ? undefined : remove}>
                Retirer
              </Text>
            </View>
          )}
        </View>
        {failed ? (
          <Ionicons name="alert-circle-outline" size={22} color={colors.textFaint} accessibilityLabel="Extrait indisponible" />
        ) : (
          <Pressable
            onPress={toggleMute}
            style={styles.btn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Activer le son' : 'Couper le son'}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={20} color={playing ? colors.goldLight : colors.text} />
            )}
          </Pressable>
        )}
      </View>
      {picker}
    </>
  );
}

/** Petite ligne "♪ Titre · Artiste" pour les cartes du fil. */
export function MusicTag({ music }: { music?: WorkoutMusicInfo | null }) {
  if (!music) return null;
  return (
    <Text style={styles.tag} numberOfLines={1}>
      <Ionicons name="musical-notes" size={12} color={colors.textDim} /> {music.title} · {music.artist}
    </Text>
  );
}

function MusicPickerSheet({
  visible,
  onClose,
  onPick,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (t: MusicTrack) => void;
  busy: boolean;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<MusicTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = term.trim();
    if (s.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setSearching(true);
      musicApi
        .search(s)
        .then((r) => {
          if (cancelled) return;
          setResults(r.tracks || []);
          setError(null);
        })
        .catch((e) => {
          if (!cancelled) setError(errMsg(e, 'Recherche indisponible'));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  // Moins de 2 caractères : on n'affiche rien (les anciens résultats restent en mémoire)
  const active = term.trim().length >= 2;
  const shown = active ? results : [];

  return (
    <Sheet visible={visible} onClose={onClose} title="Ajouter un son" maxHeight={0.92}>
      <View style={{ gap: 10, paddingBottom: 8 }}>
        <Input value={term} onChangeText={setTerm} placeholder="Titre ou artiste…" autoFocus maxLength={100} returnKeyType="search" />
        {active && searching && <ActivityIndicator color={colors.textDim} />}
        {active && !!error && <Text style={{ color: colors.danger }}>{error}</Text>}
        {active && !searching && !error && results.length === 0 && <T v="small">Aucun titre trouvé.</T>}
        {shown.map((t) => (
          <Pressable
            key={t.track_id}
            onPress={() => onPick(t)}
            disabled={busy}
            style={({ pressed }) => [styles.result, (pressed || busy) && { opacity: 0.6 }]}
          >
            {t.cover_url ? (
              <Image source={{ uri: t.cover_url }} style={styles.coverSm} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.coverSm, styles.coverEmpty]}>
                <Ionicons name="musical-notes" size={16} color={colors.textDim} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>
                {t.title}
                {t.explicit ? <Text style={styles.explicit}>{'  E'}</Text> : null}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {t.artist}
              </Text>
            </View>
          </Pressable>
        ))}
        <T v="small" style={{ textAlign: 'right' }}>
          Extraits de 30 s fournis par Deezer
        </T>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPlaying: { borderColor: colors.gold },
  cover: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  coverSm: { width: 42, height: 42, borderRadius: 6, backgroundColor: colors.surface2 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontWeight: '800', fontSize: 15 },
  artist: { color: colors.textDim, fontSize: 13, marginTop: 1 },
  source: { color: colors.textFaint, textDecorationLine: 'underline' },
  explicit: { color: colors.textFaint, fontWeight: '900', fontSize: 11 },
  ownerActions: { flexDirection: 'row', gap: 16, marginTop: 4 },
  ownerAction: { color: colors.goldLight, fontWeight: '700', fontSize: 13 },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  addText: { color: colors.textDim, fontWeight: '700', fontSize: 14 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  tag: { color: colors.textDim, fontSize: 13, marginTop: 2 },
});
