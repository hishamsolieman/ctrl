import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { createCategory, updateCategory, uploadImage, mediaUrl } from "@/lib/products";
import { IconImage, IconX } from "@/components/icons";

function blank() {
  return { name_en: "", name_ar: "", description: "", image_url: "" };
}

export default function CategoryModal({ open, mode, initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setForm(
        initial
          ? {
              name_en: initial.name_en || "",
              name_ar: initial.name_ar || "",
              description: initial.description || "",
              image_url: initial.image_url || "",
            }
          : blank()
      );
    }
  }, [open, initial, mode]);

  const title = useMemo(() => {
    if (mode === "edit") return t("categories.modal.editTitle");
    if (mode === "copy") return t("categories.modal.copyTitle");
    return t("categories.modal.addTitle");
  }, [mode, t]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      set("image_url", await uploadImage(file));
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!form.name_en.trim() || !form.name_ar.trim()) {
      toast.error(t("categories.modal.nameRequired"));
      return;
    }
    if (!form.image_url) {
      toast.error(t("categories.modal.imageRequired"));
      return;
    }
    const payload = {
      name_en: form.name_en.trim(),
      name_ar: form.name_ar.trim(),
      description: form.description || null,
      image_url: form.image_url,
    };
    setSaving(true);
    try {
      if (mode === "edit") {
        await updateCategory(initial.id, payload);
        toast.success(t("categories.modal.updated"));
      } else {
        await createCategory(payload);
        toast.success(t("categories.modal.created"));
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      // Backend may return an i18n key (e.g. categories.errors.nameEnTaken).
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
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("categories.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("categories.modal.saving") : t("categories.modal.save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Image */}
        <div>
          <label className={labelCls}>{t("categories.modal.image")} *</label>
          {form.image_url ? (
            <div className="relative mx-auto aspect-[3/4] w-48 overflow-hidden rounded-xl border border-border">
              <img src={mediaUrl(form.image_url)} alt="" className="h-full w-full object-cover" />
              <button type="button" onClick={() => set("image_url", "")}
                className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white">
                <IconX width={14} height={14} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="mx-auto flex aspect-[3/4] w-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted transition hover:border-accent hover:text-accent">
              {uploading ? <span className="text-sm">…</span> : (
                <><IconImage width={28} height={28} /><span className="text-sm">{t("categories.modal.addImage")}</span></>
              )}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("categories.modal.nameEn")} *</label>
            <input className={inputCls} value={form.name_en} onChange={(e) => set("name_en", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("categories.modal.nameAr")} *</label>
            <input className={inputCls} dir="rtl" value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
          </div>
        </div>

        <div>
          <label className={labelCls}>{t("categories.modal.description")}</label>
          <textarea rows={3} className={inputCls} value={form.description}
            onChange={(e) => set("description", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
