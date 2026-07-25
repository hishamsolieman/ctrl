// Theme colors sourced from the root .env (VITE_THEME_*), applied at runtime as
// CSS variables (R G B triplets) so Tailwind tokens resolve and support opacity
// modifiers (e.g. bg-accent/15).
const env = import.meta.env;

export const theme = {
  bg: env.VITE_THEME_BG || "#000000",
  surface: env.VITE_THEME_SURFACE || "#0B0B0B",
  elevated: env.VITE_THEME_ELEVATED || "#141414",
  border: env.VITE_THEME_BORDER || "#232323",
  text: env.VITE_THEME_TEXT || "#FFFFFF",
  muted: env.VITE_THEME_MUTED || "#9A9A9A",
  accent: env.VITE_THEME_ACCENT || "#8EFF19",
};

// "#8EFF19" -> "142 255 25"
function hexToRgbTriplet(hex) {
  let h = String(hex).trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `${r} ${g} ${b}`;
}

export function applyTheme() {
  const root = document.documentElement;
  root.style.setProperty("--ctrl-bg", hexToRgbTriplet(theme.bg));
  root.style.setProperty("--ctrl-surface", hexToRgbTriplet(theme.surface));
  root.style.setProperty("--ctrl-elevated", hexToRgbTriplet(theme.elevated));
  root.style.setProperty("--ctrl-border", hexToRgbTriplet(theme.border));
  root.style.setProperty("--ctrl-text", hexToRgbTriplet(theme.text));
  root.style.setProperty("--ctrl-muted", hexToRgbTriplet(theme.muted));
  root.style.setProperty("--ctrl-accent", hexToRgbTriplet(theme.accent));
}

export default theme;
