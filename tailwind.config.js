/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Colors defined as RGB channels so opacity modifiers (bg-bg/50) still work
      colors: {
        bg:       'rgb(var(--color-bg) / <alpha-value>)',
        surface:  'rgb(var(--color-surface) / <alpha-value>)',
        surface2: 'rgb(var(--color-surface2) / <alpha-value>)',
        accent:   'rgb(var(--color-accent) / <alpha-value>)',
        text:     'rgb(var(--color-text) / <alpha-value>)',
        muted:    'rgb(var(--color-muted) / <alpha-value>)',
        error:    'rgb(var(--color-error) / <alpha-value>)',
        warning:  'rgb(var(--color-warning) / <alpha-value>)',
      },
      fontFamily: {
        mono: ["'Fira Code'", "monospace"],
        sans: ["'Fira Sans'", "sans-serif"],
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "slide-in":   "slide-in 0.2s ease-out",
        "fade-in":    "fade-in 0.15s ease-out",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 8px rgba(34,197,94,0.25)" },
          "50%":       { boxShadow: "0 0 20px rgba(34,197,94,0.5)" },
        },
        "slide-in": {
          from: { transform: "translateY(8px)", opacity: "0" },
          to:   { transform: "translateY(0)",   opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
}
