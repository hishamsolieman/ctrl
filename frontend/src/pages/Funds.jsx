import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Chart from "react-apexcharts";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { fundsOverview, listFunds, deleteFund } from "@/lib/funds";
import FundModal from "@/components/funds/FundModal";
import Modal from "@/components/Modal";
import StatCard from "@/components/StatCard";
import ChartCard from "@/components/dashboard/ChartCard";
import { baseOptions, donutOptions, PALETTE } from "@/lib/charts";
import theme from "@/config/theme";
import {
  IconCoins,
  IconScale,
  IconTruck,
  IconWallet,
  IconTrendUp,
  IconTrendDown,
  IconRefresh,
  IconSearch,
  IconPlus,
  IconEye,
  IconEyeOff,
  IconEdit,
  IconTrash,
} from "@/components/icons";

const ADMIN_LEVEL = 30;
const PAGE_SIZE = 10;
const SECRETS = ["gross", "revenue", "cashflow", "suppliers", "estRevenue", "expenses"];
const HIDDEN = Object.fromEntries(SECRETS.map((k) => [k, false]));

const OUT_COLOR = "#FB7185";
const IN_COLOR = "#38BDF8";

export default function Funds() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const loc = isAr ? "ar-EG" : "en-US";
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const isAdmin = (user?.role_level ?? 0) >= ADMIN_LEVEL;

  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [shown, setShown] = useState(HIDDEN);
  const [modal, setModal] = useState({ open: false, mode: "add", fund: null });
  const [confirmDel, setConfirmDel] = useState(null);

  const loadOverview = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      setData(await fundsOverview());
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, t, toast]);

  const loadList = useCallback(async () => {
    if (!isAdmin) return;
    setListLoading(true);
    try {
      const res = await listFunds({ q, page, page_size: PAGE_SIZE });
      setItems(res.items);
      setPages(res.pages);
      setTotal(res.total);
    } catch {
      /* non-fatal — the overview already reports failures */
    } finally {
      setListLoading(false);
    }
  }, [isAdmin, q, page]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const currency = data?.currency || "";
  const money = useCallback(
    (n) =>
      `${Number(n || 0).toLocaleString(loc, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${currency}`.trim(),
    [loc, currency]
  );
  const compact = useCallback(
    (n) => Number(n || 0).toLocaleString(loc, { notation: "compact", maximumFractionDigits: 1 }),
    [loc]
  );
  const num = useCallback((n) => Number(n || 0).toLocaleString(loc), [loc]);

  const allShown = SECRETS.every((k) => shown[k]);
  const toggle = (k) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () => setShown(Object.fromEntries(SECRETS.map((k) => [k, !allShown])));

  const totals = data?.totals;

  const monthLabels = useMemo(
    () =>
      (data?.months || []).map((m) => {
        const [y, mo] = m.month.split("-").map(Number);
        return new Date(y, mo - 1, 1).toLocaleDateString(loc, { month: "short", year: "2-digit" });
      }),
    [data, loc]
  );

  function refreshAll() {
    loadOverview();
    loadList();
  }

  async function onDelete() {
    if (!confirmDel) return;
    try {
      await deleteFund(confirmDel.id);
      toast.success(t("funds.deleted"));
      setConfirmDel(null);
      refreshAll();
    } catch {
      toast.error(t("auth.genericError"));
    }
  }

  // --- charts -------------------------------------------------------------
  const cashflowChart = useMemo(() => {
    if (!data?.months?.length) return null;
    const base = baseOptions();
    // Operating flow only, matching the estimated-cashflow card: stock purchases
    // and manual funds land in the gross value, not here.
    const inflow = data.months.map((m) => Math.round(m.sales * 100) / 100);
    const outflow = data.months.map((m) => Math.round(m.expenses * 100) / 100);
    const net = inflow.map((v, i) => Math.round((v - outflow[i]) * 100) / 100);
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "line", height: 320, stacked: false },
        colors: [IN_COLOR, OUT_COLOR, theme.accent],
        stroke: { width: [0, 0, 3], curve: "smooth" },
        plotOptions: {
          bar: { columnWidth: "60%", borderRadius: 3, borderRadiusApplication: "end" },
        },
        markers: { size: 0, hover: { size: 5 } },
        xaxis: { ...base.xaxis, categories: monthLabels },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        legend: { ...base.legend, show: true, position: "top", horizontalAlign: "right" },
        tooltip: { theme: "dark", shared: true, intersect: false, y: { formatter: (v) => money(v) } },
      },
      series: [
        { name: t("funds.charts.inflow"), type: "column", data: inflow },
        { name: t("funds.charts.outflow"), type: "column", data: outflow },
        { name: t("funds.charts.net"), type: "line", data: net },
      ],
    };
  }, [data, monthLabels, compact, money, t]);

  const compositionChart = useMemo(() => {
    if (!totals) return null;
    const series = [totals.supplier_paid, Math.max(totals.manual_funds, 0)];
    if (series.every((v) => !v)) return null;
    return {
      options: {
        ...donutOptions({
          labels: [t("funds.charts.productCost"), t("funds.charts.manualFunds")],
          totalLabel: t("funds.charts.gross"),
          totalValue: compact(totals.gross_value),
        }),
        chart: { ...baseOptions().chart, type: "donut", height: 300 },
        colors: [theme.accent, "#A78BFA"],
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series,
    };
  }, [totals, compact, money, t]);

  const cumulativeChart = useMemo(() => {
    if (!data?.months?.length) return null;
    const base = baseOptions();
    let gross = (data.baseline?.supplier || 0) + (data.baseline?.funds || 0);
    let profit = data.baseline?.profit || 0;
    let exp = data.baseline?.expenses || 0;
    const grossLine = [];
    const revLine = [];
    data.months.forEach((m) => {
      gross += m.supplier + m.funds;
      profit += m.profit;
      exp += m.expenses;
      grossLine.push(Math.round(gross * 100) / 100);
      revLine.push(Math.round((profit - exp) * 100) / 100);
    });
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "area", height: 300 },
        colors: [theme.accent, "#34D399"],
        stroke: { width: 2, curve: "smooth" },
        fill: {
          type: "gradient",
          gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 95] },
        },
        markers: { size: 0, hover: { size: 4 } },
        xaxis: { ...base.xaxis, categories: monthLabels },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        legend: { ...base.legend, show: true, position: "top", horizontalAlign: "right" },
        tooltip: { theme: "dark", shared: true, y: { formatter: (v) => money(v) } },
      },
      series: [
        { name: t("funds.charts.gross"), data: grossLine },
        { name: t("funds.charts.revenue"), data: revLine },
      ],
    };
  }, [data, monthLabels, compact, money, t]);

  const supplierChart = useMemo(() => {
    if (!data?.top_suppliers?.length) return null;
    const base = baseOptions();
    const rows = data.top_suppliers;
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "bar", height: 300 },
        colors: PALETTE,
        plotOptions: {
          bar: {
            horizontal: true,
            distributed: true,
            barHeight: "62%",
            borderRadius: 4,
            borderRadiusApplication: "end",
          },
        },
        legend: { show: false },
        xaxis: {
          ...base.xaxis,
          categories: rows.map((r) => r.name),
          labels: { formatter: (v) => compact(v) },
        },
        yaxis: { labels: { maxWidth: 170 } },
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series: [{ name: t("funds.charts.productCost"), data: rows.map((r) => r.amount) }],
    };
  }, [data, compact, money, t]);

  const expenseChart = useMemo(() => {
    if (!data?.expense_types?.length) return null;
    const labels = data.expense_types.map((e) =>
      e.type === "other" ? e.name || t("expenses.types.other") : t(`expenses.types.${e.type}`)
    );
    const series = data.expense_types.map((e) => e.amount);
    return {
      options: {
        ...donutOptions({
          labels,
          totalLabel: t("funds.charts.total"),
          totalValue: compact(series.reduce((s, v) => s + v, 0)),
        }),
        chart: { ...baseOptions().chart, type: "donut", height: 300 },
        colors: [OUT_COLOR, "#FBBF24", "#A78BFA", IN_COLOR, theme.accent, "#34D399"],
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series,
    };
  }, [data, compact, money, t]);

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-14 animate-pulse rounded-xl bg-elevated/60" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[130px] animate-pulse rounded-2xl bg-elevated/60" />
          ))}
        </div>
        <div className="h-[360px] animate-pulse rounded-2xl bg-elevated/60" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[340px] animate-pulse rounded-2xl bg-elevated/60" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text">{t("funds.title")}</h1>
          <p className="text-sm text-muted">{t("funds.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleAll}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated">
            {allShown ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
            {allShown ? t("funds.hideAll") : t("funds.showAll")}
          </button>
          <button type="button" onClick={loadOverview} disabled={loading}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50">
            <IconRefresh width={16} height={16} className={loading ? "animate-spin" : ""} />
            {t("funds.refresh")}
          </button>
          {isAdmin && (
            <button type="button" onClick={() => setModal({ open: true, mode: "add", fund: null })}
              className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95">
              <IconPlus width={16} height={16} /> {t("funds.add")}
            </button>
          )}
        </div>
      </div>

      {/* KPI cards — every value starts masked */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard tone="accent" Icon={IconScale} label={t("funds.cards.gross")}
          value={money(totals?.gross_value)}
          foot={t("funds.cards.grossFoot", {
            supplier: money(totals?.supplier_paid),
            funds: money(totals?.manual_funds),
          })}
          secret revealed={shown.gross} onToggleSecret={() => toggle("gross")}
          revealLabel={t("funds.reveal")} hideLabel={t("funds.hide")} />
        <StatCard tone="emerald" Icon={IconTrendUp} label={t("funds.cards.revenue")}
          value={money(totals?.revenue)}
          foot={t("funds.cards.revenueFoot", { value: money(totals?.revenue_month) })}
          secret revealed={shown.revenue} onToggleSecret={() => toggle("revenue")}
          revealLabel={t("funds.reveal")} hideLabel={t("funds.hide")} />
        <StatCard tone="amber" Icon={IconWallet}
          label={t("funds.cards.cashflow")} value={money(totals?.cashflow)}
          foot={t("funds.cards.cashflowFoot", {
            days: num(totals?.rate_days),
            inflow: money(totals?.cash_in),
            outflow: money(totals?.cash_out),
          })}
          secret revealed={shown.cashflow} onToggleSecret={() => toggle("cashflow")}
          revealLabel={t("funds.reveal")} hideLabel={t("funds.hide")} />
        <StatCard tone="sky" Icon={IconTruck} label={t("funds.cards.suppliers")}
          value={money(totals?.supplier_paid)} foot={t("funds.cards.suppliersFoot")}
          secret revealed={shown.suppliers} onToggleSecret={() => toggle("suppliers")}
          revealLabel={t("funds.reveal")} hideLabel={t("funds.hide")} />
        <StatCard tone="violet" Icon={IconCoins} label={t("funds.cards.estRevenue")}
          value={money(totals?.est_revenue_year)}
          foot={t("funds.cards.estRevenueFoot", { value: money(totals?.est_revenue_month) })}
          secret revealed={shown.estRevenue} onToggleSecret={() => toggle("estRevenue")}
          revealLabel={t("funds.reveal")} hideLabel={t("funds.hide")} />
        <StatCard tone="rose" Icon={IconTrendDown} label={t("funds.cards.expenses")}
          value={money(totals?.expenses)} foot={t("funds.cards.expensesFoot")}
          secret revealed={shown.expenses} onToggleSecret={() => toggle("expenses")}
          revealLabel={t("funds.reveal")} hideLabel={t("funds.hide")} />
      </div>

      {/* Monthly cashflow */}
      <ChartCard title={t("funds.charts.cashflowTitle")} hint={t("funds.charts.cashflowHint")}
        empty={!cashflowChart} emptyText={t("funds.charts.noData")} height={320}>
        {cashflowChart && (
          <Chart options={cashflowChart.options} series={cashflowChart.series} type="line" height={320} />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("funds.charts.compositionTitle")} hint={t("funds.charts.compositionHint")}
          empty={!compositionChart} emptyText={t("funds.charts.noData")} height={300}>
          {compositionChart && (
            <Chart options={compositionChart.options} series={compositionChart.series} type="donut" height={300} />
          )}
        </ChartCard>

        <ChartCard title={t("funds.charts.cumulativeTitle")} hint={t("funds.charts.cumulativeHint")}
          empty={!cumulativeChart} emptyText={t("funds.charts.noData")} height={300}>
          {cumulativeChart && (
            <Chart options={cumulativeChart.options} series={cumulativeChart.series} type="area" height={300} />
          )}
        </ChartCard>

        <ChartCard title={t("funds.charts.supplierTitle")} hint={t("funds.charts.supplierHint")}
          empty={!supplierChart} emptyText={t("funds.charts.noSuppliers")} height={300}>
          {supplierChart && (
            <Chart options={supplierChart.options} series={supplierChart.series} type="bar" height={300} />
          )}
        </ChartCard>

        <ChartCard title={t("funds.charts.expenseTitle")} hint={t("funds.charts.expenseHint")}
          empty={!expenseChart} emptyText={t("funds.charts.noExpenses")} height={300}>
          {expenseChart && (
            <Chart options={expenseChart.options} series={expenseChart.series} type="donut" height={300} />
          )}
        </ChartCard>

      </div>

      {/* Manual fund entries */}
      <div className="ctrl-card flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text">{t("funds.table.title")}</h2>
            <p className="text-xs text-muted">{t("funds.table.hint")}</p>
          </div>
          <div className="relative min-w-[220px]">
            <IconSearch width={16} height={16}
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted"
              style={{ [isAr ? "right" : "left"]: 12 }} />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder={t("funds.searchPlaceholder")}
              className="ctrl-input w-full py-2 ps-10 text-sm" />
          </div>
        </div>

        <div className="overflow-auto">
          <table className="ctrl-table w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3 text-center font-medium">{t("funds.table.date")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("funds.table.amount")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("funds.table.note")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("funds.table.addedBy")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("funds.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-4 py-2">
                    <div className="h-9 animate-pulse rounded bg-elevated/70" />
                  </td></tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-sm text-muted">
                  {t("funds.empty")}
                </td></tr>
              ) : (
                items.map((f) => {
                  const negative = Number(f.amount) < 0;
                  return (
                    <tr key={f.id} className="border-b border-border/60 transition hover:bg-elevated/40">
                      <td className="px-4 py-3 text-center text-muted" dir="ltr">{f.occurred_at}</td>
                      <td className={`px-4 py-3 text-end font-semibold tabular-nums ${negative ? "text-red-400" : "text-accent"}`}>
                        {negative ? "−" : "+"}{money(Math.abs(f.amount))}
                      </td>
                      <td className="max-w-[320px] px-4 py-3 text-muted">
                        <span className="block truncate" title={f.note || ""}>{f.note || "—"}</span>
                      </td>
                      <td className="max-w-[160px] px-4 py-3 text-muted" dir="ltr">
                        <span className="block truncate" title={f.created_by || ""}>{f.created_by || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button title={t("funds.view")} className={iconBtn}
                            onClick={() => setModal({ open: true, mode: "view", fund: f })}>
                            <IconEye width={15} height={15} />
                          </button>
                          {isAdmin && (
                            <>
                              <button title={t("funds.edit")} className={iconBtn}
                                onClick={() => setModal({ open: true, mode: "edit", fund: f })}>
                                <IconEdit width={15} height={15} />
                              </button>
                              <button title={t("funds.delete")}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition hover:bg-red-500 hover:text-white"
                                onClick={() => setConfirmDel(f)}>
                                <IconTrash width={15} height={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted">{t("funds.count", { count: total })}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="ctrl-btn border border-border px-3 py-1.5 text-text hover:bg-elevated disabled:opacity-40">
                {t("funds.prev")}
              </button>
              <span className="text-muted">{page} / {pages}</span>
              <button disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="ctrl-btn border border-border px-3 py-1.5 text-text hover:bg-elevated disabled:opacity-40">
                {t("funds.next")}
              </button>
            </div>
          </div>
        )}
      </div>

      <FundModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.fund}
        currency={currency}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onSaved={refreshAll}
      />

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)}
        title={t("funds.confirmDelete.title")} size="sm"
        footer={
          <>
            <button type="button" onClick={() => setConfirmDel(null)}
              className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated">
              {t("funds.modal.cancel")}
            </button>
            <button type="button" onClick={onDelete}
              className="ctrl-btn bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600">
              {t("funds.delete")}
            </button>
          </>
        }>
        <p className="text-sm text-text">
          {t("funds.confirmDelete.body", {
            amount: confirmDel ? money(confirmDel.amount) : "",
            date: confirmDel?.occurred_at || "",
          })}
        </p>
      </Modal>
    </div>
  );
}
