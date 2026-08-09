import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { createInvoice, updateInvoice, searchStock } from "@/lib/invoices";
import { lookupCustomer } from "@/lib/pos";
import { mediaUrl } from "@/lib/products";
import { IconSearch, IconPlus, IconTrash, IconImage } from "@/components/icons";

let _k = 1;
const key = () => `l${_k++}`;

// Map a persisted sale item into an editable line.
function fromSaleItem(i) {
  return {
    key: key(),
    id: i.id,
    stock_id: i.stock_id,
    code: i.code,
    name: i.name,
    image: null,
    quantity: String(i.quantity ?? 1),
    unit_price: Number(i.unit_price || 0).toFixed(2),
    list_price: Number(i.list_price || i.unit_price || 0),
    min_price: Number(i.min_price || 0),
    on_hand: null, // unknown for already-recorded lines; server validates
  };
}

// Map an inventory search hit into a new line.
function fromStock(s) {
  return {
    key: key(),
    id: null,
    stock_id: s.stock_id,
    code: s.code,
    name: s.label_en ? `${s.name} · ${s.label_en}` : s.name,
    image: s.image,
    quantity: "1",
    unit_price: Number(s.price || 0).toFixed(2),
    list_price: Number(s.price || 0),
    min_price: Number(s.min_price || 0),
    on_hand: Number(s.on_hand || 0),
  };
}

export default function InvoiceModal({ open, mode, initial, boot, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();
  const isEdit = mode === "edit";

  const [items, setItems] = useState([]);
  const [customer, setCustomer] = useState({ phone: "", name: "" });
  const [paymentId, setPaymentId] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [saving, setSaving] = useState(false);

  const [pq, setPq] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && initial) {
      setItems((initial.items || []).map(fromSaleItem));
      setCustomer({ phone: initial.customer_phone || "", name: initial.customer_name || "" });
      setPaymentId(initial.payment_method_id ? String(initial.payment_method_id) : "");
    } else {
      setItems([]);
      setCustomer({ phone: "", name: "" });
      setPaymentId(boot?.payment_methods?.[0]?.id ? String(boot.payment_methods[0].id) : "");
    }
    setCreatedAt("");
    setPq("");
    setResults([]);
  }, [open, isEdit, initial, boot]);

  // Debounced inventory search — only runs when the user types a query so we
  // never pull the full catalog. Backend returns in-stock rows only.
  useEffect(() => {
    if (!open) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = pq.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchStock(term));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [pq, open]);

  const money = useMemo(
    () => (n) =>
      `${Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${boot?.currency || ""}`.trim(),
    [isAr, boot]
  );

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, count = 0;
    for (const l of items) {
      const qty = Number(l.quantity || 0);
      const unit = Number(l.unit_price || 0);
      const list = Number(l.list_price || 0);
      subtotal += list * qty;
      discount += Math.max(0, list - unit) * qty;
      count += qty;
    }
    return { subtotal, discount, total: subtotal - discount, count };
  }, [items]);

  function addStock(s) {
    setItems((prev) => {
      const existing = prev.find((l) => l.stock_id === s.stock_id);
      if (existing) {
        return prev.map((l) =>
          l.stock_id === s.stock_id
            ? { ...l, quantity: String(Number(l.quantity || 0) + 1) }
            : l
        );
      }
      return [...prev, fromStock(s)];
    });
  }

  const setLine = (k, patch) =>
    setItems((prev) => prev.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const removeLine = (k) => setItems((prev) => prev.filter((l) => l.key !== k));

  function onQtyChange(k, raw) {
    const cleaned = String(raw).replace(/\D/g, "");
    setLine(k, { quantity: cleaned });
  }

  function onPriceChange(k, raw) {
    let cleaned = String(raw).replace(/[^\d.]/g, "");
    const dot = cleaned.indexOf(".");
    if (dot !== -1) {
      cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
      const [whole, frac = ""] = cleaned.split(".");
      cleaned = `${whole}.${frac.slice(0, 2)}`;
    }
    setLine(k, { unit_price: cleaned });
  }

  function clampPrice(l) {
    let u = Number(l.unit_price || 0);
    if (!Number.isFinite(u) || u < 0) u = 0;
    if (l.list_price && u > l.list_price) u = l.list_price;
    if (u < l.min_price) u = l.min_price;
    setLine(l.key, { unit_price: (Math.round(u * 100) / 100).toFixed(2) });
  }

  function clampQty(l) {
    const q = Math.max(1, Math.floor(Number(l.quantity) || 1));
    setLine(l.key, { quantity: String(q) });
  }

  async function onPhoneBlur() {
    const phone = customer.phone.trim();
    if (!phone) return;
    try {
      const r = await lookupCustomer(phone);
      if (r.found && r.name && !customer.name.trim()) setCustomer((c) => ({ ...c, name: r.name }));
    } catch {
      /* ignore */
    }
  }

  async function submit() {
    if (!isEdit && !createdAt) return toast.error(t("invoices.errors.dateRequired"));
    if (items.length === 0) return toast.error(t("invoices.errors.noItems"));
    for (const l of items) {
      if (!Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 1)
        return toast.error(t("invoices.errors.badQty"));
    }
    const cust = {
      phone: customer.phone.trim() || null,
      name: customer.name.trim() || null,
    };
    setSaving(true);
    try {
      if (isEdit) {
        await updateInvoice(initial.id, {
          customer: cust,
          payment_method_id: paymentId ? Number(paymentId) : null,
          items: items.map((l) => ({
            id: l.id || null,
            stock_id: l.id ? null : l.stock_id,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
          })),
        });
        toast.success(t("invoices.updated"));
      } else {
        await createInvoice({
          customer: cust,
          payment_method_id: paymentId ? Number(paymentId) : null,
          created_at: createdAt || null,
          items: items.map((l) => ({
            stock_id: l.stock_id,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
          })),
        });
        toast.success(t("invoices.created"));
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  const label = "mb-1 block text-xs font-medium text-muted";
  const inputCls = "ctrl-input-sm w-full text-sm";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t("invoices.modal.editTitle") : t("invoices.modal.addTitle")}
      dismissable={false}
      size="2xl"
      footer={
        <>
          <div className="me-auto text-sm text-muted">
            {t("invoices.modal.total")}: <span className="font-semibold text-text">{money(totals.total)}</span>
          </div>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("invoices.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("invoices.modal.saving") : t("invoices.modal.save")}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {isEdit && initial?.is_backtrack && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-violet-500/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-violet-300">
              {t("invoices.backtrackTag")}
            </span>
            <span className="text-xs text-muted">{t("invoices.backtrackNote")}</span>
          </div>
        )}

        {/* Customer + payment + (backdate) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={label}>{t("invoices.modal.phone")}</label>
            <input className={inputCls} dir="ltr" value={customer.phone}
              onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
              onBlur={onPhoneBlur} placeholder={t("invoices.modal.phonePlaceholder")} />
          </div>
          <div>
            <label className={label}>{t("invoices.modal.customer")}</label>
            <input className={inputCls} value={customer.name}
              onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
              placeholder={t("invoices.modal.unknown")} />
          </div>
          <div>
            <label className={label}>{t("invoices.modal.payment")}</label>
            <select className={`${inputCls} ctrl-select`} value={paymentId}
              onChange={(e) => setPaymentId(e.target.value)}>
              <option value="">—</option>
              {(boot?.payment_methods || []).map((m) => (
                <option key={m.id} value={m.id}>{isAr ? m.name_ar : m.name_en}</option>
              ))}
            </select>
          </div>
          {!isEdit && (
            <div>
              <label className={label}>
                {t("invoices.modal.date")} <span className="text-red-400">*</span>
              </label>
              <input type="datetime-local" required className={inputCls} value={createdAt}
                onChange={(e) => setCreatedAt(e.target.value)} />
            </div>
          )}
        </div>

        {/* Inventory picker */}
        <div>
          <label className={label}>{t("invoices.modal.addItems")}</label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
              <IconSearch width={16} height={16} />
            </span>
            <input className={`${inputCls} ps-9`} value={pq}
              onChange={(e) => setPq(e.target.value)}
              placeholder={t("invoices.modal.searchStock")} />
          </div>
          {pq.trim() && (
            <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-border">
              {searching ? (
                <div className="p-3 text-center text-sm text-muted">{t("invoices.modal.searching")}</div>
              ) : results.length === 0 ? (
                <div className="p-3 text-center text-sm text-muted">{t("invoices.modal.noStock")}</div>
              ) : (
                results.map((s) => (
                  <button key={s.stock_id} type="button" onClick={() => addStock(s)}
                    className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-start transition last:border-0 hover:bg-elevated/50">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated">
                      {s.image ? <img src={mediaUrl(s.image)} alt="" className="h-full w-full object-cover" />
                        : <IconImage width={16} height={16} className="text-muted" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">
                        {s.name}{(isAr ? s.label_ar : s.label_en) ? ` · ${isAr ? s.label_ar : s.label_en}` : ""}
                      </span>
                      <span className="block font-mono text-[11px] text-muted" dir="ltr">{s.code}</span>
                    </span>
                    <span className="shrink-0 text-end text-xs">
                      <span className="block text-text">{money(s.price)}</span>
                      <span className={`block ${s.on_hand > 0 ? "text-muted" : "text-red-400"}`}>
                        {t("invoices.modal.onHand", { count: s.on_hand })}
                      </span>
                    </span>
                    <IconPlus width={16} height={16} className="shrink-0 text-accent" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="ctrl-table w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-start font-medium">{t("invoices.modal.item")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("invoices.modal.qty")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("invoices.modal.unit")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("invoices.modal.lineTotal")}</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                    {t("invoices.modal.empty")}
                  </td>
                </tr>
              ) : (
                items.map((l) => (
                  <tr key={l.key} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <p className="text-text">{l.name}</p>
                      <p className="font-mono text-[11px] text-muted" dir="ltr">{l.code}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) => onQtyChange(l.key, e.target.value)}
                        onBlur={() => clampQty(l)}
                        className="ctrl-input-sm w-16 text-center text-sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={l.unit_price}
                        onChange={(e) => onPriceChange(l.key, e.target.value)}
                        onBlur={() => clampPrice(l)}
                        className="ctrl-input-sm w-24 text-end text-sm"
                        dir="ltr"
                      />
                    </td>
                    <td className="px-3 py-2 text-end font-medium text-text tabular-nums">
                      {money(Number(l.unit_price || 0) * Number(l.quantity || 0))}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button type="button" onClick={() => removeLine(l.key)}
                        title={t("invoices.modal.remove")}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition hover:bg-red-500 hover:text-white">
                        <IconTrash width={14} height={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="ms-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between text-muted">
            <span>{t("invoices.modal.subtotal")}</span>
            <span className="tabular-nums">{money(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>{t("invoices.modal.discount")}</span>
            <span className="tabular-nums">{money(totals.discount)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold text-text">
            <span>{t("invoices.modal.total")}</span>
            <span className="tabular-nums">{money(totals.total)}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
