import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { addAttributeValue } from "@/lib/products";

function blank() {
  return { value_en: "", value_ar: "", number: "", hex: "#8eff19" };
}

// Adds a new value to an EXISTING attribute (e.g. a new colour/size/material).
// On success calls onSaved(updatedAttribute, newValueId).
export default function AttributeValueModal({ open, attr, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(blank());
  }, [open, attr]);

  if (!attr) return null;

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const attrName = isAr ? attr.name_ar : attr.name_en;

  async function submit() {
    let payload;
    if (attr.type === "number") {
      if (form.number === "" || Number.isNaN(Number(form.number))) {
        toast.error(t("products.attrs.modal.valueRequired"));
        return;
      }
      payload = { value_en: String(form.number).trim(), value_ar: String(form.number).trim() };
    } else {
      if (!form.value_en.trim() || !form.value_ar.trim()) {
        toast.error(t("products.attrs.modal.valueRequired"));
        return;
      }
      payload = { value_en: form.value_en.trim(), value_ar: form.value_ar.trim() };
      if (attr.type === "color") payload.hex = form.hex;
    }
    setSaving(true);
    try {
      const res = await addAttributeValue(attr.id, payload);
      toast.success(t("products.modal.valueAdded"));
      onSaved?.(res.attribute, res.value_id);
      onClose?.();
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(d ? t(d, { defaultValue: d }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("products.modal.addValueTo", { name: attrName })}
      dismissable={false}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("products.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("products.modal.saving") : t("products.modal.save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {attr.type === "number" ? (
          <div>
            <label className={labelCls}>{t("products.attrs.modal.number")}</label>
            <input type="number" step="any" className={inputCls} value={form.number}
              onChange={(e) => set("number", e.target.value)} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>
                {attr.type === "color" ? t("products.attrs.modal.colorNameEn") : t("products.attrs.modal.valueEn")}
              </label>
              <input className={inputCls} value={form.value_en}
                onChange={(e) => set("value_en", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>
                {attr.type === "color" ? t("products.attrs.modal.colorNameAr") : t("products.attrs.modal.valueAr")}
              </label>
              <input className={inputCls} dir="rtl" value={form.value_ar}
                onChange={(e) => set("value_ar", e.target.value)} />
            </div>
          </div>
        )}

        {attr.type === "color" && (
          <div>
            <label className={labelCls}>{t("products.attrs.modal.color")}</label>
            <div className="flex items-center gap-3">
              <input type="color" className="h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                value={form.hex} onChange={(e) => set("hex", e.target.value)} />
              <span className="font-mono text-sm text-muted">{form.hex}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
