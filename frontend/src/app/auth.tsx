import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';

export interface User {
  id: number;
  username: string;
  display_name: string;
  is_admin: boolean;
  avatar_url: string | null;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh(): Promise<void>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const RETRIES = 10;
const RETRY_MS = 1500;

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // The server restarting, or no network, is no logging out: asked again, for a while.
    for (let attempt = 0; ; attempt++) {
      try {
        setUser(await api<User | null>('/auth/me'));
        break;
      } catch (e) {
        const down = !(e instanceof ApiError) || e.status >= 500;
        if (!down || attempt >= RETRIES) {
          setUser(null);
          break;
        }
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    await api('/auth/login', { method: 'POST', json: { username, password } });
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, refresh, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
