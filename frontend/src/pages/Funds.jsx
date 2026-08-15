import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Chart from "react-apexcharts";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { fundsOverview, downloadFundsDocs, listFunds, deleteFund } from "@/lib/funds";
import FundModal from "@/components/funds/FundModal";
import Modal from "@/components/Modal";
import StatCard from "@/components/StatCard";
import ChartCard from "@/components/dashboard/ChartCard";
import { baseOptions, donutOptions } from "@/lib/charts";
import theme from "@/config/theme";
import {
  IconCoins,
  IconScale,
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
  IconDownload,
  IconBriefcase,
  IconLayers,
  IconChart,
  IconBox,
} from "@/components/icons";

const ADMIN_LEVEL = 30;
const PAGE_SIZE = 10;

// Card order: Business capital first, then the reference-guide metrics.
const METRICS = ["B", "T", "COGS", "R", "E", "P", "M", "S", "F", "C"];
const HIDDEN = Object.fromEntries(METRICS.map((k) => [k, false]));
const PCT_KEYS = new Set(["M"]);

const TONES = {
  B: "accent",
  T: "emerald",
  COGS: "amber",
  R: "sky",
  E: "rose",
  P: "emerald",
  M: "violet",
  S: "sky",
  F: "accent",
  C: "violet",
};
const ICONS = {
  B: IconBriefcase,
  T: IconTrendUp,
  COGS: IconLayers,
  R: IconScale,
  E: IconTrendDown,
  P: IconCoins,
  M: IconChart,
  S: IconBox,
  F: IconWallet,
  C: IconScale,
};

const PERIODS = [
  "all_time",
  "yesterday",
  "last_week",
  "last_month",
  "last_quarter",
  "last_year",
  "custom",
];

const OUT_COLOR = "#FB7185";
const IN_COLOR = "#38BDF8";

function bucketLabel(key, loc) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(loc, { month: "short", day: "numeric" });
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(loc, { month: "short", year: "2-digit" });
  }
  return key;
}

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
  const [docsLoading, setDocsLoading] = useState(false);
  const [shown, setShown] = useState(HIDDEN);
  const [period, setPeriod] = useState("all_time");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [modal, setModal] = useState({ open: false, mode: "add", fund: null });
  const [confirmDel, setConfirmDel] = useState(null);

  const loadOverview = useCallback(async () => {
    if (!isAdmin) return;
    if (period === "custom" && (!dateFrom || !dateTo)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(
        await fundsOverview({
          period,
          date_from: period === "custom" ? dateFrom : undefined,
          date_to: period === "custom" ? dateTo : undefined,
        })
      );
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, period, dateFrom, dateTo, t, toast]);

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
  const pct = useCallback(
    (n) =>
      `${Number(n || 0).toLocaleString(loc, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}%`,
    [loc]
  );

  const displayValue = useCallback(
    (key, source) => {
      if (!source) return PCT_KEYS.has(key) ? pct(0) : money(0);
      return PCT_KEYS.has(key) ? pct(source[key]) : money(source[key]);
    },
    [money, pct]
  );

  const allShown = METRICS.every((k) => shown[k]);
  const toggle = (k) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () => setShown(Object.fromEntries(METRICS.map((k) => [k, !allShown])));

  const metrics = data?.metrics;
  const estimates = data?.estimates;

  function refreshAll() {
    loadOverview();
    loadList();
  }

  async function onDownloadDocs() {
    setDocsLoading(true);
    try {
      await downloadFundsDocs(isAr ? "ar" : "en");
      toast.success(t("funds.docs.downloaded"));
    } catch {
      toast.error(t("funds.docs.failed"));
    } finally {
      setDocsLoading(false);
    }
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
  const cashLabels = useMemo(
    () => (data?.cashflow || []).map((r) => bucketLabel(r.key, loc)),
    [data, loc]
  );

  const cashflowChart = useMemo(() => {
    if (!data?.cashflow?.length) return null;
    const base = baseOptions();
    const inflow = data.cashflow.map((m) => Math.round(m.sales * 100) / 100);
    const outflow = data.cashflow.map((m) => Math.round(m.expenses * 100) / 100);
    const net = data.cashflow.map((m) => Math.round(m.net * 100) / 100);
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
        xaxis: { ...base.xaxis, categories: cashLabels },
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
  }, [data, cashLabels, compact, money, t]);

  const profitPathChart = useMemo(() => {
    if (!data?.profit_path?.length) return null;
    const rows = data.profit_path;
    const base = baseOptions();
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "bar", height: 300 },
        colors: [theme.accent, OUT_COLOR, "#34D399", "#FBBF24", "#A78BFA"],
        plotOptions: {
          bar: {
            distributed: true,
            columnWidth: "55%",
            borderRadius: 4,
            borderRadiusApplication: "end",
          },
        },
        dataLabels: { enabled: false },
        legend: { show: false },
        xaxis: { ...base.xaxis, categories: rows.map((r) => t(`funds.metrics.${r.key}`)) },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series: [{ name: t("funds.charts.amount"), data: rows.map((r) => r.value) }],
    };
  }, [data, compact, money, t]);

  const marginChart = useMemo(() => {
    if (!data?.margin_trend?.length) return null;
    const base = baseOptions();
    const labels = data.margin_trend.map((r) => bucketLabel(r.key, loc));
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "area", height: 300 },
        colors: [theme.accent],
        stroke: { width: 2, curve: "smooth" },
        fill: {
          type: "gradient",
          gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 95] },
        },
        markers: { size: 0, hover: { size: 4 } },
        xaxis: { ...base.xaxis, categories: labels },
        yaxis: { labels: { formatter: (v) => `${Number(v).toFixed(0)}%` } },
        legend: { show: false },
        tooltip: { theme: "dark", y: { formatter: (v) => `${Number(v).toFixed(1)}%` } },
      },
      series: [{ name: t("funds.charts.margin"), data: data.margin_trend.map((r) => r.margin) }],
    };
  }, [data, loc, t]);

  const capitalChart = useMemo(() => {
    if (!data?.capital?.length) return null;
    const series = data.capital.map((c) => c.value);
    if (series.every((v) => !v)) return null;
    return {
      options: {
        ...donutOptions({
          labels: data.capital.map((c) => t(`funds.metrics.${c.key}`)),
          totalLabel: t("funds.metrics.B"),
          totalValue: compact(series.reduce((s, v) => s + v, 0)),
        }),
        chart: { ...baseOptions().chart, type: "donut", height: 300 },
        colors: [theme.accent, IN_COLOR, "#A78BFA"],
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series,
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
  const toolbarBtn = "ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50";

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  // Full skeleton — also shown on Refresh (loading is set true before each fetch).
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-14 animate-pulse rounded-xl bg-elevated/60" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 [&>div]:min-h-[7.5rem]">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-2xl bg-elevated/60" />
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
      {/* Header — filters + actions share one row; Add sits at the far end. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("funds.title")}</h1>
          <p className="text-sm text-muted">{t("funds.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="ctrl-input ctrl-select w-auto shrink-0 py-2 text-sm"
            aria-label={t("funds.period.label")}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`funds.period.${p}`)}
              </option>
            ))}
          </select>
          {period === "custom" && (
            <>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="ctrl-input w-auto shrink-0 py-2 text-sm"
                aria-label={t("funds.period.from")}
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="ctrl-input w-auto shrink-0 py-2 text-sm"
                aria-label={t("funds.period.to")}
              />
            </>
          )}
          <button type="button" onClick={toggleAll} className={toolbarBtn}>
            {allShown ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
            {allShown ? t("funds.hideAll") : t("funds.showAll")}
          </button>
          <button type="button" onClick={onDownloadDocs} disabled={docsLoading} className={toolbarBtn}>
            <IconDownload width={16} height={16} /> {t("funds.docs.download")}
          </button>
          <button type="button" onClick={refreshAll} disabled={loading} className={toolbarBtn}>
            <IconRefresh width={16} height={16} className={loading ? "animate-spin" : ""} />
            {t("funds.refresh")}
          </button>
          <button
            type="button"
            onClick={() => setModal({ open: true, mode: "add", fund: null })}
            className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95"
          >
            <IconPlus width={16} height={16} /> {t("funds.add")}
          </button>
        </div>
      </div>

      {/* 10 KPI cards, 5 per row — foot shows the month-end estimate. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 [&>div]:min-h-[7.5rem]">
        {METRICS.map((key) => {
          const Icon = ICONS[key];
          return (
            <StatCard
              key={key}
              tone={TONES[key]}
              Icon={Icon}
              label={t(`funds.metrics.${key}`)}
              value={displayValue(key, metrics)}
              foot={t("funds.cards.eomFoot", { value: displayValue(key, estimates) })}
              secret
              revealed={shown[key]}
              onToggleSecret={() => toggle(key)}
              revealLabel={t("funds.reveal")}
              hideLabel={t("funds.hide")}
            />
          );
        })}
      </div>

      {/* Cashflow — filtered by the selected period. */}
      <ChartCard
        title={t("funds.charts.cashflowTitle")}
        hint={t("funds.charts.cashflowHint")}
        empty={!cashflowChart}
        emptyText={t("funds.charts.noData")}
        height={320}
      >
        {cashflowChart && (
          <Chart options={cashflowChart.options} series={cashflowChart.series} type="line" height={320} />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={t("funds.charts.profitPathTitle")}
          hint={t("funds.charts.profitPathHint")}
          empty={!profitPathChart}
          emptyText={t("funds.charts.noData")}
          height={300}
        >
          {profitPathChart && (
            <Chart options={profitPathChart.options} series={profitPathChart.series} type="bar" height={300} />
          )}
        </ChartCard>

        <ChartCard
          title={t("funds.charts.marginTitle")}
          hint={t("funds.charts.marginHint")}
          empty={!marginChart}
          emptyText={t("funds.charts.noData")}
          height={300}
        >
          {marginChart && (
            <Chart options={marginChart.options} series={marginChart.series} type="area" height={300} />
          )}
        </ChartCard>

        <ChartCard
          title={t("funds.charts.capitalTitle")}
          hint={t("funds.charts.capitalHint")}
          empty={!capitalChart}
          emptyText={t("funds.charts.noData")}
          height={300}
        >
          {capitalChart && (
            <Chart options={capitalChart.options} series={capitalChart.series} type="donut" height={300} />
          )}
        </ChartCard>

        <ChartCard
          title={t("funds.charts.expenseTitle")}
          hint={t("funds.charts.expenseHint")}
          empty={!expenseChart}
          emptyText={t("funds.charts.noExpenses")}
          height={300}
        >
          {expenseChart && (
            <Chart options={expenseChart.options} series={expenseChart.series} type="donut" height={300} />
          )}
        </ChartCard>
      </div>

      {/* Fund entries */}
      <div className="ctrl-card flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text">{t("funds.table.title")}</h2>
            <p className="text-xs text-muted">{t("funds.table.hint")}</p>
          </div>
          <div className="relative min-w-[220px]">
            <IconSearch
              width={16}
              height={16}
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted"
              style={{ [isAr ? "right" : "left"]: 12 }}
            />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder={t("funds.searchPlaceholder")}
              className="ctrl-input w-full py-2 ps-10 text-sm"
            />
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
                  <tr key={i}>
                    <td colSpan={5} className="px-4 py-2">
                      <div className="h-9 animate-pulse rounded bg-elevated/70" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-muted">
                    {t("funds.empty")}
                  </td>
                </tr>
              ) : (
                items.map((f) => {
                  const negative = Number(f.amount) < 0;
                  return (
                    <tr key={f.id} className="border-b border-border/60 transition hover:bg-elevated/40">
                      <td className="px-4 py-3 text-center text-muted" dir="ltr">
                        {f.occurred_at}
                      </td>
                      <td
                        className={`px-4 py-3 text-end font-semibold tabular-nums ${
                          negative ? "text-red-400" : "text-accent"
                        }`}
                      >
                        {negative ? "−" : "+"}
                        {money(Math.abs(f.amount))}
                      </td>
                      <td className="max-w-[320px] px-4 py-3 text-muted">
                        <span className="block truncate" title={f.note || ""}>
                          {f.note || "—"}
                        </span>
                      </td>
                      <td className="max-w-[160px] px-4 py-3 text-muted" dir="ltr">
                        <span className="block truncate" title={f.created_by || ""}>
                          {f.created_by || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            title={t("funds.view")}
                            className={iconBtn}
                            onClick={() => setModal({ open: true, mode: "view", fund: f })}
                          >
                            <IconEye width={15} height={15} />
                          </button>
                          <button
                            title={t("funds.edit")}
                            className={iconBtn}
                            onClick={() => setModal({ open: true, mode: "edit", fund: f })}
                          >
                            <IconEdit width={15} height={15} />
                          </button>
                          <button
                            title={t("funds.delete")}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition hover:bg-red-500 hover:text-white"
                            onClick={() => setConfirmDel(f)}
                          >
                            <IconTrash width={15} height={15} />
                          </button>
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
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="ctrl-btn border border-border px-3 py-1.5 text-text hover:bg-elevated disabled:opacity-40"
              >
                {t("funds.prev")}
              </button>
              <span className="text-muted">
                {page} / {pages}
              </span>
              <button
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="ctrl-btn border border-border px-3 py-1.5 text-text hover:bg-elevated disabled:opacity-40"
              >
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

      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title={t("funds.confirmDelete.title")}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmDel(null)}
              className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated"
            >
              {t("funds.modal.cancel")}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="ctrl-btn bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600"
            >
              {t("funds.delete")}
            </button>
          </>
        }
      >
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
