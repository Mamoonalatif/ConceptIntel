import React from 'react';
import { Check, X } from 'lucide-react';

export const SPECIAL_CHARS = '!@#$%^&*';

export const passwordChecks = (password: string) => ({
  length: password.length >= 8,
  upper: /[A-Z]/.test(password),
  lower: /[a-z]/.test(password),
  digit: /[0-9]/.test(password),
  special: [...password].some((ch) => SPECIAL_CHARS.includes(ch)),
});

export const isPasswordValid = (password: string) =>
  Object.values(passwordChecks(password)).every(Boolean);

const RULES: { key: keyof ReturnType<typeof passwordChecks>; label: string }[] = [
  { key: 'length', label: 'At least 8 characters' },
  { key: 'upper', label: 'One uppercase letter' },
  { key: 'lower', label: 'One lowercase letter' },
  { key: 'digit', label: 'One number' },
  { key: 'special', label: `One special character (${SPECIAL_CHARS})` },
];

// Full checklist, shown as soon as the password field is focused (even before typing)
// and live-updated on every keystroke: each rule turns green with a check as soon as
// it's satisfied, and stays red with a cross while it's violated.
export const PasswordChecklist: React.FC<{ password: string; visible: boolean }> = ({ password, visible }) => {
  if (!visible) return null;
  const checks = passwordChecks(password);

  return (
    <ul className="mt-2 space-y-1">
      {RULES.map(({ key, label }) => {
        const passed = checks[key];
        return (
          <li
            key={key}
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              passed ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {passed ? (
              <Check className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <X className="w-3.5 h-3.5 shrink-0" />
            )}
            {label}
          </li>
        );
      })}
    </ul>
  );
};
