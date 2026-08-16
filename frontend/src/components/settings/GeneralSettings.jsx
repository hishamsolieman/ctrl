import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import { getGeneralSettings, updateGeneralSettings } from "@/lib/settings";
import { uploadImage, mediaUrl } from "@/lib/products";
import { IconImage, IconX, IconActivity, IconReceipt } from "@/components/icons";

const LANGS = ["auto", "en", "ar"];

const EMPTY = {
  branch_address: "",
  report_logo: "",
  invoice_logo: "",
  customer_phone_regex: "",
  currency: "",
  invoice_language: "auto",
  backup_duration_hours: "24",
};

function LogoCard({ label, hint, value, onChange, uploading, Icon }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);

  return (
    <div className="ctrl-card flex flex-col p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated text-accent">
          <Icon width={18} height={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">{label}</p>
          {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</p>}
        </div>
      </div>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className={`relative flex min-h-[11rem] flex-1 items-center justify-center overflow-hidden rounded-xl border border-dashed transition ${
          value
            ? "border-border bg-elevated/40 hover:border-accent"
            : "border-border bg-elevated/20 text-muted hover:border-accent hover:text-accent"
        } disabled:opacity-50`}
      >
        {value ? (
          <img src={mediaUrl(value)} alt="" className="max-h-40 max-w-[80%] object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-2 px-4 text-center">
            <IconImage width={28} height={28} />
            <span className="text-sm font-medium">
              {uploading ? t("settings.general.uploading") : t("settings.general.addLogo")}
            </span>
          </span>
        )}
      </button>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="ctrl-btn border border-border px-3 py-1.5 text-xs text-text hover:bg-elevated disabled:opacity-50"
        >
          <IconImage width={14} height={14} />
          {uploading
            ? t("settings.general.uploading")
            : value
              ? t("settings.general.changeLogo")
              : t("settings.general.addLogo")}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="ctrl-btn border border-border px-3 py-1.5 text-xs text-muted hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
          >
            <IconX width={13} height={13} />
            {t("settings.general.removeLogo")}
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) await onChange(file);
        }}
      />
    </div>
  );
}

export default function GeneralSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getGeneralSettings();
      setForm({
        branch_address: data.branch_address || "",
        report_logo: data.report_logo || "",
        invoice_logo: data.invoice_logo || "",
        customer_phone_regex: data.customer_phone_regex || "",
        currency: data.currency || "",
        invoice_language: LANGS.includes(data.invoice_language) ? data.invoice_language : "auto",
        backup_duration_hours: String(data.backup_duration_hours || 24),
      });
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function onLogo(key, fileOrEmpty) {
    if (fileOrEmpty === "") {
      set(key, "");
      return;
    }
    setUploading(key);
    try {
      set(key, await uploadImage(fileOrEmpty));
    } catch (err) {
      if (err?.code === "unsupported") toast.error(t("products.modal.imageUnsupported"));
      else {
        const detail = err?.response?.data?.detail;
        toast.error(detail ? t(detail, { defaultValue: t("auth.genericError") }) : t("auth.genericError"));
      }
    } finally {
      setUploading("");
    }
  }

  async function submit(e) {
    e.preventDefault();
    const regex = form.customer_phone_regex.trim();
    if (!regex) return toast.error(t("settings.general.errors.badRegex"));
    try {
      new RegExp(regex);
    } catch {
      return toast.error(t("settings.general.errors.badRegex"));
    }
    if (!form.currency.trim()) return toast.error(t("settings.general.errors.currencyRequired"));
    const hours = parseInt(form.backup_duration_hours, 10);
    if (!Number.isInteger(hours) || hours < 1) return toast.error(t("settings.general.errors.backupHours"));

    setSaving(true);
    try {
      const saved = await updateGeneralSettings({
        branch_address: form.branch_address.trim(),
        report_logo: form.report_logo || "",
        invoice_logo: form.invoice_logo || "",
        customer_phone_regex: regex,
        currency: form.currency.trim(),
        invoice_language: form.invoice_language || "auto",
        backup_duration_hours: hours,
      });
      setForm((f) => ({
        ...f,
        ...saved,
        invoice_language: saved.invoice_language || "auto",
        backup_duration_hours: String(saved.backup_duration_hours || hours),
      }));
      toast.success(t("settings.general.saved"));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1.5 block text-xs font-medium text-muted";

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="ctrl-card h-64 animate-pulse bg-elevated/40" />
          <div className="ctrl-card h-64 animate-pulse bg-elevated/40" />
        </div>
        <div className="ctrl-card h-36 animate-pulse bg-elevated/40" />
        <div className="ctrl-card h-52 animate-pulse bg-elevated/40" />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-6">
      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold text-text">{t("settings.general.section.branding")}</h2>
          <p className="text-sm text-muted">{t("settings.general.section.brandingSub")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <LogoCard
            Icon={IconActivity}
            label={t("settings.general.reportLogo")}
            hint={t("settings.general.reportLogoHint")}
            value={form.report_logo}
            uploading={uploading === "report_logo"}
            onChange={(v) => onLogo("report_logo", v)}
          />
          <LogoCard
            Icon={IconReceipt}
            label={t("settings.general.invoiceLogo")}
            hint={t("settings.general.invoiceLogoHint")}
            value={form.invoice_logo}
            uploading={uploading === "invoice_logo"}
            onChange={(v) => onLogo("invoice_logo", v)}
          />
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold text-text">{t("settings.general.section.backup")}</h2>
          <p className="text-sm text-muted">{t("settings.general.section.backupSub")}</p>
        </div>
        <div className="ctrl-card p-5 sm:p-6">
          <div className="max-w-sm">
            <label className={labelCls}>{t("settings.general.backupHours")}</label>
            <input
              className={inputCls}
              dir="ltr"
              inputMode="numeric"
              value={form.backup_duration_hours}
              onChange={(e) => set("backup_duration_hours", e.target.value.replace(/\D/g, ""))}
            />
            <p className="mt-1.5 text-[12px] text-muted">{t("settings.general.backupHoursHint")}</p>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold text-text">{t("settings.general.section.store")}</h2>
          <p className="text-sm text-muted">{t("settings.general.section.storeSub")}</p>
        </div>
        <div className="ctrl-card p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <label className={labelCls}>{t("settings.general.branchAddress")}</label>
              <textarea
                rows={4}
                className={`${inputCls} min-h-[6.5rem] resize-y`}
                value={form.branch_address}
                onChange={(e) => set("branch_address", e.target.value)}
              />
              <p className="mt-1.5 text-[12px] text-muted">{t("settings.general.branchAddressHint")}</p>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-6 lg:grid-cols-1">
              <div>
                <label className={labelCls}>{t("settings.general.currency")}</label>
                <input
                  className={inputCls}
                  dir="ltr"
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>{t("settings.general.invoiceLanguage")}</label>
                <select
                  className={`ctrl-select ${inputCls}`}
                  value={form.invoice_language}
                  onChange={(e) => set("invoice_language", e.target.value)}
                >
                  {LANGS.map((code) => (
                    <option key={code} value={code}>
                      {t(`settings.general.invoiceLang.${code}`)}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[12px] text-muted">{t("settings.general.invoiceLanguageHint")}</p>
              </div>
            </div>

            <div className="lg:col-span-12">
              <label className={labelCls}>{t("settings.general.phoneRegex")}</label>
              <input
                className={`${inputCls} font-mono`}
                dir="ltr"
                value={form.customer_phone_regex}
                onChange={(e) => set("customer_phone_regex", e.target.value)}
              />
              <p className="mt-1.5 text-[12px] text-muted">{t("settings.general.phoneRegexHint")}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex justify-end border-t border-border pt-4">
        <button type="submit" disabled={saving || !!uploading} className="ctrl-btn-accent px-6 py-2.5 text-sm">
          {saving ? t("settings.general.saving") : t("settings.general.save")}
        </button>
      </div>
    </form>
  );
}
