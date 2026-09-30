// Form validation helpers shared across pages.
// Deliberately simple (not RFC 5322-exhaustive) - catches the typos that matter
// (missing @, missing domain, stray spaces) without rejecting valid real-world addresses.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if the (trimmed) string looks like an email address. */
export const isValidEmail = (value: string) => EMAIL_PATTERN.test(value.trim());
