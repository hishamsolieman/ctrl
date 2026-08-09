import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { useToast } from "@/context/ToastContext";
import Logo from "@/components/Logo";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { IconEye, IconEyeOff } from "@/components/icons";

// Same shell as Login — forced password change after first login / admin reset.
export default function ResetPassword() {
  const { t } = useTranslation();
  const { changePassword, logout } = useAuth();
  const brand = useBrand();
  const toast = useToast();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const pw = password.trim();
    const cf = confirm.trim();
    if (!pw || !cf) return toast.error(t("auth.reset.errors.required"));
    if (pw.length < 8) return toast.error(t("auth.reset.errors.passwordShort"));
    if (pw !== cf) return toast.error(t("auth.reset.errors.mismatch"));

    setSubmitting(true);
    try {
      await changePassword(pw, cf);
      toast.success(t("auth.reset.success"));
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(
        typeof detail === "string"
          ? t(detail, { defaultValue: detail })
          : t("auth.genericError")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ctrl-grid-bg relative flex min-h-screen items-center justify-center bg-bg px-4 py-10">
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
            {t("auth.reset.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-center text-sm text-muted">
            {t("auth.reset.subtitle")}
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-muted">
                {t("auth.reset.password")}
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  className="ctrl-input pe-11"
                  placeholder={t("auth.reset.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  minLength={8}
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
              <p className="mt-1.5 text-xs text-muted">{t("auth.reset.hint")}</p>
            </div>

            <div>
              <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-muted">
                {t("auth.reset.confirm")}
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  className="ctrl-input pe-11"
                  placeholder={t("auth.reset.confirmPlaceholder")}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted hover:text-text"
                  tabIndex={-1}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  {showConfirm ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <button type="submit" className="ctrl-btn-accent mt-2 w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-black/40 border-t-black" />
                  {t("auth.reset.saving")}
                </>
              ) : (
                t("auth.reset.submit")
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
              className="ctrl-btn w-full border border-border px-3 py-2.5 text-sm text-muted hover:bg-elevated hover:text-text"
            >
              {t("common.signOut")}
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
