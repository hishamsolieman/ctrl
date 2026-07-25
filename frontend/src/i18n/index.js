import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// The DB `translations` table (namespace 'ui', served by GET /i18n/{locale}) is
// the ONLY source of UI strings. There are no bundled en.json/ar.json files;
// `loadDbTranslations()` fetches everything at boot (see main.jsx).

// Languages configured here. Adding a new language = add an entry (strings live in the DB).
export const LANGUAGES = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
];

export const RTL_LANGUAGES = LANGUAGES.filter((l) => l.dir === "rtl").map(
  (l) => l.code
);

export function isRTL(lng) {
  return RTL_LANGUAGES.includes(lng);
}

// Keep <html> dir/lang in sync so RTL mirroring works app-wide.
export function applyDirection(lng) {
  const dir = isRTL(lng) ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", lng);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Resources are empty at init; they are populated from the DB in
    // loadDbTranslations() before the app renders.
    resources: {},
    fallbackLng: "en",
    supportedLngs: LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
    },
  });

applyDirection(i18n.resolvedLanguage || "en");
i18n.on("languageChanged", applyDirection);

// Rebuild a nested object from flat dotted keys ("a.b.c" -> {a:{b:{c:...}}}).
function unflatten(flat) {
  const out = {};
  for (const [dotted, value] of Object.entries(flat || {})) {
    const parts = dotted.split(".");
    let node = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) node[p] = value;
      else node = node[p] = node[p] || {};
    });
  }
  return out;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:2830";

// Load all UI translations from the DB (the single source of truth).
export async function loadDbTranslations(locales = LANGUAGES.map((l) => l.code)) {
  await Promise.all(
    locales.map(async (lng) => {
      try {
        const res = await fetch(`${API_BASE}/i18n/${lng}`);
        if (!res.ok) return;
        const data = await res.json();
        const ui = data?.translations?.ui;
        if (ui && Object.keys(ui).length) {
          i18n.addResourceBundle(lng, "translation", unflatten(ui), true, true);
        }
      } catch {
        /* network/API error: keys render raw until the API is reachable */
      }
    })
  );
  // Trigger a re-render for any already-mounted components.
  i18n.changeLanguage(i18n.resolvedLanguage);
}

export default i18n;
