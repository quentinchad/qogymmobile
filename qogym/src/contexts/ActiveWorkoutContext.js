import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { sessionService, workoutService, friendsService } from '../services/api';

/**
 * ActiveWorkoutContext — possède le state du workout en cours.
 *
 * Avant : tout le state du workout (chrono, sets saisis, exos, etc.) vivait
 * dans Workout.js. Quand on quittait la page, le composant était démonté et
 * le state mourait avec. Pour autoriser la "réduction" du workout (mini-card
 * en bas pendant qu'on navigue ailleurs dans l'app), on remonte ce state au
 * niveau App via ce Context.
 *
 * Le state survit à toute navigation tant que le Provider est monté.
 * La page Workout.js et la mini-card sont maintenant deux *vues* sur le
 * même state.
 *
 * Le brouillon localStorage continue de fonctionner exactement comme avant
 * pour le cas "utilisateur ferme l'onglet et revient" (récupération à
 * froid). Au boot de l'app, on scanne les brouillons et on charge le plus
 * récent automatiquement → la mini-card apparaît, et l'utilisateur peut
 * la taper pour reprendre.
 */

const DRAFT_TTL = 60 * 60 * 1000; // 1h
const getDraftKey = (userId, sessionId) => `qogym_workout_draft_${userId}_${sessionId}`;

const ActiveWorkoutContext = createContext(null);

const initialState = () => ({
  // Identité
  sessionId:    null,
  session:      null,        // { id, name, exercises, ... } chargée depuis l'API
  sessionName:  '',          // gardé séparé pour la mini-card sans avoir à charger session
  workoutId:    null,
  isEmptyWorkout: false,

  // Données entraînement
  exercises:        [],
  extraSets:        {},
  currentSets:      {},
  validatedSets:    {},
  restOverrides:    {},
  lastPerformances: {},
  notes:            '',
  selectedParticipants: [],

  // Timer
  timerActive:  false,
  pausedTime:   0,           // secondes accumulées en pause
  startedAt:    null,        // timestamp ms du début (null si pas démarré)

  // Countdown de repos
  countdownEndAt:    null,    // timestamp ms de fin (null = inactif)
  countdownDuration: 0,       // durée totale du countdown (en s) — utilisé
                              // pour calculer le ratio de progression de
                              // l'anneau visuel

  // UI : amis (chargés une fois, mémoisés ici)
  friends: [],

  // Catalogue d'exos pour le picker (chargé une fois)
  allExercises: [],
});

// Compteur d'IDs pour les exercices ajoutés "à la volée" pendant une séance.
// On utilise des entiers strictement négatifs (les ids BDD étant positifs)
// pour distinguer les exos locaux des exos persistés.
//
// ⚠️ Ce compteur vit au niveau du module : il est remis à -1 à chaque
// rechargement de l'app (refresh, fermeture/réouverture de l'onglet,
// passage en arrière-plan sur un mobile qui décharge la WebView, HMR en
// dev, etc.). Sans précaution, ça peut produire des collisions :
//   1. tu ajoutes 3 exos custom → ids -2, -3, -4 (sauvés en brouillon)
//   2. l'app recharge → compteur revient à -1
//   3. brouillon ré-hydraté → state contient toujours -2, -3, -4
//   4. nouvel ajout → newCustomId() renvoie -2 → COLLISION avec l'exo 1
//   5. dans currentSets indexé par `${id}-${setNumber}`, les deux exos
//      partagent les mêmes inputs (poids/reps) — bug observé en prod.
//
// La parade : à l'hydratation du brouillon, on appelle `reseedCustomIds`
// avec les ids des exos déjà présents pour s'assurer que le prochain
// `newCustomId()` retourne une valeur strictement plus petite (plus
// négative) que tout id déjà utilisé.
let _customIdCounter = -1;
export const newCustomId = () => --_customIdCounter;
const reseedCustomIds = (existingIds) => {
  let min = -1;
  for (const id of existingIds) {
    const n = typeof id === 'number' ? id : parseInt(id, 10);
    if (Number.isFinite(n) && n < min) min = n;
  }
  // Le prochain --_customIdCounter doit être < min, donc on positionne
  // le compteur à min (le décrément le rendra plus petit).
  if (min < _customIdCounter) _customIdCounter = min;
};

export const ActiveWorkoutProvider = ({ user, children }) => {
  const [state, setStateRaw] = useState(initialState);
  // Le timer fait avancer `timerSeconds` chaque seconde pour rerender les vues.
  const [timerSeconds, setTimerSeconds] = useState(0);
  const isHydratedRef = useRef(false);
  // Garde une trace du sessionId courant pour les writeurs de draft.
  const stateRef = useRef(state);
  stateRef.current = state;

  // setState helper qui accepte fn ou objet partiel.
  const setState = useCallback((updater) => {
    setStateRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      return next;
    });
  }, []);

  // ── Au boot : scanner les brouillons et charger le plus récent ──
  useEffect(() => {
    if (!user) return;
    if (isHydratedRef.current) return;

    try {
      const candidates = [];
      const prefix = `qogym_workout_draft_${user.id}_`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        try {
          const draft = JSON.parse(localStorage.getItem(key));
          if (draft && Date.now() - draft.timestamp < DRAFT_TTL) {
            const sessionId = key.slice(prefix.length);
            candidates.push({ sessionId, draft, key });
          } else if (draft && Date.now() - draft.timestamp >= DRAFT_TTL) {
            // Nettoyage des brouillons expirés
            localStorage.removeItem(key);
          }
        } catch (_) {
          // brouillon corrompu, on l'ignore
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.draft.timestamp - a.draft.timestamp);
        const latest = candidates[0];
        const d = latest.draft;
        // ⚠️ Important : reseed le compteur d'ids custom pour qu'il soit
        // toujours strictement plus petit (= plus négatif) que tout id
        // déjà présent dans les exos restaurés. Sinon collision possible
        // au prochain ajout d'un exo custom (cf. commentaire sur
        // `reseedCustomIds`).
        reseedCustomIds((d.exercises || []).map(e => e.id));
        // On charge le brouillon dans le state. Le timer reprend où il en
        // était (paused : timerSeconds = pausedTime, pas de start).
        setStateRaw({
          ...initialState(),
          sessionId:    latest.sessionId,
          sessionName:  d.sessionName || '',
          workoutId:    d.workoutId || null,
          isEmptyWorkout: !!d.isEmptyWorkout,
          exercises:    d.exercises || [],
          extraSets:    d.extraSets || {},
          currentSets:  d.currentSets || {},
          validatedSets:d.validatedSets || {},
          restOverrides: d.restOverrides || {},
          lastPerformances: d.lastPerformances || {},
          notes:        d.notes || '',
          selectedParticipants: d.selectedParticipants || [],
          // Timer en pause à la valeur du brouillon
          timerActive:  false,
          pausedTime:   d.timerSeconds || d.pausedTime || 0,
          startedAt:    null,
        });
        setTimerSeconds(d.timerSeconds || d.pausedTime || 0);
      }
    } catch (_) { /* localStorage indisponible : ignore */ }

    isHydratedRef.current = true;
  }, [user]);

  // ── Persist draft à chaque changement ──
  useEffect(() => {
    if (!user || !state.sessionId) return;
    if (!isHydratedRef.current) return;
    const draft = {
      timestamp: Date.now(),
      sessionName:  state.sessionName,
      workoutId:    state.workoutId,
      isEmptyWorkout: state.isEmptyWorkout,
      exercises:    state.exercises,
      extraSets:    state.extraSets,
      currentSets:  state.currentSets,
      validatedSets:state.validatedSets,
      restOverrides: state.restOverrides,
      lastPerformances: state.lastPerformances,
      notes:        state.notes,
      selectedParticipants: state.selectedParticipants,
      timerSeconds: timerSeconds,
      pausedTime:   state.pausedTime,
    };
    try {
      localStorage.setItem(getDraftKey(user.id, state.sessionId), JSON.stringify(draft));
    } catch (_) { /* quota ou indispo */ }
  }, [user, state, timerSeconds]);

  // ── Timer global : tourne tant que timerActive est vrai ──
  // Mis à jour 1×/seconde (entier). Suffisant pour la mini-card, le persist
  // localStorage, et tout consommateur "tranquille". La page Workout veut
  // afficher les centièmes — elle utilisera useTimerHighPrecision (cf.
  // export du hook ci-dessous) qui tick beaucoup plus rapidement, mais
  // localement à son composant pour ne pas faire re-render toute l'app.
  useEffect(() => {
    if (!state.timerActive || !state.startedAt) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - state.startedAt) / 1000) + state.pausedTime;
      setTimerSeconds(elapsed);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state.timerActive, state.startedAt, state.pausedTime]);

  // ── Actions ───────────────────────────────────────────────────────
  /**
   * Démarre un nouveau workout depuis zéro (appel API `start` inclus).
   * Si un workout est déjà actif, l'appelant est censé avoir géré le
   * "abandonner l'ancien ?" en amont (cf. hasActive ci-dessous).
   */
  const start = useCallback(async (sessionId, options = {}) => {
    const { isEmptyWorkout = false } = options;
    // Démarrer un workout from scratch : on remet le compteur d'ids custom
    // à -1 (le premier ajout sera donc -2). Comme les exos de la séance
    // template ont des ids positifs (BDD), aucune collision possible avec
    // ce reset.
    _customIdCounter = -1;

    // Charge la session
    const sessResp = await sessionService.getById(sessionId);
    const loadedSession = sessResp.data.session;

    // Démarre le workout côté API
    const wResp = await workoutService.start(sessionId);
    const performances = {};
    (wResp.data.last_performances || []).forEach(p => { performances[p.id] = p.last_performance; });

    // Charge les amis (best effort)
    let friendsList = [];
    try {
      const fResp = await friendsService.getFriends();
      friendsList = fResp.data.friends || [];
    } catch (_) {}

    // Charge le catalogue d'exos (best effort)
    let allExos = loadedSession.exercises || [];
    try {
      const aResp = await sessionService.getAllExercises();
      const fetched = aResp.data.exercises || [];
      if (fetched.length > 0) {
        allExos = fetched.map(e => ({
          ...e,
          sets: e.sets && e.sets > 0 ? e.sets : 3,
          reps_min: e.reps_min && e.reps_min > 0 ? e.reps_min : 8,
          reps_max: e.reps_max && e.reps_max > 0 ? e.reps_max : 12,
          rest_time: e.rest_time && e.rest_time > 0 ? e.rest_time : 90,
        }));
      }
    } catch (_) {}

    // Heuristique séance vide
    const detectedEmpty = isEmptyWorkout || (loadedSession.exercises || []).length === 0;

    setStateRaw({
      ...initialState(),
      sessionId,
      session:      loadedSession,
      sessionName:  loadedSession.name || '',
      workoutId:    wResp.data.workout_id,
      isEmptyWorkout: detectedEmpty,
      exercises:    loadedSession.exercises || [],
      lastPerformances: performances,
      friends:      friendsList,
      allExercises: allExos,
      // On démarre le timer immédiatement
      timerActive:  true,
      startedAt:    Date.now(),
      pausedTime:   0,
    });
    setTimerSeconds(0);
    isHydratedRef.current = true;
  }, []);

  /**
   * Quand on (ré)entre sur la page Workout pour une session déjà active
   * dans le state, on n'a pas besoin de redémarrer ; mais on peut vouloir
   * recharger la session depuis l'API si elle est manquante (cas du
   * boot avec brouillon : on a chargé le brouillon mais pas la session).
   */
  const ensureSessionLoaded = useCallback(async () => {
    const s = stateRef.current;
    if (!s.sessionId || s.session) return;
    try {
      const sessResp = await sessionService.getById(s.sessionId);
      setState({ session: sessResp.data.session, sessionName: sessResp.data.session.name || '' });
    } catch (_) {}
    // Charge les amis si pas encore fait
    if ((s.friends || []).length === 0) {
      try {
        const fResp = await friendsService.getFriends();
        setState({ friends: fResp.data.friends || [] });
      } catch (_) {}
    }
    // Charge le catalogue d'exos si pas encore fait
    if ((s.allExercises || []).length === 0) {
      try {
        const aResp = await sessionService.getAllExercises();
        const fetched = aResp.data.exercises || [];
        if (fetched.length > 0) {
          const allExos = fetched.map(e => ({
            ...e,
            sets: e.sets && e.sets > 0 ? e.sets : 3,
            reps_min: e.reps_min && e.reps_min > 0 ? e.reps_min : 8,
            reps_max: e.reps_max && e.reps_max > 0 ? e.reps_max : 12,
            rest_time: e.rest_time && e.rest_time > 0 ? e.rest_time : 90,
          }));
          setState({ allExercises: allExos });
        }
      } catch (_) {}
    }
  }, [setState]);

  /**
   * Reprend le timer (après une pause silencieuse pour un brouillon
   * restauré).
   */
  const resumeTimer = useCallback(() => {
    setState(prev => {
      if (prev.timerActive) return prev;
      return { ...prev, timerActive: true, startedAt: Date.now() };
    });
  }, [setState]);

  const pauseTimer = useCallback(() => {
    setState(prev => {
      if (!prev.timerActive) return prev;
      const elapsed = prev.startedAt ? Math.floor((Date.now() - prev.startedAt) / 1000) : 0;
      return { ...prev, timerActive: false, pausedTime: prev.pausedTime + elapsed, startedAt: null };
    });
  }, [setState]);

  /** Remet le chrono à zéro (et le met en pause). */
  const resetTimer = useCallback(() => {
    setState(prev => ({ ...prev, timerActive: false, startedAt: null, pausedTime: 0 }));
    setTimerSeconds(0);
  }, [setState]);

  /** Termine et nettoie le state (ne fait pas l'appel API — c'est au caller). */
  const clear = useCallback(() => {
    if (user && stateRef.current.sessionId) {
      try { localStorage.removeItem(getDraftKey(user.id, stateRef.current.sessionId)); } catch (_) {}
    }
    setStateRaw(initialState());
    setTimerSeconds(0);
  }, [user]);

  /** Setters façon React.useState : acceptent valeur ou updater. */
  const setExercises = useCallback((updater) => {
    setStateRaw(prev => ({ ...prev, exercises: typeof updater === 'function' ? updater(prev.exercises) : updater }));
  }, []);
  const setExtraSets = useCallback((updater) => {
    setStateRaw(prev => ({ ...prev, extraSets: typeof updater === 'function' ? updater(prev.extraSets) : updater }));
  }, []);
  const setCurrentSets = useCallback((updater) => {
    setStateRaw(prev => ({ ...prev, currentSets: typeof updater === 'function' ? updater(prev.currentSets) : updater }));
  }, []);
  const setValidatedSets = useCallback((updater) => {
    setStateRaw(prev => ({ ...prev, validatedSets: typeof updater === 'function' ? updater(prev.validatedSets) : updater }));
  }, []);
  const setRestOverrides = useCallback((updater) => {
    setStateRaw(prev => ({ ...prev, restOverrides: typeof updater === 'function' ? updater(prev.restOverrides) : updater }));
  }, []);
  const setNotes = useCallback((updater) => {
    setStateRaw(prev => ({ ...prev, notes: typeof updater === 'function' ? updater(prev.notes) : updater }));
  }, []);
  const setSelectedParticipants = useCallback((updater) => {
    setStateRaw(prev => ({ ...prev, selectedParticipants: typeof updater === 'function' ? updater(prev.selectedParticipants) : updater }));
  }, []);

  const setLastPerformances = useCallback((updater) => {
    setStateRaw(prev => ({ ...prev, lastPerformances: typeof updater === 'function' ? updater(prev.lastPerformances) : updater }));
  }, []);

  const startCountdown = useCallback((restSeconds) => {
    setState({
      countdownEndAt:    Date.now() + restSeconds * 1000,
      countdownDuration: restSeconds,
    });
  }, [setState]);
  const dismissCountdown = useCallback(() => {
    setState({ countdownEndAt: null, countdownDuration: 0 });
  }, [setState]);

  const value = {
    // State (lecture)
    state,
    timerSeconds,
    hasActive: !!state.sessionId,

    // Actions
    start,
    ensureSessionLoaded,
    resumeTimer,
    pauseTimer,
    resetTimer,
    clear,

    // Setters granulaires (façon useState)
    setExercises,
    setExtraSets,
    setCurrentSets,
    setValidatedSets,
    setRestOverrides,
    setNotes,
    setSelectedParticipants,
    setLastPerformances,

    // Countdown
    startCountdown,
    dismissCountdown,
  };

  return (
    <ActiveWorkoutContext.Provider value={value}>
      {children}
    </ActiveWorkoutContext.Provider>
  );
};

export const useActiveWorkout = () => {
  const ctx = useContext(ActiveWorkoutContext);
  if (!ctx) throw new Error('useActiveWorkout doit être utilisé dans <ActiveWorkoutProvider>');
  return ctx;
};

/**
 * Variante haute fréquence du chrono : retourne le temps écoulé en secondes
 * **en nombre flottant** (avec centièmes), mis à jour ~30 fois par seconde.
 *
 * À utiliser uniquement dans le composant qui affiche le chrono détaillé
 * (page Workout) — pas dans la mini-card ni les autres consumers, sinon
 * tout l'app re-rendrait 30 fois par seconde.
 *
 * Le state interne vit dans le composant qui appelle ce hook, donc le
 * coût du re-render est localisé.
 */
export const useTimerHighPrecision = () => {
  const ctx = useContext(ActiveWorkoutContext);
  if (!ctx) throw new Error('useTimerHighPrecision doit être utilisé dans <ActiveWorkoutProvider>');
  const { state } = ctx;
  const [secs, setSecs] = useState(() => state.pausedTime || 0);

  useEffect(() => {
    if (!state.timerActive || !state.startedAt) {
      // En pause : on fixe la valeur à pausedTime et on ne tick pas.
      setSecs(state.pausedTime || 0);
      return;
    }
    let timeoutId = null;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const elapsed = (Date.now() - state.startedAt) / 1000 + state.pausedTime;
      setSecs(elapsed);
      // Tick à ~30Hz : suffisant pour montrer les centièmes en mouvement
      // sans saturer le CPU/le re-render. requestAnimationFrame serait
      // ~60Hz, donc on utilise setTimeout(33ms) pour throttle.
      timeoutId = setTimeout(tick, 33);
    };
    tick();
    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [state.timerActive, state.startedAt, state.pausedTime]);

  return secs;
};

export default ActiveWorkoutContext;