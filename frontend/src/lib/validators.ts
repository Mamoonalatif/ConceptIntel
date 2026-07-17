// Deliberately simple (not RFC 5322-exhaustive) - catches the typos that matter
// (missing @, missing domain, stray spaces) without rejecting valid real-world addresses.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (value: string) => EMAIL_PATTERN.test(value.trim());
