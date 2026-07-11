import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  authService,
  clearStoredToken,
  dashboardPathForRole,
  getStoredToken,
  type AuthRole,
  type AuthUser,
  type LoginPayload,
  type RegisterPayload,
} from '../services/authService';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<string>;
  register: (payload: RegisterPayload) => Promise<string>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const stored = getStoredToken();
      if (!stored) {
        if (!cancelled) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const me = await authService.me();
        if (!cancelled) {
          setUser(me);
          setToken(stored);
        }
      } catch {
        clearStoredToken();
        if (!cancelled) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const data = await authService.login(payload);
    setUser(data.user);
    setToken(data.access_token);
    return dashboardPathForRole(data.user.role);
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const data = await authService.register(payload);
    setUser(data.user);
    setToken(data.access_token);
    return dashboardPathForRole(data.user.role);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user && token),
      isLoading,
      login,
      register,
      logout,
    }),
    [user, token, isLoading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export type { AuthRole };
