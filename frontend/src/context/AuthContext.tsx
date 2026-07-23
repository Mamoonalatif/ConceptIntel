import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/api';

interface User {
  id: number;
  email: string;
  full_name: string;
  role: 'teacher' | 'student' | 'admin' | 'program_coordinator' | 'course_coordinator';
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (credentials: any, rememberMe?: boolean) => Promise<any>;
  loginWithGoogle: (idToken: string, rememberMe?: boolean) => Promise<any>;
  register: (userData: any) => Promise<any>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token may live in localStorage ("remember me" - survives browser restart) or
// sessionStorage (cleared when the browser closes), depending on what was chosen at login.
const getStoredToken = (): string | null =>
  localStorage.getItem('token') || sessionStorage.getItem('token');

const storeToken = (accessToken: string, rememberMe: boolean) => {
  // Clear both first so switching remember-me preference doesn't leave a stale copy
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
  if (rememberMe) {
    localStorage.setItem('token', accessToken);
  } else {
    sessionStorage.setItem('token', accessToken);
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = getStoredToken();
      if (storedToken) {
        try {
          const userData = await authService.getMe();
          setUser(userData);
        } catch (error) {
          console.error("Failed to load user metadata, logging out", error);
          logout();
        }
      }
      setIsLoading(false);
    };
    initAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Deliberately does NOT touch isLoading below - that flag means "still checking
  // for a saved session at app startup" and gates whether GuestRoute/PrivateRoute
  // render the page at all. Reusing it for "a login request is in flight" caused a
  // real bug: it briefly went true mid-login, GuestRoute rendered null instead of
  // the Login page, tearing down (unmounting) the exact component instance whose
  // catch block was about to call setError - so the error silently vanished into a
  // component that no longer existed. Callers (Login.tsx etc.) already track their
  // own local `loading` state for the button/spinner - that's the correct layer for
  // per-request loading state, not this context-wide flag.
  const login = async (credentials: any, rememberMe: boolean = false) => {
    const data = await authService.login(credentials);
    storeToken(data.access_token, rememberMe);
    setToken(data.access_token);
    return data;
  };

  const loginWithGoogle = async (idToken: string, rememberMe: boolean = false) => {
    const data = await authService.google(idToken);
    storeToken(data.access_token, rememberMe);
    setToken(data.access_token);
    return data;
  };

  const register = async (userData: any) => {
    return authService.register(userData);
  };

  const logout = () => {
    localStorage.removeItem('token');
    sessionStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setIsLoading(false);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, loginWithGoogle, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
