import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import {
  listSuppliers,
  getSupplierStats,
  deleteSupplier,
  exportSuppliers,
  importSuppliers,
} from "@/lib/products";
import StatCard, { MASK } from "@/components/StatCard";
import SupplierModal from "@/components/suppliers/SupplierModal";
import SupplierViewModal from "@/components/suppliers/SupplierViewModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  IconTruck,
  IconWallet,
  IconList,
  IconStar,
  IconSearch,
  IconPlus,
  IconEye,
  IconEyeOff,
  IconEdit,
  IconCopy,
  IconTrash,
  IconPhone,
  IconMail,
  IconMapPin,
  IconTrendUp,
  IconTrendDown,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconUpload,
} from "@/components/icons";

const PAGE_SIZE = 10;
const SECRETS = ["total", "spend", "products", "top"];
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

// Truncated cell text — native tooltip only when the full string is present.
function CellText({ children, className = "" }) {
  const text = children == null || children === "" ? "" : String(children);
  if (!text) return "—";
  return (
    <span className={`block truncate ${className}`} title={text}>
      {text}
    </span>
  );
}

export default function Suppliers() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState(HIDDEN);
  const [showProducts, setShowProducts] = useState(false);

  const [modal, setModal] = useState({ open: false, mode: "add", supplier: null });
  const [viewing, setViewing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const importRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setShown(HIDDEN);
    setShowProducts(false);
    try {
      const [rows, s] = await Promise.all([listSuppliers(), getSupplierStats()]);
      setItems(rows);
      setStats(s);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) =>
      [x.name, x.phone, x.email, x.address].some((v) => (v || "").toLowerCase().includes(s))
    );
  }, [items, q]);

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

  const allShown = SECRETS.every((k) => shown[k]);
  const toggle = (k) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () =>
    setShown(Object.fromEntries(SECRETS.map((k) => [k, !allShown])));

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

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteSupplier(toDelete.id);
      toast.success(t("suppliers.confirmDelete.deleted"));
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(
        err?.response?.data?.detail ||
          t("suppliers.confirmDelete.blocked", { name: toDelete.name, count: toDelete.product_count })
      );
    } finally {
      setDeleting(false);
    }
  }

  const openAdd = () => setModal({ open: true, mode: "add", supplier: null });
  const openEdit = (s) => setModal({ open: true, mode: "edit", supplier: s });
  const openCopy = (s) => setModal({ open: true, mode: "copy", supplier: s });

  async function onExport() {
    try {
      await exportSuppliers(q.trim() || undefined);
    } catch {
      toast.error(t("auth.genericError"));
    }
  }

  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const res = await importSuppliers(file);
      if (res.updated > 0) {
        toast.success(
          t("suppliers.importDoneUpdated", {
            created: res.created,
            updated: res.updated,
          })
        );
      } else {
        toast.success(t("suppliers.importDone", { count: res.created }));
      }
      load();
    } catch {
      toast.error(t("auth.genericError"));
    }
  }

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";
  const toolbarBtn = "ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated";
  const revealProps = (key) => ({
    secret: true,
    revealed: shown[key],
    onToggleSecret: () => toggle(key),
    revealLabel: t("suppliers.reveal"),
    hideLabel: t("suppliers.hide"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("suppliers.title")}</h1>
          <p className="text-sm text-muted">{t("suppliers.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onExport} className={toolbarBtn}>
            <IconDownload width={16} height={16} /> {t("suppliers.export")}
          </button>
          <button type="button" onClick={() => importRef.current?.click()} className={toolbarBtn}>
            <IconUpload width={16} height={16} /> {t("suppliers.import")}
          </button>
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImport} />
          <button
            type="button"
            onClick={toggleAll}
            className={toolbarBtn}
          >
            {allShown ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
            {allShown ? t("suppliers.hideAll") : t("suppliers.showAll")}
          </button>
          <button onClick={openAdd} className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95">
            <IconPlus width={16} height={16} /> {t("suppliers.add")}
          </button>
        </div>
      </div>

      {/* Stats cards — every value starts masked */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          tone="emerald"
          Icon={IconTruck}
          label={t("suppliers.stats.total")}
          value={stats != null ? num(stats.total) : "—"}
          foot={
            <TrendBadge
              trend={stats?.totalTrend}
              phrase={t("suppliers.stats.newThisMonth")}
              revealed={shown.total}
            />
          }
          {...revealProps("total")}
        />
        <StatCard
          tone="amber"
          Icon={IconWallet}
          label={t("suppliers.stats.spend")}
          value={stats ? money(stats.spend) : "—"}
          foot={
            <TrendBadge
              trend={stats?.spendTrend}
              phrase={t("suppliers.stats.paidThisMonth")}
              format={money}
              revealed={shown.spend}
            />
          }
          {...revealProps("spend")}
        />
        <StatCard
          tone="sky"
          Icon={IconList}
          label={t("suppliers.stats.products")}
          value={stats != null ? num(stats.products) : "—"}
          foot={
            <TrendBadge
              trend={stats?.productsTrend}
              phrase={t("suppliers.stats.boughtThisMonth")}
              format={num}
              revealed={shown.products}
            />
          }
          {...revealProps("products")}
        />
        <StatCard
          tone="violet"
          Icon={IconStar}
          label={t("suppliers.stats.top")}
          value={stats?.top ? stats.top.name : t("suppliers.stats.none")}
          foot={
            stats?.top ? (
              <span className="font-semibold text-text">
                {shown.top ? money(stats.top.spend) : MASK}
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
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t("suppliers.search")} className="ctrl-input py-2.5 ps-10" />
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
                <IconTruck width={30} height={30} />
              </span>
              <div>
                <p className="text-lg font-semibold text-text">{t("suppliers.empty")}</p>
                <p className="mt-1 text-sm text-muted">{t("suppliers.emptyBody")}</p>
              </div>
              <button onClick={openAdd} className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95">
                <IconPlus width={16} height={16} /> {t("suppliers.add")}
              </button>
            </div>
          ) : (
            <table className="ctrl-table w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-medium">{t("suppliers.table.name")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("suppliers.table.phone")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("suppliers.table.email")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("suppliers.table.address")}</th>
                  <th className="px-4 py-3 text-center font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {t("suppliers.table.products")}
                      <button
                        type="button"
                        onClick={() => setShowProducts((v) => !v)}
                        title={showProducts ? t("suppliers.hide") : t("suppliers.show")}
                        className="text-muted transition hover:text-text"
                      >
                        {showProducts
                          ? <IconEyeOff width={15} height={15} />
                          : <IconEye width={15} height={15} />}
                      </button>
                    </span>
                  </th>
                  <th className="px-4 py-3 text-end font-medium">{t("suppliers.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 transition hover:bg-elevated/40">
                    <td className="max-w-[12rem] px-4 py-3 font-medium text-text">
                      <CellText>{s.name}</CellText>
                    </td>
                    <td className="max-w-[10rem] px-4 py-3 text-muted">
                      {s.phone ? (
                        <span className="inline-flex max-w-full items-center gap-1.5" dir="ltr" title={s.phone}>
                          <IconPhone width={14} height={14} className="shrink-0 text-muted" />
                          <span className="truncate">{s.phone}</span>
                        </span>
                      ) : "—"}
                    </td>
                    <td className="max-w-[12rem] px-4 py-3 text-muted">
                      {s.email ? (
                        <span className="inline-flex max-w-full items-center gap-1.5" dir="ltr" title={s.email}>
                          <IconMail width={14} height={14} className="shrink-0 text-muted" />
                          <span className="truncate">{s.email}</span>
                        </span>
                      ) : "—"}
                    </td>
                    <td className="max-w-[16rem] px-4 py-3 text-muted">
                      {s.address ? (
                        <span className="inline-flex max-w-full items-center gap-1.5" title={s.address}>
                          <IconMapPin width={14} height={14} className="shrink-0 text-muted" />
                          <span className="truncate">{s.address}</span>
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
                        {showProducts ? num(s.product_count) : MASK}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button title={t("suppliers.view")} className={iconBtn} onClick={() => setViewing(s)}>
                          <IconEye width={15} height={15} />
                        </button>
                        <button title={t("suppliers.edit")} className={iconBtn} onClick={() => openEdit(s)}>
                          <IconEdit width={15} height={15} />
                        </button>
                        <button title={t("suppliers.copy")} className={iconBtn} onClick={() => openCopy(s)}>
                          <IconCopy width={15} height={15} />
                        </button>
                        <button title={t("suppliers.delete")}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition hover:bg-red-500 hover:text-white"
                          onClick={() => setToDelete(s)}>
                          <IconTrash width={15} height={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!loading && filtered.length > 0 && pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40">
              {isAr ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
              {t("products.pagination.prev")}
            </button>
            <span className="text-sm text-muted">{t("products.pagination.pageOf", { page, pages: pageCount })}</span>
            <button disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40">
              {t("products.pagination.next")}
              {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      <SupplierModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.supplier}
        currency={stats?.currency}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onSaved={load}
      />
      <SupplierViewModal
        open={!!viewing}
        supplier={viewing}
        currency={stats?.currency}
        onClose={() => setViewing(null)}
      />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title={t("suppliers.confirmDelete.title")}
        body={t("suppliers.confirmDelete.body", { name: toDelete?.name || "" })}
        confirmLabel={t("suppliers.confirmDelete.confirm")}
        cancelLabel={t("suppliers.confirmDelete.cancel")}
      />
    </div>
  );
}
