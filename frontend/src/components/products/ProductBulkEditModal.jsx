import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { bulkUpdateProducts } from "@/lib/products";

// The common value across selected rows, or "" when they differ.
function common(rows, field) {
  const first = rows[0]?.[field] ?? "";
  return rows.every((r) => (r[field] ?? "") === first) ? first : "";
}

export default function ProductBulkEditModal({
  open,
  products,
  categories,
  suppliers,
  onClose,
  onApplied,
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();
  const rows = products || [];
  const [enabled, setEnabled] = useState({});
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEnabled({});
      setValues({
        category_id: common(rows, "category_id") || "",
        supplier_id: common(rows, "supplier_id") || "",
        supplier_price: common(rows, "supplier_price") ?? "",
        min_price: common(rows, "min_price") ?? "",
        price: common(rows, "price") ?? "",
        note: common(rows, "note") || "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const setVal = (k, v) => setValues((s) => ({ ...s, [k]: v }));
  const toggle = (k) => setEnabled((s) => ({ ...s, [k]: !s[k] }));

  async function apply() {
    const payload = { ids: rows.map((r) => r.id) };
    if (enabled.category_id) payload.category_id = values.category_id ? Number(values.category_id) : null;
    if (enabled.supplier_id) payload.supplier_id = values.supplier_id ? Number(values.supplier_id) : null;
    if (enabled.supplier_price) payload.supplier_price = Number(values.supplier_price) || 0;
    if (enabled.min_price) payload.min_price = Number(values.min_price) || 0;
    if (enabled.price) payload.price = Number(values.price) || 0;
    if (enabled.note) payload.note = values.note;

    if (Object.keys(payload).length <= 1) {
      toast.error(t("products.bulk.noFields"));
      return;
    }
    if (
      enabled.price &&
      enabled.min_price &&
      Number(values.price || 0) < Number(values.min_price || 0)
    ) {
      toast.error(t("products.modal.priceBelowMin"));
      return;
    }
    setSaving(true);
    try {
      const res = await bulkUpdateProducts(payload);
      toast.success(t("products.bulk.updated", { count: res.updated }));
      onApplied?.();
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  const Field = ({ k, label, children }) => (
    <div className={`rounded-lg border p-3 transition ${enabled[k] ? "border-accent/60" : "border-border"}`}>
      <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-text">
        <input type="checkbox" className="ctrl-check" checked={!!enabled[k]} onChange={() => toggle(k)} />
        {label}
      </label>
      <div className={enabled[k] ? "" : "pointer-events-none opacity-40"}>{children}</div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("products.bulk.title", { count: rows.length })}
      dismissable={false}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("products.bulk.cancel")}
          </button>
          <button type="button" onClick={apply} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("products.bulk.applying") : t("products.bulk.apply")}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">{t("products.bulk.hint")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field k="category_id" label={t("products.modal.category")}>
          <select className={`${inputCls} ctrl-select`} value={values.category_id}
            onChange={(e) => setVal("category_id", e.target.value)}>
            <option value="">{t("products.modal.selectCategory")}</option>
            {(categories || []).map((c) => (
              <option key={c.id} value={c.id}>{isAr ? c.name_ar : c.name_en}</option>
            ))}
          </select>
        </Field>
        <Field k="supplier_id" label={t("products.modal.supplier")}>
          <select className={`${inputCls} ctrl-select`} value={values.supplier_id}
            onChange={(e) => setVal("supplier_id", e.target.value)}>
            <option value="">{t("products.modal.selectSupplier")}</option>
            {(suppliers || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field k="supplier_price" label={t("products.modal.supplierPrice")}>
          <input type="number" step="any" className={inputCls} value={values.supplier_price}
            onChange={(e) => setVal("supplier_price", e.target.value)} />
        </Field>
        <Field k="min_price" label={t("products.modal.minPrice")}>
          <input type="number" step="any" className={inputCls} value={values.min_price}
            onChange={(e) => setVal("min_price", e.target.value)} />
        </Field>
        <Field k="price" label={t("products.modal.price")}>
          <input type="number" step="any" className={inputCls} value={values.price}
            onChange={(e) => setVal("price", e.target.value)} />
        </Field>
        <Field k="note" label={t("products.modal.note")}>
          <input className={inputCls} value={values.note}
            onChange={(e) => setVal("note", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
