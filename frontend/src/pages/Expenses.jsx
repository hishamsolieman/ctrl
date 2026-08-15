import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import {
  expenseMeta,
  expenseStats,
  listExpenses,
  deleteExpense,
} from "@/lib/expenses";
import ExpenseModal from "@/components/expenses/ExpenseModal";
import Modal from "@/components/Modal";
import StatCard, { MASK } from "@/components/StatCard";
import {
  IconWallet,
  IconReceipt,
  IconCart,
  IconTrendUp,
  IconSearch,
  IconPlus,
  IconEye,
  IconEyeOff,
  IconEdit,
  IconTrash,
  IconUser,
} from "@/components/icons";

const ADMIN_LEVEL = 30;
const PAGE_SIZE = 10;
const ALL = "all";
const SECRETS = ["total", "month", "salesCount", "salesTotal"];
const HIDDEN = Object.fromEntries(SECRETS.map((k) => [k, false]));

export default function Expenses() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const { user } = useAuth();
  const toast = useToast();
  // Admin / SuperAdmin only — user filter & on-behalf list.
  const isAdmin = (user?.role_level ?? 0) >= ADMIN_LEVEL;

  const [meta, setMeta] = useState(null);
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [currency, setCurrency] = useState("");
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [userFilter, setUserFilter] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(HIDDEN);
  const [modal, setModal] = useState({ open: false, mode: "add", expense: null });
  const [confirmDel, setConfirmDel] = useState(null);

  const money = useCallback(
    (n) =>
      `${Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${currency}`.trim(),
    [isAr, currency]
  );

  const num = useCallback(
    (n) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US"),
    [isAr]
  );

  const loadStats = useCallback(async () => {
    try {
      const s = await expenseStats();
      setStats(s);
      setCurrency(s.currency);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listExpenses({
        q,
        user_id: isAdmin && userFilter !== ALL ? userFilter : undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setItems(data.items);
      setPages(data.pages);
      setTotal(data.total);
      setCurrency(data.currency);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [q, userFilter, page, isAdmin, t, toast]);

  useEffect(() => {
    expenseMeta().then(setMeta).catch(() => {});
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const onSearch = (v) => {
    setQ(v);
    setPage(1);
  };

  function refreshAll() {
    setShown(HIDDEN);
    loadList();
    loadStats();
  }

  const allShown = SECRETS.every((k) => shown[k]);
  const toggle = (k) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () =>
    setShown(Object.fromEntries(SECRETS.map((k) => [k, !allShown])));
  const revealProps = (key) => ({
    secret: true,
    revealed: shown[key],
    onToggleSecret: () => toggle(key),
    revealLabel: t("expenses.reveal"),
    hideLabel: t("expenses.hide"),
  });

  async function onDelete() {
    if (!confirmDel) return;
    try {
      await deleteExpense(confirmDel.id);
      toast.success(t("expenses.deleted"));
      setConfirmDel(null);
      refreshAll();
    } catch {
      toast.error(t("auth.genericError"));
    }
  }

  const typeLabel = useCallback(
    (e) => (e.type === "other" ? e.name || t("expenses.types.other") : t(`expenses.types.${e.type}`)),
    [t]
  );

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";
  const toolbarBtn = "ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated";
  const cols = isAdmin ? 6 : 5;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("expenses.title")}</h1>
          <p className="text-sm text-muted">
            {isAdmin ? t("expenses.subtitleAdmin") : t("expenses.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleAll} className={toolbarBtn}>
            {allShown ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
            {allShown ? t("expenses.hideAll") : t("expenses.showAll")}
          </button>
          <button
            onClick={() => setModal({ open: true, mode: "add", expense: null })}
            className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95"
          >
            <IconPlus width={16} height={16} /> {t("expenses.add")}
          </button>
        </div>
      </div>

      {/* Stats — same card style/height as invoices */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 [&>div]:min-h-[7.5rem]">
        <StatCard
          tone="amber"
          Icon={IconWallet}
          label={t("expenses.stats.total")}
          value={stats ? money(stats.total_expenses) : "—"}
          {...revealProps("total")}
        />
        <StatCard
          tone="violet"
          Icon={IconReceipt}
          label={t("expenses.stats.month")}
          value={stats ? money(stats.month_expenses) : "—"}
          {...revealProps("month")}
        />
        <StatCard
          tone="sky"
          Icon={IconCart}
          label={t("expenses.stats.salesCount")}
          value={stats != null ? num(stats.sales_count) : "—"}
          {...revealProps("salesCount")}
        />
        <StatCard
          tone="emerald"
          Icon={IconTrendUp}
          label={t("expenses.stats.salesTotal")}
          value={stats ? money(stats.sales_total) : "—"}
          {...revealProps("salesTotal")}
        />
      </div>

      {/* Toolbar — search + user filter share one row; filter is 25% when shown */}
      <div className="flex items-center gap-3">
        <div className={`relative min-w-0 ${isAdmin ? "w-3/4" : "w-full"}`}>
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
            <IconSearch width={18} height={18} />
          </span>
          <input
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t("expenses.searchPlaceholder")}
            className="ctrl-input w-full py-2.5 ps-10"
          />
        </div>
        {isAdmin && (
          <select
            className="ctrl-input ctrl-select w-1/4 min-w-0 shrink-0 py-2.5"
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value={ALL}>{t("expenses.allUsers")}</option>
            {(meta?.users || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="ctrl-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="ctrl-table w-full text-sm">
            <thead>
              <tr>
                {isAdmin && (
                  <th className="px-4 py-3 text-start font-medium">{t("expenses.table.user")}</th>
                )}
                <th className="px-4 py-3 text-start font-medium">{t("expenses.table.type")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("expenses.table.amount")}</th>
                <th className="px-4 py-3 text-center font-medium">{t("expenses.table.date")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("expenses.table.note")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("expenses.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={cols} className="px-4 py-2">
                      <div className="h-9 animate-pulse rounded bg-elevated/70" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="py-12 text-center text-sm text-muted">
                    {t("expenses.empty")}
                  </td>
                </tr>
              ) : (
                items.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 transition hover:bg-elevated/40">
                    {isAdmin && (
                      <td className="px-4 py-3" dir="ltr">
                        <span className="inline-flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-elevated text-muted">
                            <IconUser width={13} height={13} />
                          </span>
                          <span className="font-medium text-text">{e.username}</span>
                        </span>
                      </td>
                    )}
                    <td className="max-w-[220px] px-4 py-3">
                      <span className="block truncate font-medium text-text" title={typeLabel(e)}>
                        {typeLabel(e)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end font-semibold text-text tabular-nums">
                      {money(e.amount)}
                    </td>
                    <td className="px-4 py-3 text-center text-muted" dir="ltr">
                      {e.spent_at}
                    </td>
                    <td className="max-w-[240px] px-4 py-3 text-muted">
                      <span className="block truncate" title={e.note || ""}>
                        {e.note || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          title={t("expenses.view")}
                          className={iconBtn}
                          onClick={() => setModal({ open: true, mode: "view", expense: e })}
                        >
                          <IconEye width={15} height={15} />
                        </button>
                        {e.can_manage && (
                          <>
                            <button
                              title={t("expenses.edit")}
                              className={iconBtn}
                              onClick={() => setModal({ open: true, mode: "edit", expense: e })}
                            >
                              <IconEdit width={15} height={15} />
                            </button>
                            <button
                              title={t("expenses.delete")}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition hover:bg-red-500 hover:text-white"
                              onClick={() => setConfirmDel(e)}
                            >
                              <IconTrash width={15} height={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && items.length > 0 && pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted">{t("expenses.count", { count: total })}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="ctrl-btn border border-border px-3 py-1.5 text-text hover:bg-elevated disabled:opacity-40"
              >
                {t("expenses.prev")}
              </button>
              <span className="text-muted">
                {t("products.pagination.pageOf", { page, pages })}
              </span>
              <button
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="ctrl-btn border border-border px-3 py-1.5 text-text hover:bg-elevated disabled:opacity-40"
              >
                {t("expenses.next")}
              </button>
            </div>
          </div>
        )}
      </div>

      <ExpenseModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.expense}
        meta={meta}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onSaved={refreshAll}
      />

      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title={t("expenses.confirmDelete.title")}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmDel(null)}
              className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated"
            >
              {t("expenses.modal.cancel")}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="ctrl-btn bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600"
            >
              {t("expenses.delete")}
            </button>
          </>
        }
      >
        <p className="text-sm text-text">
          {t("expenses.confirmDelete.body", {
            type: confirmDel ? typeLabel(confirmDel) : "",
            amount: confirmDel ? money(confirmDel.amount) : "",
          })}
        </p>
      </Modal>
    </div>
  );
}
