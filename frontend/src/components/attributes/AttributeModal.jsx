import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { createAttribute, updateAttribute } from "@/lib/products";
import { IconPlus, IconX } from "@/components/icons";

let _k = 1;
const key = () => `av${_k++}`;

const TYPES = ["text", "number", "color"];

function toValue(v) {
  return {
    key: key(),
    id: v?.id ?? null,
    value_en: v?.value_en ?? "",
    value_ar: v?.value_ar ?? "",
    hex: v?.extra?.hex ?? "#8eff19",
  };
}

function blank() {
  // New attributes default to global (product-level; coding requires not-global).
  return { type: "text", name_en: "", name_ar: "", is_required: false, is_global: true, coding: false, values: [] };
}

export default function AttributeModal({ open, mode, initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);

  const isCopy = mode === "copy";
  const inUse = mode === "edit" && !!initial?.in_use;

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        type: initial.type || "text",
        name_en: isCopy ? "" : initial.name_en || "",
        name_ar: isCopy ? "" : initial.name_ar || "",
        is_required: !!initial.is_required,
        is_global: initial.is_global ?? true,
        coding: !!initial.coding,
        values: (initial.values || []).map((v) => ({ ...toValue(v), id: isCopy ? null : v.id })),
      });
    } else {
      setForm(blank());
    }
  }, [open, initial, mode, isCopy]);

  const title = useMemo(() => {
    if (mode === "edit") return t("products.attrs.modal.editTitle");
    if (mode === "copy") return t("products.attrs.modal.copyTitle");
    return t("products.attrs.modal.addTitle");
  }, [mode, t]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setVal = (k, patch) =>
    setForm((f) => ({ ...f, values: f.values.map((v) => (v.key === k ? { ...v, ...patch } : v)) }));
  const addValue = () => setForm((f) => ({ ...f, values: [...f.values, toValue()] }));
  const removeValue = (k) => setForm((f) => ({ ...f, values: f.values.filter((v) => v.key !== k) }));

  async function submit() {
    if (!form.name_en.trim() || !form.name_ar.trim()) {
      toast.error(t("products.attrs.modal.nameRequired"));
      return;
    }
    const values = form.values
      .map((v) => {
        if (form.type === "number") {
          const n = String(v.value_en).trim();
          if (!n) return null;
          return { ...(v.id ? { id: v.id } : {}), value_en: n, value_ar: n, extra: null };
        }
        if (form.type === "color") {
          if (!v.value_en.trim() || !v.value_ar.trim()) return null;
          return { ...(v.id ? { id: v.id } : {}), value_en: v.value_en.trim(), value_ar: v.value_ar.trim(),
                   extra: { hex: v.hex } };
        }
        if (!v.value_en.trim() || !v.value_ar.trim()) return null;
        return { ...(v.id ? { id: v.id } : {}), value_en: v.value_en.trim(), value_ar: v.value_ar.trim(), extra: null };
      })
      .filter(Boolean);

    // Values must be unique within the attribute (EN, AR, and hex for colours).
    const seenEn = new Set(), seenAr = new Set(), seenHex = new Set();
    for (const v of values) {
      const en = v.value_en.trim().toLowerCase();
      const ar = v.value_ar.trim().toLowerCase();
      if (en && seenEn.has(en)) { toast.error(t("products.attrs.errors.dupValueEn")); return; }
      if (ar && seenAr.has(ar)) { toast.error(t("products.attrs.errors.dupValueAr")); return; }
      seenEn.add(en); seenAr.add(ar);
      if (form.type === "color") {
        const hx = (v.extra?.hex || "").trim().toLowerCase();
        if (hx && seenHex.has(hx)) { toast.error(t("products.attrs.errors.dupColorHex")); return; }
        if (hx) seenHex.add(hx);
      }
    }

    const payload = {
      type: form.type,
      name_en: form.name_en.trim(),
      name_ar: form.name_ar.trim(),
      is_required: form.is_required,
      is_global: form.is_global,
      coding: form.coding && !form.is_global,
      values,
    };
    setSaving(true);
    try {
      let saved;
      if (mode === "edit") {
        saved = await updateAttribute(initial.id, payload);
        toast.success(t("products.attrs.modal.updated"));
      } else {
        saved = await createAttribute(payload);
        toast.success(t("products.attrs.modal.created"));
      }
      onSaved?.(saved);
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
      title={title}
      dismissable={false}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("products.attrs.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("products.attrs.modal.saving") : t("products.attrs.modal.save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {inUse && (
          <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
            {t("products.attrs.modal.inUseHint")}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>{t("products.attrs.modal.type")}</label>
            <select className={`${inputCls} ctrl-select`} value={form.type}
              onChange={(e) => set({ type: e.target.value })}>
              {TYPES.map((tp) => (
                <option key={tp} value={tp}>{t(`products.attrs.type.${tp}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{t("products.attrs.modal.nameEn")}</label>
            <input className={inputCls} value={form.name_en}
              onChange={(e) => set({ name_en: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>{t("products.attrs.modal.nameAr")}</label>
            <input className={inputCls} dir="rtl" value={form.name_ar}
              onChange={(e) => set({ name_ar: e.target.value })} />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input type="checkbox" className="ctrl-check" checked={form.is_required}
              onChange={(e) => set({ is_required: e.target.checked })} />
            {t("products.attrs.modal.mandatory")}
            <span className="text-xs text-muted">— {t("products.attrs.modal.mandatoryHint")}</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className={`flex items-center gap-2 text-sm text-text ${inUse ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
            <input type="checkbox" className="ctrl-check" checked={form.is_global} disabled={inUse}
              onChange={(e) => set(e.target.checked ? { is_global: true, coding: false } : { is_global: false })} />
            {t("products.attrs.modal.global")}
            <span className="text-xs text-muted">— {t("products.attrs.modal.globalHint")}</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className={`flex items-center gap-2 text-sm ${form.is_global || inUse ? "cursor-not-allowed opacity-60 text-muted" : "cursor-pointer text-text"}`}>
            <input type="checkbox" className="ctrl-check" checked={form.coding}
              disabled={form.is_global || inUse}
              onChange={(e) => set({ coding: e.target.checked })} />
            {t("products.attrs.modal.coding")}
            <span className="text-xs text-muted">— {t("products.attrs.modal.codingHint")}</span>
          </label>
        </div>

        {/* Values */}
        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted">{t("products.attrs.modal.values")}</p>
            <button type="button" onClick={addValue}
              className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <IconPlus width={13} height={13} /> {t("products.attrs.modal.addValue")}
            </button>
          </div>
          {form.values.length === 0 ? (
            <p className="py-2 text-xs text-muted">{t("products.attrs.modal.noValues")}</p>
          ) : (
            <div className="space-y-2">
              {form.values.map((v) => (
                <div key={v.key} className="flex flex-wrap items-center gap-2">
                  {form.type === "number" ? (
                    <input type="number" step="any" className="ctrl-input-sm w-40 text-sm"
                      placeholder={t("products.attrs.modal.number")}
                      value={v.value_en} onChange={(e) => setVal(v.key, { value_en: e.target.value })} />
                  ) : (
                    <>
                      <input className="ctrl-input-sm w-40 text-sm"
                        placeholder={form.type === "color" ? t("products.attrs.modal.colorNameEn") : t("products.attrs.modal.valueEn")}
                        value={v.value_en} onChange={(e) => setVal(v.key, { value_en: e.target.value })} />
                      <input className="ctrl-input-sm w-40 text-sm" dir="rtl"
                        placeholder={form.type === "color" ? t("products.attrs.modal.colorNameAr") : t("products.attrs.modal.valueAr")}
                        value={v.value_ar} onChange={(e) => setVal(v.key, { value_ar: e.target.value })} />
                    </>
                  )}
                  {form.type === "color" && (
                    <input type="color" title={t("products.attrs.modal.color")}
                      className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                      value={v.hex || "#8eff19"} onChange={(e) => setVal(v.key, { hex: e.target.value })} />
                  )}
                  <button type="button" onClick={() => removeValue(v.key)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-red-400">
                    <IconX width={14} height={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
