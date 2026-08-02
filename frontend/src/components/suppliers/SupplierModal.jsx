import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import {
  createSupplier,
  updateSupplier,
  listSupplierInvoices,
  createSupplierInvoice,
  deleteSupplierInvoice,
} from "@/lib/products";
import SupplierInvoicesEditor from "@/components/suppliers/SupplierInvoicesEditor";

let _uid = 1;
const nextTmp = () => `t${_uid++}`;

function blank() {
  return { name: "", phone: "", email: "", address: "" };
}

export default function SupplierModal({ open, mode, initial, currency, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  // Edit mode: invoices are persisted immediately (each has `id`).
  // Add/copy mode: invoices are buffered as drafts (each has `_tmp`) and
  // created after the supplier itself is saved.
  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;
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
    setInvoices([]);
    if (isEdit && initial?.id) {
      setLoadingInvoices(true);
      listSupplierInvoices(initial.id)
        .then(setInvoices)
        .catch(() => {})
        .finally(() => setLoadingInvoices(false));
    }
  }, [open, initial, mode, isEdit]);

  const title = useMemo(() => {
    if (mode === "edit") return t("suppliers.modal.editTitle");
    if (mode === "copy") return t("suppliers.modal.copyTitle");
    return t("suppliers.modal.addTitle");
  }, [mode, t]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // --- Invoice handlers (persisted for edit, buffered for add/copy) ---
  async function addInvoice(payload) {
    if (isEdit && initial?.id) {
      const created = await createSupplierInvoice(initial.id, payload);
      setInvoices((prev) => [created, ...prev]);
    } else {
      setInvoices((prev) => [{ _tmp: nextTmp(), ...payload }, ...prev]);
    }
  }
  async function removeInvoice(inv) {
    if (inv.id) {
      try {
        await deleteSupplierInvoice(initial.id, inv.id);
        setInvoices((prev) => prev.filter((x) => x.id !== inv.id));
        toast.success(t("suppliers.invoices.deleted"));
      } catch {
        toast.error(t("auth.genericError"));
      }
    } else {
      setInvoices((prev) => prev.filter((x) => x._tmp !== inv._tmp));
    }
  }

  async function submit() {
    if (!form.name.trim()) return toast.error(t("suppliers.modal.nameRequired"));
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return toast.error(t("suppliers.modal.emailInvalid"));
    if (!form.address.trim()) return toast.error(t("suppliers.modal.addressRequired"));

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim(),
    };
    setSaving(true);
    try {
      let saved;
      if (isEdit) {
        saved = await updateSupplier(initial.id, payload);
        toast.success(t("suppliers.modal.updated"));
      } else {
        saved = await createSupplier(payload);
        // Persist buffered invoices against the freshly-created supplier.
        let failed = 0;
        for (const inv of [...invoices].reverse()) {
          try {
            await createSupplierInvoice(saved.id, {
              name: inv.name,
              quantity: inv.quantity,
              amount: inv.amount,
              invoice_date: inv.invoice_date,
              image_url: inv.image_url || null,
            });
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) toast.error(t("suppliers.invoices.someFailed", { count: failed }));
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
      size="xl"
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
          <textarea rows={2} className={inputCls} value={form.address}
            onChange={(e) => set("address", e.target.value)} />
        </div>

        {/* Invoices */}
        <div className="border-t border-border pt-4">
          <SupplierInvoicesEditor
            invoices={invoices}
            onAdd={addInvoice}
            onDelete={removeInvoice}
            currency={currency}
            loading={loadingInvoices}
          />
        </div>
      </div>
    </Modal>
  );
}
