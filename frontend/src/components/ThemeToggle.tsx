// Purpose: icon button that switches the app between light and dark mode.
import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Shared light/dark toggle rendered next to `NotificationBell` on every
 * dashboard header. Styled to match the icon-button pattern already used
 * for the notification bell and change-password buttons in each dashboard.
 */
export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle color theme"
      className="p-2 text-text-muted hover:text-primary rounded-lg hover:bg-primary-muted border border-transparent hover:border-primary/20 transition-all"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};
