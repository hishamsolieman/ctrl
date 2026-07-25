import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { bulkUpdateCategories, uploadImage, mediaUrl } from "@/lib/products";
import { IconImage, IconX } from "@/components/icons";

// The common value across selected rows, or "" when they differ.
function common(rows, field) {
  const first = rows[0]?.[field] ?? "";
  return rows.every((r) => (r[field] ?? "") === first) ? first : "";
}

export default function CategoryBulkEditModal({ open, categories, onClose, onApplied }) {
  const { t } = useTranslation();
  const toast = useToast();
  const rows = categories || [];
  const [enabled, setEnabled] = useState({});
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setEnabled({});
      setValues({
        name_en: common(rows, "name_en"),
        name_ar: common(rows, "name_ar"),
        description: common(rows, "description"),
        image_url: common(rows, "image_url"),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const setVal = (k, v) => setValues((s) => ({ ...s, [k]: v }));
  const toggle = (k) => setEnabled((s) => ({ ...s, [k]: !s[k] }));

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      setVal("image_url", await uploadImage(file));
      setEnabled((s) => ({ ...s, image_url: true }));
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setUploading(false);
    }
  }

  async function apply() {
    const payload = { ids: rows.map((r) => r.id) };
    ["name_en", "name_ar", "description", "image_url"].forEach((k) => {
      if (enabled[k]) payload[k] = values[k];
    });
    if (Object.keys(payload).length <= 1) {
      toast.error(t("categories.bulk.noFields"));
      return;
    }
    setSaving(true);
    try {
      const res = await bulkUpdateCategories(payload);
      toast.success(t("categories.bulk.updated", { count: res.updated }));
      onApplied?.();
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  const Field = ({ k, children }) => (
    <div className={`rounded-lg border p-3 transition ${enabled[k] ? "border-accent/60" : "border-border"}`}>
      <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-text">
        <input type="checkbox" className="ctrl-check" checked={!!enabled[k]} onChange={() => toggle(k)} />
        {t(`categories.modal.${k === "image_url" ? "image" : k === "name_en" ? "nameEn" : k === "name_ar" ? "nameAr" : "description"}`)}
      </label>
      <div className={enabled[k] ? "" : "pointer-events-none opacity-40"}>{children}</div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("categories.bulk.title", { count: rows.length })}
      dismissable={false}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("categories.bulk.cancel")}
          </button>
          <button type="button" onClick={apply} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("categories.bulk.applying") : t("categories.bulk.apply")}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">{t("categories.bulk.hint")}</p>
      <div className="space-y-3">
        <Field k="name_en">
          <input className={inputCls} value={values.name_en} onChange={(e) => setVal("name_en", e.target.value)} />
        </Field>
        <Field k="name_ar">
          <input className={inputCls} dir="rtl" value={values.name_ar} onChange={(e) => setVal("name_ar", e.target.value)} />
        </Field>
        <Field k="description">
          <textarea rows={2} className={inputCls} value={values.description}
            onChange={(e) => setVal("description", e.target.value)} />
        </Field>
        <Field k="image_url">
          <div className="flex items-center gap-3">
            {values.image_url && (
              <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                <img src={mediaUrl(values.image_url)} alt="" className="h-full w-full object-cover" />
                <button type="button" onClick={() => setVal("image_url", "")}
                  className="absolute end-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white">
                  <IconX width={10} height={10} />
                </button>
              </div>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted transition hover:border-accent hover:text-accent">
              <IconImage width={18} height={18} />
              <span className="text-[9px]">{t("categories.modal.addImage")}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          </div>
        </Field>
      </div>
    </Modal>
  );
}
