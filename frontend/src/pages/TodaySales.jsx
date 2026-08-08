import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Chart from "react-apexcharts";
import { useToast } from "@/context/ToastContext";
import { todaySales } from "@/lib/dashboard";
import StatCard from "@/components/StatCard";
import ChartCard from "@/components/dashboard/ChartCard";
import { baseOptions, donutOptions, PALETTE } from "@/lib/charts";
import theme from "@/config/theme";
import {
  IconReceipt,
  IconTrendUp,
  IconTrendDown,
  IconWallet,
  IconDrawer,
  IconClock,
  IconRefresh,
  IconEye,
  IconEyeOff,
} from "@/components/icons";

const SECRETS = ["count", "amount", "cash", "drawer", "expenses"];
const HIDDEN = Object.fromEntries(SECRETS.map((k) => [k, false]));

const hourLabels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));

// Running total, cut off after `upto` so today's line stops at the current hour.
function cumulative(rows, upto = 23) {
  let sum = 0;
  return rows.map((r, i) => {
    sum += Number(r.amount) || 0;
    return i > upto ? null : Math.round(sum * 100) / 100;
  });
}

export default function TodaySales() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const loc = isAr ? "ar-EG" : "en-US";
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(HIDDEN);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await todaySales());
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

  const allShown = SECRETS.every((k) => shown[k]);
  const toggle = (k) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () =>
    setShown(Object.fromEntries(SECRETS.map((k) => [k, !allShown])));

  const dayLabel = useMemo(() => {
    if (!data?.now) return "";
    return new Date(data.now).toLocaleDateString(loc, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, [data, loc]);

  const today = data?.today;
  const noSales = !today || today.count === 0;

  // --- chart configs ------------------------------------------------------
  const hourlyChart = useMemo(() => {
    if (!data) return null;
    const base = baseOptions();
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "line", height: 300 },
        colors: [theme.accent, "#38BDF8"],
        stroke: { width: [2, 0], curve: "smooth" },
        fill: {
          type: ["gradient", "solid"],
          gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 95] },
        },
        plotOptions: {
          bar: { columnWidth: "45%", borderRadius: 3, borderRadiusApplication: "end" },
        },
        markers: { size: 0, hover: { size: 4 } },
        xaxis: { ...base.xaxis, categories: hourLabels, tickAmount: 12 },
        yaxis: [
          { labels: { formatter: (v) => compact(v) } },
          { opposite: true, min: 0, labels: { formatter: (v) => num(Math.round(v)) } },
        ],
        legend: { ...base.legend, show: true, position: "top", horizontalAlign: "right" },
        tooltip: {
          theme: "dark",
          x: { formatter: (_v, o) => `${hourLabels[o?.dataPointIndex ?? 0]}:00` },
          y: {
            formatter: (v, o) =>
              o?.seriesIndex === 0 ? money(v) : num(Math.round(v || 0)),
          },
        },
      },
      series: [
        { name: t("todaySales.charts.revenue"), type: "area", data: data.hourly.map((h) => h.amount) },
        { name: t("todaySales.charts.sales"), type: "column", data: data.hourly.map((h) => h.count) },
      ],
    };
  }, [data, compact, money, num, t]);

  const paceChart = useMemo(() => {
    if (!data) return null;
    const base = baseOptions();
    const nowHour = new Date(data.now).getHours();
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "line", height: 280 },
        colors: [theme.accent, theme.muted],
        stroke: { width: [3, 2], curve: "smooth", dashArray: [0, 5] },
        markers: { size: 0, hover: { size: 4 } },
        xaxis: { ...base.xaxis, categories: hourLabels, tickAmount: 12 },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        legend: { ...base.legend, show: true, position: "top", horizontalAlign: "right" },
        tooltip: {
          theme: "dark",
          x: { formatter: (_v, o) => `${hourLabels[o?.dataPointIndex ?? 0]}:00` },
          y: { formatter: (v) => (v == null ? "—" : money(v)) },
        },
      },
      series: [
        { name: t("todaySales.charts.today"), data: cumulative(data.hourly, nowHour) },
        { name: t("todaySales.charts.yesterday"), data: cumulative(data.hourly_prev) },
      ],
    };
  }, [data, compact, money, t]);

  const paymentChart = useMemo(() => {
    if (!data?.payments?.length) return null;
    const labels = data.payments.map((p) => (isAr ? p.name_ar : p.name_en));
    const series = data.payments.map((p) => p.amount);
    return {
      options: {
        ...donutOptions({
          labels,
          totalLabel: t("todaySales.charts.total"),
          totalValue: compact(series.reduce((s, v) => s + v, 0)),
        }),
        chart: { ...baseOptions().chart, type: "donut", height: 300 },
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series,
    };
  }, [data, isAr, compact, money, t]);

  const categoryChart = useMemo(() => {
    if (!data?.categories?.length) return null;
    const labels = data.categories.map((c) => (isAr ? c.name_ar : c.name_en));
    const series = data.categories.map((c) => c.amount);
    return {
      options: {
        ...donutOptions({
          labels,
          totalLabel: t("todaySales.charts.total"),
          totalValue: compact(series.reduce((s, v) => s + v, 0)),
        }),
        chart: { ...baseOptions().chart, type: "donut", height: 300 },
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series,
    };
  }, [data, isAr, compact, money, t]);

  const productChart = useMemo(() => {
    if (!data?.top_products?.length) return null;
    const base = baseOptions();
    const rows = data.top_products;
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
        tooltip: {
          theme: "dark",
          y: {
            formatter: (v, o) => {
              const row = rows[o?.dataPointIndex ?? 0];
              return `${money(v)} · ${num(row?.quantity || 0)}×`;
            },
          },
        },
      },
      series: [{ name: t("todaySales.charts.revenue"), data: rows.map((r) => r.amount) }],
    };
  }, [data, compact, money, num, t]);

  const drawerChart = useMemo(() => {
    if (!today) return null;
    const base = baseOptions();
    return {
      options: {
        ...base,
        chart: { ...base.chart, type: "bar", height: 280 },
        colors: [theme.accent, "#FB7185", "#38BDF8"],
        plotOptions: {
          bar: { distributed: true, columnWidth: "45%", borderRadius: 6, borderRadiusApplication: "end" },
        },
        legend: { show: false },
        dataLabels: {
          enabled: true,
          formatter: (v) => compact(v),
          style: { colors: [theme.text], fontWeight: 600 },
          offsetY: -20,
        },
        xaxis: {
          ...base.xaxis,
          categories: [
            t("todaySales.charts.cashIn"),
            t("todaySales.charts.expensesOut"),
            t("todaySales.charts.drawerNow"),
          ],
        },
        yaxis: { labels: { formatter: (v) => compact(v) } },
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series: [
        {
          name: t("todaySales.charts.amount"),
          data: [today.cash, today.expenses, today.drawer],
        },
      ],
    };
  }, [today, compact, money, t]);

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
          totalLabel: t("todaySales.charts.total"),
          totalValue: compact(series.reduce((s, v) => s + v, 0)),
        }),
        chart: { ...baseOptions().chart, type: "donut", height: 280 },
        colors: ["#FB7185", "#FBBF24", "#A78BFA", "#38BDF8", theme.accent, "#34D399"],
        tooltip: { theme: "dark", y: { formatter: (v) => money(v) } },
      },
      series,
    };
  }, [data, compact, money, t]);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-16 animate-pulse rounded-xl bg-elevated/60" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[118px] animate-pulse rounded-2xl bg-elevated/60" />
          ))}
        </div>
        <div className="h-[340px] animate-pulse rounded-2xl bg-elevated/60" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[320px] animate-pulse rounded-2xl bg-elevated/60" />
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
          <h1 className="text-xl font-bold text-text">{t("todaySales.title")}</h1>
          <p className="text-sm text-muted">
            {t("todaySales.subtitle", { name: data?.user?.full_name || data?.user?.username })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAll}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated"
          >
            {allShown ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
            {allShown ? t("todaySales.hideAll") : t("todaySales.showAll")}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95 disabled:opacity-50"
          >
            <IconRefresh width={16} height={16} className={loading ? "animate-spin" : ""} />
            {t("todaySales.refresh")}
          </button>
        </div>
      </div>

      {/* Day banner */}
      <div className="ctrl-card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
        <span className="inline-flex items-center gap-2 text-muted">
          <IconClock width={16} height={16} className="text-accent" />
          {dayLabel}
        </span>
        <span className="text-muted">
          {t("todaySales.banner", { count: num(today?.count), items: num(today?.items) })}
        </span>
      </div>

      {/* KPI cards — every value starts masked */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          tone="sky"
          Icon={IconReceipt}
          label={t("todaySales.cards.count")}
          value={num(today?.count)}
          foot={t("todaySales.cards.countFoot", { items: num(today?.items) })}
          secret
          revealed={shown.count}
          onToggleSecret={() => toggle("count")}
          revealLabel={t("todaySales.reveal")}
          hideLabel={t("todaySales.hide")}
        />
        <StatCard
          tone="accent"
          Icon={IconTrendUp}
          label={t("todaySales.cards.amount")}
          value={money(today?.amount)}
          foot={t("todaySales.cards.amountFoot", { value: money(today?.avg_ticket) })}
          secret
          revealed={shown.amount}
          onToggleSecret={() => toggle("amount")}
          revealLabel={t("todaySales.reveal")}
          hideLabel={t("todaySales.hide")}
        />
        <StatCard
          tone="emerald"
          Icon={IconWallet}
          label={t("todaySales.cards.cash")}
          value={money(today?.cash)}
          foot={t("todaySales.cards.cashFoot", { value: money(today?.other) })}
          secret
          revealed={shown.cash}
          onToggleSecret={() => toggle("cash")}
          revealLabel={t("todaySales.reveal")}
          hideLabel={t("todaySales.hide")}
        />
        <StatCard
          tone="violet"
          Icon={IconDrawer}
          label={t("todaySales.cards.drawer")}
          value={money(today?.drawer)}
          foot={t("todaySales.cards.drawerFoot", {
            cash: money(today?.cash),
            expenses: money(today?.expenses),
          })}
          secret
          revealed={shown.drawer}
          onToggleSecret={() => toggle("drawer")}
          revealLabel={t("todaySales.reveal")}
          hideLabel={t("todaySales.hide")}
        />
        <StatCard
          tone="rose"
          Icon={IconTrendDown}
          label={t("todaySales.cards.expenses")}
          value={money(today?.expenses)}
          foot={t("todaySales.cards.expensesFoot", { count: num(today?.expense_count) })}
          secret
          revealed={shown.expenses}
          onToggleSecret={() => toggle("expenses")}
          revealLabel={t("todaySales.reveal")}
          hideLabel={t("todaySales.hide")}
        />
      </div>

      {/* Hourly performance */}
      <ChartCard
        title={t("todaySales.charts.hourlyTitle")}
        hint={t("todaySales.charts.hourlyHint")}
        empty={noSales}
        emptyText={t("todaySales.charts.noSales")}
        height={300}
      >
        {hourlyChart && (
          <Chart options={hourlyChart.options} series={hourlyChart.series} type="line" height={300} />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pace vs yesterday */}
        <ChartCard
          title={t("todaySales.charts.paceTitle")}
          hint={t("todaySales.charts.paceHint")}
          empty={noSales && !data?.hourly_prev?.some((h) => h.amount > 0)}
          emptyText={t("todaySales.charts.noSales")}
          height={280}
        >
          {paceChart && (
            <Chart options={paceChart.options} series={paceChart.series} type="line" height={280} />
          )}
        </ChartCard>

        {/* Payment mix */}
        <ChartCard
          title={t("todaySales.charts.paymentTitle")}
          hint={t("todaySales.charts.paymentHint")}
          empty={!paymentChart}
          emptyText={t("todaySales.charts.noSales")}
          height={300}
        >
          {paymentChart && (
            <Chart options={paymentChart.options} series={paymentChart.series} type="donut" height={300} />
          )}
        </ChartCard>

        {/* Top products */}
        <ChartCard
          title={t("todaySales.charts.productTitle")}
          hint={t("todaySales.charts.productHint")}
          empty={!productChart}
          emptyText={t("todaySales.charts.noSales")}
          height={300}
        >
          {productChart && (
            <Chart options={productChart.options} series={productChart.series} type="bar" height={300} />
          )}
        </ChartCard>

        {/* Category mix */}
        <ChartCard
          title={t("todaySales.charts.categoryTitle")}
          hint={t("todaySales.charts.categoryHint")}
          empty={!categoryChart}
          emptyText={t("todaySales.charts.noSales")}
          height={300}
        >
          {categoryChart && (
            <Chart options={categoryChart.options} series={categoryChart.series} type="donut" height={300} />
          )}
        </ChartCard>

        {/* Drawer flow */}
        <ChartCard
          title={t("todaySales.charts.drawerTitle")}
          hint={t("todaySales.charts.drawerHint")}
          height={280}
        >
          {drawerChart && (
            <Chart options={drawerChart.options} series={drawerChart.series} type="bar" height={280} />
          )}
        </ChartCard>

        {/* Expenses by type */}
        <ChartCard
          title={t("todaySales.charts.expenseTitle")}
          hint={t("todaySales.charts.expenseHint")}
          empty={!expenseChart}
          emptyText={t("todaySales.charts.noExpenses")}
          height={280}
        >
          {expenseChart && (
            <Chart options={expenseChart.options} series={expenseChart.series} type="donut" height={280} />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
