import { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { IconCopy, IconCheck } from "@/components/icons";

// Shows a freshly created / reset credential once. The password is never
// retrievable again, so we make it easy to copy.
export default function CredentialDialog({ open, cred, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(cred?.password || "");
      setCopied(true);
      toast.success(t("users.cred.copied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("auth.genericError"));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("users.cred.title")}
      dismissable={false}
      size="sm"
      footer={
        <button type="button" onClick={onClose}
          className="ctrl-btn bg-accent text-black hover:brightness-95">
          {t("users.cred.done")}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{t("users.cred.body")}</p>
        <div className="rounded-xl border border-border bg-elevated/40 p-4">
          <p className="text-[11px] uppercase tracking-widest text-muted">{t("users.cred.username")}</p>
          <p className="mt-1 font-mono text-sm text-text" dir="ltr">{cred?.username}</p>
          <p className="mt-3 text-[11px] uppercase tracking-widest text-muted">{t("users.cred.password")}</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-lg bg-bg px-3 py-2 font-mono text-sm text-accent" dir="ltr">
              {cred?.password}
            </code>
            <button type="button" onClick={copy} title={t("users.cred.copy")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent">
              {copied ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-amber-400">{t("users.cred.warning")}</p>
      </div>
    </Modal>
  );
}
