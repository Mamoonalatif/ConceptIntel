/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Theme-aware surface tokens ──
        // All resolve through CSS variables (see src/index.css :root / .dark) so the
        // same className works in both light and dark without any `dark:` prefix.
        // The `<alpha-value>` placeholder lets Tailwind opacity modifiers (e.g. bg-surface/50) keep working.
        background: "rgb(var(--bg) / <alpha-value>)",
        surface:    "rgb(var(--surface) / <alpha-value>)",
        card:       "rgb(var(--card) / <alpha-value>)",
        border:     "rgb(var(--border) / <alpha-value>)",

        // ── Brand Accent Palette (same hue in both themes, per design) ──
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          hover:   "rgb(var(--primary-hover) / <alpha-value>)",
          light:   "rgb(var(--primary-light) / <alpha-value>)",
          muted:   "rgb(var(--primary-muted) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          hover:   "rgb(var(--secondary-hover) / <alpha-value>)",
          light:   "rgb(var(--secondary-light) / <alpha-value>)",
          muted:   "rgb(var(--secondary-muted) / <alpha-value>)",
        },

        // ── Text Colors ──
        text: {
          primary:   "rgb(var(--text-primary) / <alpha-value>)",
          secondary: "rgb(var(--text-secondary) / <alpha-value>)",
          muted:     "rgb(var(--text-muted) / <alpha-value>)",
        },
      },
      fontFamily: {
        // Inter first: a neutral, highly-legible UI typeface (same family used by most
        // professional education/productivity dashboards) - 'Outfit' kept only as a
        // fallback, not the primary voice of the app anymore.
        sans: ['Inter', 'Outfit', 'system-ui', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        // Flat, neutral shadows (no colored glow) - a plain elevation cue rather than
        // a brand-tinted halo, matching a calmer "education app" look.
        'soft':   '0 1px 2px 0 rgba(15,23,42,0.04), 0 1px 3px -1px rgba(15,23,42,0.06)',
        'card':   '0 1px 3px 0 rgba(15,23,42,0.06), 0 2px 8px -2px rgba(15,23,42,0.06)',
        'focus':  '0 0 0 3px rgba(37,99,235,0.18)',
        'glow':   '0 4px 14px -4px rgba(15,23,42,0.12)',
        'hover':  '0 4px 16px -4px rgba(15,23,42,0.14)',
      },
      keyframes: {
        'slide-in': {
          '0%':   { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(37,99,235,0)' },
          '50%':       { boxShadow: '0 0 12px 2px rgba(37,99,235,0.10)' },
        },
        'spin-slow': {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'slide-in':   'slide-in 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
        'fade-in':    'fade-in 0.35s ease-out both',
        'fade-up':    'fade-up 0.4s ease-out both',
        'pulse-glow': 'pulse-glow 2.5s ease-in-out infinite',
        'spin-slow':  'spin-slow 3s linear infinite',
        'shimmer':    'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
}
