// Theme (light/dark) context: stores the choice in localStorage and applies it to <html>.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

// The two supported themes.
export type Theme = 'light' | 'dark';

// localStorage key where the user's explicit choice is saved.
const STORAGE_KEY = 'conceptintel-theme';

// What consumers get from useTheme().
interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

// The context object; undefined default lets useTheme detect a missing provider.
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Reads the OS-level dark-mode preference (used when the user hasn't chosen).
const getSystemPreference = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

// Returns the saved theme, or null if none/invalid (or when not in a browser).
const readStoredTheme = (): Theme | null => {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
};

// Applies the theme to <html> as `class="dark"` (Tailwind's `darkMode: 'class'`
// config already expects this) so every `dark:` utility and CSS-variable
// override in index.css picks it up immediately, including on first paint.
const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.setAttribute('data-theme', theme);
};

// Provider: holds theme state, syncs it to the DOM, and exposes setTheme/toggleTheme.
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? getSystemPreference());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow OS-level changes only until the user makes an explicit choice of their own.
  useEffect(() => {
    if (readStoredTheme() !== null) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (readStoredTheme() === null) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  // Explicit user choice: update state and persist it (which stops following the OS).
  const setTheme = (next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  // Flips between light and dark.
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  // Memoised so consumers only re-render when the theme changes.
  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// Hook for components to read/change the theme; must be used inside ThemeProvider.
export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
};
