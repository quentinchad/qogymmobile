import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, FlatList, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInputInstance, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth';
import { errMsg, sessionApi, workoutApi } from '@/lib/api';
import { store } from '@/lib/storage';
import { autoSessionName, fmtClock, isTrue } from '@/lib/format';
import { getSupersetMembers, linkWithNext, normalizeOrphans, normSupersetGroup, unlinkAtIndex } from '@/lib/supersets';
import { colors, radius } from '@/theme';
import { Button, IconBtn, Input, Loader, T, tap } from '@/components/ui';
import { CatalogPicker } from '@/components/CatalogPicker';
import { catalogDefaults } from '@/lib/catalog';
import { Sheet } from '@/components/Sheet';
import { Ring } from '@/components/Visuals';
import { RestTimePicker } from '@/components/RestTimePicker';
import { ReorderList } from '@/components/ReorderList';
import { useConfirm, useToast } from '@/components/Feedback';
import { elapsedSeconds, Exercise, newCustomId, totalSetsOf, useActiveWorkout, useTicker } from '@/workout/ActiveWorkout';
import { ExerciseCard } from '@/workout/ExerciseCard';

const KEEP_AWAKE_KEY = 'qg_keep_awake';

export default function WorkoutScreen() {
  const { sessionId, empty } = useLocalSearchParams<{ sessionId: string; empty?: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const confirm = useConfirm();
  const aw = useActiveWorkout();
  const { state, set, hydrated } = aw;
  const sRef = useRef(state);
  sRef.current = state;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [reorder, setReorder] = useState(false);
  const [editingRestFor, setEditingRestFor] = useState<number | null>(null);
  const [keepAwake, setKeepAwake] = useState(false);
  const [focused, setFocused] = useState(true);
  // Barre chrono compacte, épinglée en haut dès que le gros bloc chrono sort de l'écran.
  const listRef = useRef<FlatList<any>>(null);
  const panelH = useRef(220);
  const [showMini, setShowMini] = useState(false);
  const showMiniRef = useRef(false);
  const onListScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const v = e.nativeEvent.contentOffset.y > panelH.current - 30;
    if (v !== showMiniRef.current) {
      showMiniRef.current = v;
      setShowMini(v);
    }
  }, []);

  // ── Démarrage / reprise ──────────────────────────────────────────────
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !user || !sessionId) return;
    if (startedFor.current === sessionId) return;
    startedFor.current = sessionId;
    let cancelled = false;
    (async () => {
      const s = sRef.current;
      if (s.sessionId === String(sessionId)) {
        await aw.ensureSessionLoaded();
        if (!cancelled) setLoading(false);
        return;
      }
      if (s.sessionId && s.sessionId !== String(sessionId)) {
        const ok = await confirm({
          title: "Abandonner l'entraînement en cours ?",
          message: `Tu as déjà un entraînement en cours (${s.sessionName || 'séance précédente'}). Démarrer une nouvelle séance abandonnera celui-ci.`,
          confirmLabel: 'Démarrer la nouvelle',
          cancelLabel: "Garder l'ancien",
          variant: 'danger',
        });
        if (cancelled) return;
        if (!ok) {
          router.replace(`/workout/${s.sessionId}`);
          return;
        }
        aw.clear();
      }
      try {
        await aw.start(String(sessionId), { isEmptyWorkout: empty === '1' });
        if (!cancelled && empty === '1') setShowAdd(true);
      } catch (e) {
        if (!cancelled) {
          toast(errMsg(e, "Erreur lors du démarrage de l'entraînement"), 'error');
          router.back();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user, sessionId]);

  // Séance sans exercice → ouvre l'ajout automatiquement une fois
  const sawEmpty = useRef(false);
  useEffect(() => {
    if (loading || sawEmpty.current) return;
    if (state.sessionId === String(sessionId) && state.exercises.length === 0) {
      sawEmpty.current = true;
      setShowAdd(true);
    }
  }, [loading, state.sessionId, state.exercises.length, sessionId]);

  // ── Écran allumé (optionnel) ─────────────────────────────────────────
  useEffect(() => {
    store.get<boolean>(KEEP_AWAKE_KEY, false).then(setKeepAwake);
  }, []);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    if (keepAwake && focused) {
      activateKeepAwakeAsync('workout').catch(() => {});
      return () => {
        deactivateKeepAwake('workout').catch(() => {});
      };
    }
  }, [keepAwake, focused]);

  // ── Séries ───────────────────────────────────────────────────────────
  const onSetChange = useCallback(
    (exId: number, setNumber: number, field: 'weight' | 'reps', v: string) => {
      const key = `${exId}-${setNumber}`;
      set('currentSets', (prev) => ({ ...prev, [key]: { ...prev[key], [field]: v } }));
    },
    [set],
  );

  const onValidate = useCallback(
    (exId: number, setNumber: number, effectiveRest: number) => {
      const s = sRef.current;
      const key = `${exId}-${setNumber}`;
      const already = !!s.validatedSets[key];
      Haptics.impactAsync(already ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      set('validatedSets', (prev) => {
        const n = { ...prev };
        if (already) delete n[key];
        else n[key] = true;
        return n;
      });
      if (already) return;
      // Superset : un seul repos, celui du 1er exo du groupe, à chaque série validée.
      const idx = s.exercises.findIndex((e) => String(e.id) === String(exId));
      if (idx >= 0) {
        const members = getSupersetMembers(s.exercises, idx);
        if (members.length > 1) {
          const first = members[0];
          const shared = s.restOverrides[first.id] !== undefined ? s.restOverrides[first.id] : Number(first.rest_time) || 0;
          if (shared > 0) aw.startCountdown(shared);
          return;
        }
      }
      if (effectiveRest > 0) aw.startCountdown(effectiveRest);
    },
    [set, aw.startCountdown],
  );

  const onAddSet = useCallback(
    (exId: number) => {
      const s = sRef.current;
      const ex = s.exercises.find((e) => e.id === exId);
      if (!ex) return;
      set('extraSets', (p) => ({ ...p, [exId]: totalSetsOf(ex, p) + 1 }));
    },
    [set],
  );
  const onRemoveSet = useCallback(
    (exId: number) => {
      const s = sRef.current;
      const ex = s.exercises.find((e) => e.id === exId);
      if (!ex) return;
      const cur = totalSetsOf(ex, s.extraSets);
      if (cur <= 1) return;
      const key = `${exId}-${cur}`;
      set('extraSets', (p) => ({ ...p, [exId]: cur - 1 }));
      set('validatedSets', (p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
      set('currentSets', (p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    },
    [set],
  );

  const onLink = useCallback(
    (exId: number) =>
      set('exercises', (prev) => {
        const i = prev.findIndex((e) => String(e.id) === String(exId));
        return i < 0 ? prev : linkWithNext(prev, i);
      }),
    [set],
  );
  const onUnlink = useCallback(
    (exId: number) =>
      set('exercises', (prev) => {
        const i = prev.findIndex((e) => String(e.id) === String(exId));
        return i < 0 ? prev : normalizeOrphans(unlinkAtIndex(prev, i));
      }),
    [set],
  );
  const onRemove = useCallback(
    async (exId: number) => {
      const ok = await confirm({
        title: 'Retirer cet exercice ?',
        message: "L'exercice sera retiré de cet entraînement (la séance d'origine n'est pas modifiée).",
        confirmLabel: 'Retirer',
        variant: 'danger',
      });
      if (ok) set('exercises', (prev) => normalizeOrphans(prev.filter((e) => e.id !== exId)));
    },
    [confirm, set],
  );
  const onOpenProgress = useCallback(
    (name: string) => {
      if (user && name) router.push(`/exercises/${user.id}/${encodeURIComponent(name)}`);
    },
    [user],
  );
  const openReorder = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setReorder(true);
  }, []);
  const onEditRest = useCallback((id: number) => setEditingRestFor(id), []);

  // ── Terminer ─────────────────────────────────────────────────────────
  const handleComplete = async () => {
    if (saving) return;
    const ok = await confirm({
      title: 'Terminer cet entraînement ?',
      message: "Tes performances seront enregistrées dans l'historique.",
      confirmLabel: 'Terminer',
      cancelLabel: 'Continuer',
    });
    if (!ok) return;
    const s = sRef.current;
    const { exercises, currentSets, session } = s;

    const exerciseOrder = exercises.map((ex, idx) => {
      const entry: any = {
        id: ex._custom ? null : ex.id,
        name: ex.name,
        display_order: idx + 1,
        is_custom: !!ex._custom,
        superset_group: normSupersetGroup(ex.superset_group),
      };
      if (ex._custom) {
        const total = totalSetsOf(ex, s.extraSets);
        const setsData = [];
        for (let n = 1; n <= total; n++) {
          const sd = currentSets[`${ex.id}-${n}`];
          if (sd && (sd.weight || sd.reps)) {
            setsData.push({ set_number: n, weight: sd.weight ? parseFloat(sd.weight) : null, reps: sd.reps ? parseInt(sd.reps, 10) : 0 });
          }
        }
        entry.sets_data = setsData;
      }
      return entry;
    });

    const nonCustomSets: any[] = [];
    for (const [key, sd] of Object.entries(currentSets)) {
      if (!sd?.weight && !sd?.reps) continue;
      const [exerciseId, setNumber] = key.split('-');
      const ex = exercises.find((e) => String(e.id) === exerciseId);
      if (!ex || ex._custom) continue;
      nonCustomSets.push({ exercise_id: Number(exerciseId), set_number: Number(setNumber), weight: sd.weight || null, reps: sd.reps || 0 });
    }

    const originalIds = (session?.exercises || []).filter((e: any) => !e._custom).map((e: any) => e.id);
    const currentIds = exercises.filter((e) => !e._custom).map((e) => e.id);
    const hasCustom = exercises.some((e) => e._custom);
    const orderChanged = originalIds.length !== currentIds.length || originalIds.some((id: any, i: number) => id !== currentIds[i]);
    const pairs = (arr: { id: any; sg: number | null }[]) => {
      const out = new Set<string>();
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++)
          if (arr[i].sg !== null && arr[i].sg === arr[j].sg) {
            const a = String(arr[i].id), b = String(arr[j].id);
            out.add(a < b ? `${a}|${b}` : `${b}|${a}`);
          }
      return out;
    };
    const op = pairs((session?.exercises || []).map((e: any) => ({ id: e.id, sg: normSupersetGroup(e.superset_group) })));
    const cp = pairs(exercises.filter((e) => !e._custom).map((e) => ({ id: e.id, sg: normSupersetGroup(e.superset_group) })));
    const supersetsChanged = op.size !== cp.size || [...op].some((k) => !cp.has(k));
    const hasModifications = hasCustom || orderChanged || supersetsChanged;

    const wid = s.workoutId!;
    const sid = s.sessionId!;
    const sname = session?.name || s.sessionName;
    const isEmpty = s.isEmptyWorkout;
    const isArchived = Number(session?.is_archived) === 1 && Number(session?.is_owner) === 1;

    setSaving(true);
    try {
      await workoutApi.complete(wid, { notes: s.notes, participants: s.selectedParticipants, exerciseOrder, nonCustomSets });
    } catch (e) {
      setSaving(false);
      toast(errMsg(e, "Erreur lors de l'enregistrement — tes données sont conservées, réessaie."), 'error');
      return;
    }
    // ✅ Sauvegardé côté serveur : la suite est optionnelle.
    aw.clear();
    setSaving(false);
    toast('Entraînement enregistré 💪', 'success');

    let apply = false;
    let gallery = false;
    if (isEmpty || isArchived) {
      gallery = await confirm({
        title: 'Enregistrer cette séance ?',
        message: "Ajoute-la à ta galerie pour la refaire plus tard, ou garde simplement l'historique dans le Feed.",
        confirmLabel: 'Enregistrer',
        cancelLabel: "Juste l'historique",
      });
      if (gallery) {
        if (isEmpty) {
          try {
            await sessionApi.patch(sid, { name: autoSessionName('end') });
          } catch {}
        }
        apply = true;
      }
    } else if (hasModifications) {
      const parts = [];
      if (hasCustom) parts.push('des exercices ajoutés');
      if (orderChanged) parts.push("l'ordre des exercices");
      if (supersetsChanged) parts.push('le regroupement en supersets');
      apply = await confirm({
        title: 'Mettre à jour la séance ?',
        message: `Tu as modifié cette séance (${parts.join(' et ')}). Enregistrer ces changements dans « ${sname} » ?`,
        confirmLabel: 'Mettre à jour',
        cancelLabel: 'Juste cet entraînement',
      });
    }
    if (apply) {
      try {
        await workoutApi.applyTemplateChanges(wid, exerciseOrder, gallery);
      } catch {}
    }
    store.set('qg_needs_refresh', Date.now());
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const handleAbandon = async () => {
    const ok = await confirm({
      title: "Abandonner l'entraînement ?",
      message: "Tes performances en cours ne seront pas enregistrées dans l'historique.",
      confirmLabel: 'Abandonner',
      cancelLabel: 'Continuer',
      variant: 'danger',
    });
    if (ok) {
      aw.clear();
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
  };

  // Retour Android = réduire (l'entraînement continue)
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (saving) return true;
        return false;
      });
      return () => sub.remove();
    }, [saving]),
  );

  // ── Données dérivées par carte ───────────────────────────────────────
  const cards = useMemo(() => {
    const ex = state.exercises;
    return ex.map((exercise, i) => {
      const sg = normSupersetGroup(exercise.superset_group);
      const prevSg = i > 0 ? normSupersetGroup(ex[i - 1].superset_group) : null;
      const nextSg = i < ex.length - 1 ? normSupersetGroup(ex[i + 1].superset_group) : null;
      const inSs = sg !== null && (prevSg === sg || nextSg === sg);
      const first = inSs && prevSg !== sg;
      const last = inSs && nextSg !== sg;
      let pos = 0;
      if (inSs) for (let k = i - 1; k >= 0 && normSupersetGroup(ex[k].superset_group) === sg; k--) pos++;
      let size = 1;
      if (first) for (let k = i + 1; k < ex.length && normSupersetGroup(ex[k].superset_group) === sg; k++) size++;
      const restSrc = inSs ? ex[i - pos] : exercise;
      const total = totalSetsOf(exercise, state.extraSets);
      const sets = Array.from({ length: total }, (_, n) => state.currentSets[`${exercise.id}-${n + 1}`]);
      const validated = Array.from({ length: total }, (_, n) => !!state.validatedSets[`${exercise.id}-${n + 1}`]);
      return {
        exercise,
        index: i,
        totalSets: total,
        sets,
        validated,
        effectiveRest: state.restOverrides[restSrc.id] !== undefined ? state.restOverrides[restSrc.id] : Number(restSrc.rest_time) || 0,
        restModified: state.restOverrides[restSrc.id] !== undefined,
        restSourceId: restSrc.id,
        lastPerformance: state.lastPerformances[exercise.id] || exercise.last_performance || null,
        inSuperset: inSs,
        firstOfSuperset: first,
        lastOfSuperset: last,
        positionInSuperset: pos,
        groupSize: size,
        canLinkNext: i < ex.length - 1 && (nextSg !== sg || sg === null),
        linkedToNext: inSs && nextSg === sg,
      };
    });
  }, [state.exercises, state.extraSets, state.currentSets, state.validatedSets, state.restOverrides, state.lastPerformances]);

  if (loading || !state.sessionId || state.sessionId !== String(sessionId)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <Loader label="Démarrage de l'entraînement…" style={{ flex: 1, justifyContent: 'center' }} />
      </View>
    );
  }

  const editingEx = editingRestFor != null ? state.exercises.find((e) => e.id === editingRestFor) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* En-tête */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconBtn name="chevron-down" size={28} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} label="Réduire" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {state.session?.name || state.sessionName}
          </Text>
          {!!state.session?.session_type_name && <Text style={styles.subtitle}>{state.session.session_type_name}</Text>}
        </View>
        <IconBtn
          name={keepAwake ? 'sunny' : 'sunny-outline'}
          color={keepAwake ? colors.goldLight : colors.textDim}
          onPress={() => {
            const v = !keepAwake;
            setKeepAwake(v);
            store.set(KEEP_AWAKE_KEY, v);
            toast(v ? "L'écran restera allumé pendant la séance" : "L'écran peut se mettre en veille", 'info');
          }}
          label="Garder l'écran allumé"
        />
        <IconBtn
          name={aw.beepEnabled ? 'notifications' : 'notifications-off-outline'}
          color={aw.beepEnabled ? colors.goldLight : colors.textDim}
          onPress={aw.toggleBeep}
          label="Bip de fin de repos"
        />
        <IconBtn name="swap-vertical" color={colors.textDim} onPress={openReorder} label="Réorganiser" />
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        onScroll={onListScroll}
        scrollEventThrottle={32}
        data={cards}
        keyExtractor={(c) => String(c.exercise.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 40, gap: 12 }}
        ListHeaderComponent={<TimerPanel focused={focused && !showMini} onHeight={(h) => (panelH.current = h)} />}
        renderItem={({ item }) => (
          <ExerciseCard
            {...item}
            onSetChange={onSetChange}
            onValidate={onValidate}
            onAddSet={onAddSet}
            onRemoveSet={onRemoveSet}
            onEditRest={onEditRest}
            onLink={onLink}
            onUnlink={onUnlink}
            onRemove={onRemove}
            onOpenProgress={onOpenProgress}
            onLongPress={openReorder}
          />
        )}
        removeClippedSubviews={false}
        initialNumToRender={4}
        ListFooterComponent={
          <View style={{ gap: 12 }}>
            <Pressable style={styles.addBtn} onPress={() => { tap(); setShowAdd(true); }}>
              <Ionicons name="add-circle" size={22} color={colors.goldLight} />
              <Text style={styles.addText}>Ajouter un exercice</Text>
            </Pressable>
            <NotesAndFriends />
            <Button title="Terminer et enregistrer" icon="checkmark-done" variant="success" onPress={handleComplete} loading={saving} />
            <Button title="Abandonner" variant="danger" onPress={handleAbandon} disabled={saving} />
          </View>
        }
      />
      <MiniTimerBar visible={showMini} focused={focused} onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} />
      </KeyboardAvoidingView>

      <AddExerciseSheet visible={showAdd} onClose={() => setShowAdd(false)} />

      <Sheet visible={reorder} onClose={() => setReorder(false)} title="Réorganiser" scroll={false} footer={<Button title="Terminé" onPress={() => setReorder(false)} />}>
        <ReorderSheetBody />
      </Sheet>

      <RestTimePicker
        visible={!!editingEx}
        value={editingEx ? (state.restOverrides[editingEx.id] !== undefined ? state.restOverrides[editingEx.id] : Number(editingEx.rest_time) || 0) : 0}
        onChange={(v) => editingEx && set('restOverrides', (p) => ({ ...p, [editingEx.id]: v }))}
        onClose={() => setEditingRestFor(null)}
      />

      {saving && (
        <View style={styles.savingOverlay}>
          <View style={styles.savingCard}>
            <Loader />
            <T v="h3">Enregistrement…</T>
            <T v="small">Ne ferme pas l'application</T>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Chrono + repos ─────────────────────────────────────────────────────
function TimerPanel({ focused, onHeight }: { focused: boolean; onHeight?: (h: number) => void }) {
  const aw = useActiveWorkout();
  const { state } = aw;
  const resting = !!state.countdownEndAt && state.countdownEndAt > Date.now();
  const justFinished = Date.now() - aw.restFinishedAt < 3000;
  // 4 Hz pendant un repos (anneau fluide), 1 Hz sinon, rien si écran caché.
  useTicker(focused && (state.timerActive || resting || justFinished), resting ? 250 : 1000);

  const remainingMs = resting ? state.countdownEndAt! - Date.now() : 0;
  const progress = resting && state.countdownDuration ? 1 - remainingMs / (state.countdownDuration * 1000) : 0;

  return (
    <View style={styles.timerCard} onLayout={(e) => onHeight?.(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.timerLabel}>Durée</Text>
          <Text style={styles.timer}>{fmtClock(elapsedSeconds(state))}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {state.timerActive ? (
              <Button title="Pause" icon="pause" variant="secondary" small onPress={aw.pauseTimer} />
            ) : (
              <Button title="Reprendre" icon="play" variant="success" small onPress={aw.resumeTimer} />
            )}
            <IconBtn name="refresh" color={colors.textDim} bg={colors.surface2} onPress={aw.resetTimer} label="Remettre à zéro" />
          </View>
        </View>
        {(resting || justFinished) && (
          <Pressable onPress={aw.dismissCountdown} hitSlop={6}>
            <Ring size={104} stroke={9} progress={justFinished && !resting ? 1 : progress} color={justFinished && !resting ? colors.success : colors.gold}>
              {resting ? (
                <>
                  <Text style={styles.restNum}>{fmtClock(Math.ceil(remainingMs / 1000))}</Text>
                  <Text style={styles.restLbl}>repos</Text>
                </>
              ) : (
                <>
                  <Ionicons name="flash" size={26} color={colors.success} />
                  <Text style={[styles.restLbl, { color: colors.success }]}>Go !</Text>
                </>
              )}
            </Ring>
          </Pressable>
        )}
      </View>
      {resting && (
        <View style={styles.restActions}>
          <Button title="−15 s" variant="secondary" small onPress={() => aw.addRest(-15)} style={{ flex: 1 }} />
          <Button title="+30 s" variant="secondary" small onPress={() => aw.addRest(30)} style={{ flex: 1 }} />
          <Button title="Passer" variant="outline" small icon="play-skip-forward" onPress={aw.dismissCountdown} style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );
}

// ── Barre chrono compacte (visible quand on a scrollé) ─────────────────
function MiniTimerBar({ visible, focused, onPress }: { visible: boolean; focused: boolean; onPress: () => void }) {
  const aw = useActiveWorkout();
  const { state } = aw;
  const anim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: 160, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, anim]);

  const resting = !!state.countdownEndAt && state.countdownEndAt > Date.now();
  const justFinished = Date.now() - aw.restFinishedAt < 3000;
  useTicker(mounted && focused && (state.timerActive || resting || justFinished), 1000);
  if (!mounted) return null;

  const remaining = resting ? Math.ceil((state.countdownEndAt! - Date.now()) / 1000) : 0;
  const pct = resting && state.countdownDuration ? Math.min(1, Math.max(0, 1 - remaining / state.countdownDuration)) : 0;

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.mini,
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] },
      ]}
    >
      <Pressable style={styles.miniMain} onPress={onPress} hitSlop={4}>
        <Ionicons name={state.timerActive ? 'time-outline' : 'pause'} size={16} color={colors.textDim} />
        <Text style={styles.miniClock}>{fmtClock(elapsedSeconds(state))}</Text>
        {resting ? (
          <View style={styles.miniRest}>
            <Ionicons name="hourglass-outline" size={14} color={colors.goldLight} />
            <Text style={styles.miniRestNum}>{fmtClock(remaining)}</Text>
          </View>
        ) : justFinished ? (
          <View style={styles.miniRest}>
            <Ionicons name="flash" size={14} color={colors.success} />
            <Text style={[styles.miniRestNum, { color: colors.success }]}>Go !</Text>
          </View>
        ) : null}
      </Pressable>
      {resting && (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable style={styles.miniBtn} onPress={() => { tap(); aw.addRest(30); }} hitSlop={4}>
            <Text style={styles.miniBtnText}>+30 s</Text>
          </Pressable>
          <Pressable style={styles.miniBtn} onPress={() => { tap(); aw.dismissCountdown(); }} hitSlop={4} accessibilityLabel="Passer le repos">
            <Ionicons name="play-skip-forward" size={15} color={colors.text} />
          </Pressable>
        </View>
      )}
      {resting && <View style={[styles.miniProgress, { width: `${pct * 100}%` }]} />}
    </Animated.View>
  );
}

// ── Notes + participants ───────────────────────────────────────────────
function NotesAndFriends() {
  const { state, set } = useActiveWorkout();
  const [showFriends, setShowFriends] = useState(state.selectedParticipants.length > 0);
  return (
    <View style={styles.block}>
      <Input
        label="Notes (optionnel)"
        value={state.notes}
        onChangeText={(v) => set('notes', v)}
        placeholder="Comment s'est passé l'entraînement ?"
        multiline
      />
      <Pressable
        style={styles.toggleRow}
        onPress={() => {
          tap();
          const v = !showFriends;
          setShowFriends(v);
          if (!v) set('selectedParticipants', []);
        }}
      >
        <Ionicons name={showFriends ? 'checkbox' : 'square-outline'} size={22} color={showFriends ? colors.gold : colors.textDim} />
        <Text style={{ color: colors.text, fontSize: 15 }}>Ajouter des amis à la séance</Text>
      </Pressable>
      {showFriends &&
        (state.friends.length === 0 ? (
          <T v="small">Tu n'as pas encore d'amis.</T>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {state.friends.map((f: any) => {
              const on = state.selectedParticipants.includes(f.friend_id);
              return (
                <Pressable
                  key={f.friend_id}
                  onPress={() => {
                    tap();
                    set('selectedParticipants', (p) => (on ? p.filter((x) => x !== f.friend_id) : [...p, f.friend_id]));
                  }}
                  style={[styles.friendChip, on && { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}
                >
                  <Text style={{ color: on ? colors.goldLight : colors.textDim, fontWeight: '700' }}>{f.friend_username}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
    </View>
  );
}

// ── Réorganisation ─────────────────────────────────────────────────────
function ReorderSheetBody() {
  const { state, set } = useActiveWorkout();
  const [dragging, setDragging] = useState(false);
  return (
    <ScrollView scrollEnabled={!dragging} style={{ maxHeight: 480 }} contentContainerStyle={{ paddingVertical: 6 }}>
      <T v="small" style={{ marginBottom: 10 }}>
        Maintiens la poignée ≡ et fais glisser pour changer l'ordre.
      </T>
      <ReorderList
        items={state.exercises}
        keyOf={(e: Exercise) => String(e.id)}
        onDragChange={setDragging}
        onReorder={(from, to) =>
          set('exercises', (prev) => {
            const arr = [...prev];
            const [m] = arr.splice(from, 1);
            arr.splice(to, 0, m);
            return normalizeOrphans(arr);
          })
        }
        render={(e: Exercise) => (
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
            {e.name}
            {e._custom ? <Text style={{ color: colors.goldLight, fontSize: 11 }}>  perso</Text> : null}
          </Text>
        )}
      />
    </ScrollView>
  );
}

// ── Ajout d'exercice ───────────────────────────────────────────────────
function AddExerciseSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { state, set } = useActiveWorkout();
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [sets, setSets] = useState(3);
  const searchRef = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (visible) {
      setSearch('');
      setName('');
      setSets(3);
    }
  }, [visible]);

  const exerciseNames = useMemo(() => state.exercises.map((e: any) => e.name), [state.exercises]);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return state.allExercises.filter((e: any) => e.name?.toLowerCase().includes(q)).slice(0, 30);
  }, [search, state.allExercises]);

  const add = (exo: any) => {
    const id = newCustomId();
    set('exercises', (prev) => [
      ...prev,
      {
        id,
        name: exo.name,
        sets: exo.sets || sets,
        reps_min: exo.reps_min || 8,
        reps_max: exo.reps_max || 12,
        rest_time: exo.rest_time || 90,
        exercise_order: prev.length + 1,
        superset_group: null,
        _custom: true,
        last_performance: exo.last_performance || null,
      },
    ]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Ajouter un exercice">
      <Text style={styles.sheetLabel}>Depuis tes exercices</Text>
      <Input ref={searchRef} value={search} onChangeText={setSearch} placeholder="Rechercher…" autoFocus={false} />
      {search.length > 0 && (
        <View style={{ marginTop: 8, gap: 6 }}>
          {results.length === 0 ? (
            <T v="small" style={{ padding: 8 }}>
              Aucun résultat
            </T>
          ) : (
            results.map((e: any) => (
              <Pressable key={`${e.id}-${e.name}`} style={styles.result} onPress={() => add(e)}>
                <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                  {e.name}
                </Text>
                <Text style={{ color: colors.textDim, fontSize: 12 }}>
                  {e.sets} × {e.reps_min}
                  {e.reps_max && e.reps_max !== e.reps_min ? `-${e.reps_max}` : ''}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      )}
      <Text style={[styles.sheetLabel, { marginTop: 18 }]}>Suggestions d'exercices</Text>
      <CatalogPicker
        query={search}
        exclude={exerciseNames}
        onPick={(ex) => {
          const d = catalogDefaults(ex);
          add({ name: ex.n, sets, reps_min: d.reps_min, reps_max: d.reps_max, rest_time: d.rest_time });
        }}
      />
      <View style={styles.divider}>
        <View style={styles.divLine} />
        <Text style={{ color: colors.textFaint, fontSize: 12 }}>ou créer un exercice</Text>
        <View style={styles.divLine} />
      </View>
      <Input value={name} onChangeText={setName} placeholder="Nom de l'exercice" onSubmitEditing={() => name.trim() && add({ name: name.trim(), sets })} />
      <View style={styles.stepRow}>
        <Text style={{ color: colors.textDim, fontWeight: '600' }}>Séries</Text>
        <View style={styles.stepper}>
          <IconBtn name="remove" onPress={() => setSets((v) => Math.max(1, v - 1))} bg={colors.surface3} />
          <Text style={styles.stepVal}>{sets}</Text>
          <IconBtn name="add" onPress={() => setSets((v) => v + 1)} bg={colors.surface3} />
        </View>
      </View>
      <Button title="Ajouter" onPress={() => add({ name: name.trim(), sets })} disabled={!name.trim()} style={{ marginBottom: 10 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 12 },
  timerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.25)',
    marginBottom: 2,
  },
  timerLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  timer: { color: colors.text, fontSize: 46, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  restNum: { color: colors.goldLight, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  restLbl: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  restActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(212,166,74,0.45)',
  },
  addText: { color: colors.goldLight, fontWeight: '800', fontSize: 15 },
  block: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  friendChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
  savingOverlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  savingCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 24, alignItems: 'center', gap: 6, minWidth: 240 },
  sheetLabel: { color: colors.textDim, fontWeight: '700', fontSize: 13, marginBottom: 8 },
  mini: {
    position: 'absolute',
    top: 8,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.35)',
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  miniMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  miniClock: { color: colors.text, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  miniRest: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(212,166,74,0.14)' },
  miniRestNum: { color: colors.goldLight, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  miniBtn: { minWidth: 44, height: 32, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  miniBtnText: { color: colors.text, fontWeight: '800', fontSize: 13 },
  miniProgress: { position: 'absolute', left: 0, bottom: 0, height: 3, backgroundColor: colors.gold },
  result: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface2 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  divLine: { flex: 1, height: 1, backgroundColor: colors.border },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepVal: { color: colors.text, fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'center' },
});
