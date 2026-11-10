import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { QOJIM } from '@/theme';
import { store } from './storage';

/**
 * Mises à jour hors Play Store : même fichier https://qojim.com/version.json
 * que l'ancienne app. La mise à jour est TOUJOURS proposée, jamais imposée
 * (sauf si minRequiredVersionCode est volontairement monté dans version.json).
 */

type VersionInfo = {
  latestVersionCode: number;
  latestVersion?: string;
  downloadUrl?: string;
  minRequiredVersionCode?: number;
  releaseNotes?: string;
};

type UpdateCtx = {
  info: VersionInfo | null;
  available: boolean;
  mandatory: boolean;
  dismissed: boolean;
  progress: number | null;
  installedVersion: string;
  dismiss: () => void;
  install: () => Promise<void>;
  check: (force?: boolean) => void;
  /** Plan B : téléchargement par le navigateur / gestionnaire Android. */
  openInBrowser: () => void;
  error: string | null;
};

const C = createContext<UpdateCtx | null>(null);
const DISMISS_KEY = 'qg_update_dismissed_code';
const CHECK_EVERY = 6 * 60 * 60 * 1000;

export const installedVersionCode = () => Number(Application.nativeBuildVersion ?? 0) || 0;

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [dismissedCode, setDismissedCode] = useState<number>(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastCheck = useRef(0);
  const installed = installedVersionCode();

  const check = useCallback((force = false) => {
    if (Platform.OS !== 'android') return;
    if (!force && Date.now() - lastCheck.current < CHECK_EVERY) return;
    lastCheck.current = Date.now();
    fetch(`${QOJIM}/version.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && typeof j.latestVersionCode === 'number' && setInfo(j))
      .catch(() => {});
  }, []);

  useEffect(() => {
    store.get<number>(DISMISS_KEY, 0).then(setDismissedCode);
    // Vérification différée : ne ralentit pas le démarrage.
    const t = setTimeout(() => check(true), 2500);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [check]);

  const available = !!info && installed > 0 && info.latestVersionCode > installed;
  const mandatory = available && !!info?.minRequiredVersionCode && installed < (info?.minRequiredVersionCode ?? 0);
  const dismissed = !mandatory && !!info && dismissedCode >= info.latestVersionCode;

  const dismiss = useCallback(() => {
    if (!info) return;
    setDismissedCode(info.latestVersionCode);
    store.set(DISMISS_KEY, info.latestVersionCode);
  }, [info]);

  const install = useCallback(async () => {
    if (!info || progress !== null) return;
    setError(null);
    const url = info.downloadUrl || `${QOJIM}/qogym.apk`;
    const target = `${FileSystem.cacheDirectory}qogym-update.apk`;
    try {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      setProgress(0);
      const dl = FileSystem.createDownloadResumable(url, target, {}, (p) => {
        if (p.totalBytesExpectedToWrite > 0) setProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
      });
      const res = await dl.downloadAsync();
      if (!res?.uri) throw new Error('Téléchargement interrompu');
      const contentUri = await FileSystem.getContentUriAsync(res.uri);
      setProgress(null);
      await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/vnd.android.package-archive',
      });
    } catch (e: any) {
      setProgress(null);
      setError(`Échec du téléchargement${e?.message ? ` (${e.message})` : ''}. Essaie via le navigateur.`);
    }
  }, [info, progress]);

  const openInBrowser = useCallback(() => {
    Linking.openURL(info?.downloadUrl || `${QOJIM}/qogym.apk`).catch(() => {});
  }, [info]);

  const value = useMemo<UpdateCtx>(
    () => ({
      info,
      available,
      mandatory,
      dismissed,
      progress,
      installedVersion: Application.nativeApplicationVersion ?? '',
      dismiss,
      install,
      check,
      openInBrowser,
      error,
    }),
    [info, available, mandatory, dismissed, progress, dismiss, install, check, openInBrowser, error],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useUpdate = () => {
  const c = useContext(C);
  if (!c) throw new Error('useUpdate hors provider');
  return c;
};
