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
      // ── Type scale ──
      // Overrides Tailwind's defaults, which this app had been using unchanged.
      // The problem that motivated this: 56% of every text-size utility in src/ was
      // 12px or smaller, and headings (text-base, 16px) sat only 2px above body
      // (text-sm, 14px). The result read as one flat wall of small grey text with no
      // hierarchy - "flat and cramped" is a typography problem here, not a colour one.
      //
      // Two things change. The floor lifts (12 -> 13, 14 -> 15) so body copy is
      // comfortable, and the GAPS widen as the scale climbs (17 -> 19 -> 22 -> 28) so a
      // heading actually reads as a heading. Line-heights are set explicitly and run
      // looser than Tailwind's defaults, which is most of the "cramped" feeling.
      //
      // App-wide by design: every existing className picks it up with no edits.
      fontSize: {
        xs:   ['0.8125rem', { lineHeight: '1.15rem' }],   // 13px  (was 12)
        sm:   ['0.9375rem', { lineHeight: '1.4rem'  }],   // 15px  (was 14)
        base: ['1.0625rem', { lineHeight: '1.65rem' }],   // 17px  (was 16)
        lg:   ['1.1875rem', { lineHeight: '1.8rem'  }],   // 19px  (was 18)
        xl:   ['1.375rem',  { lineHeight: '1.9rem'  }],   // 22px  (was 20)
        '2xl':['1.75rem',   { lineHeight: '2.2rem'  }],   // 28px  (was 24)
        '3xl':['2.125rem',  { lineHeight: '2.5rem'  }],   // 34px  (was 30)
        '4xl':['2.5rem',    { lineHeight: '2.9rem'  }],   // 40px  (was 36)
        '5xl':['3.25rem',   { lineHeight: '1.1'     }],   // 52px  (was 48)
      },
      fontFamily: {
        // Duolingo-style pairing: 'Nunito' (rounded, friendly) for body/UI text,
        // 'Baloo 2' (chunky, bubbly) reserved for headings via `font-display`.
        sans: ['Nunito', 'system-ui', 'sans-serif'],
        display: ['Baloo 2', 'Nunito', 'system-ui', 'sans-serif'],
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
