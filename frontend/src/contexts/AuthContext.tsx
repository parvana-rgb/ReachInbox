import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { api } from '../services/api';
import type { User } from '../types';

interface AuthState { user: User | null; loading: boolean; serverError: string | null; logout: () => Promise<void> }
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    api.me()
      .then(setUser)
      .catch((e) => {
        if (axios.isAxiosError(e) && e.response?.status === 401) setUser(null);
        else setServerError('Cannot reach the ReachInbox server. Check that the backend is running.');
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, loading, serverError, logout }), [user, loading, serverError, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
