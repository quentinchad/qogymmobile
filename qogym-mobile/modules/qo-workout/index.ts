import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type NativeWorkoutState = {
  title: string;
  /** ms epoch où le chrono valait 0 (0 = en pause) */
  chronoBase: number;
  pausedSec: number;
  /** ms epoch de fin du repos (0 = pas de repos) */
  restEnd: number;
  restTotal: number;
  setsDone: number;
  setsTotal: number;
  beep: boolean;
};

export type RestChangeEvent = {
  restEndAt: number;
  restTotal: number;
  reason: 'skip' | 'add' | 'end';
};

type NativeModuleShape = {
  update(state: NativeWorkoutState): void;
  stop(): void;
  getRest(): { restEndAt: number; restTotal: number; active: boolean };
  setForeground(fg: boolean): void;
  beep(final: boolean): void;
  vibrate(ms: number): void;
  addListener(event: 'onRestChange', cb: (e: RestChangeEvent) => void): { remove(): void };
};

// Module optionnel : absent sur web / Expo Go → toutes les fonctions deviennent des no-op.
const Native =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeModuleShape>('QoWorkout') : null;

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const QoWorkout = {
  available: !!Native,
  update: (s: NativeWorkoutState) => safe(() => Native?.update(s), undefined),
  stop: () => safe(() => Native?.stop(), undefined),
  getRest: () =>
    safe(() => Native?.getRest() ?? null, null) as { restEndAt: number; restTotal: number; active: boolean } | null,
  setForeground: (fg: boolean) => safe(() => Native?.setForeground(fg), undefined),
  beep: (final: boolean) => safe(() => Native?.beep(final), undefined),
  vibrate: (ms: number) => safe(() => Native?.vibrate(ms), undefined),
  onRestChange: (cb: (e: RestChangeEvent) => void) => {
    if (!Native) return { remove() {} };
    return safe(() => Native.addListener('onRestChange', cb), { remove() {} });
  },
};

export default QoWorkout;
