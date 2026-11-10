import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import QoWorkout from '../../modules/qo-workout';
import { friendsApi, sessionApi, workoutApi } from '@/lib/api';
import { store } from '@/lib/storage';
import { useAuth } from '@/lib/auth';

/**
 * État global de l'entraînement en cours (port de ActiveWorkoutContext du
 * site). Différences clés pour le natif :
 *  - le chrono est basé sur l'heure réelle (startedAt) : il continue même si
 *    l'app est fermée ou tuée par Android, et reprend exactement où il en est ;
 *  - la notification système (chrono + repos restant) est pilotée d'ici ;
 *  - aucun "tick" global : les écrans qui affichent un chrono le calculent
 *    eux-mêmes, uniquement quand ils sont visibles (économie de batterie).
 */

export type Exercise = {
  id: number;
  name: string;
  sets: number | string;
  reps_min?: number | string;
  reps_max?: number | string;
  rest_time?: number | string;
  superset_group?: number | string | null;
  exercise_order?: number;
  last_performance?: string | null;
  _custom?: boolean;
  [k: string]: any;
};

export type SetData = { weight?: string; reps?: string };

export type WorkoutState = {
  sessionId: string | null;
  session: any | null;
  sessionName: string;
  workoutId: number | null;
  isEmptyWorkout: boolean;
  exercises: Exercise[];
  extraSets: Record<string, number>;
  currentSets: Record<string, SetData>;
  validatedSets: Record<string, boolean>;
  restOverrides: Record<string, number>;
  lastPerformances: Record<string, string>;
  notes: string;
  selectedParticipants: number[];
  timerActive: boolean;
  startedAt: number | null;
  pausedTime: number;
  countdownEndAt: number | null;
  countdownDuration: number;
  friends: any[];
  allExercises: any[];
};

const initialState = (): WorkoutState => ({
  sessionId: null,
  session: null,
  sessionName: '',
  workoutId: null,
  isEmptyWorkout: false,
  exercises: [],
  extraSets: {},
  currentSets: {},
  validatedSets: {},
  restOverrides: {},
  lastPerformances: {},
  notes: '',
  selectedParticipants: [],
  timerActive: false,
  startedAt: null,
  pausedTime: 0,
  countdownEndAt: null,
  countdownDuration: 0,
  friends: [],
  allExercises: [],
});

// Brouillon conservé 8 h après la dernière modification.
const DRAFT_TTL = 8 * 60 * 60 * 1000;
const draftKey = (userId: number) => `qg_workout_draft_${userId}`;
const BEEP_KEY = 'qg_rest_beep';

// Ids négatifs pour les exos ajoutés pendant la séance (cf. site web).
let customIdCounter = -1;
export const newCustomId = () => --customIdCounter;
const reseedCustomIds = (ids: any[]) => {
  let min = -1;
  for (const id of ids) {
    const n = typeof id === 'number' ? id : parseInt(id, 10);
    if (Number.isFinite(n) && n < min) min = n;
  }
  if (min < customIdCounter) customIdCounter = min;
};

const normalizeCatalog = (list: any[]) =>
  list.map((e) => ({
    ...e,
    sets: e.sets && e.sets > 0 ? e.sets : 3,
    reps_min: e.reps_min && e.reps_min > 0 ? e.reps_min : 8,
    reps_max: e.reps_max && e.reps_max > 0 ? e.reps_max : 12,
    rest_time: e.rest_time && e.rest_time > 0 ? e.rest_time : 90,
  }));

export const totalSetsOf = (ex: Exercise, extraSets: Record<string, number>) =>
  extraSets[ex.id] !== undefined ? extraSets[ex.id] : parseInt(String(ex.sets), 10) || 1;

export const elapsedSeconds = (s: Pick<WorkoutState, 'timerActive' | 'startedAt' | 'pausedTime'>) =>
  s.timerActive && s.startedAt ? (Date.now() - s.startedAt) / 1000 + s.pausedTime : s.pausedTime;

type Updater<T> = T | ((prev: T) => T);

type Ctx = {
  state: WorkoutState;
  hasActive: boolean;
  hydrated: boolean;
  beepEnabled: boolean;
  /** Timestamp de la dernière fin de repos (pour l'animation "✓ go !") */
  restFinishedAt: number;
  start: (sessionId: string, opts?: { isEmptyWorkout?: boolean }) => Promise<void>;
  ensureSessionLoaded: () => Promise<void>;
  resumeTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  clear: () => void;
  set: <K extends keyof WorkoutState>(key: K, v: Updater<WorkoutState[K]>) => void;
  startCountdown: (sec: number) => void;
  dismissCountdown: () => void;
  addRest: (sec: number) => void;
  toggleBeep: () => void;
};

const C = createContext<Ctx | null>(null);

export function ActiveWorkoutProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<WorkoutState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [beepEnabled, setBeepEnabled] = useState(true);
  const [restFinishedAt, setRestFinishedAt] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const userId = user?.id ?? null;

  // ── Restauration du brouillon ─────────────────────────────────────────
  useEffect(() => {
    setHydrated(false);
    setState(initialState());
    if (!userId) {
      setHydrated(true);
      return;
    }
    let alive = true;
    (async () => {
      setBeepEnabled(await store.get(BEEP_KEY, true));
      const draft = await store.get<(Partial<WorkoutState> & { updatedAt?: number }) | null>(draftKey(userId), null);
      if (!alive) return;
      if (draft && draft.sessionId && draft.updatedAt && Date.now() - draft.updatedAt < DRAFT_TTL) {
        reseedCustomIds((draft.exercises || []).map((e) => e.id));
        setState({ ...initialState(), ...draft, friends: [], allExercises: [] } as WorkoutState);
      } else if (draft) {
        store.remove(draftKey(userId));
        QoWorkout.stop();
      } else {
        QoWorkout.stop();
      }
      setHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  // ── Sauvegarde (débouncée) ─────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || !userId || !state.sessionId) return;
    const t = setTimeout(() => {
      const { friends, allExercises, ...rest } = state;
      store.set(draftKey(userId), { ...rest, updatedAt: Date.now() });
    }, 350);
    return () => clearTimeout(t);
  }, [state, hydrated, userId]);

  // ── Notification système ───────────────────────────────────────────────
  const setsDone = useMemo(() => Object.keys(state.validatedSets).length, [state.validatedSets]);
  const setsTotal = useMemo(
    () => state.exercises.reduce((acc, e) => acc + totalSetsOf(e, state.extraSets), 0),
    [state.exercises, state.extraSets],
  );
  useEffect(() => {
    if (!hydrated) return;
    if (!state.sessionId) return;
    QoWorkout.update({
      title: state.sessionName || 'Entraînement',
      chronoBase: state.timerActive && state.startedAt ? state.startedAt - state.pausedTime * 1000 : 0,
      pausedSec: Math.floor(state.pausedTime),
      restEnd: state.countdownEndAt && state.countdownEndAt > Date.now() ? state.countdownEndAt : 0,
      restTotal: state.countdownDuration,
      setsDone,
      setsTotal,
      beep: beepEnabled,
    });
  }, [
    hydrated,
    state.sessionId,
    state.sessionName,
    state.timerActive,
    state.startedAt,
    state.pausedTime,
    state.countdownEndAt,
    state.countdownDuration,
    setsDone,
    setsTotal,
    beepEnabled,
  ]);

  // Actions faites depuis la notification (Passer / +30 s / fin d'alarme)
  useEffect(() => {
    const sub = QoWorkout.onRestChange((e) => {
      setState((p) =>
        e.restEndAt > 0
          ? { ...p, countdownEndAt: e.restEndAt, countdownDuration: e.restTotal }
          : { ...p, countdownEndAt: null, countdownDuration: 0 },
      );
    });
    return () => sub.remove();
  }, []);

  // Premier plan / arrière-plan : la notification « Repos terminé » n'est affichée que hors de l'app.
  useEffect(() => {
    QoWorkout.setForeground(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (st) => {
      const fg = st === 'active';
      QoWorkout.setForeground(fg);
      if (fg && stateRef.current.sessionId) {
        const r = QoWorkout.getRest();
        if (r && r.active) {
          const nativeEnd = r.restEndAt > Date.now() ? r.restEndAt : 0;
          const jsEnd = stateRef.current.countdownEndAt && stateRef.current.countdownEndAt > Date.now() ? stateRef.current.countdownEndAt : 0;
          if (Math.abs(nativeEnd - jsEnd) > 500) {
            setState((p) => ({ ...p, countdownEndAt: nativeEnd || null, countdownDuration: nativeEnd ? r.restTotal : 0 }));
          }
        }
      }
    });
    return () => sub.remove();
  }, []);

  // ── Fin de repos (UI) ──────────────────────────────────────────────────
  // Les bips (décompte 5 → 1 + double bip final) sont joués côté natif par
  // une alarme, que l'app soit à l'écran ou non : un seul timeout ici pour l'UI.
  useEffect(() => {
    const end = state.countdownEndAt;
    if (!end) return;
    const now = Date.now();
    if (end <= now) {
      setState((p) => (p.countdownEndAt === end ? { ...p, countdownEndAt: null, countdownDuration: 0 } : p));
      return;
    }
    const t = setTimeout(() => {
      setRestFinishedAt(Date.now());
      setState((p) => (p.countdownEndAt === end ? { ...p, countdownEndAt: null, countdownDuration: 0 } : p));
    }, end - now);
    return () => clearTimeout(t);
  }, [state.countdownEndAt]);

  // ── Actions ────────────────────────────────────────────────────────────
  const ensureNotifPermission = useCallback(async () => {
    if (Platform.OS !== 'android' || Platform.Version < 33) return;
    try {
      const perm = 'android.permission.POST_NOTIFICATIONS' as any;
      const has = await PermissionsAndroid.check(perm);
      if (!has) await PermissionsAndroid.request(perm);
    } catch {}
  }, []);

  const start = useCallback(
    async (sessionId: string, opts: { isEmptyWorkout?: boolean } = {}) => {
      customIdCounter = -1;
      ensureNotifPermission();
      const sessResp = await sessionApi.get(sessionId);
      const session = sessResp.session;
      const w = await workoutApi.start(sessionId);
      const perfs: Record<string, string> = {};
      (w.last_performances || []).forEach((p: any) => {
        perfs[p.id] = p.last_performance;
      });
      const [friends, catalog] = await Promise.all([
        friendsApi.list().then((r) => r.friends || []).catch(() => []),
        sessionApi.allExercises().then((r) => r.exercises || []).catch(() => []),
      ]);
      setState({
        ...initialState(),
        sessionId: String(sessionId),
        session,
        sessionName: session?.name || '',
        workoutId: w.workout_id,
        isEmptyWorkout: !!opts.isEmptyWorkout || (session?.exercises || []).length === 0,
        exercises: session?.exercises || [],
        lastPerformances: perfs,
        friends,
        allExercises: catalog.length ? normalizeCatalog(catalog) : session?.exercises || [],
        timerActive: true,
        startedAt: Date.now(),
        pausedTime: 0,
      });
    },
    [ensureNotifPermission],
  );

  const ensureSessionLoaded = useCallback(async () => {
    const s = stateRef.current;
    if (!s.sessionId) return;
    if (!s.session) {
      try {
        const r = await sessionApi.get(s.sessionId);
        setState((p) => ({ ...p, session: r.session, sessionName: r.session?.name || p.sessionName }));
      } catch {}
    }
    if (!s.friends.length) {
      friendsApi
        .list()
        .then((r) => setState((p) => ({ ...p, friends: r.friends || [] })))
        .catch(() => {});
    }
    if (!s.allExercises.length) {
      sessionApi
        .allExercises()
        .then((r) => {
          const list = r.exercises || [];
          if (list.length) setState((p) => ({ ...p, allExercises: normalizeCatalog(list) }));
        })
        .catch(() => {});
    }
  }, []);

  const resumeTimer = useCallback(() => {
    setState((p) => (p.timerActive ? p : { ...p, timerActive: true, startedAt: Date.now() }));
  }, []);
  const pauseTimer = useCallback(() => {
    setState((p) => {
      if (!p.timerActive) return p;
      const elapsed = p.startedAt ? (Date.now() - p.startedAt) / 1000 : 0;
      return { ...p, timerActive: false, pausedTime: p.pausedTime + elapsed, startedAt: null };
    });
  }, []);
  const resetTimer = useCallback(() => {
    setState((p) => ({ ...p, timerActive: false, startedAt: null, pausedTime: 0 }));
  }, []);

  const clear = useCallback(() => {
    if (userId) store.remove(draftKey(userId));
    QoWorkout.stop();
    setState(initialState());
  }, [userId]);

  const set = useCallback(<K extends keyof WorkoutState>(key: K, v: Updater<WorkoutState[K]>) => {
    setState((p) => ({ ...p, [key]: typeof v === 'function' ? (v as (x: WorkoutState[K]) => WorkoutState[K])(p[key]) : v }));
  }, []);

  const startCountdown = useCallback((sec: number) => {
    setState((p) => ({ ...p, countdownEndAt: Date.now() + sec * 1000, countdownDuration: sec }));
  }, []);
  const dismissCountdown = useCallback(() => {
    setState((p) => ({ ...p, countdownEndAt: null, countdownDuration: 0 }));
  }, []);
  const addRest = useCallback((sec: number) => {
    setState((p) => {
      if (!p.countdownEndAt) return p;
      const end = Math.max(Date.now() + 1000, p.countdownEndAt + sec * 1000);
      return { ...p, countdownEndAt: end, countdownDuration: Math.max(1, p.countdownDuration + sec) };
    });
  }, []);
  const toggleBeep = useCallback(() => {
    setBeepEnabled((b) => {
      store.set(BEEP_KEY, !b);
      // Aperçu du son à l'activation (permet aussi de régler le volume).
      if (!b) QoWorkout.beep(false);
      return !b;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      state,
      hasActive: !!state.sessionId,
      hydrated,
      beepEnabled,
      restFinishedAt,
      start,
      ensureSessionLoaded,
      resumeTimer,
      pauseTimer,
      resetTimer,
      clear,
      set,
      startCountdown,
      dismissCountdown,
      addRest,
      toggleBeep,
    }),
    [state, hydrated, beepEnabled, restFinishedAt, start, ensureSessionLoaded, resumeTimer, pauseTimer, resetTimer, clear, set, startCountdown, dismissCountdown, addRest, toggleBeep],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useActiveWorkout = () => {
  const c = useContext(C);
  if (!c) throw new Error('useActiveWorkout hors provider');
  return c;
};

/**
 * Force un re-render toutes les `ms` tant que `active` est vrai ET que l'app
 * est au premier plan (aucun calcul quand l'écran est éteint).
 */
export function useTicker(active: boolean, ms = 1000) {
  const [, setN] = useState(0);
  const [fg, setFg] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setFg(st === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!active || !fg) return;
    setN((n) => n + 1);
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, fg, ms]);
}
