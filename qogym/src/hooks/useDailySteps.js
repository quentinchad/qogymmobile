import { useState, useEffect, useCallback } from 'react';
import { stepsService } from '../services/api';
import { readNativeSteps, hasNativeStepsBridge, todayISO } from '../utils/steps';

/**
 * useDailySteps — store PARTAGÉ pour les pas du jour + objectif.
 *
 * Pourquoi un store partagé et pas un simple hook : avec le carousel
 * (SwipeShell), Feed ET Profil sont montés en permanence. Deux instances
 * indépendantes d'un hook classique feraient chacune leur sync (double
 * appel API, double lecture du pont natif, double push). On centralise
 * donc l'état au niveau module avec un mini système d'abonnement : une
 * seule sync, tous les consommateurs voient la même valeur.
 */

const state = {
  steps: null,
  goal: null,
  source: null,
  loading: true,
  error: false,
  migrationNeeded: false,
};

const listeners = new Set();
let syncing = false;
let lastSyncAt = 0;

const emit = () => {
  // On passe une copie pour que React détecte le changement de référence.
  const snap = { ...state };
  listeners.forEach((l) => l(snap));
};

const setState = (patch) => {
  Object.assign(state, patch);
  emit();
};

/**
 * Sync : lit serveur + natif, push si le natif est plus à jour.
 * `force` ignore le throttle (utilisé par les actions explicites).
 */
const doSync = async ({ force = false } = {}) => {
  if (syncing) return;
  // Throttle léger : pas plus d'une sync auto toutes les 15 s (évite les
  // rafales sur visibilitychange/focus successifs).
  if (!force && Date.now() - lastSyncAt < 15000) return;
  syncing = true;
  lastSyncAt = Date.now();
  const day = todayISO();
  try {
    let serverSteps = 0;
    let serverGoal = null;
    let serverSource = null;
    try {
      const resp = await stepsService.getToday(day);
      serverSteps  = resp.data.steps || 0;
      serverGoal   = resp.data.goal ?? null;
      serverSource = resp.data.source ?? null;
      setState({ error: false, migrationNeeded: !!resp.data.migration_needed });
    } catch (_) {
      setState({ error: true });
    }

    // Migration pas encore exécutée : inutile de tenter le push natif
    // (la table n'existe pas). On affiche un état "indisponible" propre.
    if (state.migrationNeeded) {
      setState({ steps: 0, goal: null, source: null, loading: false });
      return;
    }

    let nativeVal = null;
    try {
      nativeVal = await readNativeSteps();
    } catch (_) {}

    let finalSteps = serverSteps;
    let finalSource = serverSource;
    if (nativeVal && nativeVal.day === day && nativeVal.steps > serverSteps) {
      const nSource = nativeVal.source === 'native-partial' ? 'native-partial' : 'native';
      finalSteps = nativeVal.steps;
      finalSource = nSource;
      try {
        const pushResp = await stepsService.pushSteps({
          steps: nativeVal.steps,
          day,
          source: nSource,
        });
        if (pushResp?.data?.steps != null) {
          finalSteps = pushResp.data.steps;
          finalSource = pushResp.data.source || nSource;
        }
      } catch (_) {}
    }

    setState({
      steps: finalSteps,
      goal: serverGoal,
      source: finalSource,
      loading: false,
    });
  } finally {
    syncing = false;
  }
};

const pushManual = async (value) => {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const day = todayISO();
  setState({ steps: n, source: 'manual' });
  try {
    const resp = await stepsService.pushSteps({ steps: n, day, source: 'manual' });
    if (resp?.data?.steps != null) {
      setState({ steps: resp.data.steps, source: resp.data.source || 'manual' });
    }
    return true;
  } catch (_) {
    return false;
  }
};

const pushGoal = async (value) => {
  const v = value === null || value === '' ? null : Math.max(0, Math.round(Number(value) || 0));
  try {
    const resp = await stepsService.setGoal(v);
    setState({ goal: resp?.data?.goal ?? v });
    return true;
  } catch (_) {
    return false;
  }
};

// Listeners globaux app-revient-au-premier-plan : posés une seule fois.
let globalBound = false;
const bindGlobal = () => {
  if (globalBound || typeof document === 'undefined') return;
  globalBound = true;
  const onVis = () => {
    if (document.visibilityState === 'visible') doSync();
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onVis);
};

export const useDailySteps = () => {
  const [snap, setSnap] = useState(() => ({ ...state }));

  useEffect(() => {
    listeners.add(setSnap);
    bindGlobal();
    // Première sync (le throttle évite les doublons si déjà fait récemment
    // par l'autre consommateur).
    doSync();
    return () => { listeners.delete(setSnap); };
  }, []);

  const refresh = useCallback(() => doSync({ force: true }), []);
  const setManualSteps = useCallback((v) => pushManual(v), []);
  const saveGoal = useCallback((v) => pushGoal(v), []);

  return {
    steps: snap.steps,
    goal: snap.goal,
    source: snap.source,
    loading: snap.loading,
    error: snap.error,
    migrationNeeded: snap.migrationNeeded,
    bridgePresent: hasNativeStepsBridge(),
    refresh,
    setManualSteps,
    saveGoal,
  };
};

export default useDailySteps;
