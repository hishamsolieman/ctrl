import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import { useBrand } from "@/context/BrandContext";
import { useAuth } from "@/context/AuthContext";
import { posScan, posSetQty, posSwitch, posRelease, posCheckout, lookupCustomer } from "@/lib/pos";
import { mapCartLine } from "@/lib/carts";
import { mediaUrl } from "@/lib/products";
import { getPrintTarget, getGeneralSettings, printDocument, resolveInvoiceLanguage } from "@/lib/settings";
import { buildInvoiceHtml, invoiceItemName } from "@/lib/invoicePrint";
import {
  IconSearch,
  IconTrash,
  IconPlus,
  IconCart,
  IconCheck,
  IconUser,
  IconWallet,
  IconDiscount,
  IconImage,
  IconPrinter,
  IconChevronLeft,
  IconChevronRight,
} from "@/components/icons";

const newKey = () =>
  crypto?.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`;

const STEPS = ["pos.step.cart", "pos.step.customer", "pos.step.invoice"];

// Canonicalize a phone number for display (mirrors the backend): local Egyptian
// numbers (0xxxxxxxxxx) become +20xxxxxxxxxx; a 00 prefix becomes +; + is kept.
function normalizePhone(raw) {
  const p = (raw || "").trim();
  if (!p) return "";
  const plus = p.startsWith("+");
  const digits = p.replace(/\D/g, "");
  if (!digits) return "";
  if (plus) return "+" + digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  if (digits.startsWith("0")) return "+20" + digits.slice(1);
  return "+" + digits;
}

function StatCard({ Icon, label, value, tone }) {
  const tones = {
    sky: "from-sky-500/15 via-sky-500/5 bg-sky-500/20 text-sky-300",
    amber: "from-amber-500/15 via-amber-500/5 bg-amber-500/20 text-amber-300",
    emerald: "from-emerald-500/15 via-emerald-500/5 bg-emerald-500/20 text-emerald-300",
  };
  const [g1, g2, tile1, tile2] = (tones[tone] || tones.emerald).split(" ");
  return (
    <div className={`ctrl-card relative overflow-hidden bg-gradient-to-br ${g1} ${g2} to-transparent p-4`}>
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
          <p className="mt-1 truncate text-xl font-bold text-text">{value}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tile1} ${tile2}`}>
          <Icon width={20} height={20} />
        </span>
      </div>
    </div>
  );
}

// Map a committed sale (checkout response) into the invoice view/print model.
function firstNameOf(fullName) {
  return String(fullName || "").trim().split(/\s+/).filter(Boolean)[0] || "";
}

function saleToInvoiceModel(sale, isAr, sellerName) {
  return {
    invoice_no: sale.invoice_no,
    created_at: sale.created_at,
    customer_name: sale.customer_name,
    seller_name: sale.seller_name || sellerName || "",
    customer_phone: sale.customer_phone,
    payment_method: isAr ? sale.payment_method_ar : sale.payment_method_en,
    items: (sale.items || []).map((i) => {
      const list = i.list_price ?? i.unit_price;
      return {
        name: i.name,
        attributes: i.attributes || [],
        quantity: i.quantity,
        unit_price: list,
        line_total: (list || 0) * (i.quantity || 0),
      };
    }),
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    paid: sale.paid_amount,
    changeExact: sale.change_amount,
    changeRaw: sale.change_raw,
  };
}

export default function CartWorkspace({ tab, boot, patch }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();
  const brand = useBrand();
  const { user } = useAuth();
  const sellerName = firstNameOf(user?.full_name);

  const currency = boot?.currency || "";
  const methods = boot?.payment_methods || [];

  const selectedMethod = useMemo(
    () => methods.find((m) => m.id === tab.paymentMethodId) || null,
    [methods, tab.paymentMethodId]
  );
  const isCash = (selectedMethod?.code || "").toLowerCase() === "cash";

  // Phone validation regex comes from the DB config (via /pos/bootstrap). Empty
  // phone is allowed (optional); the number is validated in its canonical form.
  const phoneValid = useCallback(
    (raw) => {
      const p = normalizePhone(raw);
      if (!p) return true;
      const rx = boot?.phone_regex;
      if (!rx) return true;
      try {
        return new RegExp(rx).test(p);
      } catch {
        return true;
      }
    },
    [boot]
  );

  const [scanValue, setScanValue] = useState("");
  const [priceDraft, setPriceDraft] = useState({});
  const [qtyDraft, setQtyDraft] = useState({});
  const [editPrice, setEditPrice] = useState(null); // stock_id whose price is being edited
  const [editQty, setEditQty] = useState(null); // stock_id whose qty is being edited
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const scanRef = useRef(null);

  const items = tab.items;
  const step = tab.step;

  const money = useCallback(
    (n) =>
      `${Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${currency}`.trim(),
    [isAr, currency]
  );

  // Plain number with 2 decimals (no currency) — for the editable unit-price label.
  const num2 = useCallback(
    (n) =>
      Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [isAr]
  );

  // Union of all attributes (coding + non-coding) across cart lines. Each becomes
  // its own table column; a row shows a locked value (coding) or a dropdown
  // (non-coding, editable), or "—" when the line doesn't have that attribute.
  const attrColumns = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      for (const a of it.coding_attrs || [])
        if (!map.has(a.attr_id))
          map.set(a.attr_id, { attr_id: a.attr_id, name_en: a.name_en, name_ar: a.name_ar, type: a.type });
      for (const a of it.nc_attrs || [])
        if (!map.has(a.attr_id))
          map.set(a.attr_id, { attr_id: a.attr_id, name_en: a.name_en, name_ar: a.name_ar, type: a.type });
    }
    return [...map.values()];
  }, [items]);

  const stats = useMemo(() => {
    let count = 0;
    let discount = 0;
    let total = 0;
    for (const i of items) {
      count += i.quantity || 0;
      // Discount = list price minus the (possibly reduced) sold unit price.
      discount += Math.max(0, (i.price || 0) - (i.unit_price || 0)) * (i.quantity || 0);
      total += (i.unit_price || 0) * (i.quantity || 0);
    }
    return { count, discount: Math.max(0, discount), total };
  }, [items]);

  // Cash payment: never accept less than the invoice (auto-bump to total). The
  // "raw" change rounds the invoice UP to the whole unit; the exact change uses
  // the real total — both are shown to the cashier.
  const cash = useMemo(() => {
    const total = stats.total;
    const typed = Number(tab.paidAmount);
    const paid = Math.max(isFinite(typed) ? typed : 0, total);
    const exact = Math.max(0, paid - total);
    const raw = Math.max(0, paid - Math.ceil(total));
    return { total, paid, exact, raw };
  }, [stats.total, tab.paidAmount]);

  const focusScan = useCallback(() => {
    setTimeout(() => scanRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (step === 1) focusScan();
  }, [step, focusScan]);

  // Clicking anywhere on the page (outside a control/dialog) returns focus to
  // the scan box, so the barcode scanner is always ready.
  useEffect(() => {
    if (step !== 1) return;
    const onDown = (e) => {
      const el = e.target;
      if (el?.closest?.('input, button, select, textarea, a, [role="dialog"]')) return;
      focusScan();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [step, focusScan]);

  // Auto-fill customer name from an existing phone (debounced).
  useEffect(() => {
    const phone = (tab.customer.phone || "").trim();
    if (!phone) {
      if (tab.customer.existing) patch((tb) => ({ customer: { ...tb.customer, existing: false } }));
      return;
    }
    const h = setTimeout(async () => {
      try {
        // Search by the canonical form so 01xxxxxxxxx and +201xxxxxxxxx match the
        // same stored (+20) customer.
        const r = await lookupCustomer(normalizePhone(phone) || phone);
        patch((tb) => ({
          customer: {
            ...tb.customer,
            existing: r.found,
            name: r.found ? r.name : tb.customer.name,
          },
        }));
      } catch {
        /* ignore lookup errors */
      }
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.customer.phone]);

  // ---- Item operations (cart lines are keyed by stock_id) ----
  const mapLine = mapCartLine;

  const upsertLine = (line) =>
    patch((tb) => {
      const found = tb.items.find((i) => i.stock_id === line.stock_id);
      if (found) {
        return {
          items: tb.items.map((i) =>
            i.stock_id === line.stock_id
              ? {
                  ...i,
                  quantity: line.quantity,
                  available: line.available,
                  on_hand: line.on_hand,
                  coding_editable: !!line.coding_editable,
                  coding_attrs: line.coding_attrs || [],
                  nc_attrs: line.nc_attrs || [],
                  selected: line.selected || {},
                  siblings: line.siblings || [],
                }
              : i
          ),
        };
      }
      return { items: [...tb.items, { ...mapLine(line), unit_price: line.price }] };
    });

  async function handleScan() {
    const code = scanValue.trim();
    if (!code) return;
    setScanValue("");
    try {
      const line = await posScan(tab.holdKey, code);
      upsertLine(line);
    } catch (err) {
      toast.error(t(err?.response?.data?.detail || "auth.genericError"));
    } finally {
      focusScan();
    }
  }

  async function commitQty(item, q) {
    setQtyDraft((d) => {
      const { [item.stock_id]: _drop, ...rest } = d;
      return rest;
    });
    if (q <= 0) return removeItem(item);
    try {
      const line = await posSetQty(tab.holdKey, item.stock_id, q);
      if (line.capped) toast.info(t("pos.qtyCapped", { count: line.quantity }));
      if ((line.quantity || 0) <= 0) {
        patch((tb) => ({ items: tb.items.filter((i) => i.stock_id !== item.stock_id) }));
      } else {
        patch((tb) => ({
          items: tb.items.map((i) =>
            i.stock_id === item.stock_id
              ? {
                  ...i,
                  quantity: line.quantity,
                  available: line.available,
                  on_hand: line.on_hand,
                  siblings: line.siblings || i.siblings,
                }
              : i
          ),
        }));
      }
    } catch (err) {
      toast.error(t(err?.response?.data?.detail || "auth.genericError"));
    }
  }

  // Switch a line's attribute (coding color or non-coding size) to an in-stock
  // combination. `attrId` is the anchor the cashier just changed.
  async function doSwitch(item, attrId, valueId) {
    if (!valueId) return;
    const target = { ...(item.selected || {}), [String(attrId)]: Number(valueId) };
    try {
      const line = await posSwitch(tab.holdKey, item.stock_id, target, attrId);
      if (line.capped) toast.info(t("pos.qtyCapped", { count: line.quantity }));
      patch((tb) => ({
        items: tb.items.map((i) =>
          i.stock_id === item.stock_id
            ? { ...mapLine(line), unit_price: i.unit_price, pending: i.pending }
            : i
        ),
      }));
    } catch (err) {
      toast.error(t(err?.response?.data?.detail || "auth.genericError"));
    } finally {
      focusScan();
    }
  }

  // A line pushed from the product list stays `pending` until the cashier
  // confirms its variant here; checkout is blocked while any line is pending.
  function confirmVariant(item) {
    patch((tb) => ({
      items: tb.items.map((i) =>
        i.stock_id === item.stock_id ? { ...i, pending: false } : i
      ),
    }));
  }

  async function removeItem(item) {
    patch((tb) => ({ items: tb.items.filter((i) => i.stock_id !== item.stock_id) }));
    try {
      await posRelease(tab.holdKey, item.stock_id);
    } catch {
      /* best effort */
    }
    focusScan();
  }

  function commitPrice(item, raw) {
    setPriceDraft((d) => {
      const { [item.stock_id]: _drop, ...rest } = d;
      return rest;
    });
    let v = Number(raw);
    if (!isFinite(v) || v < 0) v = item.unit_price;
    // Cap at the product's list price — the cashier may only discount, never raise it.
    if (v > item.price) {
      v = item.price;
      toast.info(t("pos.priceCapped", { name: item.name }));
    }
    if (v < item.min_price) {
      v = item.min_price;
      toast.info(t("pos.priceAdjusted", { name: item.name }));
    }
    v = Number(v.toFixed(2));
    patch((tb) => ({
      items: tb.items.map((i) => (i.stock_id === item.stock_id ? { ...i, unit_price: v } : i)),
    }));
  }

  // Is a non-coding value selectable? Only if a sibling stock with that exact
  // combination exists and has free availability (or it's the current stock).
  function optionAvailable(item, attrId, valueId) {
    const target = { ...(item.selected || {}), [String(attrId)]: Number(valueId) };
    const keys = Object.keys(target);
    return (item.siblings || []).some((s) => {
      const a = s.attributes || {};
      if (Object.keys(a).length !== keys.length) return false;
      if (!keys.every((k) => Number(a[k]) === Number(target[k]))) return false;
      return s.available > 0 || s.stock_id === item.stock_id;
    });
  }

  // ---- Wizard nav ----
  const pendingLine = items.find((i) => i.pending);

  function goNextFromCart() {
    if (!items.length) return toast.info(t("pos.cartEmpty"));
    if (pendingLine) return toast.error(t("pos.finalizeRequired", { name: pendingLine.name }));
    patch({ step: 2 });
  }

  // Step 2 -> 3 only builds the invoice PREVIEW; the sale is not created yet.
  function goToInvoice() {
    if (!items.length) return toast.info(t("pos.cartEmpty"));
    if (pendingLine) return toast.error(t("pos.finalizeRequired", { name: pendingLine.name }));
    if (!tab.customer.name.trim()) return toast.error(t("pos.customer.nameRequired"));
    if (!tab.paymentMethodId) return toast.error(t("pos.payment.required"));
    if (!phoneValid(tab.customer.phone)) return toast.error(t("pos.errors.invalidPhone"));
    patch({ step: 3 });
  }

  // Auto-print the finished invoice using the profile assigned to "Invoice
  // Printing". With no assigned profile, the OS default printer/paper is used.
  async function autoPrintInvoice(sale) {
    const [{ profile }, general] = await Promise.all([
      getPrintTarget("invoice").catch(() => ({ profile: null })),
      getGeneralSettings().catch(() => ({})),
    ]);
    const invLang = resolveInvoiceLanguage(general.invoice_language, i18n.resolvedLanguage);
    const invIsAr = invLang === "ar";
    const tInv = i18n.getFixedT(invLang);
    const labels = {
      title: tInv("pos.invoice.title"),
      paidBadge: tInv("pos.invoice.paidBadge"),
      billTo: tInv("pos.invoice.billTo"),
      sellerName: tInv("pos.invoice.sellerName"),
      payment: tInv("pos.invoice.payment"),
      item: tInv("pos.invoice.item"),
      qty: tInv("pos.table.qty"),
      price: tInv("pos.table.price"),
      total: tInv("pos.table.total"),
      subtotal: tInv("pos.invoice.subtotal"),
      discount: tInv("pos.stats.discount"),
      totalLabel: tInv("pos.stats.total"),
      paid: tInv("pos.payment.paid"),
      changeRaw: tInv("pos.payment.changeRaw"),
      changeExact: tInv("pos.payment.changeExact"),
      thanks: tInv("pos.invoice.thanks"),
    };
    const logo = general.invoice_logo ? mediaUrl(general.invoice_logo) : brand.logo;
    const body = buildInvoiceHtml({
      inv: saleToInvoiceModel(sale, invIsAr, sellerName),
      brand: { ...brand, logo, address: general.branch_address || "" },
      isAr: invIsAr,
      isCash,
      labels,
      profile,
      money,
      num2,
    });
    await printDocument(body);
  }

  async function reprintInvoice() {
    if (!tab.sale || printing) return;
    setPrinting(true);
    try {
      await autoPrintInvoice(tab.sale);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setPrinting(false);
    }
  }

  // Actually create the sale (only from the invoice step, on "Checkout").
  async function doCheckout() {
    if (!items.length) return toast.info(t("pos.cartEmpty"));
    if (pendingLine) return toast.error(t("pos.finalizeRequired", { name: pendingLine.name }));
    if (!tab.customer.name.trim()) return toast.error(t("pos.customer.nameRequired"));
    if (!tab.paymentMethodId) return toast.error(t("pos.payment.required"));
    if (!phoneValid(tab.customer.phone)) return toast.error(t("pos.errors.invalidPhone"));
    setBusy(true);
    try {
      const sale = await posCheckout({
        hold_key: tab.holdKey,
        payment_method_id: tab.paymentMethodId,
        customer: {
          phone: tab.customer.phone.trim() || null,
          name: tab.customer.name.trim(),
        },
        items: items.map((i) => ({
          stock_id: i.stock_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
        ...(isCash ? { paid_amount: cash.paid } : {}),
      });
      toast.success(t("pos.invoice.done"));
      // "Skip invoice" → go straight to a fresh cart (no invoice screen, no print).
      // Otherwise show the completed invoice and print it automatically using the
      // assigned "Invoice Printing" profile (or the OS default printer).
      if (tab.skipInvoice) {
        newSale();
      } else {
        patch({ sale });
        autoPrintInvoice(sale).catch(() => {});
      }
    } catch (err) {
      toast.error(t(err?.response?.data?.detail || "auth.genericError"));
    } finally {
      setBusy(false);
    }
  }

  function newSale() {
    patch({
      items: [],
      step: 1,
      customer: { phone: "", name: "", existing: false },
      paymentMethodId: null,
      paidAmount: "",
      skipInvoice: false,
      sale: null,
      holdKey: newKey(),
    });
  }

  const setCustomer = (partial) =>
    patch((tb) => ({ customer: { ...tb.customer, ...partial } }));

  // Resolve a cart line's attributes (coding + selected non-coding) into the same
  // shape the backend snapshots, so the preview and the committed invoice match.
  const lineAttrs = (item) => {
    const out = [];
    for (const a of item.coding_attrs || [])
      out.push({ name_en: a.name_en, name_ar: a.name_ar, value_en: a.value_en, value_ar: a.value_ar, hex: a.hex });
    for (const a of item.nc_attrs || []) {
      const cur = item.selected?.[String(a.attr_id)];
      const v = (a.values || []).find((x) => Number(x.value_id) === Number(cur));
      if (v) out.push({ name_en: a.name_en, name_ar: a.name_ar, value_en: v.value_en, value_ar: v.value_ar, hex: v.hex });
    }
    return out;
  };

  const committed = !!tab.sale;
  const inv = committed
    ? saleToInvoiceModel(tab.sale, isAr, sellerName)
    : {
        invoice_no: null,
        created_at: new Date().toISOString(),
        customer_name: tab.customer.name,
        seller_name: sellerName,
        customer_phone: normalizePhone(tab.customer.phone),
        payment_method: selectedMethod ? (isAr ? selectedMethod.name_ar : selectedMethod.name_en) : "",
        items: items.map((i) => ({
          name: i.name,
          attributes: lineAttrs(i),
          quantity: i.quantity,
          // Rows show the catalog (list) price; discount bridges to the net total.
          unit_price: i.price,
          line_total: (i.price || 0) * (i.quantity || 0),
        })),
        // Subtotal is gross (before discount); total is net (after discount).
        subtotal: stats.total + stats.discount,
        discount: stats.discount,
        total: stats.total,
        paid: cash.paid,
        changeExact: cash.exact,
        changeRaw: cash.raw,
      };

  const inputSm = "ctrl-input-sm w-full text-sm";

  return (
    <div className="ctrl-card flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 border-b border-border px-4 py-3 sm:gap-4">
        {STEPS.map((key, idx) => {
          const n = idx + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={key} className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition ${
                    done
                      ? "bg-accent text-black"
                      : active
                      ? "bg-accent/20 text-accent ring-2 ring-accent"
                      : "bg-elevated text-muted"
                  }`}
                >
                  {done ? <IconCheck width={14} height={14} /> : n}
                </span>
                <span
                  className={`hidden text-sm font-medium sm:inline ${
                    active ? "text-text" : "text-muted"
                  }`}
                >
                  {t(key)}
                </span>
              </div>
              {idx < STEPS.length - 1 && <span className="h-px w-6 bg-border sm:w-10" />}
            </div>
          );
        })}
      </div>

      {/* Step body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {step === 1 && (
          <div className="flex h-full flex-col gap-4">
            {/* Scan box */}
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
                <IconSearch width={18} height={18} />
              </span>
              <input
                ref={scanRef}
                autoFocus
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleScan()}
                placeholder={t("pos.scan.placeholder")}
                className="ctrl-input px-10 py-3 text-center text-base"
              />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard tone="sky" Icon={IconCart} label={t("pos.stats.items")} value={stats.count} />
              <StatCard tone="amber" Icon={IconDiscount} label={t("pos.stats.discount")} value={money(stats.discount)} />
              <StatCard tone="emerald" Icon={IconWallet} label={t("pos.stats.total")} value={money(stats.total)} />
            </div>

            {/* Items */}
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
              {items.length === 0 ? (
                <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 py-10 text-center text-muted">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated">
                    <IconCart width={26} height={26} />
                  </span>
                  <p className="text-sm">{t("pos.empty")}</p>
                </div>
              ) : (
                <div className="max-h-full overflow-auto">
                  <table className="ctrl-table w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-surface">
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                        <th className="w-14 px-3 py-2.5" />
                        <th className="px-3 py-2.5 text-start font-medium">{t("pos.table.code")}</th>
                        <th className="px-3 py-2.5 text-center font-medium">{t("pos.table.category")}</th>
                        <th className="px-3 py-2.5 text-start font-medium">{t("pos.table.name")}</th>
                        {attrColumns.map((col) => (
                          <th key={col.attr_id} className="px-3 py-2.5 text-center font-medium">
                            {isAr ? col.name_ar : col.name_en}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-center font-medium">{t("pos.table.price")}</th>
                        <th className="px-3 py-2.5 text-center font-medium">{t("pos.table.qty")}</th>
                        <th className="px-3 py-2.5 text-end font-medium">{t("pos.table.total")}</th>
                        <th className="w-16 px-2 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const priceVal = priceDraft[item.stock_id] ?? String(item.unit_price);
                        const qtyVal = qtyDraft[item.stock_id] ?? String(item.quantity);
                        const atMax = item.quantity >= item.available;
                        const editing = editPrice === item.stock_id;
                        const editingQty = editQty === item.stock_id;
                        return (
                          <tr
                            key={item.stock_id}
                            className={`border-b border-border/60 last:border-0 ${
                              item.pending ? "bg-amber-500/10" : ""
                            }`}
                          >
                            <td className="px-3 py-2">
                              <div className="mx-auto h-10 w-10 overflow-hidden rounded-lg border border-border bg-elevated">
                                {item.image ? (
                                  <img src={mediaUrl(item.image)} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-muted">
                                    <IconImage width={16} height={16} />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-muted">{item.code}</td>
                            <td className="px-3 py-2 text-center text-xs text-muted">
                              {(isAr ? item.category_ar : item.category_en) || "—"}
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-medium text-text">{item.name}</p>
                            </td>
                            {attrColumns.map((col) => {
                              const coding = (item.coding_attrs || []).find(
                                (a) => a.attr_id === col.attr_id
                              );
                              const nc = (item.nc_attrs || []).find((a) => a.attr_id === col.attr_id);
                              // Editable when it's a non-coding attribute, or a coding
                              // attribute on a flexible (product-scanned) line.
                              const editable =
                                nc || (coding && coding.editable && coding.values ? coding : null);
                              if (editable) {
                                const cur = item.selected?.[String(editable.attr_id)] ?? "";
                                const curVal = (editable.values || []).find(
                                  (val) => Number(val.value_id) === Number(cur)
                                );
                                return (
                                  <td key={col.attr_id} className="px-3 py-2">
                                    <div className="mx-auto flex w-fit items-center gap-1.5">
                                      {editable.type === "color" && curVal?.hex && (
                                        <span
                                          className="h-3 w-3 shrink-0 rounded-full border border-border"
                                          style={{ backgroundColor: curVal.hex }}
                                        />
                                      )}
                                      <select
                                        value={cur}
                                        onChange={(e) =>
                                          doSwitch(item, editable.attr_id, e.target.value)
                                        }
                                        className="ctrl-input-sm ctrl-select h-7 py-0 text-xs"
                                      >
                                        {(editable.values || []).map((val) => {
                                          const ok =
                                            val.available ??
                                            optionAvailable(item, editable.attr_id, val.value_id);
                                          return (
                                            <option
                                              key={val.value_id}
                                              value={val.value_id}
                                              disabled={!ok}
                                            >
                                              {(isAr ? val.value_ar : val.value_en) +
                                                (ok ? "" : ` — ${t("pos.table.soldOut")}`)}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    </div>
                                  </td>
                                );
                              }
                              if (coding) {
                                // Locked: baked into the scanned variant code.
                                return (
                                  <td key={col.attr_id} className="px-3 py-2">
                                    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                                      {coding.type === "color" && coding.hex && (
                                        <span
                                          className="h-3 w-3 shrink-0 rounded-full border border-border"
                                          style={{ backgroundColor: coding.hex }}
                                        />
                                      )}
                                      {isAr ? coding.value_ar : coding.value_en}
                                    </span>
                                  </td>
                                );
                              }
                              return (
                                <td key={col.attr_id} className="px-3 py-2 text-center text-muted">
                                  —
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 text-center">
                              {editing ? (
                                <input
                                  autoFocus
                                  type="text"
                                  inputMode="decimal"
                                  dir="ltr"
                                  value={priceVal}
                                  onChange={(e) =>
                                    setPriceDraft((d) => ({
                                      ...d,
                                      [item.stock_id]: e.target.value.replace(/[^0-9.]/g, ""),
                                    }))
                                  }
                                  onBlur={(e) => {
                                    commitPrice(item, e.target.value);
                                    setEditPrice(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      commitPrice(item, e.target.value);
                                      setEditPrice(null);
                                    } else if (e.key === "Escape") {
                                      setPriceDraft((d) => {
                                        const { [item.stock_id]: _drop, ...rest } = d;
                                        return rest;
                                      });
                                      setEditPrice(null);
                                    }
                                  }}
                                  className={`${inputSm} mx-auto w-24 text-center`}
                                />
                              ) : (
                                <button
                                  type="button"
                                  onDoubleClick={() => {
                                    setPriceDraft((d) => ({
                                      ...d,
                                      [item.stock_id]: String(item.unit_price),
                                    }));
                                    setEditPrice(item.stock_id);
                                  }}
                                  title={t("pos.table.editPrice")}
                                  className={`mx-auto cursor-text rounded-md px-2 py-1 font-medium tabular-nums hover:bg-elevated ${
                                    item.unit_price < item.price ? "text-amber-300" : "text-text"
                                  }`}
                                  dir="ltr"
                                >
                                  {num2(item.unit_price)}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="mx-auto flex w-fit items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => commitQty(item, item.quantity - 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-accent transition hover:bg-accent/10"
                                >
                                  <span className="text-base leading-none">−</span>
                                </button>
                                {editingQty ? (
                                  <input
                                    autoFocus
                                    type="text"
                                    inputMode="numeric"
                                    dir="ltr"
                                    value={qtyVal}
                                    onChange={(e) =>
                                      setQtyDraft((d) => ({
                                        ...d,
                                        [item.stock_id]: e.target.value.replace(/[^0-9]/g, ""),
                                      }))
                                    }
                                    onBlur={(e) => {
                                      commitQty(item, Math.trunc(Number(e.target.value) || 0));
                                      setEditQty(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        commitQty(item, Math.trunc(Number(e.target.value) || 0));
                                        setEditQty(null);
                                      } else if (e.key === "Escape") {
                                        setQtyDraft((d) => {
                                          const { [item.stock_id]: _drop, ...rest } = d;
                                          return rest;
                                        });
                                        setEditQty(null);
                                      }
                                    }}
                                    className={`${inputSm} w-14 text-center`}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onDoubleClick={() => {
                                      setQtyDraft((d) => ({
                                        ...d,
                                        [item.stock_id]: String(item.quantity),
                                      }));
                                      setEditQty(item.stock_id);
                                    }}
                                    title={t("pos.table.editQty")}
                                    className="w-14 cursor-text rounded-md px-2 py-1 text-center font-medium tabular-nums text-text hover:bg-elevated"
                                    dir="ltr"
                                  >
                                    {item.quantity}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={atMax}
                                  onClick={() => commitQty(item, item.quantity + 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-accent transition hover:bg-accent/10 disabled:opacity-40"
                                >
                                  <IconPlus width={14} height={14} />
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-end font-semibold text-text">
                              {money((item.unit_price || 0) * (item.quantity || 0))}
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex items-center justify-center gap-1">
                                {item.pending && (
                                  <button
                                    type="button"
                                    onClick={() => confirmVariant(item)}
                                    title={t("pos.confirmVariant")}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent hover:bg-accent/25"
                                  >
                                    <IconCheck width={15} height={15} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeItem(item)}
                                  title={t("pos.remove")}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
                                >
                                  <IconTrash width={15} height={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mx-auto max-w-xl space-y-5">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-text">
                <IconUser width={18} height={18} className="text-accent" />
                {t("pos.customer.title")}
              </h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">{t("pos.customer.phone")}</label>
                <input
                  dir="ltr"
                  value={tab.customer.phone}
                  onChange={(e) => setCustomer({ phone: e.target.value })}
                  onBlur={(e) => {
                    const n = normalizePhone(e.target.value);
                    if (n && n !== e.target.value) setCustomer({ phone: n });
                  }}
                  className={`${inputSm} ${
                    tab.customer.phone && !phoneValid(tab.customer.phone)
                      ? "border-red-500/70"
                      : ""
                  }`}
                  placeholder="+20…"
                />
                <p className="mt-1 text-xs text-muted">{t("pos.customer.phoneHint")}</p>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
                  {t("pos.customer.name")}
                  {tab.customer.existing && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      {t("pos.customer.existing")}
                    </span>
                  )}
                </label>
                <input
                  value={tab.customer.name}
                  onChange={(e) => setCustomer({ name: e.target.value })}
                  readOnly={tab.customer.existing}
                  className={`${inputSm} ${tab.customer.existing ? "opacity-70" : ""}`}
                  placeholder={t("pos.customer.name")}
                />
              </div>
            </div>

            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
                <IconWallet width={16} height={16} className="text-accent" />
                {t("pos.payment.title")}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {methods.map((m) => {
                  const selected = tab.paymentMethodId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => patch({ paymentMethodId: m.id })}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${
                        selected
                          ? "border-accent bg-accent/10 text-text"
                          : "border-border text-muted hover:border-accent/50 hover:text-text"
                      }`}
                    >
                      <span className="font-medium">{isAr ? m.name_ar : m.name_en}</span>
                      {selected && <IconCheck width={16} height={16} className="text-accent" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cash tendered + change (only for cash payments) */}
            {isCash && (
              <div className="rounded-xl border border-border bg-elevated/40 p-4">
                <label className="mb-1 block text-xs font-medium text-muted">
                  {t("pos.payment.paid")}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={tab.paidAmount}
                  onChange={(e) => patch({ paidAmount: e.target.value.replace(/[^0-9.]/g, "") })}
                  onBlur={(e) => {
                    // Auto-adjust: anything below the total snaps up to the total.
                    const v = Number(e.target.value);
                    if (!isFinite(v) || v < stats.total) patch({ paidAmount: stats.total.toFixed(2) });
                  }}
                  placeholder={num2(stats.total)}
                  className={`${inputSm} text-center text-base`}
                />
                <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                  <div className="flex items-center justify-between text-muted">
                    <span>{t("pos.payment.changeRaw")}</span>
                    <span className="text-lg font-bold text-accent">{money(cash.raw)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{t("pos.payment.changeExact")}</span>
                    <span>{money(cash.exact)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="rounded-xl border border-border bg-elevated/40 p-4">
              <div className="flex items-center justify-between text-sm text-muted">
                <span>{t("pos.stats.items")}</span>
                <span className="text-text">{stats.count}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-base font-bold text-text">
                <span>{t("pos.stats.total")}</span>
                <span>{money(stats.total)}</span>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mx-auto max-w-2xl">
            <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-elevated/40 to-surface shadow-xl">
              {/* Brand header */}
              <div className="flex items-center justify-between gap-4 border-b border-border bg-elevated/40 p-5">
                <div className="flex items-center">
                  {brand.logo && (
                    <img
                      src={brand.logo}
                      alt=""
                      className="h-14 w-14 shrink-0 object-contain object-center"
                    />
                  )}
                </div>
                <div className="text-end">
                  <p className="font-mono text-sm text-text">
                    {inv.invoice_no || t("pos.invoice.draft")}
                  </p>
                  <p className="text-xs text-muted" dir="ltr">
                    {inv.created_at
                      ? new Date(inv.created_at).toLocaleString(isAr ? "ar-EG" : "en-US")
                      : "—"}
                  </p>
                </div>
              </div>

              {/* Bill to + payment */}
              <div className="grid grid-cols-2 gap-4 border-b border-border p-5 text-sm">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-widest text-muted">
                    {t("pos.invoice.billTo")}
                  </p>
                  <p className="font-semibold text-text">{inv.customer_name || "—"}</p>
                  <p className="mt-3 mb-1 text-xs uppercase tracking-widest text-muted">
                    {t("pos.invoice.sellerName")}
                  </p>
                  <p className="font-semibold text-text">{inv.seller_name || "—"}</p>
                </div>
                <div className="text-end">
                  <p className="mb-1 text-xs uppercase tracking-widest text-muted">
                    {t("pos.invoice.payment")}
                  </p>
                  <p className="font-semibold text-text">{inv.payment_method || "—"}</p>
                </div>
              </div>

              {/* Items */}
              <div className="p-5">
                <table className="ctrl-table w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted">
                      <th className="px-2 py-2 text-start font-medium">{t("pos.invoice.item")}</th>
                      <th className="px-2 py-2 text-center font-medium">{t("pos.table.qty")}</th>
                      <th className="px-2 py-2 text-center font-medium">{t("pos.table.price")}</th>
                      <th className="px-2 py-2 text-end font-medium">{t("pos.table.total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.items.map((it, idx) => (
                      <tr key={idx} className="border-b border-border/50 last:border-0">
                        <td className="px-2 py-2 text-start">
                          <p className="font-medium text-text">{invoiceItemName(it.name, it.attributes)}</p>
                          {(it.attributes || []).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {it.attributes.map((a, i2) => (
                                <span
                                  key={i2}
                                  className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted"
                                >
                                  {a.hex && (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full border border-white/20"
                                      style={{ backgroundColor: a.hex }}
                                    />
                                  )}
                                  {(isAr ? a.value_ar : a.value_en) || a.value_en}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center text-text">{it.quantity}</td>
                        <td className="px-2 py-2 text-center text-text" dir="ltr">{num2(it.unit_price)}</td>
                        <td className="px-2 py-2 text-end font-medium text-text">{money(it.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals — full-width rows: label on the start, amount on the end. */}
              <div className="border-t border-border p-5">
                <div className="w-full space-y-1.5 text-sm">
                  <div className="flex items-center justify-between text-muted">
                    <span>{t("pos.invoice.subtotal")}</span>
                    <span className="text-text">{money(inv.subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted">
                    <span>{t("pos.stats.discount")}</span>
                    <span className="text-text">−{money(inv.discount)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2 text-base font-bold text-text">
                    <span>{t("pos.stats.total")}</span>
                    <span>{money(inv.total)}</span>
                  </div>
                  {isCash && (
                    <div className="mt-2 space-y-1 rounded-lg bg-elevated/50 p-3">
                      <div className="flex items-center justify-between text-muted">
                        <span>{t("pos.payment.paid")}</span>
                        <span className="text-text">{money(inv.paid)}</span>
                      </div>
                      <div className="flex items-center justify-between font-semibold text-accent">
                        <span>{t("pos.payment.changeRaw")}</span>
                        <span>{money(inv.changeExact)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-border bg-elevated/30 p-4 text-center text-xs text-muted">
                {t("pos.invoice.thanks")}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        {step === 1 && (
          <>
            <span className="text-sm text-muted">
              {t("pos.stats.total")}: <span className="font-semibold text-text">{money(stats.total)}</span>
            </span>
            <button
              type="button"
              onClick={goNextFromCart}
              disabled={!items.length}
              className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95 disabled:opacity-40"
            >
              {t("pos.next")}
              {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <button
              type="button"
              onClick={() => patch({ step: 1 })}
              className="ctrl-btn border border-border px-4 py-2 text-sm text-text hover:bg-elevated"
            >
              {isAr ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
              {t("pos.back")}
            </button>
            <button
              type="button"
              onClick={goToInvoice}
              className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95 disabled:opacity-50"
            >
              {t("pos.next")}
              {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
            </button>
          </>
        )}
        {step === 3 && !committed && (
          <>
            <button
              type="button"
              onClick={() => patch({ step: 2 })}
              className="ctrl-btn border border-border px-4 py-2 text-sm text-text hover:bg-elevated"
            >
              {isAr ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
              {t("pos.back")}
            </button>
            <div className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={tab.skipInvoice}
                  onChange={(e) => patch({ skipInvoice: e.target.checked })}
                  className="ctrl-check"
                />
                {t("pos.invoice.skip")}
              </label>
              <button
                type="button"
                onClick={doCheckout}
                disabled={busy}
                className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95 disabled:opacity-50"
              >
                <IconCheck width={16} height={16} /> {t("pos.invoice.checkout")}
              </button>
            </div>
          </>
        )}
        {step === 3 && committed && (
          <>
            <button
              type="button"
              onClick={reprintInvoice}
              disabled={printing}
              className="ctrl-btn border border-border px-4 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50"
            >
              <IconPrinter width={16} height={16} /> {t("pos.invoice.print")}
            </button>
            <button
              type="button"
              onClick={newSale}
              className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95"
            >
              <IconPlus width={16} height={16} /> {t("pos.invoice.newSale")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
