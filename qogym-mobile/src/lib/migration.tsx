import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { QOJIM } from '@/theme';
import { authApi, setAuthToken } from './api';
import { store } from './storage';
import { useAuth } from './auth';

/**
 * Reprise de session depuis l'ancienne app.
 *
 * L'ancienne APK (même package com.qojim.qogym) affichait le site dans une
 * WebView : le token de connexion est resté dans le localStorage de cette
 * WebView, qui survit à la mise à jour. Au tout premier lancement, on ouvre
 * une WebView invisible sur qojim.com pour relire ce token, on le vérifie
 * auprès de l'API, puis on connecte l'utilisateur automatiquement.
 * → Après la mise à jour, personne n'a besoin de se reconnecter.
 */
const FLAG = 'qg_legacy_migration_done';

const READ_JS = `
(function () {
  try {
    var t = window.localStorage.getItem('qogym_token');
    var u = window.localStorage.getItem('qogym_user');
    window.ReactNativeWebView.postMessage(JSON.stringify({ token: t, user: u }));
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ token: null }));
  }
})();
true;
`;

export function useLegacyMigration() {
  const { ready, user, login } = useAuth();
  const [state, setState] = useState<'checking' | 'running' | 'done'>('checking');

  useEffect(() => {
    if (!ready) return;
    if (user) {
      setState('done');
      store.set(FLAG, true);
      return;
    }
    store.get<boolean>(FLAG, false).then((done) => setState(done ? 'done' : 'running'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const finish = () => {
    store.set(FLAG, true);
    setState('done');
  };

  const onResult = async (token: string | null) => {
    if (!token) return finish();
    try {
      setAuthToken(token);
      const r = await authApi.me();
      if (r?.user) {
        await login(r.user, token);
      } else {
        setAuthToken(null);
      }
    } catch {
      setAuthToken(null);
    }
    finish();
  };

  return { pending: state !== 'done', running: state === 'running', onResult, finish };
}

export function LegacyMigrationProbe({ onResult, onTimeout }: { onResult: (t: string | null) => void; onTimeout: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!done.current) {
        done.current = true;
        onTimeout();
      }
    }, 7000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} pointerEvents="none">
      <WebView
        source={{ uri: `${QOJIM}/version.json` }}
        injectedJavaScript={READ_JS}
        domStorageEnabled
        javaScriptEnabled
        cacheEnabled
        onMessage={(e) => {
          if (done.current) return;
          done.current = true;
          let token: string | null = null;
          try {
            token = JSON.parse(e.nativeEvent.data)?.token || null;
          } catch {}
          onResult(token);
        }}
        onError={() => {
          if (!done.current) {
            done.current = true;
            onResult(null);
          }
        }}
      />
    </View>
  );
}
