import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { authService, clearApiCache } from '../services/api';

interface User {
  id: number;
  email: string;
  full_name: string;
  // Base identity - never changes on promotion. Program/Course Coordinator are
  // ADDITIONAL authority flags below, not separate role values - a teacher given
  // coordinator authority keeps every teacher capability plus the coordinator ones.
  role: 'teacher' | 'student' | 'admin';
  is_program_coordinator: boolean;
  is_course_coordinator: boolean;
  avatar_url?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (credentials: any, rememberMe?: boolean) => Promise<any>;
  loginWithGoogle: (idToken: string, rememberMe?: boolean) => Promise<any>;
  register: (userData: any) => Promise<any>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token may live in localStorage ("remember me" - survives browser restart) or
// sessionStorage (cleared when the browser closes), depending on what was chosen at login.
const getStoredToken = (): string | null =>
  localStorage.getItem('token') || sessionStorage.getItem('token');

// A shared hint that SOME tab holds a session-only token. localStorage is shared
// across tabs (sessionStorage is not), so this is how a newly-opened tab can tell
// "I might be able to borrow a session" apart from "nobody is signed in" - without
// it, every logged-out visitor would sit through the handshake timeout before the
// login page rendered. Deliberately just a flag; the token itself never lands here.
const SESSION_HINT_KEY = 'session_active';

const storeToken = (accessToken: string, refreshToken: string | undefined, rememberMe: boolean) => {
  // Clear both first so switching remember-me preference doesn't leave a stale copy
  localStorage.removeItem('token');
  localStorage.removeItem('refresh_token');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('refresh_token');
  const store = rememberMe ? localStorage : sessionStorage;
  store.setItem('token', accessToken);
  if (refreshToken) store.setItem('refresh_token', refreshToken);
  if (rememberMe) {
    localStorage.removeItem(SESSION_HINT_KEY);   // token is already tab-shared
  } else {
    localStorage.setItem(SESSION_HINT_KEY, '1');
  }
};

// ── Cross-tab session sharing ────────────────────────────────────────────────
// THE BUG THIS FIXES: opening any link in a new tab bounced the user to /login,
// even though they were signed in. Nothing to do with Google/Gmail - the cause is
// that a session-only login (remember-me unchecked) puts the token in
// sessionStorage, and sessionStorage is PER TAB. A new tab starts with an empty
// one, finds no token, and PrivateRoute redirects. Every "open in new tab" feature
// (the content viewer, the game player) hit this every time.
//
// Rather than demoting every login to localStorage - which would silently make
// "don't remember me" persist to disk anyway - a new tab asks the tabs that are
// already open for the token, over a BroadcastChannel. Semantics are preserved:
// close every tab and the session really is gone, because there is nobody left to
// answer. Falls back safely to "logged out" where BroadcastChannel is unsupported.
const AUTH_CHANNEL = 'conceptintel-auth';
const HANDSHAKE_TIMEOUT_MS = 400;

type AuthMessage =
  | { type: 'request-token' }
  | { type: 'share-token'; token: string; user: string | null }
  | { type: 'logout' };

const openAuthChannel = (): BroadcastChannel | null => {
  try {
    return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(AUTH_CHANNEL) : null;
  } catch {
    return null;
  }
};

/** Asks any already-open tab for its token. Resolves null if nobody answers in time. */
const requestTokenFromOtherTabs = (): Promise<{ token: string; user: string | null } | null> =>
  new Promise((resolve) => {
    const channel = openAuthChannel();
    if (!channel) { resolve(null); return; }

    let settled = false;
    const finish = (value: { token: string; user: string | null } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.close();
      resolve(value);
    };

    channel.onmessage = (event: MessageEvent<AuthMessage>) => {
      const msg = event.data;
      if (msg?.type === 'share-token' && msg.token) finish({ token: msg.token, user: msg.user });
    };

    const timer = setTimeout(() => finish(null), HANDSHAKE_TIMEOUT_MS);
    channel.postMessage({ type: 'request-token' } as AuthMessage);
  });

// ── Cached user profile ──────────────────────────────────────────────────────
// The token alone was persisted, not the profile it identifies, so EVERY page
// load (and every hard refresh) blocked the whole app on a fresh /auth/me before
// it could decide which dashboard to render - that's the "Authenticating
// session..." wait, and the reason the sidebar/dashboard appeared to load twice.
// Caching the profile next to the token lets the first paint happen immediately
// from the cached copy, while /auth/me revalidates in the background and quietly
// corrects it if anything changed server-side (role granted, avatar updated).
//
// This is a rendering optimisation only - it is NOT a security decision. Every
// request is still authorized server-side off the JWT, so a tampered cached
// profile buys nothing: the API would simply 403.
const USER_CACHE_KEY = 'cached_user';

const readCachedUser = (): User | null => {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY) || sessionStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Guard against a half-written or outdated shape from an older build.
    return parsed && typeof parsed.id === 'number' && typeof parsed.role === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

const writeCachedUser = (user: User | null) => {
  localStorage.removeItem(USER_CACHE_KEY);
  sessionStorage.removeItem(USER_CACHE_KEY);
  if (!user) return;
  // Follow the token's storage so the profile never outlives the session that
  // owns it - a session-only login must not leave a profile behind on disk.
  const store = localStorage.getItem('token') ? localStorage : sessionStorage;
  try {
    store.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    /* storage full or blocked - caching is best-effort, never fatal */
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Both initialisers run synchronously on the very first render, so a returning
  // user's dashboard paints on frame one instead of after a network round trip.
  const [user, setUser] = useState<User | null>(() => (getStoredToken() ? readCachedUser() : null));
  const [token, setToken] = useState<string | null>(getStoredToken());
  // Only genuinely "unknown" when there's a token but no cached profile to render
  // from - otherwise there is nothing to wait for and the spinner is pure delay.
  // A tab with no token of its own is NOT necessarily logged out - it may just be a
  // newly-opened tab that hasn't asked its siblings yet. Start in the loading state
  // so PrivateRoute shows a spinner for the length of the handshake instead of
  // redirecting to /login before the answer arrives.
  const [isLoading, setIsLoading] = useState(() => {
    const stored = getStoredToken();
    if (stored) return !readCachedUser();          // have a token, may need the profile
    // No token here. Only wait if another tab might be holding one.
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  });

  // Which token we've already resolved a profile for. Login below fetches the
  // profile itself (so a login resolves with `user` already populated and the
  // caller can navigate straight to a rendered dashboard); without this marker
  // the effect would immediately fire a second, redundant /auth/me for the same
  // token - one wasted round trip on the single most latency-visible action in
  // the app.
  const fetchedForToken = useRef<string | null>(null);

  useEffect(() => {
    const initAuth = async () => {
      let storedToken = getStoredToken();

      // Newly-opened tab with no token of its own: ask the other tabs before
      // concluding the user is signed out.
      if (!storedToken) {
        if (localStorage.getItem(SESSION_HINT_KEY) !== '1') {
          setIsLoading(false);
          return;
        }
        const shared = await requestTokenFromOtherTabs();
        if (!shared) {
          // Nobody answered: every tab holding that session is gone, so the hint is
          // stale. Clearing it means the next load is instant instead of waiting again.
          localStorage.removeItem(SESSION_HINT_KEY);
        }
        if (shared) {
          // Adopted into sessionStorage, not localStorage: this tab is borrowing a
          // session, and must not be the thing that makes it outlive the browser.
          sessionStorage.setItem('token', shared.token);
          if (shared.user) sessionStorage.setItem(USER_CACHE_KEY, shared.user);
          storedToken = shared.token;
          setToken(shared.token);
          setUser(readCachedUser());
        } else {
          setIsLoading(false);
          return;
        }
      }
      if (fetchedForToken.current === storedToken) {
        setIsLoading(false);
        return;
      }
      try {
        const userData = await authService.getMe();
        fetchedForToken.current = storedToken;
        setUser(userData);
        writeCachedUser(userData);
      } catch (error: any) {
        // Only a rejected identity should end the session. A network blip or a
        // backend that's briefly down must NOT log the user out - previously any
        // failure here did, which meant a momentarily unreachable API silently
        // signed people out mid-session.
        const statusCode = error?.response?.status;
        if (statusCode === 401 || statusCode === 403) {
          console.warn('Session rejected by the server, signing out.');
          logout();
        } else {
          console.error('Could not refresh user profile; keeping the cached session.', error);
        }
      } finally {
        setIsLoading(false);
      }
    };
    initAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // The other side of the handshake: answer newly-opened tabs, and keep logout in
  // sync so signing out in one tab doesn't leave the others looking signed in.
  useEffect(() => {
    const channel = openAuthChannel();
    if (!channel) return;

    channel.onmessage = (event: MessageEvent<AuthMessage>) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'request-token') {
        // Only a tab that actually holds a token replies. Read from storage rather
        // than from state so the answer is correct even mid-render.
        const current = getStoredToken();
        if (current) {
          channel.postMessage({
            type: 'share-token',
            token: current,
            user: localStorage.getItem(USER_CACHE_KEY) || sessionStorage.getItem(USER_CACHE_KEY),
          } as AuthMessage);
        }
      } else if (msg.type === 'logout') {
        // Clear local copies directly - calling logout() here would re-broadcast and
        // bounce the message around every open tab.
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('refresh_token');
        localStorage.removeItem(SESSION_HINT_KEY);
        writeCachedUser(null);
        setToken(null);
        setUser(null);
      }
    };

    return () => channel.close();
  }, []);

  // Raised by services/api.ts when a 401 survives a refresh attempt (the refresh
  // token itself is missing/expired) - the session is genuinely over, so this
  // tab signs out the same way an explicit logout() click would, instead of
  // leaving the user staring at silently-failing requests.
  useEffect(() => {
    const onSessionExpired = () => logout();
    window.addEventListener('conceptintel:session-expired', onSessionExpired);
    return () => window.removeEventListener('conceptintel:session-expired', onSessionExpired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deliberately does NOT touch isLoading below - that flag means "still checking
  // for a saved session at app startup" and gates whether GuestRoute/PrivateRoute
  // render the page at all. Reusing it for "a login request is in flight" caused a
  // real bug: it briefly went true mid-login, GuestRoute rendered null instead of
  // the Login page, tearing down (unmounting) the exact component instance whose
  // catch block was about to call setError - so the error silently vanished into a
  // component that no longer existed. Callers (Login.tsx etc.) already track their
  // own local `loading` state for the button/spinner - that's the correct layer for
  // per-request loading state, not this context-wide flag.
  //
  // Both sign-in paths resolve the profile BEFORE returning. The caller's own
  // button spinner is already showing at that point, so the /auth/me round trip
  // costs nothing visually - whereas deferring it (the old behaviour) dropped the
  // user onto a protected route with `user` still null, which rendered a second
  // full-screen "Authenticating session..." after the button had already
  // finished. That double wait is what made Google sign-in feel slow, and it's
  // also what let a route briefly resolve against a not-yet-known role.
  // `profile` is the `user` object /auth/login and /auth/google now return
  // inline (see backend/app/auth/schemas.py Token.user) - passing it in means
  // sign-in no longer needs a second, sequential GET /auth/me round trip just to
  // learn who just logged in. That second request was a full extra network +
  // remote-DB leg stacked on top of the login call itself, which is exactly what
  // made the gap between "signed in" and "dashboard rendered" visible - most of
  // all on Google sign-in, where it lands right after the token-verification
  // call. Still falls back to fetching it if a response is ever missing it (an
  // older cached deploy, a hand-rolled test response, etc).
  const completeSignIn = async (
    accessToken: string, refreshToken: string | undefined, rememberMe: boolean, profile?: any,
  ) => {
    storeToken(accessToken, refreshToken, rememberMe);
    try {
      const resolvedProfile = profile || await authService.getMe();
      fetchedForToken.current = accessToken;
      setUser(resolvedProfile);
      writeCachedUser(resolvedProfile);
    } catch {
      // Non-fatal: leave it to the effect below to retry once `token` changes.
      // Sign-in itself succeeded - the token is valid and already stored.
    }
    setToken(accessToken);
  };

  const login = async (credentials: any, rememberMe: boolean = false) => {
    const data = await authService.login(credentials);
    await completeSignIn(data.access_token, data.refresh_token, rememberMe, data.user);
    return data;
  };

  const loginWithGoogle = async (idToken: string, rememberMe: boolean = false) => {
    const data = await authService.google(idToken);
    await completeSignIn(data.access_token, data.refresh_token, rememberMe, data.user);
    return data;
  };

  const register = async (userData: any) => {
    return authService.register(userData);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('refresh_token');
    localStorage.removeItem(SESSION_HINT_KEY);
    writeCachedUser(null);
    // Drop every cached API response too - otherwise the next person to sign in
    // on this browser would be served the previous user's dashboard data.
    clearApiCache();
    fetchedForToken.current = null;
    setToken(null);
    setUser(null);
    setIsLoading(false);
    // Tell every other open tab to drop the session too. Without this, signing out
    // in one tab leaves the others holding a live token - and worse, a new tab could
    // then borrow it back through the handshake above.
    const channel = openAuthChannel();
    if (channel) {
      channel.postMessage({ type: 'logout' } as AuthMessage);
      channel.close();
    }
  };

  // Re-fetches /auth/me so a change made elsewhere (e.g. uploading/removing a
  // profile photo) is reflected in `user` everywhere it's consumed, without a
  // full page reload.
  const refreshUser = async () => {
    const userData = await authService.getMe();
    setUser(userData);
    writeCachedUser(userData);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, loginWithGoogle, register, logout, refreshUser }}>
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
