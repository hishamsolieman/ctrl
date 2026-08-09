import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import {
  listCustomers,
  getCustomerStats,
  listCustomerSales,
  updateCustomer,
  exportCustomers,
} from "@/lib/customers";
import StatCard, { MASK } from "@/components/StatCard";
import {
  IconUser,
  IconWallet,
  IconList,
  IconCart,
  IconSearch,
  IconPhone,
  IconEdit,
  IconTrendUp,
  IconTrendDown,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconEye,
  IconEyeOff,
} from "@/components/icons";

const PAGE_SIZE = 10;
const MODERATOR_LEVEL = 20;
const SECRETS = ["total", "orders", "revenue", "top"];
const HIDDEN = Object.fromEntries(SECRETS.map((k) => [k, false]));

function TrendBadge({ trend, phrase, format, revealed }) {
  if (!trend) return null;
  const up = trend.dir === "up";
  const down = trend.dir === "down";
  const color = up ? "text-emerald-400" : down ? "text-red-400" : "text-muted";
  const Arrow = up ? IconTrendUp : down ? IconTrendDown : null;
  const shown = revealed ? (format ? format(trend.month) : trend.month) : MASK;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`inline-flex items-center gap-1 font-semibold ${color}`}>
        {Arrow && <Arrow width={14} height={14} />}
        {shown}
      </span>
      <span className="truncate text-muted">{phrase}</span>
    </div>
  );
}

function ColReveal({ label, shown, onToggle, showTitle, hideTitle }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <button
        type="button"
        onClick={onToggle}
        title={shown ? hideTitle : showTitle}
        className="text-muted transition hover:text-text"
      >
        {shown ? <IconEyeOff width={15} height={15} /> : <IconEye width={15} height={15} />}
      </button>
    </span>
  );
}

export default function Customers() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const canAccess = !!user && (user.role_level ?? 0) >= MODERATOR_LEVEL;

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState(HIDDEN);
  const [showPhone, setShowPhone] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [showSpent, setShowSpent] = useState(false);

  // Lazily-loaded per-customer sales; open accordions tracked by id.
  const [expanded, setExpanded] = useState(() => new Set());
  const [salesById, setSalesById] = useState({});
  const [openInvoices, setOpenInvoices] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setShown(HIDDEN);
    setShowPhone(false);
    setShowOrders(false);
    setShowSpent(false);
    try {
      const [rows, s] = await Promise.all([listCustomers(), getCustomerStats()]);
      setItems(rows);
      setStats(s);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (canAccess) load();
  }, [canAccess, load]);

  const money = useCallback(
    (n) => {
      const value = Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${value} ${stats?.currency || ""}`.trim();
    },
    [isAr, stats]
  );

  const num = useCallback(
    (n) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US"),
    [isAr]
  );

  const fmtDate = useCallback(
    (iso) => {
      if (!iso) return "—";
      try {
        return new Date(iso).toLocaleString(isAr ? "ar-EG" : "en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        return iso;
      }
    },
    [isAr]
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) =>
      [x.name, x.phone].some((v) => (v || "").toLowerCase().includes(s))
    );
  }, [items, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  useEffect(() => {
    setPage(1);
  }, [q]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const allShown = SECRETS.every((k) => shown[k]);
  const toggle = (k) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () =>
    setShown(Object.fromEntries(SECRETS.map((k) => [k, !allShown])));
  const revealProps = (key) => ({
    secret: true,
    revealed: shown[key],
    onToggleSecret: () => toggle(key),
    revealLabel: t("customers.reveal"),
    hideLabel: t("customers.hide"),
  });

  async function onExport() {
    try {
      await exportCustomers(q.trim() || undefined);
    } catch {
      toast.error(t("auth.genericError"));
    }
  }

  async function toggleExpand(c) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(c.id)) n.delete(c.id);
      else n.add(c.id);
      return n;
    });
    if (!expanded.has(c.id) && !salesById[c.id]) {
      setSalesById((m) => ({ ...m, [c.id]: { loading: true, data: [] } }));
      try {
        const data = await listCustomerSales(c.id);
        setSalesById((m) => ({ ...m, [c.id]: { loading: false, data } }));
      } catch {
        setSalesById((m) => ({ ...m, [c.id]: { loading: false, data: [] } }));
        toast.error(t("auth.genericError"));
      }
    }
  }

  function toggleInvoice(saleId) {
    setOpenInvoices((prev) => {
      const n = new Set(prev);
      if (n.has(saleId)) n.delete(saleId);
      else n.add(saleId);
      return n;
    });
  }

  function openEdit(c) {
    setEditing(c);
    setEditName(c.name);
  }

  async function saveEdit() {
    if (!editing) return;
    const name = editName.trim();
    if (!name) return toast.error(t("customers.nameRequired"));
    setSaving(true);
    try {
      const updated = await updateCustomer(editing.id, name);
      setItems((prev) => prev.map((x) => (x.id === editing.id ? { ...x, name: updated.name } : x)));
      toast.success(t("customers.saved"));
      setEditing(null);
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";
  const toolbarBtn = "ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated";
  const COLS = 7;
  const showLbl = t("customers.show");
  const hideLbl = t("customers.hide");

  if (authLoading) return null;
  if (!canAccess) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("customers.title")}</h1>
          <p className="text-sm text-muted">{t("customers.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onExport} className={toolbarBtn}>
            <IconDownload width={16} height={16} /> {t("customers.export")}
          </button>
          <button type="button" onClick={toggleAll} className={toolbarBtn}>
            {allShown ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
            {allShown ? t("customers.hideAll") : t("customers.showAll")}
          </button>
        </div>
      </div>

      {/* Stats cards — every value starts masked */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          tone="emerald"
          Icon={IconUser}
          label={t("customers.stats.total")}
          value={stats != null ? num(stats.total) : "—"}
          foot={
            <TrendBadge
              trend={stats?.totalTrend}
              phrase={t("customers.stats.newThisMonth")}
              revealed={shown.total}
            />
          }
          {...revealProps("total")}
        />
        <StatCard
          tone="sky"
          Icon={IconList}
          label={t("customers.stats.orders")}
          value={stats != null ? num(stats.orders) : "—"}
          foot={
            <TrendBadge
              trend={stats?.ordersTrend}
              phrase={t("customers.stats.ordersThisMonth")}
              revealed={shown.orders}
            />
          }
          {...revealProps("orders")}
        />
        <StatCard
          tone="amber"
          Icon={IconWallet}
          label={t("customers.stats.revenue")}
          value={stats ? money(stats.revenue) : "—"}
          foot={
            <TrendBadge
              trend={stats?.revenueTrend}
              phrase={t("customers.stats.revenueThisMonth")}
              format={money}
              revealed={shown.revenue}
            />
          }
          {...revealProps("revenue")}
        />
        <StatCard
          tone="violet"
          Icon={IconCart}
          label={t("customers.stats.top")}
          value={stats?.top ? stats.top.name : t("customers.stats.none")}
          foot={
            stats?.top ? (
              <span className="font-semibold text-text">
                {shown.top ? money(stats.top.spent) : MASK}
              </span>
            ) : null
          }
          {...revealProps("top")}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
          <IconSearch width={18} height={18} />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("customers.search")}
          className="ctrl-input py-2.5 ps-10"
        />
      </div>

      {/* Table */}
      <div className="ctrl-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-4">
              <div className="h-9 animate-pulse rounded-lg bg-elevated" />
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-elevated/70" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-muted">
                <IconUser width={30} height={30} />
              </span>
              <div>
                <p className="text-lg font-semibold text-text">{t("customers.empty")}</p>
                <p className="mt-1 text-sm text-muted">{t("customers.emptyBody")}</p>
              </div>
            </div>
          ) : (
            <table className="ctrl-table w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="w-10 px-2 py-3" />
                  <th className="px-4 py-3 text-start font-medium">{t("customers.table.name")}</th>
                  <th className="px-4 py-3 text-start font-medium">
                    <ColReveal
                      label={t("customers.table.phone")}
                      shown={showPhone}
                      onToggle={() => setShowPhone((v) => !v)}
                      showTitle={showLbl}
                      hideTitle={hideLbl}
                    />
                  </th>
                  <th className="px-4 py-3 text-center font-medium">
                    <ColReveal
                      label={t("customers.table.orders")}
                      shown={showOrders}
                      onToggle={() => setShowOrders((v) => !v)}
                      showTitle={showLbl}
                      hideTitle={hideLbl}
                    />
                  </th>
                  <th className="px-4 py-3 text-end font-medium">
                    <ColReveal
                      label={t("customers.table.spent")}
                      shown={showSpent}
                      onToggle={() => setShowSpent((v) => !v)}
                      showTitle={showLbl}
                      hideTitle={hideLbl}
                    />
                  </th>
                  <th className="px-4 py-3 text-start font-medium">{t("customers.table.lastOrder")}</th>
                  <th className="px-4 py-3 text-end font-medium">{t("customers.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((c) => {
                  const isOpen = expanded.has(c.id);
                  const sales = salesById[c.id];
                  return (
                    <FragmentRow
                      key={c.id}
                      c={c}
                      cols={COLS}
                      isOpen={isOpen}
                      sales={sales}
                      openInvoices={openInvoices}
                      showPhone={showPhone}
                      showOrders={showOrders}
                      showSpent={showSpent}
                      onToggleExpand={() => toggleExpand(c)}
                      onToggleInvoice={toggleInvoice}
                      onEdit={() => openEdit(c)}
                      money={money}
                      fmtDate={fmtDate}
                      isAr={isAr}
                      t={t}
                      iconBtn={iconBtn}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!loading && filtered.length > 0 && pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40"
            >
              {isAr ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
              {t("products.pagination.prev")}
            </button>
            <span className="text-sm text-muted">
              {t("products.pagination.pageOf", { page, pages: pageCount })}
            </span>
            <button
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40"
            >
              {t("products.pagination.next")}
              {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !saving && setEditing(null)}
        >
          <div className="ctrl-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-text">{t("customers.editTitle")}</h3>
            {editing.phone && (
              <p className="mt-1 text-sm text-muted" dir="ltr">
                {editing.phone}
              </p>
            )}
            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-muted">
              {t("customers.table.name")}
            </label>
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
              className="ctrl-input mt-1.5 py-2.5"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="ctrl-btn border border-border px-4 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50"
              >
                {t("customers.cancel")}
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95 disabled:opacity-50"
              >
                {t("customers.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  c,
  cols,
  isOpen,
  sales,
  openInvoices,
  showPhone,
  showOrders,
  showSpent,
  onToggleExpand,
  onToggleInvoice,
  onEdit,
  money,
  fmtDate,
  isAr,
  t,
  iconBtn,
}) {
  return (
    <>
      <tr
        className={`border-b border-border/60 transition hover:bg-elevated/40 ${isOpen ? "bg-elevated/30" : ""}`}
      >
        <td className="px-2 py-3 text-center">
          <button
            type="button"
            onClick={onToggleExpand}
            title={t("customers.viewOrders")}
            className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-text"
          >
            <IconChevronDown
              width={16}
              height={16}
              className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </button>
        </td>
        <td className="cursor-pointer px-4 py-3 font-medium text-text" onClick={onToggleExpand}>
          {c.name}
        </td>
        <td className="px-4 py-3 text-muted">
          {!showPhone ? (
            MASK
          ) : c.phone ? (
            <span className="inline-flex items-center gap-1.5" dir="ltr">
              <IconPhone width={14} height={14} className="text-muted" /> {c.phone}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3 text-center">
          {showOrders ? (
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
              {c.orders}
            </span>
          ) : (
            MASK
          )}
        </td>
        <td className="px-4 py-3 text-end font-medium text-text tabular-nums">
          {showSpent ? money(c.spent) : MASK}
        </td>
        <td className="px-4 py-3 text-muted">{c.last_order_at ? fmtDate(c.last_order_at) : "—"}</td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button title={t("customers.editName")} className={iconBtn} onClick={onEdit}>
              <IconEdit width={15} height={15} />
            </button>
          </div>
        </td>
      </tr>

      {isOpen && (
        <tr className="bg-bg/40">
          <td colSpan={cols} className="px-4 pb-4 pt-1">
            {!sales || sales.loading ? (
              <div className="space-y-2 py-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-elevated/70" />
                ))}
              </div>
            ) : sales.data.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{t("customers.noOrders")}</p>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pe-1">
                {sales.data.map((sale) => (
                  <InvoiceCard
                    key={sale.id}
                    sale={sale}
                    open={openInvoices.has(sale.id)}
                    onToggle={() => onToggleInvoice(sale.id)}
                    money={money}
                    fmtDate={fmtDate}
                    isAr={isAr}
                    t={t}
                  />
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function InvoiceCard({ sale, open, onToggle, money, fmtDate, isAr, t }) {
  const payment = isAr ? sale.payment_method_ar : sale.payment_method_en;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-elevated/40"
      >
        <IconChevronDown
          width={16}
          height={16}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
        <span className="font-mono text-xs font-semibold text-accent">{sale.invoice_no}</span>
        <span className="text-xs text-muted">{fmtDate(sale.created_at)}</span>
        <span className="ms-auto flex items-center gap-3">
          {payment && <span className="hidden text-xs text-muted sm:inline">{payment}</span>}
          <span className="text-xs text-muted">{t("customers.itemsCount", { count: sale.item_count })}</span>
          <span className="font-semibold text-text">{money(sale.total)}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="overflow-x-auto">
            <table className="ctrl-table w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-start font-medium">{t("customers.invoice.item")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("customers.invoice.qty")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("customers.invoice.unit")}</th>
                  <th className="px-3 py-2 text-end font-medium">{t("customers.invoice.lineTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((it, idx) => (
                  <tr key={idx} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <p className="font-medium text-text">{it.name}</p>
                      {(it.attributes || []).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {it.attributes.map((a, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted"
                            >
                              {a.hex && (
                                <span
                                  className="h-2.5 w-2.5 rounded-full border border-border"
                                  style={{ backgroundColor: a.hex }}
                                />
                              )}
                              {isAr ? a.value_ar : a.value_en}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-muted">{it.quantity}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{money(it.list_price)}</td>
                    <td className="px-3 py-2 text-end font-medium tabular-nums text-text">
                      {money((it.list_price || 0) * (it.quantity || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 ms-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-muted">
              <span>{t("customers.invoice.subtotal")}</span>
              <span className="tabular-nums">{money(sale.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>{t("customers.invoice.discount")}</span>
              <span className="tabular-nums">{money(sale.discount)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold text-text">
              <span>{t("customers.invoice.total")}</span>
              <span className="tabular-nums">{money(sale.total)}</span>
            </div>
            {sale.paid_amount > 0 && (
              <div className="flex justify-between text-muted">
                <span>{t("customers.invoice.paid")}</span>
                <span className="tabular-nums">{money(sale.paid_amount)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
