import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import { posScan, posSetQty, posSwitch, posRelease, posCheckout, lookupCustomer } from "@/lib/pos";
import { mediaUrl } from "@/lib/products";
import {
  IconSearch,
  IconTrash,
  IconPlus,
  IconCart,
  IconCheck,
  IconUser,
  IconWallet,
  IconImage,
  IconChevronLeft,
  IconChevronRight,
} from "@/components/icons";

const newKey = () =>
  crypto?.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`;

const STEPS = ["pos.step.cart", "pos.step.customer", "pos.step.invoice"];

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

export default function CartWorkspace({ tab, boot, patch }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();

  const currency = boot?.currency || "";
  const methods = boot?.payment_methods || [];

  const [scanValue, setScanValue] = useState("");
  const [priceDraft, setPriceDraft] = useState({});
  const [qtyDraft, setQtyDraft] = useState({});
  const [busy, setBusy] = useState(false);
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
        const r = await lookupCustomer(phone);
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
  const mapLine = (line) => ({
    stock_id: line.stock_id,
    variant_id: line.variant_id,
    product_id: line.product_id,
    code: line.code,
    name: line.name,
    variant_en: line.variant_en,
    variant_ar: line.variant_ar,
    image: line.image,
    price: line.price,
    min_price: line.min_price,
    quantity: line.quantity,
    available: line.available,
    on_hand: line.on_hand,
    nc_attrs: line.nc_attrs || [],
    selected: line.selected || {},
    siblings: line.siblings || [],
  });

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

  // Switch a line's non-coding attribute (e.g. size) to an in-stock sibling.
  async function doSwitch(item, attrId, valueId) {
    if (!valueId) return;
    const target = { ...(item.selected || {}), [String(attrId)]: Number(valueId) };
    try {
      const line = await posSwitch(tab.holdKey, item.stock_id, target);
      if (line.capped) toast.info(t("pos.qtyCapped", { count: line.quantity }));
      patch((tb) => ({
        items: tb.items.map((i) =>
          i.stock_id === item.stock_id ? { ...mapLine(line), unit_price: i.unit_price } : i
        ),
      }));
    } catch (err) {
      toast.error(t(err?.response?.data?.detail || "auth.genericError"));
    } finally {
      focusScan();
    }
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
  function goNextFromCart() {
    if (!items.length) return toast.info(t("pos.cartEmpty"));
    patch({ step: 2 });
  }

  async function doCheckout() {
    if (!items.length) return toast.info(t("pos.cartEmpty"));
    if (!tab.customer.name.trim()) return toast.error(t("pos.customer.nameRequired"));
    if (!tab.paymentMethodId) return toast.error(t("pos.payment.required"));
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
      });
      patch({ sale, step: 3 });
      toast.success(t("pos.invoice.done"));
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
      sale: null,
      holdKey: newKey(),
    });
  }

  const setCustomer = (partial) =>
    patch((tb) => ({ customer: { ...tb.customer, ...partial } }));

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
              <StatCard tone="amber" Icon={IconWallet} label={t("pos.stats.discount")} value={money(stats.discount)} />
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
                <div className="max-h-full overflow-y-auto">
                  <table className="ctrl-table w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-surface">
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                        <th className="w-14 px-3 py-2.5" />
                        <th className="px-3 py-2.5 text-start font-medium">{t("pos.table.code")}</th>
                        <th className="px-3 py-2.5 text-start font-medium">{t("pos.table.name")}</th>
                        <th className="px-3 py-2.5 text-start font-medium">{t("pos.table.price")}</th>
                        <th className="px-3 py-2.5 text-center font-medium">{t("pos.table.qty")}</th>
                        <th className="px-3 py-2.5 text-end font-medium">{t("pos.table.total")}</th>
                        <th className="w-10 px-2 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const label = (isAr ? item.variant_ar : item.variant_en) || "";
                        const priceVal = priceDraft[item.stock_id] ?? String(item.unit_price);
                        const qtyVal = qtyDraft[item.stock_id] ?? String(item.quantity);
                        const atMax = item.quantity >= item.available;
                        return (
                          <tr key={item.stock_id} className="border-b border-border/60 last:border-0">
                            <td className="px-3 py-2">
                              <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-elevated">
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
                            <td className="px-3 py-2">
                              <p className="font-medium text-text">{item.name}</p>
                              {/* Coding attributes are baked into the code — locked. */}
                              {label && <p className="text-xs text-muted">{label}</p>}
                              {/* Non-coding attributes can be switched to in-stock siblings. */}
                              {(item.nc_attrs || []).length > 0 && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                  {item.nc_attrs.map((a) => {
                                    const cur = item.selected?.[String(a.attr_id)] ?? "";
                                    const curVal = a.values.find((val) => Number(val.value_id) === Number(cur));
                                    return (
                                      <span key={a.attr_id} className="flex items-center gap-1 text-xs">
                                        <span className="text-muted">
                                          {isAr ? a.name_ar : a.name_en}:
                                        </span>
                                        {a.type === "color" && curVal?.hex && (
                                          <span className="h-3 w-3 shrink-0 rounded-full border border-border"
                                            style={{ backgroundColor: curVal.hex }} />
                                        )}
                                        <select
                                          value={cur}
                                          onChange={(e) => doSwitch(item, a.attr_id, e.target.value)}
                                          className="ctrl-input-sm ctrl-select h-7 py-0 text-xs"
                                        >
                                          {a.values.map((val) => {
                                            const ok = optionAvailable(item, a.attr_id, val.value_id);
                                            return (
                                              <option key={val.value_id} value={val.value_id} disabled={!ok}>
                                                {(isAr ? val.value_ar : val.value_en) +
                                                  (ok ? "" : ` — ${t("pos.table.soldOut")}`)}
                                              </option>
                                            );
                                          })}
                                        </select>
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={item.min_price}
                                step="0.01"
                                dir="ltr"
                                value={priceVal}
                                onChange={(e) =>
                                  setPriceDraft((d) => ({ ...d, [item.stock_id]: e.target.value }))
                                }
                                onBlur={(e) => commitPrice(item, e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && commitPrice(item, e.target.value)}
                                className={`${inputSm} w-24`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="mx-auto flex w-fit items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => commitQty(item, item.quantity - 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent"
                                >
                                  <span className="text-base leading-none">−</span>
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  dir="ltr"
                                  value={qtyVal}
                                  onChange={(e) =>
                                    setQtyDraft((d) => ({ ...d, [item.stock_id]: e.target.value }))
                                  }
                                  onBlur={(e) => commitQty(item, Math.trunc(Number(e.target.value) || 0))}
                                  onKeyDown={(e) =>
                                    e.key === "Enter" && commitQty(item, Math.trunc(Number(e.target.value) || 0))
                                  }
                                  className={`${inputSm} w-14 text-center`}
                                />
                                <button
                                  type="button"
                                  disabled={atMax}
                                  onClick={() => commitQty(item, item.quantity + 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent disabled:opacity-40"
                                >
                                  <IconPlus width={14} height={14} />
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-end font-semibold text-text">
                              {money((item.unit_price || 0) * (item.quantity || 0))}
                            </td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() => removeItem(item)}
                                title={t("pos.remove")}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
                              >
                                <IconTrash width={15} height={15} />
                              </button>
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
                  className={inputSm}
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

        {step === 3 && tab.sale && (
          <div className="mx-auto max-w-lg">
            <div className="rounded-2xl border border-border bg-elevated/30 p-6">
              <div className="mb-4 text-center">
                <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <IconCheck width={26} height={26} />
                </span>
                <h3 className="text-lg font-bold text-text">{t("pos.invoice.title")}</h3>
                <p className="text-xs text-muted">{t("pos.invoice.thanks")}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 border-y border-border py-3 text-sm">
                <span className="text-muted">{t("pos.invoice.number")}</span>
                <span className="text-end font-mono text-text">{tab.sale.invoice_no}</span>
                <span className="text-muted">{t("pos.invoice.date")}</span>
                <span className="text-end text-text" dir="ltr">
                  {tab.sale.created_at ? new Date(tab.sale.created_at).toLocaleString(isAr ? "ar-EG" : "en-US") : "—"}
                </span>
                <span className="text-muted">{t("pos.invoice.customer")}</span>
                <span className="text-end text-text">{tab.sale.customer_name || "—"}</span>
                <span className="text-muted">{t("pos.invoice.payment")}</span>
                <span className="text-end text-text">{tab.sale.payment_method || "—"}</span>
              </div>

              <table className="my-3 w-full text-sm">
                <tbody>
                  {tab.sale.items.map((it, idx) => (
                    <tr key={idx} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 text-text">
                        {it.name} <span className="text-muted">× {it.quantity}</span>
                      </td>
                      <td className="py-1.5 text-end text-text">{money(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between border-t border-border pt-3 text-base font-bold text-text">
                <span>{t("pos.stats.total")}</span>
                <span>{money(tab.sale.total)}</span>
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
              onClick={doCheckout}
              disabled={busy}
              className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95 disabled:opacity-50"
            >
              {t("pos.next")}
              {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <button
              type="button"
              onClick={() => {}}
              className="ctrl-btn border border-border px-4 py-2 text-sm text-text hover:bg-elevated"
            >
              {t("pos.invoice.print")}
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
