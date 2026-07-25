/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Backed by CSS variables (R G B triplets) set at runtime from the root
        // .env (see theme.js). Using rgb(var / <alpha-value>) enables opacity
        // modifiers like bg-accent/15.
        bg: "rgb(var(--ctrl-bg) / <alpha-value>)",
        surface: "rgb(var(--ctrl-surface) / <alpha-value>)",
        elevated: "rgb(var(--ctrl-elevated) / <alpha-value>)",
        border: "rgb(var(--ctrl-border) / <alpha-value>)",
        text: "rgb(var(--ctrl-text) / <alpha-value>)",
        muted: "rgb(var(--ctrl-muted) / <alpha-value>)",
        accent: "rgb(var(--ctrl-accent) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Poppins", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        accent: "0 0 24px -6px rgb(var(--ctrl-accent) / 0.7)",
      },
      keyframes: {
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "pulse-accent": {
          "0%,100%": { opacity: 1 },
          "50%": { opacity: 0.4 },
        },
      },
      animation: {
        "spin-slow": "spin-slow 1.1s linear infinite",
        "fade-in": "fade-in 0.4s ease both",
        "pulse-accent": "pulse-accent 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
