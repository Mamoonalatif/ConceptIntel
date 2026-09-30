// Purpose: password-strength rules (shared by register/reset/change-password forms) and a live checklist UI that shows which rules pass.
import React from 'react';
import { Check, X } from 'lucide-react';

// Characters that count as a "special character" in the password rules.
export const SPECIAL_CHARS = '!@#$%^&*';

// Evaluates each password rule and returns a pass/fail flag per rule.
export const passwordChecks = (password: string) => ({
  length: password.length >= 8,
  upper: /[A-Z]/.test(password),
  lower: /[a-z]/.test(password),
  digit: /[0-9]/.test(password),
  special: [...password].some((ch) => SPECIAL_CHARS.includes(ch)),
});

// True only when every rule passes; forms use this to allow submission.
export const isPasswordValid = (password: string) =>
  Object.values(passwordChecks(password)).every(Boolean);

// Display order and human-readable label for each rule shown in the checklist.
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
