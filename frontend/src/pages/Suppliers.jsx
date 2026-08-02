import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import {
  listSuppliers,
  getSupplierStats,
  deleteSupplier,
} from "@/lib/products";
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
} from "@/components/icons";

const PAGE_SIZE = 8;

const TONES = {
  emerald: {
    grad: "from-emerald-500/15 via-emerald-500/5",
    tile: "bg-emerald-500/20 text-emerald-300",
    glow: "bg-emerald-500/20",
  },
  amber: {
    grad: "from-amber-500/15 via-amber-500/5",
    tile: "bg-amber-500/20 text-amber-300",
    glow: "bg-amber-500/20",
  },
  sky: {
    grad: "from-sky-500/15 via-sky-500/5",
    tile: "bg-sky-500/20 text-sky-300",
    glow: "bg-sky-500/20",
  },
  violet: {
    grad: "from-violet-500/15 via-violet-500/5",
    tile: "bg-violet-500/20 text-violet-300",
    glow: "bg-violet-500/20",
  },
};

function StatCard({ Icon, label, value, sub, foot, tone = "emerald" }) {
  const c = TONES[tone] || TONES.emerald;
  return (
    <div className={`ctrl-card relative overflow-hidden bg-gradient-to-br ${c.grad} to-transparent p-5`}>
      {/* Decorative glow — top corner, away from the icon */}
      <span className={`pointer-events-none absolute -start-8 -top-10 h-24 w-24 rounded-full ${c.glow} blur-2xl`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
          <p className="mt-2 truncate text-2xl font-bold text-text">{value}</p>
          {sub && <p className="mt-1 truncate text-xs text-muted">{sub}</p>}
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.tile}`}>
          <Icon width={22} height={22} />
        </span>
      </div>
      {foot && <div className="relative mt-3 border-t border-border/60 pt-2">{foot}</div>}
    </div>
  );
}

function TrendBadge({ trend, phrase, format }) {
  if (!trend) return null;
  const up = trend.dir === "up";
  const down = trend.dir === "down";
  const color = up ? "text-emerald-400" : down ? "text-red-400" : "text-muted";
  const Arrow = up ? IconTrendUp : down ? IconTrendDown : null;
  const shown = format ? format(trend.month) : trend.month;
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

export default function Suppliers() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [modal, setModal] = useState({ open: false, mode: "add", supplier: null });
  const [viewing, setViewing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("suppliers.title")}</h1>
          <p className="text-sm text-muted">{t("suppliers.subtitle")}</p>
        </div>
        <button onClick={openAdd} className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95">
          <IconPlus width={16} height={16} /> {t("suppliers.add")}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard tone="emerald" Icon={IconTruck} label={t("suppliers.stats.total")}
          value={stats?.total ?? "—"}
          foot={<TrendBadge trend={stats?.totalTrend} phrase={t("suppliers.stats.newThisMonth")} />} />
        <StatCard tone="amber" Icon={IconWallet} label={t("suppliers.stats.spend")}
          value={stats ? money(stats.spend) : "—"}
          foot={<TrendBadge trend={stats?.spendTrend} phrase={t("suppliers.stats.paidThisMonth")} format={money} />} />
        <StatCard tone="sky" Icon={IconList} label={t("suppliers.stats.products")}
          value={stats?.products ?? "—"}
          foot={<TrendBadge trend={stats?.productsTrend} phrase={t("suppliers.stats.boughtThisMonth")} />} />
        <StatCard tone="violet" Icon={IconStar} label={t("suppliers.stats.top")}
          value={stats?.top ? stats.top.name : t("suppliers.stats.none")}
          sub={stats?.top ? money(stats.top.spend) : ""} />
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
                  <th className="px-4 py-3 text-center font-medium">{t("suppliers.table.products")}</th>
                  <th className="px-4 py-3 text-end font-medium">{t("suppliers.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 transition hover:bg-elevated/40">
                    <td className="px-4 py-3 font-medium text-text">{s.name}</td>
                    <td className="px-4 py-3 text-muted">
                      {s.phone ? (
                        <span className="inline-flex items-center gap-1.5" dir="ltr">
                          <IconPhone width={14} height={14} className="text-muted" /> {s.phone}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {s.email ? (
                        <span className="inline-flex items-center gap-1.5" dir="ltr">
                          <IconMail width={14} height={14} className="text-muted" /> {s.email}
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
                        {s.product_count}
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
