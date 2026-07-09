export type AuthRole = 'student' | 'teacher' | 'coordinator' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: AuthRole;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
  role: AuthRole;
}

export interface LoginPayload {
  email: string;
  password: string;
}

const TOKEN_KEY = 'conceptintel_token';
const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): HeadersInit {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    let message = 'Request failed';
    if (typeof detail === 'string') {
      message = detail;
    } else if (Array.isArray(detail) && detail[0]?.msg) {
      message = detail[0].msg;
    }
    throw new Error(message);
  }
  return data as T;
}

export const authService = {
  async register(payload: RegisterPayload): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await handleResponse<AuthResponse>(res);
    setStoredToken(data.access_token);
    return data;
  },

  async login(payload: LoginPayload): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await handleResponse<AuthResponse>(res);
    setStoredToken(data.access_token);
    return data;
  },

  async me(): Promise<AuthUser> {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { ...authHeaders() },
    });
    return handleResponse<AuthUser>(res);
  },

  async logout(): Promise<void> {
    const token = getStoredToken();
    if (token) {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore network errors during logout
      }
    }
    clearStoredToken();
  },
};

export function dashboardPathForRole(role: AuthRole): string {
  switch (role) {
    case 'teacher':
      return '/teacher/dashboard';
    case 'coordinator':
      return '/coordinator/dashboard';
    case 'admin':
      return '/admin/dashboard';
    default:
      return '/student/dashboard';
  }
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Familiar first name for greetings (e.g. "Muhammad kashif" → "Kashif"). */
export function getFriendlyDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Student';
  const name = parts.length === 1 ? parts[0] : parts[parts.length - 1];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
