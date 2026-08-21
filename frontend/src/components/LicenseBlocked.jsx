import { useState } from "react";
import { useTranslation } from "react-i18next";
import brand from "@/config/brand";

export default function LicenseBlocked({ hwid }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!hwid) return;
    try {
      await navigator.clipboard.writeText(hwid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-bg px-6">
      <img src={brand.logo} alt={brand.name} className="h-8" />
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
        <h1 className="text-lg font-semibold text-text">
          {t("license.blocked.title", { defaultValue: "This device is not licensed" })}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t("license.blocked.body", {
            defaultValue: "This PC is not licensed for the desktop app.",
          })}
        </p>
        {hwid ? (
          <div className="mt-5">
            <p className="mb-1.5 text-[11px] uppercase tracking-widest text-muted">
              {t("license.blocked.hwid", { defaultValue: "HWID" })}
            </p>
            <p className="break-all rounded-lg bg-elevated px-3 py-2 font-mono text-xs text-text" dir="ltr">
              {hwid}
            </p>
            <button
              type="button"
              onClick={copy}
              className="ctrl-btn-accent mt-4 w-full text-sm"
            >
              {copied
                ? t("license.blocked.copied", { defaultValue: "Copied" })
                : t("license.blocked.copy", { defaultValue: "Copy HWID" })}
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-red-400">
            {t("license.blocked.readFailed", {
              defaultValue: "Could not read this PC’s hardware ID.",
            })}
          </p>
        )}
      </div>
    </div>
  );
}
