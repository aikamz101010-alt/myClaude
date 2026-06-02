/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#0F172A",
        surface:  "#1E293B",
        surface2: "#334155",
        accent:   "#22C55E",
        text:     "#F8FAFC",
        muted:    "#94A3B8",
        error:    "#EF4444",
        warning:  "#F59E0B",
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
