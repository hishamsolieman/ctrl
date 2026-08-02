import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import { uploadImage, mediaUrl } from "@/lib/products";
import { IconImage, IconPlus, IconTrash, IconX } from "@/components/icons";

function todayInput() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function emptyDraft() {
  return { name: "", quantity: "", amount: "", invoice_date: todayInput(), image_url: "" };
}

// Shared invoices UI (add form + table + image lightbox). The parent owns the
// `invoices` array and decides how `onAdd`/`onDelete` persist (API vs local draft).
export default function SupplierInvoicesEditor({ invoices, onAdd, onDelete, currency, loading, readOnly = false }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();

  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const money = (n) =>
    `${Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency || ""}`.trim();

  const setD = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const inputCls = "ctrl-input-sm w-full text-sm";

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      setD("image_url", await uploadImage(file));
    } catch (err) {
      if (err?.code === "unsupported") toast.error(t("products.modal.imageUnsupported"));
      else {
        const detail = err?.response?.data?.detail;
        toast.error(detail ? t(detail, { defaultValue: t("auth.genericError") }) : t("auth.genericError"));
      }
    } finally {
      setUploading(false);
    }
  }

  async function add() {
    if (!draft.name.trim()) return toast.error(t("suppliers.invoices.nameRequired"));
    if (draft.quantity === "" || Number(draft.quantity) < 0)
      return toast.error(t("suppliers.invoices.quantityRequired"));
    if (draft.amount === "" || Number(draft.amount) < 0)
      return toast.error(t("suppliers.invoices.amountRequired"));
    if (!draft.invoice_date) return toast.error(t("suppliers.invoices.dateRequired"));
    setSaving(true);
    try {
      await onAdd({
        name: draft.name.trim(),
        quantity: Math.trunc(Number(draft.quantity)),
        amount: Number(Number(draft.amount).toFixed(2)),
        invoice_date: draft.invoice_date,
        image_url: draft.image_url || null,
      });
      toast.success(t("suppliers.invoices.added"));
      setDraft(emptyDraft());
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p className="mb-2 text-sm font-semibold text-text">
        {t("suppliers.invoices.title")}
        <span className="ms-2 text-xs font-normal text-muted">
          {t("suppliers.invoices.count", { count: invoices.length })}
        </span>
      </p>

      {/* Add invoice row */}
      {!readOnly && (
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-border bg-elevated/40 p-3 sm:grid-cols-[1fr_5rem_7rem_9rem_auto_auto]">
        <input className={inputCls} placeholder={t("suppliers.invoices.name")}
          value={draft.name} onChange={(e) => setD("name", e.target.value)} />
        <input type="number" min="0" step="1" className={inputCls}
          placeholder={t("suppliers.invoices.quantity")}
          value={draft.quantity} onChange={(e) => setD("quantity", e.target.value)} />
        <input type="number" min="0" step="0.01" className={inputCls}
          placeholder={t("suppliers.invoices.amount")}
          value={draft.amount} onChange={(e) => setD("amount", e.target.value)} />
        <input type="date" className={inputCls} title={t("suppliers.invoices.date")}
          value={draft.invoice_date} onChange={(e) => setD("invoice_date", e.target.value)} />
        {draft.image_url ? (
          <div className="relative h-9 w-9">
            <img src={mediaUrl(draft.image_url)} alt=""
              className="h-9 w-9 rounded-lg border border-border object-cover" />
            <button type="button" onClick={() => setD("image_url", "")}
              className="absolute -end-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/80 text-white">
              <IconX width={10} height={10} />
            </button>
          </div>
        ) : (
          <label className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-muted transition hover:border-accent hover:text-accent"
            title={t("suppliers.invoices.image")}>
            {uploading ? <span className="text-[10px]">…</span> : <IconImage width={16} height={16} />}
            <input type="file" accept="image/*" className="hidden" onChange={onFile} />
          </label>
        )}
        <button type="button" onClick={add} disabled={saving}
          className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95">
          <IconPlus width={16} height={16} /> {t("suppliers.invoices.add")}
        </button>
      </div>
      )}

      {/* Invoices table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="ctrl-table w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-elevated/40 text-xs text-muted">
              <th className="px-3 py-2 text-start font-medium">{t("suppliers.invoices.name")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("suppliers.invoices.quantity")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("suppliers.invoices.amount")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("suppliers.invoices.date")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("suppliers.invoices.image")}</th>
              {!readOnly && <th className="w-10 px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={readOnly ? 5 : 6} className="px-3 py-6 text-center text-muted">…</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={readOnly ? 5 : 6} className="px-3 py-6 text-center text-muted">
                {t("suppliers.invoices.empty")}
              </td></tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id ?? inv._tmp} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium text-text">{inv.name}</td>
                  <td className="px-3 py-2 text-center text-muted">{inv.quantity}</td>
                  <td className="px-3 py-2 text-text">{money(inv.amount)}</td>
                  <td className="px-3 py-2 text-muted" dir="ltr">{inv.invoice_date || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {inv.image_url ? (
                      <button type="button" onClick={() => setLightbox(inv.image_url)}
                        className="mx-auto block h-10 w-10 overflow-hidden rounded-lg border border-border transition hover:border-accent">
                        <img src={mediaUrl(inv.image_url)} alt="" className="h-full w-full object-cover" />
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  {!readOnly && (
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onDelete(inv)}
                        title={t("suppliers.invoices.delete")}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10">
                        <IconTrash width={15} height={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6"
          onClick={() => setLightbox(null)}>
          <button type="button" onClick={() => setLightbox(null)}
            className="absolute end-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20">
            <IconX width={20} height={20} />
          </button>
          <img src={mediaUrl(lightbox)} alt=""
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
