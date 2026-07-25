import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { LANGUAGES } from "@/i18n";
import { IconUser, IconLogout } from "@/components/icons";

// Clickable user chip that opens a dropdown with language selection + logout.
export default function UserMenu() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click / Escape.
  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const current = i18n.resolvedLanguage;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-3 rounded-lg border px-2.5 py-1.5 transition ${
          open
            ? "border-accent bg-elevated"
            : "border-border bg-elevated hover:border-accent"
        }`}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-accent">
          <IconUser width={18} height={18} />
        </span>
        <span className="hidden text-start leading-tight sm:block">
          <span className="block text-xs font-semibold text-text">
            {user?.username}
          </span>
          <span className="block text-[10px] uppercase tracking-wide text-accent">
            {user?.role}
          </span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute end-0 mt-2 w-60 origin-top overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-fade-in">
          {/* Header */}
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-text">{user?.username}</p>
            <p className="text-[11px] uppercase tracking-wide text-accent">
              {user?.role}
            </p>
          </div>

          {/* Language selection */}
          <div className="px-2 py-2">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
              {t("common.language")}
            </p>
            {LANGUAGES.map((lng) => {
              const active = current === lng.code;
              return (
                <button
                  key={lng.code}
                  type="button"
                  onClick={() => i18n.changeLanguage(lng.code)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-elevated text-text"
                      : "text-muted hover:bg-elevated hover:text-text"
                  }`}
                >
                  <span>{lng.label}</span>
                  {active && (
                    <span className="h-2 w-2 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 transition hover:bg-red-500/10"
            >
              <IconLogout width={16} height={16} />
              {t("common.signOut")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
