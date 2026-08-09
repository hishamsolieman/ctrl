import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { listInvoices, getInvoiceStats, exportInvoices } from "@/lib/invoices";
import { posBootstrap } from "@/lib/pos";
import InvoiceModal from "@/components/invoices/InvoiceModal";
import StatCard, { MASK } from "@/components/StatCard";
import {
  IconReceipt,
  IconWallet,
  IconList,
  IconDiscount,
  IconSearch,
  IconPlus,
  IconEdit,
  IconUser,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconDownload,
  IconRefresh,
} from "@/components/icons";

const PAGE_SIZE = 10;
const MODERATOR_LEVEL = 20;
const ADMIN_LEVEL = 30;
const SECRETS = ["revenue", "invoices", "items", "discount"];
const HIDDEN = Object.fromEntries(SECRETS.map((k) => [k, false]));

// First day of the current month, as a YYYY-MM-DD string for a date input.
function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
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

export default function Invoices() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const canAccess = !!user && user.role_level >= MODERATOR_LEVEL;
  // Only Admin / SuperAdmin may backtrack or edit invoices.
  const canModify = !!user && user.role_level >= ADMIN_LEVEL;

  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [stats, setStats] = useState(null);
  const [boot, setBoot] = useState(null);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [by, setBy] = useState("invoice");
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(() => new Set());

  const [shown, setShown] = useState(HIDDEN);
  const [showTotals, setShowTotals] = useState(false);
  const [showItems, setShowItems] = useState(false);

  const [modal, setModal] = useState({ open: false, mode: "create", invoice: null });

  const loadStats = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([getInvoiceStats(), posBootstrap()]);
      setStats(s);
      setBoot(b);
    } catch {
      /* non-fatal */
    }
  }, []);

  const filterParams = useMemo(
    () => ({
      search: q.trim() || undefined,
      by,
      date_from: dateFrom ? `${dateFrom}T00:00` : undefined,
      date_to: dateTo ? `${dateTo}T23:59` : undefined,
    }),
    [q, by, dateFrom, dateTo]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listInvoices({
        ...filterParams,
        page,
        page_size: PAGE_SIZE,
      });
      setData(res);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [filterParams, page, t, toast]);

  useEffect(() => {
    if (canAccess) loadStats();
  }, [canAccess, loadStats]);
  useEffect(() => {
    if (canAccess) load();
  }, [canAccess, load]);

  useEffect(() => setPage(1), [q, by, dateFrom, dateTo]);

  const money = useCallback(
    (n) =>
      `${Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${stats?.currency || ""}`.trim(),
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

  const allShown = SECRETS.every((k) => shown[k]);
  const toggle = (k) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () =>
    setShown(Object.fromEntries(SECRETS.map((k) => [k, !allShown])));
  const revealProps = (key) => ({
    secret: true,
    revealed: shown[key],
    onToggleSecret: () => toggle(key),
    revealLabel: t("invoices.reveal"),
    hideLabel: t("invoices.hideValue"),
  });

  function toggleRow(id) {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function resetDates() {
    setDateFrom("");
    setDateTo("");
  }

  async function onExport() {
    try {
      await exportInvoices(filterParams);
    } catch {
      toast.error(t("auth.genericError"));
    }
  }

  const afterSaved = () => {
    load();
    loadStats();
  };

  if (authLoading) return null;
  if (!canAccess) return <Navigate to="/dashboard" replace />;

  const pageCount = Math.max(1, data.pages || 1);
  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";
  const toolbarBtn = "ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated";
  const COLS = 7;
  const showLbl = t("invoices.show");
  const hideLbl = t("invoices.hide");

  const monthFoot = (value) => (
    <span>
      <span className="font-semibold text-text">{value}</span> · {t("invoices.stats.thisMonth")}
    </span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("invoices.title")}</h1>
          <p className="text-sm text-muted">{t("invoices.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onExport} className={toolbarBtn}>
            <IconDownload width={16} height={16} /> {t("invoices.export")}
          </button>
          <button type="button" onClick={toggleAll} className={toolbarBtn}>
            {allShown ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
            {allShown ? t("invoices.hideAll") : t("invoices.showAll")}
          </button>
          {canModify && (
            <button
              onClick={() => setModal({ open: true, mode: "create", invoice: null })}
              className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95"
            >
              <IconPlus width={16} height={16} /> {t("invoices.backtrack")}
            </button>
          )}
        </div>
      </div>

      {/* Stats — every value starts masked */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          tone="amber"
          Icon={IconWallet}
          label={t("invoices.stats.revenue")}
          value={stats ? money(stats.overall.revenue) : "—"}
          foot={stats && monthFoot(shown.revenue ? money(stats.month.revenue) : MASK)}
          {...revealProps("revenue")}
        />
        <StatCard
          tone="emerald"
          Icon={IconReceipt}
          label={t("invoices.stats.invoices")}
          value={stats != null ? num(stats.overall.invoices) : "—"}
          foot={stats && monthFoot(shown.invoices ? num(stats.month.invoices) : MASK)}
          {...revealProps("invoices")}
        />
        <StatCard
          tone="sky"
          Icon={IconList}
          label={t("invoices.stats.items")}
          value={stats != null ? num(stats.overall.items) : "—"}
          foot={stats && monthFoot(shown.items ? num(stats.month.items) : MASK)}
          {...revealProps("items")}
        />
        <StatCard
          tone="violet"
          Icon={IconDiscount}
          label={t("invoices.stats.discount")}
          value={stats ? money(stats.overall.discount) : "—"}
          foot={stats && monthFoot(shown.discount ? money(stats.month.discount) : MASK)}
          {...revealProps("discount")}
        />
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
            <IconSearch width={18} height={18} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={by === "item" ? t("invoices.searchItem") : t("invoices.searchInvoice")}
            className="ctrl-input py-2.5 ps-10"
          />
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => setBy("invoice")}
            className={`px-3 py-2 text-sm transition ${by === "invoice" ? "bg-accent text-black" : "text-muted hover:bg-elevated"}`}
          >
            {t("invoices.byInvoice")}
          </button>
          <button
            onClick={() => setBy("item")}
            className={`px-3 py-2 text-sm transition ${by === "item" ? "bg-accent text-black" : "text-muted hover:bg-elevated"}`}
          >
            {t("invoices.byItem")}
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="ctrl-input-sm"
            title={t("invoices.from")}
          />
          <span className="text-muted">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="ctrl-input-sm"
            title={t("invoices.to")}
          />
          <button
            type="button"
            onClick={resetDates}
            title={t("invoices.resetDates")}
            aria-label={t("invoices.resetDates")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted transition hover:border-accent hover:text-accent"
          >
            <IconRefresh width={16} height={16} />
          </button>
        </div>
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
          ) : data.items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-muted">
                <IconReceipt width={30} height={30} />
              </span>
              <div>
                <p className="text-lg font-semibold text-text">{t("invoices.empty")}</p>
                <p className="mt-1 text-sm text-muted">{t("invoices.emptyBody")}</p>
              </div>
            </div>
          ) : (
            <table className="ctrl-table w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="w-10 px-2 py-3" />
                  <th className="px-4 py-3 text-start font-medium">{t("invoices.table.invoice")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("invoices.table.date")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("invoices.table.customer")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("invoices.table.seller")}</th>
                  <th className="px-4 py-3 text-center font-medium">
                    <ColReveal
                      label={t("invoices.table.items")}
                      shown={showItems}
                      onToggle={() => setShowItems((v) => !v)}
                      showTitle={showLbl}
                      hideTitle={hideLbl}
                    />
                  </th>
                  <th className="px-4 py-3 text-end font-medium">
                    <ColReveal
                      label={t("invoices.table.total")}
                      shown={showTotals}
                      onToggle={() => setShowTotals((v) => !v)}
                      showTitle={showLbl}
                      hideTitle={hideLbl}
                    />
                  </th>
                  {canModify && (
                    <th className="px-4 py-3 text-end font-medium">{t("invoices.table.actions")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => {
                  const isOpen = expanded.has(s.id);
                  return (
                    <FragmentRow
                      key={s.id}
                      s={s}
                      isOpen={isOpen}
                      cols={canModify ? COLS + 1 : COLS}
                      canModify={canModify}
                      showTotals={showTotals}
                      showItems={showItems}
                      onToggle={() => toggleRow(s.id)}
                      onEdit={() => setModal({ open: true, mode: "edit", invoice: s })}
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

        {!loading && data.items.length > 0 && pageCount > 1 && (
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

      {canModify && (
        <InvoiceModal
          open={modal.open}
          mode={modal.mode}
          initial={modal.invoice}
          boot={boot}
          onClose={() => setModal((m) => ({ ...m, open: false }))}
          onSaved={afterSaved}
        />
      )}
    </div>
  );
}

function FragmentRow({
  s,
  isOpen,
  cols,
  canModify,
  showTotals,
  showItems,
  onToggle,
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
            onClick={onToggle}
            className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-text"
          >
            <IconChevronDown
              width={16}
              height={16}
              className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </button>
        </td>
        <td className="cursor-pointer px-4 py-3" onClick={onToggle}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-accent" dir="ltr">
              {s.invoice_no}
            </span>
            {s.is_backtrack && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                {t("invoices.backtrackTag")}
              </span>
            )}
          </span>
        </td>
        <td className="px-4 py-3 text-muted">{fmtDate(s.created_at)}</td>
        <td className="px-4 py-3 text-text">
          {s.customer_name || t("invoices.unknown")}
          {s.customer_phone && (
            <span className="ms-1 text-xs text-muted" dir="ltr">
              ({s.customer_phone})
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-muted">
          <span className="inline-flex items-center gap-1.5">
            <IconUser width={14} height={14} /> {s.seller || "—"}
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          {showItems ? (
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
              {s.item_count}
            </span>
          ) : (
            MASK
          )}
        </td>
        <td className="px-4 py-3 text-end font-medium text-text tabular-nums">
          {showTotals ? money(s.total) : MASK}
        </td>
        {canModify && (
          <td className="px-4 py-3">
            <div className="flex items-center justify-end gap-2">
              <button title={t("invoices.edit")} className={iconBtn} onClick={onEdit}>
                <IconEdit width={15} height={15} />
              </button>
            </div>
          </td>
        )}
      </tr>

      {isOpen && (
        <tr className="bg-bg/40">
          <td colSpan={cols} className="px-4 pb-4 pt-1">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="ctrl-table w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-start font-medium">{t("invoices.modal.item")}</th>
                    <th className="px-3 py-2 text-center font-medium">{t("invoices.modal.qty")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("invoices.modal.unit")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("invoices.modal.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((it, idx) => (
                    <tr key={idx} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <p className="text-text">{it.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-muted" dir="ltr">
                            {it.code}
                          </span>
                          {(it.attributes || []).map((a, i) => (
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
                      </td>
                      <td className="px-3 py-2 text-center text-muted">{it.quantity}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{money(it.unit_price)}</td>
                      <td className="px-3 py-2 text-end font-medium tabular-nums text-text">
                        {money(it.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 ms-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between text-muted">
                <span>{t("invoices.modal.subtotal")}</span>
                <span className="tabular-nums">{money(s.subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>{t("invoices.modal.discount")}</span>
                <span className="tabular-nums">{money(s.discount)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1 font-semibold text-text">
                <span>{t("invoices.modal.total")}</span>
                <span className="tabular-nums">{money(s.total)}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
