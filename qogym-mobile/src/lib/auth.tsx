import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, setAuthToken, setUnauthorizedHandler } from './api';
import { store, tokenStore } from './storage';
import QoWorkout from '../../modules/qo-workout';

export type User = {
  id: number;
  username: string;
  email: string;
  is_admin?: boolean | number;
  pdp?: string | null;
  [k: string]: any;
};

type AuthCtx = {
  ready: boolean;
  user: User | null;
  login: (user: User, token: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
};

const Ctx = createContext<AuthCtx | null>(null);
const USER_KEY = 'qg_user_profile';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const clearLocal = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    QoWorkout.stop();
    await tokenStore.clear();
    await store.clearUserData();
    await store.remove(USER_KEY);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearLocal();
    });
    (async () => {
      const token = await tokenStore.get();
      const saved = await store.get<User | null>(USER_KEY, null);
      if (token && saved) {
        // Démarrage instantané avec l'utilisateur connu, vérification en fond.
        setAuthToken(token);
        setUser(saved);
        setReady(true);
        authApi
          .me()
          .then((r) => {
            if (r?.user) {
              setUser(r.user);
              store.set(USER_KEY, r.user);
            }
          })
          .catch(() => {
            /* 401 → handler ; hors ligne → on garde la session */
          });
      } else {
        setReady(true);
      }
    })();
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  const login = useCallback(async (u: User, token: string) => {
    setAuthToken(token);
    await tokenStore.set(token);
    await store.set(USER_KEY, u);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {}
    await clearLocal();
  }, [clearLocal]);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      store.set(USER_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ ready, user, login, logout, updateUser }), [ready, user, login, logout, updateUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth hors AuthProvider');
  return c;
};
