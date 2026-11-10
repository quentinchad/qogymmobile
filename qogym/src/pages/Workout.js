import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { sessionService, workoutService } from '../services/api';
import RestTimePicker from '../components/RestTimePicker';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { useActiveWorkout, useTimerHighPrecision, newCustomId } from '../contexts/ActiveWorkoutContext';
import { groupBySupersets, supersetLetter, linkWithNext, unlinkAtIndex, normalizeOrphans, normSupersetGroup, getSupersetMembers } from '../utils/supersets';
import { bestOneRepMax } from '../utils/oneRepMax';
import OneRepMaxBadge from '../components/OneRepMaxBadge';
import './Workout.css';

const formatRestTime = (seconds) => {
  if (!seconds || seconds === 0) return 'Pas de repos';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `${mins}min`;
  return `${mins}m${secs.toString().padStart(2, '0')}`;
};

const LONG_PRESS_MS = 400;
const AUTOSCROLL_EDGE_PX = 56;   // zone (px) près des bords de la liste qui déclenche le défilement auto
const AUTOSCROLL_SPEED_PX = 9;   // vitesse de défilement auto, en px par frame

const Workout = ({ user }) => {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  // Ouvre la page de progression de l'exercice (utilisateur connecté).
  const openExerciseProgress = (name) => {
    if (!user || !name) return;
    navigate(`/exercises/${user.id}/${encodeURIComponent(name)}`);
  };
  const location = useLocation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  // ── State du workout : tout vit dans le ActiveWorkoutContext ──
  // (le state survit à toute navigation tant que le Provider est monté,
  // ce qui permet la mini-card en bas et la "réduction" du workout)
  const aw = useActiveWorkout();
  const {
    state, timerSeconds, hasActive,
    start: startWorkout,
    ensureSessionLoaded,
    resumeTimer, pauseTimer,
    clear: clearWorkout,
    setExercises, setExtraSets, setCurrentSets, setValidatedSets,
    setRestOverrides, setNotes, setSelectedParticipants,
    startCountdown, dismissCountdown,
  } = aw;

  // Chrono haute précision (centièmes) — uniquement pour l'affichage de la
  // page Workout. La mini-card et le persist localStorage continuent à
  // utiliser `timerSeconds` à 1Hz.
  const timerSecondsHP = useTimerHighPrecision();

  // Aliases pour minimiser le diff avec le code existant
  const session              = state.session;
  const workoutId            = state.workoutId;
  const isEmptyWorkout       = state.isEmptyWorkout;
  const lastPerformances     = state.lastPerformances || {};
  const currentSets          = state.currentSets || {};
  const validatedSets        = state.validatedSets || {};
  const exercises            = state.exercises || [];
  const extraSets            = state.extraSets || {};
  const restOverrides        = state.restOverrides || {};
  const notes                = state.notes || '';
  const selectedParticipants = state.selectedParticipants || [];
  const friends              = state.friends || [];
  const allExercises         = state.allExercises || [];
  const timerActive          = state.timerActive;

  // ── State local UI (éphémère, pas besoin de survivre à la nav) ──
  const [loading, setLoading] = useState(true);
  const [showAddFriends, setShowAddFriends] = useState(false);
  const [editingRest, setEditingRest] = useState(null);
  // Sauvegarde "engagement final" en cours : on bloque l'UI avec un overlay
  // tant que l'appel API n'a pas rendu. Évite double-clic, navigation
  // accidentelle, ou interaction avec un state à moitié figé.
  const [isSaving, setIsSaving] = useState(false);

  const [showAddExercise, setShowAddExercise] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseSets, setNewExerciseSets] = useState(3);

  // ── Reorder mode ──
  const [reorderMode, setReorderMode] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState(null);   // ligne tenue (souris)
  const [dragOverIdx, setDragOverIdx] = useState(null);   // ligne survolée (souris)
  const [draggingId, setDraggingId] = useState(null);     // exo tenu (tactile, suit par id)
  const longPressTimer = useRef(null);
  const longPressActive = useRef(false);
  const dragItem = useRef(null);
  const dragOver = useRef(null);
  const touchStartIdx = useRef(null);
  const touchCurrentIdx = useRef(null);
  const reorderListRef = useRef(null);       // conteneur scrollable (.reorder-list)
  const dragElRef = useRef(null);             // noeud DOM de la ligne tactile tenue
  const draggedIdRef = useRef(null);          // id de l'exo tactile tenu
  const grabOffsetY = useRef(0);              // offset vertical doigt ↔ haut de la ligne
  const lastAppliedTransformY = useRef(0);    // dernier translateY appliqué à la ligne tenue
  const autoScrollDir = useRef(0);            // -1 / 0 / 1
  const autoScrollRAF = useRef(null);
  const animPointerTimers = useRef(new Map()); // node -> timeoutId (restauration pointer-events)

  useEffect(() => {
    return () => {
      if (autoScrollRAF.current !== null) cancelAnimationFrame(autoScrollRAF.current);
      animPointerTimers.current.forEach((t) => clearTimeout(t));
      animPointerTimers.current.clear();
    };
  }, []);

  // ── Countdown : dérivé du context (countdownEndAt + countdownDuration) ──
  // On retick souvent pour que l'anneau de progression bouge en douceur.
  const countdownEndAt    = state.countdownEndAt;
  const countdownDuration = state.countdownDuration || 0;
  const [, setCountdownTick] = useState(0);
  useEffect(() => {
    if (!countdownEndAt) return;
    const id = setInterval(() => setCountdownTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, [countdownEndAt]);
  // Temps restant — entier pour l'affichage du chiffre, flottant pour l'anneau
  const countdownRemainingMs = countdownEndAt
    ? Math.max(0, countdownEndAt - Date.now())
    : 0;
  const countdownRemaining = countdownEndAt
    ? Math.max(0, Math.ceil(countdownRemainingMs / 1000))
    : null;
  const countdownActive = countdownRemaining !== null && countdownRemaining > 0;
  const countdown = countdownRemaining;
  // Ratio de progression (0 = vient de démarrer, 1 = terminé)
  const countdownProgress = countdownDuration > 0
    ? Math.min(1, 1 - countdownRemainingMs / (countdownDuration * 1000))
    : 0;
  const [countdownFinished, setCountdownFinished] = useState(false);
  // Quand le countdown atteint 0, déclencher le "FINI" et le reset
  useEffect(() => {
    if (countdownEndAt && countdownRemaining === 0) {
      dismissCountdown();
      setCountdownFinished(true);
      const id = setTimeout(() => setCountdownFinished(false), 3000);
      return () => clearTimeout(id);
    }
  }, [countdownEndAt, countdownRemaining, dismissCountdown]);

  // ── Fix : reset l'état "✓ FINI" dès qu'un nouveau countdown démarre ──
  // Sans ça, si l'utilisateur valide la 2e série pendant les 3s d'affichage
  // du "✓" de la 1re série, l'anneau resterait coincé sur "✓" pendant le
  // restant du timeout (au lieu d'afficher le décompte du nouveau repos).
  // Il suffit donc de remettre countdownFinished à false dès que
  // countdownEndAt repasse à une valeur non-null.
  useEffect(() => {
    if (countdownEndAt) setCountdownFinished(false);
  }, [countdownEndAt]);

  // ── Bip sonore de fin de repos ──
  // Se déclenche à chaque seconde entre 5s et 1s restantes, plus un bip
  // final (un peu plus aigu/long) quand le repos se termine, pour signaler
  // qu'il faut reprendre l'exercice. Activable/désactivable, préférence
  // persistée en localStorage pour survivre à la navigation/reload.
  const BEEP_STORAGE_KEY = 'qogym_restBeepEnabled';
  const [beepEnabled, setBeepEnabled] = useState(() => {
    try { return localStorage.getItem(BEEP_STORAGE_KEY) !== '0'; }
    catch { return true; }
  });
  const audioCtxRef = useRef(null);
  const lastBeepedSecondRef = useRef(null);
  const audioUnlockedRef = useRef(false);
  const audioWarnedRef = useRef(false);

  const toggleBeepEnabled = () => {
    unlockAudio();
    setBeepEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(BEEP_STORAGE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  };

  // ── Déverrouillage audio ──
  // La WebView de l'APK (React Native) est plus stricte qu'un navigateur
  // normal : un AudioContext créé/repris depuis un simple setInterval (donc
  // hors d'un vrai tap utilisateur) reste souvent bloqué en 'suspended' et
  // ne joue jamais rien, silencieusement. On "déverrouille" donc l'audio en
  // jouant un son réel (pas juste resume()) au tout premier vrai tap de la
  // séance — bouton Démarrer, toggle du bip, ou validation d'une série.
  const unlockAudio = () => {
    if (audioUnlockedRef.current) return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      // Un blip très court et quasi inaudible mais bien réel : certains
      // moteurs WebView exigent un son effectivement audible (pas un gain
      // à 0) pour considérer l'audio comme "déverrouillé".
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      osc.frequency.value = 1000;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.03);
      audioUnlockedRef.current = true;
    } catch {
      // Si ça échoue ici, playBeep échouera aussi et affichera l'alerte
      // de diagnostic ci-dessous.
    }
  };

  const playBeep = (frequency = 1000, durationMs = 90) => {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Onde carrée = riche en harmoniques → sonne comme un vrai "bip"
      // électronique, beaucoup plus perçant qu'un sinus et donc plus
      // capable de percer par-dessus de la musique forte.
      osc.type = 'square';
      osc.frequency.value = frequency;
      const t0 = ctx.currentTime;
      const durationSec = durationMs / 1000;
      // Attaque quasi instantanée (pas de fondu doux) + palier au volume
      // max, puis coupure nette juste avant la fin. Un vrai bip est
      // "carré" dans le temps, pas un fade in/out mou.
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.9, t0 + 0.005);
      gain.gain.setValueAtTime(0.9, t0 + durationSec - 0.015);
      gain.gain.linearRampToValueAtTime(0, t0 + durationSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + durationSec + 0.02);
    } catch (err) {
      // Diagnostic visible une seule fois par session : dans l'APK on n'a
      // pas de console facilement accessible, donc on remonte l'erreur via
      // un toast pour comprendre pourquoi le son ne sort pas.
      if (!audioWarnedRef.current) {
        audioWarnedRef.current = true;
        showToast(`Bip audio indisponible : ${err?.message || err}`, 'error');
      }
    }
    // Vibration en backup : indépendante du volume, donc perçue même si
    // la musique couvre complètement le son (silencieux sur iOS Safari,
    // qui n'implémente pas l'API Vibration, mais gratuit sur Android/Chrome).
    if (navigator.vibrate) {
      try { navigator.vibrate(durationMs); } catch {}
    }
  };

  // Bip à chaque nouvelle seconde entre 5 et 1
  useEffect(() => {
    if (!beepEnabled) return;
    if (!countdownActive) { lastBeepedSecondRef.current = null; return; }
    if (
      countdown >= 1 && countdown <= 5 &&
      lastBeepedSecondRef.current !== countdown
    ) {
      lastBeepedSecondRef.current = countdown;
      playBeep(1000, 90);
    }
  }, [countdown, countdownActive, beepEnabled]);

  // Bip final : double bip plus aigu pour bien marquer "GO, reprends l'exo"
  const prevCountdownFinishedRef = useRef(false);
  useEffect(() => {
    if (beepEnabled && countdownFinished && !prevCountdownFinishedRef.current) {
      playBeep(1400, 100);
      setTimeout(() => playBeep(1400, 140), 150);
    }
    prevCountdownFinishedRef.current = countdownFinished;
  }, [countdownFinished, beepEnabled]);

  // ── Démarrage / reprise du workout pour le sessionId d'URL ──
  // 3 cas :
  //  1. Le context a déjà cet sessionId (workout en cours, on revient
  //     dessus depuis la mini-card) → ne rien faire, juste rendre.
  //  2. Le context a un AUTRE sessionId actif → demander si abandonner
  //     l'ancien pour démarrer le nouveau.
  //  3. Le context est vide → start direct.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setLoading(false); return; }

      if (state.sessionId === sessionId) {
        // Cas 1 : on est déjà sur ce workout. On s'assure juste que la
        // session est bien chargée (cas restauration depuis brouillon
        // au boot de l'app, où on a chargé le draft mais pas encore la
        // session API).
        await ensureSessionLoaded();
        // Le timer était mis en pause par la restauration de brouillon ;
        // on le reprend automatiquement à l'ouverture de la page.
        if (!cancelled && !state.timerActive) resumeTimer();
        if (!cancelled) setLoading(false);
        return;
      }

      if (state.sessionId && state.sessionId !== sessionId) {
        // Cas 2 : un autre workout est actif. Demande à l'utilisateur.
        const ok = await confirm({
          title: 'Abandonner l\'entraînement en cours ?',
          message:
            `Tu as déjà un entraînement en cours (${state.sessionName || 'séance précédente'}). ` +
            `Démarrer une nouvelle séance abandonnera celui-ci. Continuer ?`,
          confirmLabel: 'Démarrer la nouvelle',
          cancelLabel: 'Garder l\'ancien',
          variant: 'danger',
        });
        if (cancelled) return;
        if (!ok) {
          navigate(`/workout/${state.sessionId}`, { replace: true });
          return;
        }
        clearWorkout();
      }

      // Cas 3 : démarre un nouveau workout
      try {
        const wasIntentEmpty = !!location.state?.isEmptyWorkout;
        await startWorkout(sessionId, { isEmptyWorkout: wasIntentEmpty });
        if (cancelled) return;
        // Si on est arrivé via "Lancer une séance vide" OU si le template
        // n'a aucun exercice, on ouvre auto la modale d'ajout.
        // (On ne peut pas lire `aw.state` ici car c'est une closure stale ;
        //  on regarde donc `wasIntentEmpty` qui suffit dans 99% des cas.
        //  Le cas restant — template vide sans flag — est rare et sera
        //  géré la prochaine fois que l'utilisateur tape "+ exercice".)
        if (wasIntentEmpty) setShowAddExercise(true);
      } catch (err) {
        if (!cancelled) {
          showToast("Erreur lors du démarrage de l\'entraînement", 'error');
          navigate('/sessions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, user]);

  // Si le workout vient juste d'être chargé et que le template n'a aucun
  // exercice (cas séance vide récupérée par heuristique), on ouvre auto
  // la modale d'ajout.
  const sawEmptyOnceRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (sawEmptyOnceRef.current) return;
    if (state.sessionId === sessionId && state.exercises.length === 0) {
      sawEmptyOnceRef.current = true;
      setShowAddExercise(true);
    }
  }, [loading, state.sessionId, sessionId, state.exercises.length]);

  const handleValidateSet = (exerciseId, setNumber, effectiveRest) => {
    unlockAudio();
    const key = `${exerciseId}-${setNumber}`;
    const alreadyValidated = validatedSets[key];
    setValidatedSets(prev => {
      if (alreadyValidated) { const n = { ...prev }; delete n[key]; return n; }
      return { ...prev, [key]: true };
    });
    if (alreadyValidated) return;

    const idx = exercises.findIndex(e => String(e.id) === String(exerciseId));

    // ── Repos partagé pour les supersets ──
    // Un superset n'a qu'UN SEUL temps de repos, celui du premier exo du
    // groupe (convention : c'est lui qui "porte" le repos affiché dans
    // l'en-tête du superset). Ce repos se déclenche à CHAQUE validation de
    // série, peu importe quel exo du groupe vient d'être validé — plus
    // besoin d'attendre que tout le round soit complet.
    if (idx >= 0) {
      const members = getSupersetMembers(exercises, idx);
      if (members.length > 1) {
        const firstMember = members[0];
        const sharedRest = restOverrides[firstMember.id] !== undefined
          ? restOverrides[firstMember.id]
          : (firstMember.rest_time || 0);
        if (sharedRest > 0) startCountdown(sharedRest);
        return;
      }
    }

    // Exo solo : comportement normal.
    if (effectiveRest > 0) startCountdown(effectiveRest);
  };

  /* ── Sets helpers ── */
  const getTotalSets = (exercise) =>
    extraSets[exercise.id] !== undefined ? extraSets[exercise.id] : (parseInt(exercise.sets) || 1);

  const addSet = (exerciseId) => {
    const ex = exercises.find(e => e.id === exerciseId);
    if (!ex) return;
    setExtraSets(prev => ({ ...prev, [exerciseId]: getTotalSets(ex) + 1 }));
  };

  const removeSet = (exerciseId) => {
    const ex = exercises.find(e => e.id === exerciseId);
    if (!ex) return;
    const current = getTotalSets(ex);
    if (current <= 1) return;
    setExtraSets(prev => ({ ...prev, [exerciseId]: current - 1 }));
    const key = `${exerciseId}-${current}`;
    setValidatedSets(prev => { const n = { ...prev }; delete n[key]; return n; });
    setCurrentSets(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  /* ── Rest editing (wheel picker) ── */
  const startEditRest = (exercise) => {
    setEditingRest(exercise.id);
  };

  const commitEditRest = (exerciseId, val) => {
    if (typeof val === 'number' && !isNaN(val) && val >= 0) {
      setRestOverrides(prev => ({ ...prev, [exerciseId]: val }));
    }
  };

  const closeEditRest = () => setEditingRest(null);

  /* ── Add / Remove exercise ── */
  const handleAddExercise = (exo) => {
    const newId = newCustomId();
    setExercises(prev => [...prev, {
      id: newId, name: exo.name,
      sets: exo.sets || newExerciseSets,
      reps_min: exo.reps_min || 8, reps_max: exo.reps_max || 12,
      rest_time: exo.rest_time || 90,
      // Utiliser prev.length plutôt que la valeur fermée par closure
      // (`exercises.length`) pour être correct si deux ajouts s'enchaînent
      // avant un re-render. La vraie source de vérité est de toute façon
      // l'index dans la liste au moment du `complete` (display_order =
      // idx+1 calculé là-bas), mais cohérence vaut mieux qu'une demi-stale.
      exercise_order: prev.length + 1,
      // Toujours forcer superset_group à null pour un nouvel exo : il ne
      // doit JAMAIS hériter d'une valeur de l'objet `exo` source (qui peut
      // venir d'une autre séance où il était grouped).
      superset_group: null,
      _custom: true,
      // Un exo ajouté à la main n'a pas d'entrée dans `lastPerformances`
      // (ce map est scopé à la séance-type via l'action `start`). On
      // reporte donc ici la `last_performance` globale déjà renvoyée par
      // l'endpoint `all_exercises` (dernière fois que CET exo a été fait,
      // peu importe la séance) — pas besoin d'un nouvel appel réseau.
      last_performance: exo.last_performance || null,
    }]);
    setShowAddExercise(false); setExerciseSearch(''); setNewExerciseName(''); setNewExerciseSets(3);
  };

  const handleAddCustomExercise = () => {
    const name = newExerciseName.trim();
    if (!name) return;
    handleAddExercise({ name, sets: newExerciseSets });
  };

  const handleRemoveExercise = async (exerciseId) => {
    const ok = await confirm({
      title: 'Retirer cet exercice ?',
      message: 'L\'exercice sera retiré de cet entraînement (la séance d\'origine n\'est pas modifiée).',
      confirmLabel: 'Retirer',
      cancelLabel: 'Annuler',
      variant: 'danger',
    });
    if (!ok) return;
    setExercises(prev => normalizeOrphans(prev.filter(e => e.id !== exerciseId)));
  };

  // Lier l'exo (par id) au suivant dans la liste pour former / étendre un superset.
  const handleLinkNextWorkout = (exerciseId) => {
    setExercises(prev => {
      const idx = prev.findIndex(e => String(e.id) === String(exerciseId));
      if (idx < 0) return prev;
      return linkWithNext(prev, idx);
    });
  };

  // Délier l'exo de son superset.
  const handleUnlinkWorkout = (exerciseId) => {
    setExercises(prev => {
      const idx = prev.findIndex(e => String(e.id) === String(exerciseId));
      if (idx < 0) return prev;
      return normalizeOrphans(unlinkAtIndex(prev, idx));
    });
  };

  /* ══════════════════════════════════════════
     LONG PRESS → REORDER MODE
  ══════════════════════════════════════════ */
  const handleExoLongPressStart = (e) => {
    longPressActive.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressActive.current = true;
      // Vibrate if supported
      if (navigator.vibrate) navigator.vibrate(40);
      setReorderMode(true);
    }, LONG_PRESS_MS);
  };

  const handleExoLongPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handleExoLongPressCancel = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  /* ── Drag inside reorder overlay (mouse) ── */
  const handleDragStart = (idx) => { dragItem.current = idx; setDraggingIdx(idx); };
  const handleDragEnter = (idx) => { dragOver.current = idx; setDragOverIdx(idx); };
  const handleDragEnd = () => {
    applyReorder(dragItem.current, dragOver.current);
    dragItem.current = null; dragOver.current = null;
    setDraggingIdx(null); setDragOverIdx(null);
  };

  /* ── Auto-scroll de la liste quand on drag près d'un bord (tactile) ── */
  const stepAutoScroll = () => {
    const list = reorderListRef.current;
    if (!list || autoScrollDir.current === 0) {
      autoScrollRAF.current = null;
      return;
    }
    list.scrollTop += autoScrollDir.current * AUTOSCROLL_SPEED_PX;
    autoScrollRAF.current = requestAnimationFrame(stepAutoScroll);
  };

  const updateAutoScroll = (clientY) => {
    const list = reorderListRef.current;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    let dir = 0;
    if (clientY < rect.top + AUTOSCROLL_EDGE_PX) dir = -1;
    else if (clientY > rect.bottom - AUTOSCROLL_EDGE_PX) dir = 1;
    autoScrollDir.current = dir;
    if (dir !== 0 && autoScrollRAF.current === null) {
      autoScrollRAF.current = requestAnimationFrame(stepAutoScroll);
    }
  };

  const stopAutoScroll = () => {
    autoScrollDir.current = 0;
    if (autoScrollRAF.current !== null) {
      cancelAnimationFrame(autoScrollRAF.current);
      autoScrollRAF.current = null;
    }
  };

  /* ── Touch drag inside reorder overlay ──
     La ligne tenue suit le doigt en direct, et l'ordre du tableau est mis
     à jour en live dès qu'on survole une autre ligne (pas seulement au
     relâché) : les autres lignes glissent pour faire de la place, via une
     petite animation FLIP (mesure avant/après + transform inversé). */
  const handleReorderTouchStart = (e, idx) => {
    e.stopPropagation();
    const row = e.currentTarget.closest('[data-reorder-idx]');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    dragElRef.current = row;
    draggedIdRef.current = exercises[idx]?.id ?? null;
    grabOffsetY.current = e.touches[0].clientY - rect.top;
    lastAppliedTransformY.current = 0;
    touchStartIdx.current = idx;
    touchCurrentIdx.current = idx;
    row.style.transition = 'none';
    row.style.willChange = 'transform';
    row.style.zIndex = '5';
    setDraggingId(draggedIdRef.current);
  };

  const liveMoveTo = (toIdx) => {
    const id = draggedIdRef.current;
    const list = reorderListRef.current;
    if (id == null || !list) return;

    // FIRST — position actuelle de toutes les lignes sauf celle qu'on tient
    const before = new Map();
    list.querySelectorAll('.reorder-row').forEach((node) => {
      const nodeId = node.getAttribute('data-reorder-id');
      if (nodeId && nodeId !== String(id)) {
        before.set(nodeId, node.getBoundingClientRect().top);
      }
    });

    // LAST — on applique le nouvel ordre de façon synchrone
    flushSync(() => {
      setExercises((prev) => {
        const fromIdx = prev.findIndex((ex) => String(ex.id) === String(id));
        if (fromIdx === -1 || fromIdx === toIdx) return prev;
        const arr = [...prev];
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
        return normalizeOrphans(arr);
      });
    });

    // INVERT + PLAY — on repart de l'ancienne position (sans transition) puis
    // on relâche vers la nouvelle : le navigateur anime la différence.
    // Lectures et écritures DOM sont groupées séparément (un seul reflow forcé
    // pour tout le lot) pour éviter le "layout thrashing" ligne par ligne.
    const toAnimate = [];
    list.querySelectorAll('.reorder-row').forEach((node) => {
      const nodeId = node.getAttribute('data-reorder-id');
      if (!nodeId || nodeId === String(id)) return;
      const prevTop = before.get(nodeId);
      if (prevTop == null) return;
      const delta = prevTop - node.getBoundingClientRect().top; // lecture
      if (Math.abs(delta) >= 1) toAnimate.push({ node, delta });
    });
    toAnimate.forEach(({ node, delta }) => {
      // Une ligne en cours de glissement reste visuellement "à l'ancienne
      // place" pendant la transition alors que son data-reorder-idx est
      // déjà à jour : si le doigt reste au-dessus pendant ce court instant,
      // elementFromPoint la retrouve avec son NOUVEL index et redéclenche
      // aussitôt un réordonnancement (souvent l'inverse) → aller-retours
      // rapides. On la rend donc insensible au hit-test tant qu'elle glisse.
      const pendingTimer = animPointerTimers.current.get(node);
      if (pendingTimer) clearTimeout(pendingTimer);
      node.style.pointerEvents = 'none';
      node.style.transition = 'none';
      node.style.transform = `translateY(${delta}px)`;
    });
    if (toAnimate.length) {
      void list.offsetHeight; // un seul reflow forcé pour tout le lot
      requestAnimationFrame(() => {
        toAnimate.forEach(({ node }) => {
          node.style.transition = '';
          node.style.transform = '';
        });
        toAnimate.forEach(({ node }) => {
          const timer = window.setTimeout(() => {
            node.style.pointerEvents = '';
            animPointerTimers.current.delete(node);
          }, 240);
          animPointerTimers.current.set(node, timer);
        });
      });
    }
  };

  const handleReorderTouchMove = (e) => {
    if (touchStartIdx.current === null) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = dragElRef.current;

    // 1) Réordonnancement live si le doigt est passé sur une autre ligne
    //    (avant de repositionner la ligne tenue, pour éviter un saut visuel).
    //    La ligne tenue suit le doigt (étape 2), donc elle se trouve pile
    //    sous lui : sans ce petit détour, elementFromPoint se détecte elle-
    //    même au lieu de la ligne réellement en dessous, et rien ne bouge
    //    jamais. On la rend momentanément "transparente" au hit-test.
    if (el) el.style.pointerEvents = 'none';
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el) el.style.pointerEvents = '';
    const row = target?.closest('[data-reorder-idx]');
    if (row) {
      const overIdx = parseInt(row.getAttribute('data-reorder-idx'), 10);
      if (!isNaN(overIdx) && overIdx !== touchCurrentIdx.current) {
        touchCurrentIdx.current = overIdx;
        liveMoveTo(overIdx);
      }
    }

    // 2) La ligne tenue suit le doigt (calculé sur sa position naturelle
    //    actuelle, donc après un éventuel réordonnancement ci-dessus)
    if (el) {
      const rect = el.getBoundingClientRect();
      const naturalTop = rect.top - lastAppliedTransformY.current;
      const newTransformY = (touch.clientY - grabOffsetY.current) - naturalTop;
      lastAppliedTransformY.current = newTransformY;
      el.style.transform = `translateY(${newTransformY}px) scale(1.02)`;
    }

    // 3) Auto-scroll si on approche d'un bord de la liste
    updateAutoScroll(touch.clientY);
  };

  const handleReorderTouchEnd = () => {
    const el = dragElRef.current;
    if (el) {
      el.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translateY(0) scale(1)';
      window.setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.zIndex = '';
        el.style.willChange = '';
      }, 240);
    }
    stopAutoScroll();
    // Le doigt est relâché : la protection anti-oscillation (voir liveMoveTo)
    // n'a plus lieu d'être, on redonne prise au toucher immédiatement plutôt
    // que d'attendre les 240ms de chaque timer en cours.
    animPointerTimers.current.forEach((timer, node) => {
      clearTimeout(timer);
      node.style.pointerEvents = '';
    });
    animPointerTimers.current.clear();
    touchStartIdx.current = null;
    touchCurrentIdx.current = null;
    draggedIdRef.current = null;
    dragElRef.current = null;
    lastAppliedTransformY.current = 0;
    setDraggingId(null);
  };

  const applyReorder = (from, to) => {
    if (from === null || to === null || from === to) return;
    const arr = [...exercises];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    // Réordonner peut casser un superset (un membre se retrouve sans
    // voisin partageant son group_id) → on nettoie les orphelins.
    setExercises(normalizeOrphans(arr));
  };

  /* ── Finish ── */
  const handleComplete = async () => {
    if (isSaving) return; // anti double-clic

    const ok = await confirm({
      title: 'Terminer cet entraînement ?',
      message: 'Tes performances seront enregistrées dans l\'historique.',
      confirmLabel: 'Terminer',
      cancelLabel: 'Continuer',
      variant: 'primary',
    });
    if (!ok) return;

    // ─────────────────────────────────────────────────────────────────
    // Phase 1 — ENGAGEMENT FINAL (atomique, ne doit jamais échouer
    // silencieusement). Dès qu'on atteint l'appel `complete` réussi,
    // l'entraînement est sauvegardé côté serveur. L'utilisateur peut
    // fermer l'app à tout moment APRÈS sans rien perdre.
    // ─────────────────────────────────────────────────────────────────

    // 1.a — Construire le snapshot d'ordre + sets custom (anciennement
    //        portés par `complete`).
    const exerciseOrder = exercises.map((ex, idx) => {
      const entry = {
        id: ex._custom ? null : ex.id,
        name: ex.name,
        display_order: idx + 1,
        is_custom: !!ex._custom,
        superset_group: normSupersetGroup(ex.superset_group),
      };
      if (ex._custom) {
        const totalSets = getTotalSets(ex);
        const setsData = [];
        for (let s = 1; s <= totalSets; s++) {
          const sd = currentSets[`${ex.id}-${s}`];
          if (sd && (sd.weight || sd.reps)) {
            setsData.push({
              set_number: s,
              weight: sd.weight ? parseFloat(sd.weight) : null,
              reps: sd.reps ? parseInt(sd.reps) : 0,
            });
          }
        }
        entry.sets_data = setsData;
      }
      return entry;
    });

    // 1.b — Construire la liste plate des sets pour les exos NON-custom.
    //        Anciennement envoyés un par un via `recordSet`, on les bundle
    //        désormais dans le payload `complete` pour atomicité.
    const nonCustomSets = [];
    for (const [key, setData] of Object.entries(currentSets)) {
      if (!setData.weight && !setData.reps) continue;
      const [exerciseId, setNumber] = key.split('-');
      const exercise = exercises.find(e => String(e.id) === exerciseId);
      if (!exercise || exercise._custom) continue;
      nonCustomSets.push({
        exercise_id: Number(exerciseId),
        set_number: Number(setNumber),
        weight: setData.weight || null,
        reps: setData.reps || 0,
      });
    }

    // 1.c — Détection des modifs vs. template (calculée AVANT clearWorkout
    //        car le state sera nettoyé après l'appel).
    const originalIds = (session?.exercises || [])
      .filter(e => !e._custom)
      .map(e => e.id);
    const currentNonCustomIds = exercises
      .filter(e => !e._custom)
      .map(e => e.id);
    const hasCustomExercises = exercises.some(e => e._custom);
    const orderChanged =
      originalIds.length !== currentNonCustomIds.length ||
      originalIds.some((id, i) => id !== currentNonCustomIds[i]);
    const originalSupersets = (session?.exercises || []).map(e => ({
      id: e.id, sg: normSupersetGroup(e.superset_group),
    }));
    const currentSupersets = exercises.filter(e => !e._custom).map(e => ({
      id: e.id, sg: normSupersetGroup(e.superset_group),
    }));
    const supersetsChanged = (() => {
      const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
      const buildPairs = (arr) => {
        const set = new Set();
        for (let i = 0; i < arr.length; i += 1) {
          for (let j = i + 1; j < arr.length; j += 1) {
            if (arr[i].sg !== null && arr[i].sg === arr[j].sg) {
              set.add(pairKey(String(arr[i].id), String(arr[j].id)));
            }
          }
        }
        return set;
      };
      const origPairs = buildPairs(originalSupersets);
      const currPairs = buildPairs(currentSupersets);
      if (origPairs.size !== currPairs.size) return true;
      for (const k of origPairs) if (!currPairs.has(k)) return true;
      return false;
    })();
    const hasModifications = hasCustomExercises || orderChanged || supersetsChanged;

    // Capture des valeurs nécessaires APRÈS clearWorkout (le state sera vidé)
    const capturedWorkoutId = workoutId;
    const capturedSessionId = sessionId;
    const capturedSessionName = session?.name || '';
    // Séance vide OU séance archivée (copie créée par "Lancer cette séance"
    // depuis le Feed/Profil, séance libre...) : on propose de l'enregistrer
    // dans la galerie à la fin.
    const capturedIsEmpty = isEmptyWorkout;
    const capturedIsArchived =
      Number(session?.is_archived) === 1 && Number(session?.is_owner) === 1;

    // 1.d — Appel atomique. Overlay "Enregistrement…" pendant.
    setIsSaving(true);
    try {
      await workoutService.complete(capturedWorkoutId, {
        notes,
        participants: selectedParticipants,
        exerciseOrder,
        nonCustomSets,
      });
    } catch (err) {
      setIsSaving(false);
      showToast("Erreur lors de la finalisation de l'entraînement", 'error');
      return; // on ne nettoie RIEN — l'utilisateur peut réessayer
    }

    // ✅ À ce stade, les perfs sont sauvegardées côté serveur. Tout ce qui
    //    suit est "best-effort" : si l'app se ferme, l'entraînement est
    //    déjà dans le Feed.

    // 1.e — Nettoie immédiatement le brouillon local. Toast.
    clearWorkout();
    setIsSaving(false);
    showToast('Entraînement enregistré ✓', 'success');

    // ─────────────────────────────────────────────────────────────────
    // Phase 2 — QUESTIONS OPTIONNELLES (mise à jour template / galerie).
    // Tout ce qui suit est BEST-EFFORT. Si l'utilisateur ferme l'app à
    // partir d'ici, les perfs sont déjà sauvegardées.
    // ─────────────────────────────────────────────────────────────────

    let shouldApplyChanges = false;
    let saveInGallery = false;

    if (capturedIsEmpty || capturedIsArchived) {
      // Séance libre / copie archivée : on demande si on l'ajoute à la galerie
      saveInGallery = !!(await confirm({
        title: 'Enregistrer cette séance ?',
        message:
          'Tu peux ajouter cette séance à ta galerie pour la refaire plus tard, ' +
          'ou simplement garder l\'historique de l\'entraînement dans le Feed.',
        confirmLabel: 'Enregistrer',
        cancelLabel: 'Juste l\'historique',
        variant: 'primary',
      }));
      if (saveInGallery) {
        if (capturedIsEmpty) {
          // Séance libre : renomme avec un nom auto basé sur l'heure
          // (une copie archivée garde le nom de la séance d'origine)
          const h = new Date().getHours();
          const moment =
            h < 5  ? 'de nuit' :
            h < 12 ? 'du matin' :
            h < 14 ? 'du midi' :
            h < 18 ? 'd\u2019après-midi' :
            h < 22 ? 'du soir' :
                     'de nuit';
          const autoName = `Entraînement ${moment}`;
          try {
            await sessionService.patch(capturedSessionId, { name: autoName });
          } catch (_) { /* non bloquant */ }
        }
        shouldApplyChanges = true;
      }
      // Si saveInGallery=false : la séance reste archivée (créée archivée
      // côté serveur lors du "start empty"). Rien à faire.
    } else if (hasModifications) {
      const parts = [];
      if (hasCustomExercises) parts.push('des exercices ajoutés');
      if (orderChanged) parts.push("l'ordre des exercices");
      if (supersetsChanged) parts.push('le regroupement en supersets');
      shouldApplyChanges = !!(await confirm({
        title: 'Mettre à jour la séance ?',
        message:
          `Tu as modifié cette séance (${parts.join(' et ')}). ` +
          `Veux-tu enregistrer les changements dans la séance "${capturedSessionName}" ` +
          `ou les garder uniquement pour cet entraînement ?`,
        confirmLabel: 'Mettre à jour',
        cancelLabel: 'Juste cet entraînement',
        variant: 'primary',
      }));
    }

    if (shouldApplyChanges) {
      try {
        await workoutService.applyTemplateChanges(capturedWorkoutId, exerciseOrder, saveInGallery);
      } catch (_) {
        // Non bloquant : les perfs sont déjà sauvées, on ne dérange pas
        // l'utilisateur avec une erreur sur un step optionnel. Au pire il
        // refera la modif manuellement plus tard.
      }
    }

    navigate('/sessions');
  };

  const toggleParticipant = (friendId) => {
    setSelectedParticipants(prev =>
      prev.includes(friendId) ? prev.filter(id => id !== friendId) : [...prev, friendId]
    );
  };

  const updateSetData = (exerciseId, setNumber, field, value) => {
    const key = `${exerciseId}-${setNumber}`;
    setCurrentSets(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const formatTime = (seconds) => {
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const centiseconds = Math.floor((seconds % 1) * 100);
    if (hours === 0) return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatCountdown = (seconds) => {
    if (seconds === null) return '';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Le timer global vit dans le context (startedAt/pausedTime/timerActive).
  // On expose des wrappers qui matchent l'ancienne API.
  const startTimer = () => { unlockAudio(); resumeTimer(); };
  const stopTimer  = () => pauseTimer();
  const resetTimer = () => {
    // Pause + remet à 0. Implémenté directement sur le state via un setter
    // dédié exposé ci-dessous (cf. ActiveWorkoutContext).
    aw.resetTimer && aw.resetTimer();
  };

  const filteredExercises = allExercises.filter(e =>
    e.name.toLowerCase().includes(exerciseSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Démarrage de l'entraînement...</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="workout-page">
      {/* Overlay "Enregistrement…" : bloque toute interaction pendant
          l'appel atomique `complete`. Disparaît dès que la sauvegarde
          est confirmée côté serveur. */}
      {isSaving && (
        <div className="workout-saving-overlay" role="alert" aria-live="assertive">
          <div className="workout-saving-card">
            <div className="workout-saving-spinner" aria-hidden="true" />
            <div className="workout-saving-label">Enregistrement…</div>
            <div className="workout-saving-hint">Ne ferme pas l'application</div>
          </div>
        </div>
      )}

      <div className="workout-header">
        <div>
          <h1 className="workout-title">{session.name}</h1>
          <p className="workout-subtitle">{session.session_type_name}</p>
        </div>
      </div>

      {/* ── Main Timer ── */}
      <div className="workout-timer card">
        {/* Bouton "réduire" en haut à droite, au-dessus du chrono.
            L'entraînement continue en arrière-plan via la mini-card. */}
        <button
          type="button"
          className="workout-minimize-btn"
          onClick={() => navigate('/sessions')}
          aria-label="Réduire l'entraînement"
          title="Réduire (l'entraînement continue en arrière-plan)"
        >
          {/* Icône "minimize to bottom" : chevron vers le bas dessiné en
              SVG. Plus net qu'un caractère Unicode, scale parfaitement et
              reste cohérent visuellement à toutes les tailles. */}
          <svg
            className="workout-minimize-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Toggle du bip de fin de repos — cloche pleine si activé,
            barrée si désactivé. Placé à côté du bouton "réduire". */}
        <button
          type="button"
          className={`workout-beep-toggle-btn${beepEnabled ? ' workout-beep-toggle-btn--on' : ''}`}
          onClick={toggleBeepEnabled}
          aria-label={beepEnabled ? 'Désactiver le bip de fin de repos' : 'Activer le bip de fin de repos'}
          title={beepEnabled ? 'Bip de fin de repos activé' : 'Bip de fin de repos désactivé'}
        >
          {beepEnabled ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-9.33-5" />
              <path d="M6.26 6.26A7.9 7.9 0 0 0 6 8c0 7-3 9-3 9h13" />
              <path d="M18 8c0 2.5.34 4.5.88 6" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          )}
        </button>

        {/* Anneau de progression du repos en haut à gauche — visible
            uniquement quand un repos est en cours. Beaucoup plus discret
            que l'ancien banner pour ne pas concurrencer le chrono principal. */}
        {(countdownActive || countdownFinished) && (
          <div
            className={`rest-ring${countdownFinished ? ' rest-ring--finished' : ''}`}
            onClick={dismissCountdown}
            title={countdownFinished ? 'C\'est reparti !' : `Repos : ${formatCountdown(countdown)}`}
            role="button"
            aria-label="Annuler le repos"
          >
            <svg className="rest-ring-svg" viewBox="-4 -4 44 44" aria-hidden="true">
              <defs>
                {/* Cf. nutRingGlow dans Nutrition.js : `filter: drop-shadow`
                    en CSS produit un halo carré sur Chromium mobile, on
                    utilise donc un filtre SVG natif qui suit le tracé. */}
                <filter id="restRingGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="0.9" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle className="rest-ring-track" cx="18" cy="18" r="15.9" />
              <circle
                className="rest-ring-fill"
                cx="18" cy="18" r="15.9"
                filter="url(#restRingGlow)"
                style={{ strokeDashoffset: 100 - (countdownFinished ? 0 : countdownProgress * 100) }}
              />
            </svg>
            <span className="rest-ring-label">
              {countdownFinished ? '✓' : countdown}
            </span>
          </div>
        )}

        <div className="timer-display">{formatTime(timerSecondsHP)}</div>
        <div className="timer-controls">
          {!timerActive ? (
            <button className="btn btn-success btn-small" onClick={startTimer}>▶ Démarrer</button>
          ) : (
            <button className="btn btn-warning btn-small" onClick={stopTimer}>⏸ Pause</button>
          )}
          <button className="btn btn-secondary btn-small" onClick={resetTimer}>🔄 Reset</button>
        </div>
      </div>

      {/* ── Exercises ── */}
      <div className="workout-exercises">
        {exercises.map((exercise, exIndex) => {
          const totalSets = getTotalSets(exercise);

          // Calcul des bornes du superset auquel appartient l'exo
          const sg = normSupersetGroup(exercise.superset_group);
          const prevSg = exIndex > 0 ? normSupersetGroup(exercises[exIndex - 1].superset_group) : null;
          const nextSg = exIndex < exercises.length - 1 ? normSupersetGroup(exercises[exIndex + 1].superset_group) : null;
          const isInSuperset = sg !== null && (prevSg === sg || nextSg === sg);
          const isFirstOfSuperset = isInSuperset && prevSg !== sg;
          const isLastOfSuperset  = isInSuperset && nextSg !== sg;
          // Position alphabétique de l'exo DANS son superset (A, B, C…)
          let positionInSuperset = 0;
          if (isInSuperset) {
            for (let i = exIndex - 1; i >= 0; i -= 1) {
              if (normSupersetGroup(exercises[i].superset_group) !== sg) break;
              positionInSuperset += 1;
            }
          }
          // Un superset a UN SEUL temps de repos, celui du 1er exo du groupe
          // (même convention que dans handleValidateSet). On affiche et on
          // édite donc toujours ce repos-là, même sur le badge de B/C, pour
          // que ce qui s'affiche corresponde à ce qui se décompte vraiment.
          const restSourceExercise = isInSuperset ? exercises[exIndex - positionInSuperset] : exercise;
          const effectiveRest = restOverrides[restSourceExercise.id] !== undefined
            ? restOverrides[restSourceExercise.id] : (restSourceExercise.rest_time || 0);
          // Taille du groupe (calculée sur le premier exo, pour l'en-tête)
          let groupSize = 1;
          if (isFirstOfSuperset) {
            for (let i = exIndex + 1; i < exercises.length; i += 1) {
              if (normSupersetGroup(exercises[i].superset_group) !== sg) break;
              groupSize += 1;
            }
          }
          const showLinkBtn = exIndex < exercises.length - 1
            && (nextSg !== sg || sg === null);
          const showUnlinkBtn = isInSuperset;
          const isLinkedToNext = isInSuperset && nextSg === sg;

          return (
            <React.Fragment key={exercise.id}>
              {isFirstOfSuperset && (
                <div className="superset-header">
                  <span className="superset-header-icon">🔗</span>
                  <span className="superset-header-label">Superset · {groupSize} exercices</span>
                  <span className="superset-header-hint">repos partagé après chaque série</span>
                </div>
              )}
              <div
                className={`card workout-exercise${isInSuperset ? ' workout-exercise--in-superset' : ''}${isFirstOfSuperset ? ' workout-exercise--superset-first' : ''}${isLastOfSuperset ? ' workout-exercise--superset-last' : ''}`}
                onMouseDown={handleExoLongPressStart}
                onMouseUp={handleExoLongPressEnd}
                onMouseLeave={handleExoLongPressCancel}
                onTouchStart={handleExoLongPressStart}
                onTouchEnd={handleExoLongPressEnd}
                onTouchCancel={handleExoLongPressCancel}
                onTouchMove={handleExoLongPressCancel}
              >
                {/* ── Exercise header ── */}
                <div className="exercise-header-row">
                  <button
                    className="reorder-trigger-btn"
                    onClick={(e) => { e.stopPropagation(); setReorderMode(true); }}
                    onMouseDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    title="Réorganiser les exercices"
                  >
                    ☰
                  </button>
                  <div className="exercise-header-info">
                    <div className="exercise-name-row">
                      {isInSuperset && (
                        <span className="exercise-superset-letter exercise-superset-letter--workout" aria-label={`Position ${supersetLetter(positionInSuperset)} dans le superset`}>
                          {supersetLetter(positionInSuperset)}
                        </span>
                      )}
                      <h3 className="exercise-name">
                        {!isInSuperset && `${exIndex + 1}. `}
                        <span
                          className="exercise-name-link"
                          role="link"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); openExerciseProgress(exercise.name); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') openExerciseProgress(exercise.name); }}
                          onMouseDown={e => e.stopPropagation()}
                          onTouchStart={e => e.stopPropagation()}
                        >
                          {exercise.name}
                        </span>
                      </h3>
                      {exercise._custom && <span className="exercise-custom-badge">perso</span>}
                    </div>
                    <div className="exercise-meta-row">
                      <span className="exercise-details">
                        {totalSets} série{totalSets > 1 ? 's' : ''} · {exercise.reps_min}
                        {exercise.reps_max && exercise.reps_max !== exercise.reps_min ? `-${exercise.reps_max}` : ''} reps
                      </span>
                      {(() => {
                        // 1RM estimé "en direct", à partir des séries déjà
                        // saisies pour cet exercice dans la séance en cours
                        // (meilleure série parmi celles avec poids + reps).
                        const liveSets = [...Array(totalSets)].map(
                          (_, i) => currentSets[`${exercise.id}-${i + 1}`]
                        );
                        const orm = bestOneRepMax(liveSets);
                        return orm ? <OneRepMaxBadge value={orm.oneRepMax} /> : null;
                      })()}
                      <button
                        className={`rest-badge${restOverrides[restSourceExercise.id] !== undefined ? ' rest-badge--modified' : ''}`}
                        onClick={(e) => { e.stopPropagation(); startEditRest(restSourceExercise); }}
                        onMouseDown={e => e.stopPropagation()}
                        onTouchStart={e => e.stopPropagation()}
                      >
                        ⏱ {formatRestTime(effectiveRest)}
                      </button>
                      {/* Lier / délier en superset */}
                      {showUnlinkBtn && (
                        <button
                          type="button"
                          className="superset-toggle-btn superset-toggle-btn--unlink"
                          onClick={(e) => { e.stopPropagation(); handleUnlinkWorkout(exercise.id); }}
                          onMouseDown={e => e.stopPropagation()}
                          onTouchStart={e => e.stopPropagation()}
                          title="Retirer du superset"
                          aria-label="Retirer du superset"
                        >
                          🔓
                        </button>
                      )}
                      {showLinkBtn && !isLinkedToNext && (
                        <button
                          type="button"
                          className="superset-toggle-btn superset-toggle-btn--link"
                          onClick={(e) => { e.stopPropagation(); handleLinkNextWorkout(exercise.id); }}
                          onMouseDown={e => e.stopPropagation()}
                          onTouchStart={e => e.stopPropagation()}
                          title={sg !== null ? "Inclure aussi l'exercice suivant" : "Lier en superset avec le suivant"}
                          aria-label="Lier en superset avec le suivant"
                        >
                          🔗
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    className="exercise-remove-btn"
                    onClick={() => handleRemoveExercise(exercise.id)}
                    title="Retirer cet exercice"
                  >
                    ✕
                  </button>
                </div>

                {/* Pour les exos du template : lastPerformances (scopé à
                    cette séance-type, via l'action `start`). Pour les exos
                    ajoutés manuellement (pas dans ce map) : on retombe sur
                    exercise.last_performance, reporté depuis le catalogue
                    global au moment de l'ajout (cf. handleAddExercise). */}
                {(lastPerformances[exercise.id] || exercise.last_performance) && (
                  <div className="last-performance">
                    <strong>Dernière fois :</strong> {lastPerformances[exercise.id] || exercise.last_performance}
                  </div>
                )}

                {/* ── Sets ── */}
                <div className="sets-container">
                  {[...Array(totalSets)].map((_, setIndex) => {
                    const setNumber = setIndex + 1;
                    const key = `${exercise.id}-${setNumber}`;
                    const isValidated = !!validatedSets[key];
                    return (
                      <div key={setNumber} className={`set-row${isValidated ? ' set-row--validated' : ''}`}>
                        <span className="set-label">Série {setNumber}</span>
                        <input type="number" placeholder="kg" className="set-input" step="0.5"
                          value={currentSets[key]?.weight || ''}
                          onChange={(e) => updateSetData(exercise.id, setNumber, 'weight', e.target.value)}
                        />
                        <input type="number" placeholder="Reps" className="set-input"
                          value={currentSets[key]?.reps || ''}
                          onChange={(e) => updateSetData(exercise.id, setNumber, 'reps', e.target.value)}
                        />
                        <button
                          className={`set-validate-btn${isValidated ? ' set-validate-btn--done' : ''}`}
                          onClick={() => handleValidateSet(exercise.id, setNumber, effectiveRest)}
                        >
                          {isValidated ? '✓' : '○'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* ── Add / Remove set ── */}
                <div className="set-actions-row">
                  <button className="set-action-btn set-action-btn--add" onClick={() => addSet(exercise.id)}>
                    + Série
                  </button>
                  {totalSets > 1 && (
                    <button className="set-action-btn set-action-btn--remove" onClick={() => removeSet(exercise.id)}>
                      − Série
                    </button>
                  )}
                </div>
              </div>
              {/* Connecteur visuel "↻ enchaîner" entre deux exos d'un superset */}
              {isLinkedToNext && (
                <div className="superset-connector" aria-hidden="true">↻ enchaîner</div>
              )}
            </React.Fragment>
          );
        })}

        <button className="btn-add-exercise" onClick={() => setShowAddExercise(true)}>
          + Ajouter un exercice
        </button>
      </div>

      {/* ── Notes ── */}
      <div className="card">
        <h3 className="mb-1">Notes (optionnel)</h3>
        <textarea
          className="form-textarea"
          placeholder="Comment s'est passé l'entraînement ?"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* ── Friends ── */}
      <div className="card">
        <label className="friend-checkbox">
          <input type="checkbox" checked={showAddFriends}
            onChange={(e) => { setShowAddFriends(e.target.checked); if (!e.target.checked) setSelectedParticipants([]); }}
          />
          <span>Ajouter des amis à la séance</span>
        </label>
        {showAddFriends && (
          friends.length === 0 ? (
            <p className="no-friends-message">Vous n'avez pas encore d'amis.</p>
          ) : (
            <div className="friends-selector">
              {friends.map(friend => (
                <label key={friend.friend_id} className="friend-checkbox">
                  <input type="checkbox"
                    checked={selectedParticipants.includes(friend.friend_id)}
                    onChange={() => toggleParticipant(friend.friend_id)}
                  />
                  <span>{friend.friend_username}</span>
                </label>
              ))}
            </div>
          )
        )}
      </div>

      <div className="workout-actions">
        <button
          className="btn btn-success"
          onClick={handleComplete}
          disabled={isSaving}
        >
          {isSaving ? '⏳ Enregistrement…' : '✓ Terminer et enregistrer'}
        </button>
        <button className="btn btn-danger"
          onClick={async () => {
            const ok = await confirm({
              title: 'Abandonner l\'entraînement ?',
              message: 'Tes performances en cours ne seront pas enregistrées dans l\'historique.',
              confirmLabel: 'Abandonner',
              cancelLabel: 'Continuer',
              variant: 'danger',
            });
            if (ok) {
              clearWorkout();
              navigate('/sessions');
            }
          }}
        >
          Abandonner
        </button>
      </div>

      {/* ══════════════════════════════════════════
          REORDER MODE OVERLAY
          Long press on any exercise card activates this.
          Shows all exercises as compact draggable rows.
      ══════════════════════════════════════════ */}
      {reorderMode && (
        <div className="reorder-overlay" onClick={() => setReorderMode(false)}>
          <div className="reorder-panel" onClick={e => e.stopPropagation()}>
            <div className="reorder-header">
              <span className="reorder-title">Réorganiser les exercices</span>
              <button className="reorder-done-btn" onClick={() => setReorderMode(false)}>
                Terminé ✓
              </button>
            </div>
            <p className="reorder-hint">Glissez les lignes pour changer l'ordre</p>
            <div
              className="reorder-list"
              ref={reorderListRef}
              onTouchMove={handleReorderTouchMove}
              onTouchEnd={handleReorderTouchEnd}
            >
              {exercises.map((exercise, idx) => {
                const isDragging = draggingIdx === idx || draggingId === exercise.id;
                const isTarget = dragOverIdx === idx && draggingIdx !== idx;
                return (
                  <div
                    key={exercise.id}
                    data-reorder-idx={idx}
                    data-reorder-id={exercise.id}
                    className={`reorder-row${isDragging ? ' reorder-row--dragging' : ''}${isTarget ? ' reorder-row--target' : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={handleDragEnd}
                    onDragOver={e => e.preventDefault()}
                  >
                    <span
                      className="reorder-grip"
                      aria-label={`Glisser pour déplacer ${exercise.name}`}
                      onTouchStart={(e) => handleReorderTouchStart(e, idx)}
                    >
                      ⠿
                    </span>
                    <span className="reorder-num">{idx + 1}</span>
                    <span className="reorder-name">{exercise.name}</span>
                    {exercise._custom && <span className="exercise-custom-badge">perso</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════
          Add Exercise Modal
      ══════════════════════════════════ */}
      {showAddExercise && (
        <div className="modal active" onClick={() => setShowAddExercise(false)}>
          <div className="modal-content add-exercise-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Ajouter un exercice</h2>
              <button className="close-btn" onClick={() => setShowAddExercise(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="add-exo-section-label">Depuis vos exercices existants</p>
              <input
                className="add-exo-search"
                type="text" placeholder="Rechercher…"
                value={exerciseSearch}
                onChange={e => setExerciseSearch(e.target.value)}
                autoFocus
              />
              {exerciseSearch.length > 0 && (
                <div className="add-exo-results">
                  {filteredExercises.length === 0 ? (
                    <p className="add-exo-empty">Aucun résultat</p>
                  ) : (
                    filteredExercises.map(exo => (
                      <button key={exo.id} className="add-exo-result-item" onClick={() => handleAddExercise(exo)}>
                        <span className="add-exo-top-row">
                          <span className="add-exo-name">{exo.name}</span>
                          <span className="add-exo-meta">
                            {exo.sets} × {exo.reps_min}{exo.reps_max && exo.reps_max !== exo.reps_min ? `-${exo.reps_max}` : ''} reps
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              <div className="add-exo-divider"><span>ou créer un exercice</span></div>
              <div className="add-exo-custom">
                <input
                  className="form-input" type="text" placeholder="Nom de l'exercice"
                  value={newExerciseName}
                  onChange={e => setNewExerciseName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddCustomExercise(); }}
                />
                <div className="add-exo-sets-row">
                  <span className="add-exo-sets-label">Séries :</span>
                  <div className="add-exo-sets-stepper">
                    <button className="stepper-btn" onClick={() => setNewExerciseSets(s => Math.max(1, s - 1))}>−</button>
                    <span className="stepper-val">{newExerciseSets}</span>
                    <button className="stepper-btn" onClick={() => setNewExerciseSets(s => s + 1)}>+</button>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '0.5rem' }}
                  onClick={handleAddCustomExercise}
                  disabled={!newExerciseName.trim()}
                >
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Rest time picker ── */}
      {editingRest !== null && (() => {
        const ex = exercises.find(e => e.id === editingRest);
        if (!ex) return null;
        const current = restOverrides[ex.id] !== undefined ? restOverrides[ex.id] : (ex.rest_time || 0);
        return (
          <RestTimePicker
            value={current}
            onChange={(v) => commitEditRest(ex.id, v)}
            onClose={closeEditRest}
          />
        );
      })()}
    </div>
  );
};

export default Workout;