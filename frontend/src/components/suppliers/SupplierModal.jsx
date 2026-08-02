import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { createSupplier, updateSupplier } from "@/lib/products";

function blank() {
  return { name: "", phone: "", email: "", address: "" };
}

export default function SupplierModal({ open, mode, initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        initial
          ? {
              name: initial.name || "",
              phone: initial.phone || "",
              email: initial.email || "",
              address: initial.address || "",
            }
          : blank()
      );
    }
  }, [open, initial, mode]);

  const title = useMemo(() => {
    if (mode === "edit") return t("suppliers.modal.editTitle");
    if (mode === "copy") return t("suppliers.modal.copyTitle");
    return t("suppliers.modal.addTitle");
  }, [mode, t]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.name.trim()) {
      toast.error(t("suppliers.modal.nameRequired"));
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error(t("suppliers.modal.emailInvalid"));
      return;
    }
    if (!form.address.trim()) {
      toast.error(t("suppliers.modal.addressRequired"));
      return;
    }
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim(),
    };
    setSaving(true);
    try {
      let saved;
      if (mode === "edit") {
        saved = await updateSupplier(initial.id, payload);
        toast.success(t("suppliers.modal.updated"));
      } else {
        saved = await createSupplier(payload);
        toast.success(t("suppliers.modal.created"));
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
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("suppliers.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("suppliers.modal.saving") : t("suppliers.modal.save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls}>{t("suppliers.modal.name")} *</label>
          <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("suppliers.modal.phone")}</label>
            <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("suppliers.modal.email")}</label>
            <input type="email" className={inputCls} dir="ltr" value={form.email}
              onChange={(e) => set("email", e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelCls}>{t("suppliers.modal.address")} *</label>
          <textarea rows={3} className={inputCls} value={form.address}
            onChange={(e) => set("address", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
