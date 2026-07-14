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
        // ── Light Theme Backgrounds ──
        background: "#f0f4ff",       // soft blue-white page bg
        surface:    "#ffffff",        // white cards / panels
        card:       "#f8faff",        // very light card bg
        border:     "#dde3f0",        // light neutral border

        // ── Brand Accent Palette ──
        primary: {
          DEFAULT: "#4f46e5",         // vivid indigo
          hover:   "#4338ca",
          light:   "#6366f1",
          muted:   "#eef2ff",         // indigo tint bg
        },
        secondary: {
          DEFAULT: "#0891b2",         // cyan
          hover:   "#0e7490",
          light:   "#06b6d4",
          muted:   "#ecfeff",         // cyan tint bg
        },

        // ── Text Colors ──
        text: {
          primary:   "#0f172a",       // near-black
          secondary: "#475569",       // slate medium
          muted:     "#94a3b8",       // slate light
        },
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'soft':   '0 1px 3px 0 rgba(15,23,42,0.06), 0 1px 2px -1px rgba(15,23,42,0.04)',
        'card':   '0 4px 16px -4px rgba(79,70,229,0.08), 0 1px 4px 0 rgba(15,23,42,0.06)',
        'focus':  '0 0 0 3px rgba(79,70,229,0.2)',
        'glow':   '0 8px 32px -8px rgba(79,70,229,0.25)',
        'hover':  '0 12px 36px -8px rgba(79,70,229,0.18), 0 4px 12px -4px rgba(15,23,42,0.08)',
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
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(79,70,229,0)' },
          '50%':       { boxShadow: '0 0 20px 4px rgba(79,70,229,0.12)' },
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
