import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { resetUserPassword } from "@/lib/users";

// Reset a user's password: leave the field blank to auto-generate a strong one,
// or type a custom password (min 8). On success the caller shows the credential.
export default function ResetPasswordModal({ open, user, onClose, onDone }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setPassword("");
  }, [open]);

  async function submit() {
    const pw = password.trim();
    if (pw && pw.length < 8) return toast.error(t("users.errors.passwordShort"));
    setSaving(true);
    try {
      const cred = await resetUserPassword(user.id, pw || null);
      onDone?.(cred);
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("users.reset.title")}
      dismissable={false}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("users.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("users.modal.saving") : t("users.reset.confirm")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {t("users.reset.body", { name: user?.full_name || user?.username || "" })}
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            {t("users.reset.customLabel")}
          </label>
          <input className="ctrl-input-sm w-full text-sm" dir="ltr" value={password}
            placeholder={t("users.reset.placeholder")}
            onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-[11px] text-muted">{t("users.reset.hint")}</p>
        </div>
      </div>
    </Modal>
  );
}
