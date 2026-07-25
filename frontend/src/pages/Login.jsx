import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useToast } from "@/context/ToastContext";
import Logo from "@/components/Logo";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { IconEye, IconEyeOff } from "@/components/icons";

// Adapted from the Reback template's "SignIn2" page, re-themed to CTRL.
export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const brand = useBrand();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const from = location.state?.from?.pathname || "/dashboard";

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      const status = err?.response?.status;
      // Surface errors as a toast, never inside the form.
      toast.error(
        status === 401 ? t("auth.invalidCredentials") : t("auth.genericError")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ctrl-grid-bg relative flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      {/* Accent glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(142,255,25,0.10),transparent_60%)]" />

      <div className="absolute end-4 top-4">
        <LanguageSwitcher />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="ctrl-card px-6 py-8 shadow-2xl sm:px-9 sm:py-10">
          <div className="mb-8 flex flex-col items-center">
            <Logo className="h-9" withMotto />
          </div>

          <h1 className="text-center text-xl font-bold text-text">
            {t("auth.signInTitle")}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-center text-sm text-muted">
            {t("auth.signInSubtitle")}
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-muted">
                {t("auth.username")}
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                className="ctrl-input"
                placeholder={t("auth.usernamePlaceholder")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-muted">
                {t("auth.password")}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  className="ctrl-input pe-11"
                  placeholder={t("auth.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted hover:text-text"
                  tabIndex={-1}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <button type="submit" className="ctrl-btn-accent mt-2 w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-black/40 border-t-black" />
                  {t("auth.signingIn")}
                </>
              ) : (
                t("auth.signInButton")
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs uppercase tracking-widest text-muted">
          {brand.name} &middot; {brand.motto}
        </p>
      </div>
    </div>
  );
}
