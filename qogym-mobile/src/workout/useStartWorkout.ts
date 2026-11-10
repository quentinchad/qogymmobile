import { useCallback } from 'react';
import { router } from 'expo-router';

/**
 * Ouvre l'écran d'entraînement pour une séance. C'est l'écran qui démarre
 * réellement le workout (et qui demande quoi faire si un autre est en cours).
 */
export function useStartWorkout() {
  return useCallback(async (sessionId: string, opts: { isEmptyWorkout?: boolean } = {}) => {
    router.push(`/workout/${sessionId}${opts.isEmptyWorkout ? '?empty=1' : ''}`);
  }, []);
}
