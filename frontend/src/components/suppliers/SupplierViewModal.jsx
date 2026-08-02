import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { listSupplierInvoices } from "@/lib/products";
import SupplierInvoicesEditor from "@/components/suppliers/SupplierInvoicesEditor";
import { IconPhone, IconMail, IconMapPin } from "@/components/icons";

export default function SupplierViewModal({ open, supplier, currency, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!supplier?.id) return;
    setLoading(true);
    try {
      setInvoices(await listSupplierInvoices(supplier.id));
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [supplier, t, toast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!supplier) return null;

  return (
    <Modal open={open} onClose={onClose} title={t("suppliers.detail.title")} size="xl">
      {/* Supplier details */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h3 className="text-lg font-bold text-text">{supplier.name}</h3>
        </div>
        <div className="rounded-lg border border-border bg-elevated px-3 py-2">
          <p className="mb-0.5 text-xs text-muted">{t("suppliers.table.phone")}</p>
          <p className="inline-flex items-center gap-1.5 text-sm text-text" dir="ltr">
            <IconPhone width={14} height={14} className="text-muted" />
            {supplier.phone || "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-elevated px-3 py-2">
          <p className="mb-0.5 text-xs text-muted">{t("suppliers.table.email")}</p>
          <p className="inline-flex items-center gap-1.5 text-sm text-text" dir="ltr">
            <IconMail width={14} height={14} className="text-muted" />
            {supplier.email || "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-elevated px-3 py-2 sm:col-span-2">
          <p className="mb-0.5 text-xs text-muted">{t("suppliers.modal.address")}</p>
          <p className="inline-flex items-start gap-1.5 text-sm text-text">
            <IconMapPin width={14} height={14} className="mt-0.5 shrink-0 text-muted" />
            {supplier.address || "—"}
          </p>
        </div>
      </div>

      {/* Invoices */}
      <div className="mt-5">
        <SupplierInvoicesEditor
          invoices={invoices}
          currency={currency}
          loading={loading}
          readOnly
        />
      </div>
    </Modal>
  );
}
