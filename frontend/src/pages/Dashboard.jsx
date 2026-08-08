import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Chart from "react-apexcharts";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { businessOverview } from "@/lib/dashboard";
import StatCard, { MASK } from "@/components/StatCard";
import ChartCard from "@/components/dashboard/ChartCard";
import ReportModal from "@/components/dashboard/ReportModal";
import { baseOptions, donutOptions, PALETTE } from "@/lib/charts";
import theme from "@/config/theme";
import {
  IconWallet,
  IconCoins,
  IconScale,
  IconReceipt,
  IconUsers,
  IconBox,
  IconLayers,
  IconBriefcase,
  IconTag,
  IconClock,
  IconRefresh,
  IconEye,
  IconEyeOff,
  IconTrendUp,
  IconTrendDown,
  IconFileText,
  IconChart,
} from "@/components/icons";

// Every money/volume tile starts masked on each page load.
const SECRETS = [
  "revenue",
  "profit",
  "net",
  "avg",
  "today",
  "expenses",
  "orders",
  "customers",
  "inventory",
  "stock",
  "grossValue",
];
const HIDDEN = Object.fromEntries(SECRETS.map((k) => [k, false]));

const hourLabels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
// Backend weekday rows are Sunday-first; read them Monday-first.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Staggered entrance so the grid assembles itself rather than snapping in.
const rise = (i) => ({ animationDelay: `${Math.min(i, 12) * 45}ms` });

function Trend({ value, fmt }) {
  if (value == null) return null;
  const up = value >= 0;
  const Icon = up ? IconTrendUp : IconTrendDown;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${up ? "text-accent" : "text-rose-400"}`}>
      <Icon width={13} height={13} />
      {fmt(Math.abs(value))}
    </span>
  );
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const loc = isAr ? "ar-EG" : "en-US";
  const toast = useToast();
  const { user } = useAuth();
  const brand = useBrand();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(HIDDEN);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await businessOverview());
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

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
  const pctFmt = useCallback(
    (n) => `${Number(n || 0).toLocaleString(loc, { maximumFractionDigits: 1 })}%`,
    [loc]
  );

  const allShown = SECRETS.every((k) => shown[k]);
  const toggle = (k) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () => setShown(Object.fromEntries(SECRETS.map((k) => [k, !allShown])));

  const kpi = data?.kpi;
  const trends = data?.trends || {};
  const business = data?.scope === "business";
  const windowDays = data?.window_days || 30;

  const dayLabels = useMemo(
    () =>
      (data?.daily || []).map((d) =>
        new Date(d.date).toLocaleDateString(loc, { day: "numeric", month: "short" })
      ),
    [data, loc]
  );
  const monthLabels = useMemo(
    () =>
      (data?.monthly || []).map((m) => {
        const [y, mm] = m.month.split("-").map(Number);
        return new Date(y, mm - 1, 1).toLocaleDateString(loc, { month: "short", year: "2-digit" });
      }),
    [data, loc]
  );
  const weekdayLabels = useMemo(
    () =>
      WEEK_ORDER.map((i) =>
        new Date(2024, 0, 7 + i).toLocaleDateString(loc, { weekday: "short" })
      ),
    [loc]
  );

  // --- charts -------------------------------------------------------------
  const trendChart = useMemo(() => {
    if (!data?.daily?.length) return null;
    const base = baseOptions();
    const series = [
      {
        name: t("dashboard.charts.revenue"),
        type: "area",
        data: data.daily.map((d) => d.amount),
      },
    ];
    if (business) {
      series.push({
        name: t("dashboard.charts.profit"),
        type: "line",
        data: data.daily.map((d) => d.profit || 0),
      });
    }
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "line", height: 320 },
        colors: [theme.accent, "#38BDF8"],
        stroke: { width: business ? [2, 2] : [2], curve: "smooth" },
        fill: {
          type: business ? ["gradient", "solid"] : ["gradient"],
          gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 95] },
        },
        markers: { size: 0, hover: { size: 4 } },
        xaxis: { ...base.xaxis, categories: dayLabels, tickAmount: 10 },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        legend: { ...base.legend, show: business, position: "top", horizontalAlign: "right" },
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series,
    };
  }, [data, business, dayLabels, compact, money, t]);

  const monthlyChart = useMemo(() => {
    if (!data?.monthly?.length) return null;
    const base = baseOptions();
    const series = [
      { name: t("dashboard.charts.revenue"), type: "column", data: data.monthly.map((m) => m.sales) },
      {
        name: t("dashboard.charts.expenses"),
        type: "column",
        data: data.monthly.map((m) => m.expenses),
      },
    ];
    if (business) {
      series.push({
        name: t("dashboard.charts.profit"),
        type: "line",
        data: data.monthly.map((m) => m.profit || 0),
      });
    }
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "line", height: 320, stacked: false },
        colors: [theme.accent, "#FB7185", "#38BDF8"],
        stroke: { width: business ? [0, 0, 2.5] : [0, 0], curve: "smooth" },
        plotOptions: {
          bar: { columnWidth: "55%", borderRadius: 3, borderRadiusApplication: "end" },
        },
        markers: { size: 0, hover: { size: 4 } },
        xaxis: { ...base.xaxis, categories: monthLabels },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        legend: { ...base.legend, show: true, position: "top", horizontalAlign: "right" },
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series,
    };
  }, [data, business, monthLabels, compact, money, t]);

  const donut = useCallback(
    (rows, labelFn, valueFn, height = 300, colors) => {
      if (!rows?.length) return null;
      const series = rows.map(valueFn);
      return {
        options: {
          ...donutOptions({
            labels: rows.map(labelFn),
            totalLabel: t("dashboard.charts.total"),
            totalValue: compact(series.reduce((s, v) => s + v, 0)),
          }),
          chart: { ...baseOptions().chart, type: "donut", height },
          ...(colors ? { colors } : {}),
          tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
        },
        series,
      };
    },
    [compact, money, t]
  );

  const paymentChart = useMemo(
    () => donut(data?.payments, (p) => (isAr ? p.name_ar || p.name_en : p.name_en), (p) => p.amount),
    [data, isAr, donut]
  );
  const categoryChart = useMemo(
    () => donut(data?.categories, (c) => (isAr ? c.name_ar || c.name_en : c.name_en), (c) => c.amount),
    [data, isAr, donut]
  );
  const expenseChart = useMemo(
    () =>
      donut(
        data?.expense_types,
        (e) => (e.type === "other" ? e.name || t("expenses.types.other") : t(`expenses.types.${e.type}`)),
        (e) => e.amount,
        280,
        ["#FB7185", "#FBBF24", "#A78BFA", "#38BDF8", theme.accent, "#34D399"]
      ),
    [data, donut, t]
  );

  // Horizontal, distributed bars — shared by products, customers and staff.
  const hBar = useCallback(
    (rows, labelFn, valueFn, tipFn, height = 300) => {
      if (!rows?.length) return null;
      const base = baseOptions();
      return {
        options: {
          ...base,
          chart: { ...base.chart, type: "bar", height },
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
          xaxis: { ...base.xaxis, categories: rows.map(labelFn), labels: { formatter: (v) => compact(v) } },
          yaxis: { labels: { maxWidth: 170 } },
          tooltip: {
            theme: "dark",
            y: { formatter: (v, o) => tipFn(v, rows[o?.dataPointIndex ?? 0]) },
          },
        },
        series: [{ name: t("dashboard.charts.revenue"), data: rows.map(valueFn) }],
      };
    },
    [compact, t]
  );

  const productChart = useMemo(
    () =>
      hBar(
        data?.top_products,
        (r) => r.name,
        (r) => r.amount,
        (v, row) => `${money(v)} · ${num(row?.quantity || 0)}×`
      ),
    [data, hBar, money, num]
  );
  const customerChart = useMemo(
    () =>
      hBar(
        data?.top_customers,
        (r) => r.name,
        (r) => r.amount,
        (v, row) => `${money(v)} · ${num(row?.orders || 0)}`,
        280
      ),
    [data, hBar, money, num]
  );
  const staffChart = useMemo(
    () =>
      hBar(
        data?.staff,
        (r) => r.full_name || r.username,
        (r) => r.amount,
        (v, row) => `${money(v)} · ${num(row?.orders || 0)}`,
        280
      ),
    [data, hBar, money, num]
  );

  const hourlyChart = useMemo(() => {
    if (!data?.hourly?.length) return null;
    const base = baseOptions();
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "bar", height: 280 },
        colors: [theme.accent],
        plotOptions: { bar: { columnWidth: "60%", borderRadius: 2, borderRadiusApplication: "end" } },
        legend: { show: false },
        xaxis: { ...base.xaxis, categories: hourLabels, tickAmount: 12 },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        tooltip: {
          theme: "dark",
          x: { formatter: (_v, o) => `${hourLabels[o?.dataPointIndex ?? 0]}:00` },
          y: {
            formatter: (v, o) =>
              `${money(v)} · ${num(data.hourly[o?.dataPointIndex ?? 0]?.count || 0)}`,
          },
        },
      },
      series: [{ name: t("dashboard.charts.revenue"), data: data.hourly.map((h) => h.amount) }],
    };
  }, [data, compact, money, num, t]);

  const weekdayChart = useMemo(() => {
    if (!data?.weekday?.length) return null;
    const base = baseOptions();
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "radar", height: 280 },
        colors: [theme.accent],
        fill: { opacity: 0.22 },
        stroke: { width: 2 },
        markers: { size: 3 },
        xaxis: { categories: weekdayLabels },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series: [
        {
          name: t("dashboard.charts.revenue"),
          data: WEEK_ORDER.map((i) => data.weekday[i]?.amount || 0),
        },
      ],
    };
  }, [data, weekdayLabels, compact, money, t]);

  const stockChart = useMemo(() => {
    if (!data?.stock_by_category?.length) return null;
    const base = baseOptions();
    const rows = data.stock_by_category;
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "bar", height: 280 },
        colors: PALETTE,
        plotOptions: {
          bar: { distributed: true, columnWidth: "55%", borderRadius: 4, borderRadiusApplication: "end" },
        },
        legend: { show: false },
        xaxis: {
          ...base.xaxis,
          categories: rows.map((c) => (isAr ? c.name_ar || c.name_en : c.name_en)),
          labels: { rotate: -35, trim: true, hideOverlappingLabels: false },
        },
        yaxis: { labels: { formatter: (v) => num(Math.round(v)) } },
        tooltip: {
          theme: "dark",
          y: {
            formatter: (v, o) => {
              const row = rows[o?.dataPointIndex ?? 0];
              return row?.cost != null
                ? `${num(v)} · ${money(row.cost)}`
                : `${num(v)}`;
            },
          },
        },
      },
      series: [{ name: t("dashboard.charts.units"), data: rows.map((c) => c.quantity) }],
    };
  }, [data, isAr, money, num, t]);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-16 animate-pulse rounded-xl bg-elevated/60" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-[118px] animate-pulse rounded-2xl bg-elevated/60" />
          ))}
        </div>
        <div className="h-[360px] animate-pulse rounded-2xl bg-elevated/60" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[320px] animate-pulse rounded-2xl bg-elevated/60" />
          ))}
        </div>
      </div>
    );
  }

  if (!kpi) {
    return (
      <div className="ctrl-card flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm text-muted">{t("dashboard.charts.noData")}</p>
        <button
          type="button"
          onClick={load}
          className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated"
        >
          <IconRefresh width={16} height={16} />
          {t("dashboard.refresh")}
        </button>
      </div>
    );
  }

  const revealProps = (key) => ({
    secret: true,
    revealed: shown[key],
    onToggleSecret: () => toggle(key),
    revealLabel: t("dashboard.reveal"),
    hideLabel: t("dashboard.hide"),
  });
  const emptyText = t("dashboard.charts.noData");
  const windowHint = t("dashboard.charts.windowHint", { count: windowDays });

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="ctrl-fade flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-accent">{t("dashboard.welcome")}</p>
          <h1 className="mt-0.5 truncate text-xl font-bold text-text">
            {user?.full_name || user?.username}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {business
              ? t("dashboard.overview", { brand: brand.name })
              : t("dashboard.subtitleSelf", { brand: brand.name })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleAll}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated"
          >
            {allShown ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
            {allShown ? t("dashboard.hideAll") : t("dashboard.showAll")}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50"
          >
            <IconRefresh width={16} height={16} className={loading ? "animate-spin" : ""} />
            {t("dashboard.refresh")}
          </button>
          {data?.can_export && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95"
            >
              <IconFileText width={16} height={16} />
              {t("dashboard.exportReport")}
            </button>
          )}
        </div>
      </div>

      {/* Money KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="ctrl-rise ctrl-sheen relative" style={rise(0)}>
          <StatCard
            Icon={IconWallet}
            label={t("dashboard.cards.revenue")}
            value={money(kpi.sales_amount)}
            tone="accent"
            foot={
              <span className="flex flex-wrap items-center gap-1">
                {t("dashboard.foot.thisMonth")}
                <b className="text-text">{shown.revenue ? money(kpi.month_amount) : MASK}</b>
                <Trend value={trends.sales_amount} fmt={pctFmt} />
              </span>
            }
            {...revealProps("revenue")}
          />
        </div>

        {business && (
          <div className="ctrl-rise ctrl-sheen relative" style={rise(1)}>
            <StatCard
              Icon={IconCoins}
              label={t("dashboard.cards.grossProfit")}
              value={money(kpi.gross_profit)}
              tone="emerald"
              foot={
                <span className="flex flex-wrap items-center gap-1">
                  {t("dashboard.foot.margin")}
                  <b className="text-text">{pctFmt(kpi.margin_pct)}</b>
                  <Trend value={trends.profit} fmt={pctFmt} />
                </span>
              }
              {...revealProps("profit")}
            />
          </div>
        )}

        {business && (
          <div className="ctrl-rise ctrl-sheen relative" style={rise(2)}>
            <StatCard
              Icon={IconScale}
              label={t("dashboard.cards.netProfit")}
              value={money(kpi.net_profit)}
              tone="sky"
              foot={
                <span>
                  {t("dashboard.foot.afterExpenses")}{" "}
                  <b className="text-text">{shown.net ? money(kpi.expenses_total) : MASK}</b>
                </span>
              }
              {...revealProps("net")}
            />
          </div>
        )}

        <div className="ctrl-rise ctrl-sheen relative" style={rise(3)}>
          <StatCard
            Icon={IconReceipt}
            label={t("dashboard.cards.orders")}
            value={num(kpi.sales_count)}
            tone="violet"
            foot={
              <span className="flex flex-wrap items-center gap-1">
                {t("dashboard.foot.itemsSold", { count: shown.orders ? num(kpi.items_sold) : MASK })}
                <Trend value={trends.sales_count} fmt={pctFmt} />
              </span>
            }
            {...revealProps("orders")}
          />
        </div>

        <div className="ctrl-rise ctrl-sheen relative" style={rise(4)}>
          <StatCard
            Icon={IconTag}
            label={t("dashboard.cards.avgTicket")}
            value={money(kpi.avg_ticket)}
            tone="amber"
            foot={
              <span>
                {t("dashboard.foot.discountGiven")}{" "}
                <b className="text-text">{shown.avg ? money(kpi.discount) : MASK}</b>
              </span>
            }
            {...revealProps("avg")}
          />
        </div>

        <div className="ctrl-rise ctrl-sheen relative" style={rise(5)}>
          <StatCard
            Icon={IconClock}
            label={t("dashboard.cards.today")}
            value={money(kpi.today_amount)}
            tone="accent"
            foot={
              <span>
                {t("dashboard.foot.ordersToday", {
                  count: shown.today ? num(kpi.today_count) : MASK,
                })}
              </span>
            }
            {...revealProps("today")}
          />
        </div>

        <div className="ctrl-rise ctrl-sheen relative" style={rise(6)}>
          <StatCard
            Icon={IconChart}
            label={t("dashboard.cards.expenses")}
            value={money(kpi.expenses_total)}
            tone="rose"
            foot={
              <span className="flex flex-wrap items-center gap-1">
                {t("dashboard.foot.thisMonth")}
                <b className="text-text">{shown.expenses ? money(kpi.expenses_month) : MASK}</b>
                <Trend value={trends.expenses} fmt={pctFmt} />
              </span>
            }
            {...revealProps("expenses")}
          />
        </div>

        <div className="ctrl-rise ctrl-sheen relative" style={rise(7)}>
          <StatCard
            Icon={IconUsers}
            label={t("dashboard.cards.customers")}
            value={num(kpi.customers_total)}
            tone="sky"
            foot={
              <span className="flex flex-wrap items-center gap-1">
                {t("dashboard.foot.newThisMonth", {
                  count: shown.customers ? num(kpi.customers_month) : MASK,
                })}
                <Trend value={trends.customers} fmt={pctFmt} />
              </span>
            }
            {...revealProps("customers")}
          />
        </div>

        {business && (
          <div className="ctrl-rise ctrl-sheen relative" style={rise(8)}>
            <StatCard
              Icon={IconBox}
              label={t("dashboard.cards.inventoryValue")}
              value={money(kpi.inventory_cost)}
              tone="emerald"
              foot={
                <span>
                  {t("dashboard.foot.retailValue")}{" "}
                  <b className="text-text">{shown.inventory ? money(kpi.inventory_retail) : MASK}</b>
                </span>
              }
              {...revealProps("inventory")}
            />
          </div>
        )}

        <div className="ctrl-rise ctrl-sheen relative" style={rise(9)}>
          <StatCard
            Icon={IconLayers}
            label={t("dashboard.cards.stockOnHand")}
            value={num(kpi.stock_qty)}
            tone="violet"
            foot={
              <span>
                {t("dashboard.foot.catalogue", {
                  products: num(kpi.products),
                  variants: num(kpi.variants),
                })}
              </span>
            }
            {...revealProps("stock")}
          />
        </div>

        {business && (
          <div className="ctrl-rise ctrl-sheen relative" style={rise(10)}>
            <StatCard
              Icon={IconBriefcase}
              label={t("dashboard.cards.grossValue")}
              value={money(kpi.gross_value)}
              tone="amber"
              foot={
                <span>
                  {t("dashboard.foot.grossParts", {
                    supplier: shown.grossValue ? money(kpi.supplier_paid) : MASK,
                    funds: shown.grossValue ? money(kpi.manual_funds) : MASK,
                  })}
                </span>
              }
              {...revealProps("grossValue")}
            />
          </div>
        )}

        <div className="ctrl-rise relative" style={rise(11)}>
          <StatCard
            Icon={IconRefresh}
            label={t("dashboard.cards.stockAlerts")}
            value={num(kpi.low_stock + kpi.out_of_stock)}
            tone={kpi.out_of_stock > 0 ? "rose" : "emerald"}
            foot={
              <span>
                {t("dashboard.foot.stockAlerts", {
                  out: num(kpi.out_of_stock),
                  low: num(kpi.low_stock),
                })}
              </span>
            }
          />
        </div>
      </div>

      {/* Revenue trend */}
      <div className="ctrl-rise" style={rise(1)}>
        <ChartCard
          title={t("dashboard.charts.trend")}
          hint={windowHint}
          empty={!trendChart}
          emptyText={emptyText}
          height={320}
        >
          {trendChart && (
            <Chart options={trendChart.options} series={trendChart.series} type="line" height={320} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="ctrl-rise" style={rise(2)}>
          <ChartCard
            title={t("dashboard.charts.monthly")}
            hint={t("dashboard.charts.monthlyHint")}
            empty={!monthlyChart}
            emptyText={emptyText}
            height={320}
          >
            {monthlyChart && (
              <Chart options={monthlyChart.options} series={monthlyChart.series} type="line" height={320} />
            )}
          </ChartCard>
        </div>

        <div className="ctrl-rise" style={rise(3)}>
          <ChartCard
            title={t("dashboard.charts.products")}
            hint={windowHint}
            empty={!productChart}
            emptyText={emptyText}
            height={300}
          >
            {productChart && (
              <Chart options={productChart.options} series={productChart.series} type="bar" height={300} />
            )}
          </ChartCard>
        </div>

        <div className="ctrl-rise" style={rise(4)}>
          <ChartCard
            title={t("dashboard.charts.payments")}
            hint={windowHint}
            empty={!paymentChart}
            emptyText={emptyText}
            height={300}
          >
            {paymentChart && (
              <Chart options={paymentChart.options} series={paymentChart.series} type="donut" height={300} />
            )}
          </ChartCard>
        </div>

        <div className="ctrl-rise" style={rise(5)}>
          <ChartCard
            title={t("dashboard.charts.categories")}
            hint={windowHint}
            empty={!categoryChart}
            emptyText={emptyText}
            height={300}
          >
            {categoryChart && (
              <Chart options={categoryChart.options} series={categoryChart.series} type="donut" height={300} />
            )}
          </ChartCard>
        </div>

        <div className="ctrl-rise" style={rise(6)}>
          <ChartCard
            title={t("dashboard.charts.hourly")}
            hint={t("dashboard.charts.hourlyHint")}
            empty={!hourlyChart}
            emptyText={emptyText}
            height={280}
          >
            {hourlyChart && (
              <Chart options={hourlyChart.options} series={hourlyChart.series} type="bar" height={280} />
            )}
          </ChartCard>
        </div>

        <div className="ctrl-rise" style={rise(7)}>
          <ChartCard
            title={t("dashboard.charts.weekday")}
            hint={t("dashboard.charts.weekdayHint")}
            empty={!weekdayChart}
            emptyText={emptyText}
            height={280}
          >
            {weekdayChart && (
              <Chart options={weekdayChart.options} series={weekdayChart.series} type="radar" height={280} />
            )}
          </ChartCard>
        </div>

        <div className="ctrl-rise" style={rise(8)}>
          <ChartCard
            title={t("dashboard.charts.stock")}
            hint={t("dashboard.charts.stockHint")}
            empty={!stockChart}
            emptyText={emptyText}
            height={280}
          >
            {stockChart && (
              <Chart options={stockChart.options} series={stockChart.series} type="bar" height={280} />
            )}
          </ChartCard>
        </div>

        <div className="ctrl-rise" style={rise(9)}>
          <ChartCard
            title={t("dashboard.charts.customers")}
            hint={t("dashboard.charts.customersHint")}
            empty={!customerChart}
            emptyText={emptyText}
            height={280}
          >
            {customerChart && (
              <Chart options={customerChart.options} series={customerChart.series} type="bar" height={280} />
            )}
          </ChartCard>
        </div>

        {business && (
          <div className="ctrl-rise" style={rise(10)}>
            <ChartCard
              title={t("dashboard.charts.staff")}
              hint={windowHint}
              empty={!staffChart}
              emptyText={emptyText}
              height={280}
            >
              {staffChart && (
                <Chart options={staffChart.options} series={staffChart.series} type="bar" height={280} />
              )}
            </ChartCard>
          </div>
        )}

        <div className="ctrl-rise" style={rise(11)}>
          <ChartCard
            title={t("dashboard.charts.expenses")}
            hint={t("dashboard.charts.expensesHint")}
            empty={!expenseChart}
            emptyText={emptyText}
            height={280}
          >
            {expenseChart && (
              <Chart options={expenseChart.options} series={expenseChart.series} type="donut" height={280} />
            )}
          </ChartCard>
        </div>
      </div>

      {/* Tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="ctrl-rise" style={rise(12)}>
          <ChartCard
            title={t("dashboard.tables.recent")}
            hint={t("dashboard.tables.recentHint")}
            empty={!data?.recent_sales?.length}
            emptyText={emptyText}
            height={200}
          >
            <div className="overflow-x-auto">
              <table className="ctrl-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-xs font-medium">{t("dashboard.tables.invoice")}</th>
                    <th className="px-3 py-2 text-xs font-medium">{t("dashboard.tables.time")}</th>
                    <th className="px-3 py-2 text-xs font-medium">{t("dashboard.tables.customer")}</th>
                    <th className="px-3 py-2 text-xs font-medium">{t("dashboard.tables.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recent_sales || []).map((s) => (
                    <tr key={s.invoice_no}>
                      <td className="px-3 py-2 font-mono text-xs text-muted">{s.invoice_no}</td>
                      <td className="px-3 py-2 text-xs text-muted" dir="ltr">
                        {s.created_at
                          ? new Date(s.created_at).toLocaleString(loc, {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{s.customer || "—"}</td>
                      <td className="px-3 py-2 font-semibold text-text" dir="ltr">
                        {shown.revenue ? money(s.total) : MASK}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>

        <div className="ctrl-rise" style={rise(12)}>
          <ChartCard
            title={t("dashboard.tables.lowStock")}
            hint={t("dashboard.tables.lowStockHint")}
            empty={!data?.low_stock_items?.length}
            emptyText={t("dashboard.tables.stockHealthy")}
            height={200}
          >
            <div className="overflow-x-auto">
              <table className="ctrl-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-xs font-medium">{t("dashboard.tables.product")}</th>
                    <th className="px-3 py-2 text-xs font-medium">{t("dashboard.tables.code")}</th>
                    <th className="px-3 py-2 text-xs font-medium">{t("dashboard.tables.qty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.low_stock_items || []).map((x) => (
                    <tr key={x.code}>
                      <td className="px-3 py-2">{x.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">{x.code}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            x.quantity <= 0
                              ? "bg-rose-500/15 text-rose-300"
                              : "bg-amber-500/15 text-amber-300"
                          }`}
                        >
                          {num(x.quantity)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      </div>

      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
