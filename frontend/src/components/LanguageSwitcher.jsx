import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/i18n";

// Toggle between configured languages; direction (RTL/LTR) updates automatically.
export default function LanguageSwitcher({ className = "" }) {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage;

  return (
    <div
      className={`inline-flex items-center rounded-lg border border-border bg-elevated p-0.5 ${className}`}
    >
      {LANGUAGES.map((lng) => {
        const active = current === lng.code;
        return (
          <button
            key={lng.code}
            type="button"
            onClick={() => i18n.changeLanguage(lng.code)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              active ? "bg-accent text-black" : "text-muted hover:text-text"
            }`}
          >
            {lng.label}
          </button>
        );
      })}
    </div>
  );
}
