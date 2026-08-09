import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { LANGUAGES } from "@/i18n";
import { mediaUrl } from "@/lib/products";
import { IconLogout } from "@/components/icons";

// "John Doe" → "JD". One word → first two letters. Falls back to the username.
function initialsOf(fullName, username) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const u = String(username || "").trim();
  return (u.slice(0, 2) || "?").toUpperCase();
}

function Avatar({ user }) {
  const src = user?.image_url ? mediaUrl(user.image_url) : "";
  if (src) {
    return (
      <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-border bg-elevated">
        <img src={src} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold tracking-wide text-accent">
      {initialsOf(user?.full_name, user?.username)}
    </span>
  );
}

// Clickable user chip that opens a dropdown with language selection + logout.
export default function UserMenu() {
  const { t, i18n } = useTranslation();
  const { user, logout, updateLocale } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Change the UI language AND persist it to the user's DB record so it
  // renders from that value on every device/session.
  async function selectLanguage(code) {
    try {
      await updateLocale(code);
    } catch {
      toast?.error?.(t("auth.genericError"));
    }
  }

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
        <Avatar user={user} />
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
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Avatar user={user} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text">{user?.username}</p>
              <p className="text-[11px] uppercase tracking-wide text-accent">
                {user?.role}
              </p>
            </div>
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
                  onClick={() => selectLanguage(lng.code)}
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
