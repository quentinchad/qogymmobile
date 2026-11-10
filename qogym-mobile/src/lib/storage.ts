import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';

// ── Token (stockage chiffré) ────────────────────────────────────────────
const TOKEN_KEY = 'qogym_token';
export const tokenStore = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
  set: (t: string) => SecureStore.setItemAsync(TOKEN_KEY, t).catch(() => {}),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
};

// ── Petit stockage JSON ─────────────────────────────────────────────────
export const store = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    return AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
  },
  remove(key: string) {
    return AsyncStorage.removeItem(key).catch(() => {});
  },
  async clearUserData() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('cache:') || k.startsWith('qg_user')));
    } catch {}
  },
};

/**
 * Données "stale-while-revalidate" : on affiche instantanément la dernière
 * version connue (cache disque), puis on rafraîchit en arrière-plan.
 * Rend l'app fluide même avec un réseau lent.
 */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>, opts: { staleMs?: number } = {}) {
  const staleMs = opts.staleMs ?? 8_000;
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<any>(null);
  const lastFetch = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(
    async (mode: 'silent' | 'pull' = 'silent') => {
      if (!key) return;
      if (inflight.current) return inflight.current;
      if (mode === 'pull') setRefreshing(true);
      const p = (async () => {
        try {
          const fresh = await fetcherRef.current();
          lastFetch.current = Date.now();
          setData(fresh);
          setError(null);
          store.set(`cache:${key}`, fresh);
        } catch (e) {
          setError(e);
        } finally {
          setLoading(false);
          setRefreshing(false);
          inflight.current = null;
        }
      })();
      inflight.current = p;
      return p;
    },
    [key],
  );

  useEffect(() => {
    if (!key) return;
    let alive = true;
    setLoading(true);
    store.get<T | undefined>(`cache:${key}`, undefined).then((cached) => {
      if (!alive) return;
      if (cached !== undefined) {
        setData(cached);
        setLoading(false);
      }
      refresh();
    });
    return () => {
      alive = false;
    };
  }, [key, refresh]);

  /** À appeler au retour sur l'écran : ne refetch que si les données sont anciennes. */
  const refreshIfStale = useCallback(() => {
    if (Date.now() - lastFetch.current > staleMs) refresh();
  }, [refresh, staleMs]);

  return { data, setData, loading: loading && data === undefined, refreshing, error, refresh, refreshIfStale };
}
