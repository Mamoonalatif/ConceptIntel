import { AlertCircle, Check } from 'lucide-react';
import { cn } from '../ui/utils';

const PASSWORD_RULES = [
  {
    id: 'length',
    message: 'Use 8 characters or more for your password',
    test: (password: string) => password.length >= 8,
  },
  {
    id: 'uppercase',
    message: 'Use at least one uppercase letter',
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: 'lowercase',
    message: 'Use at least one lowercase letter',
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    id: 'number',
    message: 'Use at least one number',
    test: (password: string) => /\d/.test(password),
  },
  {
    id: 'special',
    message: 'Use at least one special character (!@#$%^&*)',
    test: (password: string) => /[!@#$%^&*]/.test(password),
  },
] as const;

function getCurrentRequirement(password: string) {
  if (!password) {
    return null;
  }

  for (const rule of PASSWORD_RULES) {
    if (!rule.test(password)) {
      return rule;
    }
  }

  return null;
}

interface PasswordRequirementsProps {
  password: string;
}

export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  const currentRequirement = getCurrentRequirement(password);
  const isStrongPassword = password.length > 0 && !currentRequirement;

  if (!password) {
    return null;
  }

  if (isStrongPassword) {
    return (
      <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
        Strong password
      </p>
    );
  }

  return (
    <p
      className={cn(
        'flex items-center gap-2 text-sm text-[#b3261e] dark:text-destructive',
      )}
      role="status"
      aria-live="polite"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      {currentRequirement?.message}
    </p>
  );
}
