import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { createPrintProfile, updatePrintProfile, isDesktop } from "@/lib/settings";
import { IconRefresh } from "@/components/icons";

const STANDARD_SIZES = ["A4", "A5", "A6", "Letter", "80mm", "58mm"];
const UNITS = ["mm", "cm", "in"];

function blank() {
  return {
    name: "",
    printer_name: "",
    size_mode: "standard",
    standard_size: "A4",
    width: "",
    height: "",
    unit: "mm",
  };
}

export default function PrintProfileModal({
  open,
  mode,
  initial,
  printers,
  printersLoading,
  onRefreshPrinters,
  onClose,
  onSaved,
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = mode === "edit";
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);

  // Keep the currently-saved printer selectable even if it's not (or no longer)
  // in the live device list (e.g. editing a profile whose printer is offline).
  const printerOptions = useMemo(() => {
    const list = [...(printers || [])];
    if (form.printer_name && !list.includes(form.printer_name)) list.unshift(form.printer_name);
    return list;
  }, [printers, form.printer_name]);

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            name: initial.name || "",
            printer_name: initial.printer_name || "",
            size_mode: initial.size_mode || "standard",
            standard_size: initial.standard_size || "A4",
            width: initial.width ?? "",
            height: initial.height ?? "",
            unit: initial.unit || "mm",
          }
        : blank()
    );
  }, [open, initial]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const title = useMemo(
    () => (isEdit ? t("settings.printer.modal.editTitle") : t("settings.printer.modal.addTitle")),
    [isEdit, t]
  );

  async function submit() {
    if (!form.name.trim()) return toast.error(t("settings.printer.errors.nameRequired"));
    if (!form.printer_name.trim()) return toast.error(t("settings.printer.errors.printerRequired"));
    if (form.size_mode === "standard" && !form.standard_size)
      return toast.error(t("settings.printer.errors.sizeRequired"));
    if (form.size_mode === "custom") {
      if (!(Number(form.width) > 0) || form.height === "" || Number(form.height) < 0)
        return toast.error(t("settings.printer.errors.sizeRequired"));
    }

    const payload = {
      name: form.name.trim(),
      printer_name: form.printer_name.trim(),
      size_mode: form.size_mode,
      standard_size: form.size_mode === "standard" ? form.standard_size : null,
      width: form.size_mode === "custom" ? Number(form.width) : null,
      height: form.size_mode === "custom" ? Number(form.height) : null,
      unit: form.unit,
    };
    setSaving(true);
    try {
      let saved;
      if (isEdit) {
        saved = await updatePrintProfile(initial.id, payload);
        toast.success(t("settings.printer.modal.updated"));
      } else {
        saved = await createPrintProfile(payload);
        toast.success(t("settings.printer.modal.created"));
      }
      onSaved?.(saved);
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
      title={title}
      dismissable={false}
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("settings.printer.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("settings.printer.modal.saving") : t("settings.printer.modal.save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls}>{t("settings.printer.modal.name")} *</label>
          <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>{t("settings.printer.modal.printer")} *</label>
          <div className="flex items-center gap-2">
            <select className={`${inputCls} ctrl-select`} value={form.printer_name}
              disabled={printersLoading || printerOptions.length === 0}
              onChange={(e) => set("printer_name", e.target.value)}>
              <option value="" disabled>
                {printersLoading
                  ? t("settings.printer.modal.loadingPrinters")
                  : printerOptions.length === 0
                  ? t("settings.printer.modal.noPrinters")
                  : t("settings.printer.modal.selectPrinter")}
              </option>
              {printerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" onClick={onRefreshPrinters} disabled={printersLoading}
              title={t("settings.printer.modal.refresh")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent disabled:opacity-50">
              <IconRefresh width={16} height={16} className={printersLoading ? "animate-spin" : ""} />
            </button>
          </div>
          {!isDesktop() && (
            <p className="mt-1 text-[11px] text-amber-400">{t("settings.printer.modal.desktopOnly")}</p>
          )}
        </div>

        <div>
          <label className={labelCls}>{t("settings.printer.modal.sizeMode")}</label>
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {["standard", "custom"].map((m) => (
              <button key={m} type="button" onClick={() => set("size_mode", m)}
                className={`px-3 py-1.5 text-sm transition ${form.size_mode === m ? "bg-accent text-black" : "text-muted hover:bg-elevated"}`}>
                {t(`settings.printer.modal.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {form.size_mode === "standard" ? (
          <div>
            <label className={labelCls}>{t("settings.printer.modal.standardSize")} *</label>
            <select className={`${inputCls} ctrl-select`} value={form.standard_size}
              onChange={(e) => set("standard_size", e.target.value)}>
              {STANDARD_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>{t("settings.printer.modal.width")} *</label>
              <input type="number" min={0} step="0.1" className={inputCls} dir="ltr"
                value={form.width} onChange={(e) => set("width", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t("settings.printer.modal.height")}</label>
              <input type="number" min={0} step="0.1" className={inputCls} dir="ltr"
                value={form.height} onChange={(e) => set("height", e.target.value)} />
              <p className="mt-1 text-[11px] text-muted">{t("settings.printer.modal.heightHint")}</p>
            </div>
            <div>
              <label className={labelCls}>{t("settings.printer.modal.unit")}</label>
              <select className={`${inputCls} ctrl-select`} value={form.unit}
                onChange={(e) => set("unit", e.target.value)}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
