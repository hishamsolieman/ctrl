/**
 * Printable business report — a standalone multi-page A4 document.
 *
 * Everything here is plain HTML + inline SVG with its own <style>: the document
 * is written into a detached iframe for printing, so no React, no ApexCharts and
 * no external assets are available at that point. Charts are therefore hand-built
 * SVG, which also means they survive "print to PDF" and physical printers alike.
 *
 * `t` is passed in (rather than a flat labels object) because the report carries
 * well over a hundred strings across its ten pages.
 */
import { pageRule } from "@/lib/barcode";

// Print palette: readable on white paper, brand green kept as the lead colour.
const C = {
  accent: "#6FBF17",
  accentSoft: "#EAF7D6",
  ink: "#111827",
  soft: "#4B5563",
  muted: "#6B7280",
  grid: "#E5E7EB",
  line: "#D1D5DB",
  good: "#15803D",
  bad: "#B91C1C",
};

const PALETTE = [
  "#6FBF17",
  "#2563EB",
  "#DB2777",
  "#F59E0B",
  "#0891B2",
  "#7C3AED",
  "#DC2626",
  "#059669",
  "#4B5563",
];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const NBSP = "\u00A0";

// --- charts ----------------------------------------------------------------
function niceMax(v) {
  if (!v || v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function svgWrap(w, h, inner) {
  return (
    `<svg class="cht" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" ` +
    `xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${inner}</svg>`
  );
}

function axes(w, h, pad, max, fmt) {
  const ticks = 4;
  let g = "";
  for (let i = 0; i <= ticks; i++) {
    const y = pad.t + ((h - pad.t - pad.b) * i) / ticks;
    const val = max * (1 - i / ticks);
    g +=
      `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${w - pad.r}" y2="${y.toFixed(1)}" ` +
      `stroke="${C.grid}" stroke-width="0.8"/>` +
      `<text x="${pad.l - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="${C.muted}">` +
      `${esc(fmt(val))}</text>`;
  }
  return g;
}

// Vertical bars (optionally with a second overlaid series drawn as a line).
function barChart({ rows, height = 150, fmt, labelEvery, line }) {
  const w = 520;
  const h = height;
  const pad = { l: 46, r: 10, t: 10, b: 24 };
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.value, line ? r.line || 0 : 0)), 0));
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const step = iw / Math.max(1, rows.length);
  const bw = Math.max(1.5, Math.min(26, step * 0.62));
  const every = labelEvery || Math.ceil(rows.length / 12);

  let bars = "";
  let pts = [];
  rows.forEach((r, i) => {
    const cx = pad.l + step * i + step / 2;
    const bh = max ? (Math.max(0, r.value) / max) * ih : 0;
    bars +=
      `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(pad.t + ih - bh).toFixed(1)}" ` +
      `width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" fill="${C.accent}" rx="1.5"/>`;
    if (i % every === 0 || i === rows.length - 1) {
      bars +=
        `<text x="${cx.toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="7.5" ` +
        `fill="${C.muted}">${esc(r.label)}</text>`;
    }
    if (line) pts.push(`${cx.toFixed(1)},${(pad.t + ih - (max ? ((r.line || 0) / max) * ih : 0)).toFixed(1)}`);
  });

  const overlay = line
    ? `<polyline points="${pts.join(" ")}" fill="none" stroke="${C.ink}" stroke-width="1.4" ` +
      `stroke-linejoin="round"/>`
    : "";

  return svgWrap(
    w,
    h,
    axes(w, h, pad, max, fmt) +
      bars +
      overlay +
      `<line x1="${pad.l}" y1="${pad.t + ih}" x2="${w - pad.r}" y2="${pad.t + ih}" stroke="${C.line}" stroke-width="1"/>`
  );
}

// Area + line, used for cumulative/trend series.
function areaChart({ rows, height = 150, fmt, labelEvery }) {
  const w = 520;
  const h = height;
  const pad = { l: 46, r: 10, t: 10, b: 24 };
  const max = niceMax(Math.max(...rows.map((r) => r.value), 0));
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const step = rows.length > 1 ? iw / (rows.length - 1) : 0;
  const every = labelEvery || Math.ceil(rows.length / 10);

  const pts = rows.map((r, i) => {
    const x = pad.l + step * i;
    const y = pad.t + ih - (max ? (Math.max(0, r.value) / max) * ih : 0);
    return [x, y];
  });
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area =
    `M ${pad.l},${pad.t + ih} ` +
    pts.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(" ") +
    ` L ${(pad.l + step * (rows.length - 1)).toFixed(1)},${pad.t + ih} Z`;

  let labels = "";
  rows.forEach((r, i) => {
    if (i % every === 0 || i === rows.length - 1) {
      labels +=
        `<text x="${(pad.l + step * i).toFixed(1)}" y="${h - 8}" text-anchor="middle" ` +
        `font-size="7.5" fill="${C.muted}">${esc(r.label)}</text>`;
    }
  });

  return svgWrap(
    w,
    h,
    axes(w, h, pad, max, fmt) +
      `<path d="${area}" fill="${C.accentSoft}"/>` +
      `<polyline points="${poly}" fill="none" stroke="${C.accent}" stroke-width="1.8" stroke-linejoin="round"/>` +
      labels +
      `<line x1="${pad.l}" y1="${pad.t + ih}" x2="${w - pad.r}" y2="${pad.t + ih}" stroke="${C.line}" stroke-width="1"/>`
  );
}

// Horizontal bars with the label inside the row — good for long product names.
function hBarChart({ rows, fmt }) {
  const w = 520;
  const rowH = 20;
  const h = Math.max(40, rows.length * rowH + 8);
  const labelW = 168;
  const max = niceMax(Math.max(...rows.map((r) => r.value), 0));
  const iw = w - labelW - 62;

  let out = "";
  rows.forEach((r, i) => {
    const y = 4 + i * rowH;
    const bw = max ? (Math.max(0, r.value) / max) * iw : 0;
    const label = String(r.label ?? "");
    out +=
      `<text x="0" y="${y + 12}" font-size="8" fill="${C.ink}">` +
      `${esc(label.length > 30 ? `${label.slice(0, 29)}…` : label)}</text>` +
      `<rect x="${labelW}" y="${y + 4}" width="${Math.max(0.6, bw).toFixed(1)}" height="10" ` +
      `fill="${PALETTE[i % PALETTE.length]}" rx="1.5"/>` +
      `<text x="${(labelW + bw + 4).toFixed(1)}" y="${y + 12}" font-size="7.5" fill="${C.soft}">` +
      `${esc(fmt(r.value))}</text>`;
  });
  return svgWrap(w, h, out);
}

// Donut with a legend column beside it.
function donutChart({ rows, fmt, total }) {
  const w = 520;
  const h = 170;
  const cx = 88;
  const cy = h / 2;
  const r = 54;
  const sw = 22;
  const circ = 2 * Math.PI * r;
  const sum = rows.reduce((s, x) => s + Math.max(0, x.value), 0);

  let arcs = "";
  let off = 0;
  rows.forEach((row, i) => {
    const frac = sum ? Math.max(0, row.value) / sum : 0;
    const len = frac * circ;
    arcs +=
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" ` +
      `stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" ` +
      `stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    off += len;
  });

  let legend = "";
  rows.forEach((row, i) => {
    const y = 18 + i * 16;
    const share = sum ? Math.round((Math.max(0, row.value) / sum) * 100) : 0;
    const label = String(row.label ?? "");
    legend +=
      `<rect x="196" y="${y - 7}" width="8" height="8" rx="2" fill="${PALETTE[i % PALETTE.length]}"/>` +
      `<text x="210" y="${y}" font-size="8.5" fill="${C.ink}">` +
      `${esc(label.length > 26 ? `${label.slice(0, 25)}…` : label)}</text>` +
      `<text x="${w}" y="${y}" text-anchor="end" font-size="8.5" fill="${C.soft}">` +
      `${esc(fmt(row.value))}${NBSP}·${NBSP}${share}%</text>`;
  });

  const middle = total
    ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="7.5" fill="${C.muted}">` +
      `${esc(total.label)}</text>` +
      `<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.ink}">` +
      `${esc(total.value)}</text>`
    : "";

  return svgWrap(w, h, arcs + middle + legend);
}

// --- building blocks -------------------------------------------------------
function table(headers, rows, { aligns = [], empty } = {}) {
  if (!rows.length) return `<p class="none">${esc(empty || "—")}</p>`;
  const th = headers
    .map((hd, i) => `<th class="${aligns[i] || "l"}">${esc(hd)}</th>`)
    .join("");
  const tb = rows
    .map(
      (r) =>
        `<tr>${r
          .map((cell, i) => {
            const a = aligns[i] || "l";
            const numeric = a === "r" || a === "c";
            return `<td class="${a}"${numeric ? ' dir="ltr"' : ""}>${cell}</td>`;
          })
          .join("")}</tr>`
    )
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
}

function kpiTile(label, value, sub) {
  return (
    `<div class="kpi"><div class="kl">${esc(label)}</div>` +
    `<div class="kv" dir="ltr">${esc(value)}</div>` +
    `${sub ? `<div class="ks">${esc(sub)}</div>` : ""}</div>`
  );
}

function delta(v, fmtPct) {
  if (v == null) return `<span class="dl">—</span>`;
  const up = v >= 0;
  return (
    `<span class="dl ${up ? "up" : "dn"}">${up ? "▲" : "▼"} ${esc(fmtPct(Math.abs(v)))}</span>`
  );
}

function section(title, hint, body) {
  return (
    `<div class="sec"><div class="st">${esc(title)}` +
    `${hint ? `<span class="sh">${esc(hint)}</span>` : ""}</div>${body}</div>`
  );
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun for reading order

/**
 * Build the printable report body.
 *
 * @param {object}   o
 * @param {object}   o.data     `/reports/business` payload
 * @param {object}   o.brand    { name, motto, logo }
 * @param {boolean}  o.isAr
 * @param {Function} o.t        i18next translator
 * @param {object|null} o.profile print profile (sizes the page; A4 when absent)
 * @param {Function} o.money    money formatter
 * @param {Function} o.num      integer formatter
 * @param {Function} o.pctFmt   percentage formatter
 * @param {Function} o.dateFmt  YYYY-MM-DD → localized date
 * @param {Function} o.dayLabel YYYY-MM-DD → short axis label
 * @param {Function} o.monthLabel YYYY-MM → short axis label
 * @param {string[]} o.weekdays  localized weekday names, Sunday first
 */
export function buildReportHtml({
  data,
  brand,
  isAr,
  t,
  profile,
  money,
  num,
  pctFmt,
  dateFmt,
  dayLabel,
  monthLabel,
  weekdays,
}) {
  const dir = isAr ? "rtl" : "ltr";
  const s = data.summary;
  const d = data.deltas || {};
  const inv = data.inventory;
  const rangeText = `${dateFmt(data.range.from)} → ${dateFmt(data.range.to)}`;
  const prevText = `${dateFmt(data.previous_range.from)} → ${dateFmt(data.previous_range.to)}`;
  const generated = new Date(data.generated_at).toLocaleString(isAr ? "ar-EG" : "en-US");

  // --- page 1: cover ------------------------------------------------------
  const cover =
    `<div class="cover">` +
    `<div class="cv-brand">` +
    `${brand?.logo ? `<img src="${esc(brand.logo)}" alt="">` : ""}` +
    `<div><div class="cv-nm">${esc(brand?.name || "")}</div>` +
    `${brand?.motto ? `<div class="cv-mt">${esc(brand.motto)}</div>` : ""}</div>` +
    `</div>` +
    `<div class="cv-mid">` +
    `<div class="cv-kicker">${esc(t("report.cover.kicker"))}</div>` +
    `<h1 class="cv-title">${esc(t("report.cover.title"))}</h1>` +
    `<div class="cv-range">${esc(rangeText)}</div>` +
    `<div class="cv-days">${esc(t("report.cover.days", { count: data.range.days }))}</div>` +
    `</div>` +
    `<div class="kpis cv-kpis">` +
    kpiTile(t("report.kpi.revenue"), money(s.sales_amount), t("report.kpi.revenueSub", { count: num(s.sales_count) })) +
    kpiTile(t("report.kpi.profit"), money(s.gross_profit), t("report.kpi.profitSub", { value: pctFmt(s.margin_pct) })) +
    kpiTile(t("report.kpi.net"), money(s.net_profit), t("report.kpi.netSub", { value: money(s.expenses) })) +
    kpiTile(t("report.kpi.orders"), num(s.sales_count), t("report.kpi.ordersSub", { count: num(s.items) })) +
    kpiTile(t("report.kpi.avgTicket"), money(s.avg_ticket), t("report.kpi.avgTicketSub")) +
    kpiTile(t("report.kpi.customers"), num(data.customers_served), t("report.kpi.customersSub", { count: num(data.new_customers) })) +
    `</div>` +
    `<div class="cv-meta">` +
    `<div><span>${esc(t("report.cover.generatedAt"))}</span><b dir="ltr">${esc(generated)}</b></div>` +
    `<div><span>${esc(t("report.cover.generatedBy"))}</span><b>${esc(
      data.generated_by.full_name || data.generated_by.username
    )}</b></div>` +
    `<div><span>${esc(t("report.cover.currency"))}</span><b>${esc(data.currency)}</b></div>` +
    `</div>`;

  // --- page 2: executive summary -----------------------------------------
  const cmpRows = [
    ["sales_amount", t("report.metrics.revenue"), money],
    ["sales_count", t("report.metrics.orders"), num],
    ["items", t("report.metrics.items"), num],
    ["avg_ticket", t("report.metrics.avgTicket"), money],
    ["discount", t("report.metrics.discount"), money],
    ["cost", t("report.metrics.cost"), money],
    ["gross_profit", t("report.metrics.grossProfit"), money],
    ["expenses", t("report.metrics.expenses"), money],
    ["net_profit", t("report.metrics.netProfit"), money],
    ["cash", t("report.metrics.cash"), money],
    ["card", t("report.metrics.card"), money],
  ].map(([key, label, fmt]) => [
    esc(label),
    esc(fmt(s[key])),
    esc(fmt(data.previous[key])),
    delta(d[key], pctFmt),
  ]);

  const summaryPage =
    section(
      t("report.sections.comparison"),
      t("report.sections.comparisonHint", { range: prevText }),
      table(
        [
          t("report.table.metric"),
          t("report.table.current"),
          t("report.table.previous"),
          t("report.table.change"),
        ],
        cmpRows,
        { aligns: ["l", "r", "r", "c"] }
      )
    ) +
    section(
      t("report.sections.monthly"),
      t("report.sections.monthlyHint"),
      data.monthly.length
        ? barChart({
            rows: data.monthly.map((m) => ({
              label: monthLabel(m.month),
              value: m.sales,
              line: m.profit,
            })),
            fmt: (v) => num(Math.round(v)),
            height: 140,
            line: true,
          }) +
          `<div class="lg"><span class="sw" style="background:${C.accent}"></span>${esc(
            t("report.legend.revenue")
          )}<span class="sw ln" style="background:${C.ink}"></span>${esc(t("report.legend.profit"))}</div>` +
          table(
            [
              t("report.table.month"),
              t("report.metrics.orders"),
              t("report.metrics.revenue"),
              t("report.metrics.grossProfit"),
              t("report.metrics.expenses"),
            ],
            data.monthly.map((m) => [
              esc(monthLabel(m.month)),
              esc(num(m.count)),
              esc(money(m.sales)),
              esc(money(m.profit)),
              esc(money(m.expenses)),
            ]),
            { aligns: ["l", "c", "r", "r", "r"] }
          )
        : `<p class="none">${esc(t("report.empty.sales"))}</p>`
    );

  // --- page 3: sales performance -----------------------------------------
  const salesPage =
    section(
      t("report.sections.daily"),
      t("report.sections.dailyHint"),
      data.daily.length
        ? areaChart({
            rows: data.daily.map((x) => ({ label: dayLabel(x.date), value: x.amount })),
            fmt: (v) => num(Math.round(v)),
            height: 150,
          })
        : `<p class="none">${esc(t("report.empty.sales"))}</p>`
    ) +
    section(
      t("report.sections.weekday"),
      t("report.sections.weekdayHint"),
      barChart({
        rows: WEEKDAY_ORDER.map((i) => ({
          label: weekdays[i],
          value: data.weekday[i]?.amount || 0,
        })),
        fmt: (v) => num(Math.round(v)),
        height: 130,
        labelEvery: 1,
      })
    ) +
    section(
      t("report.sections.hourly"),
      t("report.sections.hourlyHint"),
      barChart({
        rows: data.hourly.map((x) => ({
          label: String(x.hour).padStart(2, "0"),
          value: x.amount,
        })),
        fmt: (v) => num(Math.round(v)),
        height: 130,
        labelEvery: 2,
      })
    ) +
    section(
      t("report.sections.payments"),
      t("report.sections.paymentsHint"),
      data.payments.length
        ? donutChart({
            rows: data.payments.map((p) => ({
              label: isAr ? p.name_ar || p.name_en : p.name_en,
              value: p.amount,
            })),
            fmt: (v) => money(v),
            total: { label: t("report.legend.total"), value: num(Math.round(s.sales_amount)) },
          })
        : `<p class="none">${esc(t("report.empty.sales"))}</p>`
    );

  // --- page 4: products ---------------------------------------------------
  const productPage =
    section(
      t("report.sections.topProducts"),
      t("report.sections.topProductsHint"),
      data.products.length
        ? hBarChart({
            rows: data.products.slice(0, 10).map((p) => ({ label: p.name, value: p.amount })),
            fmt: (v) => money(v),
          })
        : `<p class="none">${esc(t("report.empty.products"))}</p>`
    ) +
    section(
      t("report.sections.productTable"),
      t("report.sections.productTableHint", { count: data.limits.products }),
      table(
        [
          "#",
          t("report.table.code"),
          t("report.table.product"),
          t("report.table.qty"),
          t("report.metrics.revenue"),
          t("report.metrics.grossProfit"),
          t("report.table.margin"),
        ],
        data.products.map((p, i) => [
          esc(num(i + 1)),
          `<span class="mono">${esc(p.code || "—")}</span>`,
          esc(p.name),
          esc(num(p.quantity)),
          esc(money(p.amount)),
          esc(money(p.profit)),
          esc(pctFmt(p.margin_pct)),
        ]),
        { aligns: ["c", "l", "l", "c", "r", "r", "c"], empty: t("report.empty.products") }
      )
    );

  // --- page 5: categories + customers ------------------------------------
  const categoryPage =
    section(
      t("report.sections.categories"),
      t("report.sections.categoriesHint"),
      data.categories.length
        ? donutChart({
            rows: data.categories.map((c) => ({
              label: isAr ? c.name_ar || c.name_en : c.name_en,
              value: c.amount,
            })),
            fmt: (v) => money(v),
            total: { label: t("report.legend.total"), value: num(Math.round(s.sales_amount)) },
          }) +
          table(
            [
              t("report.table.category"),
              t("report.table.qty"),
              t("report.metrics.revenue"),
              t("report.metrics.grossProfit"),
              t("report.table.margin"),
            ],
            data.categories.map((c) => [
              esc(isAr ? c.name_ar || c.name_en : c.name_en),
              esc(num(c.quantity)),
              esc(money(c.amount)),
              esc(money(c.profit)),
              esc(pctFmt(c.margin_pct)),
            ]),
            { aligns: ["l", "c", "r", "r", "c"] }
          )
        : `<p class="none">${esc(t("report.empty.products"))}</p>`
    ) +
    section(
      t("report.sections.customers"),
      t("report.sections.customersHint", {
        served: num(data.customers_served),
        added: num(data.new_customers),
      }),
      table(
        ["#", t("report.table.customer"), t("report.table.phone"), t("report.metrics.orders"), t("report.table.qty"), t("report.metrics.revenue")],
        data.customers.map((c, i) => [
          esc(num(i + 1)),
          esc(c.name),
          `<span class="mono">${esc(c.phone || "—")}</span>`,
          esc(num(c.orders)),
          esc(num(c.items)),
          esc(money(c.amount)),
        ]),
        { aligns: ["c", "l", "l", "c", "c", "r"], empty: t("report.empty.customers") }
      )
    );

  // --- page 6: team + inventory ------------------------------------------
  const teamPage =
    section(
      t("report.sections.staff"),
      t("report.sections.staffHint"),
      table(
        [
          t("report.table.user"),
          t("report.metrics.orders"),
          t("report.table.qty"),
          t("report.metrics.revenue"),
          t("report.metrics.discount"),
          t("report.metrics.avgTicket"),
        ],
        data.staff.map((u) => [
          `${esc(u.full_name || u.username)}<div class="sub mono">${esc(u.username)}</div>`,
          esc(num(u.orders)),
          esc(num(u.items)),
          esc(money(u.amount)),
          esc(money(u.discount)),
          esc(money(u.avg_ticket)),
        ]),
        { aligns: ["l", "c", "c", "r", "r", "r"], empty: t("report.empty.staff") }
      )
    ) +
    section(
      t("report.sections.inventory"),
      t("report.sections.inventoryHint"),
      `<div class="kpis inv-kpis">` +
        kpiTile(t("report.inventory.products"), num(inv.products), t("report.inventory.variants", { count: num(inv.variants) })) +
        kpiTile(t("report.inventory.onHand"), num(inv.stock_qty), t("report.inventory.units", { count: num(inv.stock_units) })) +
        kpiTile(t("report.inventory.cost"), money(inv.cost_value), t("report.inventory.costSub")) +
        kpiTile(t("report.inventory.retail"), money(inv.retail_value), t("report.inventory.retailSub", { value: money(inv.potential_profit) })) +
        kpiTile(t("report.inventory.out"), num(inv.out_of_stock), t("report.inventory.outSub")) +
        kpiTile(t("report.inventory.low"), num(inv.low_stock), t("report.inventory.lowSub")) +
        `</div>` +
        table(
          [t("report.table.category"), t("report.table.qty"), t("report.inventory.cost"), t("report.inventory.retail")],
          inv.by_category.map((c) => [
            esc(isAr ? c.name_ar || c.name_en : c.name_en),
            esc(num(c.quantity)),
            esc(money(c.cost)),
            esc(money(c.retail)),
          ]),
          { aligns: ["l", "c", "r", "r"], empty: t("report.empty.inventory") }
        )
    ) +
    section(
      t("report.sections.lowStock"),
      t("report.sections.lowStockHint"),
      table(
        [t("report.table.product"), t("report.table.code"), t("report.table.qty"), t("report.table.price")],
        inv.low_stock_items.map((x) => [
          esc(x.name),
          `<span class="mono">${esc(x.code)}</span>`,
          `<b class="${x.quantity <= 0 ? "bad" : ""}">${esc(num(x.quantity))}</b>`,
          esc(money(x.price)),
        ]),
        { aligns: ["l", "l", "c", "r"], empty: t("report.empty.lowStock") }
      )
    );

  // --- page 7: money out + capital ---------------------------------------
  const moneyPage =
    section(
      t("report.sections.expenses"),
      t("report.sections.expensesHint"),
      data.expenses_by_type.length
        ? donutChart({
            rows: data.expenses_by_type.map((e) => ({
              label: e.type === "other" ? e.name || t("expenses.types.other") : t(`expenses.types.${e.type}`),
              value: e.amount,
            })),
            fmt: (v) => money(v),
            total: { label: t("report.legend.total"), value: num(Math.round(s.expenses)) },
          }) +
          table(
            [t("report.table.type"), t("report.table.entries"), t("report.metrics.expenses")],
            data.expenses_by_type.map((e) => [
              esc(e.type === "other" ? e.name || t("expenses.types.other") : t(`expenses.types.${e.type}`)),
              esc(num(e.count)),
              esc(money(e.amount)),
            ]),
            { aligns: ["l", "c", "r"] }
          )
        : `<p class="none">${esc(t("report.empty.expenses"))}</p>`
    ) +
    section(
      t("report.sections.expenseList"),
      t("report.sections.expenseListHint"),
      table(
        [t("report.table.date"), t("report.table.user"), t("report.table.type"), t("report.metrics.expenses"), t("report.table.note")],
        data.expenses.map((e) => [
          `<span class="mono">${esc(e.date || "—")}</span>`,
          esc(e.user || "—"),
          esc(e.type === "other" ? e.name || t("expenses.types.other") : t(`expenses.types.${e.type}`)),
          esc(money(e.amount)),
          esc(e.note || "—"),
        ]),
        { aligns: ["l", "l", "l", "r", "l"], empty: t("report.empty.expenses") }
      )
    ) +
    section(
      t("report.sections.suppliers"),
      t("report.sections.suppliersHint"),
      table(
        [t("report.table.supplier"), t("report.table.invoices"), t("report.table.amount")],
        data.suppliers.map((x) => [esc(x.name), esc(num(x.invoices)), esc(money(x.amount))]),
        { aligns: ["l", "c", "r"], empty: t("report.empty.suppliers") }
      ) +
        table(
          [t("report.table.date"), t("report.table.supplier"), t("report.table.item"), t("report.table.qty"), t("report.table.amount")],
          data.supplier_invoices.map((x) => [
            `<span class="mono">${esc(x.date || "—")}</span>`,
            esc(x.supplier),
            esc(x.name),
            esc(num(x.quantity)),
            esc(money(x.amount)),
          ]),
          { aligns: ["l", "l", "l", "c", "r"], empty: t("report.empty.suppliers") }
        )
    ) +
    section(
      t("report.sections.capital"),
      t("report.sections.capitalHint"),
      `<div class="kpis inv-kpis">` +
        kpiTile(t("report.capital.gross"), money(data.business.gross_value), t("report.capital.grossSub")) +
        kpiTile(t("report.capital.supplierTotal"), money(data.business.supplier_paid_total), t("report.capital.supplierRange", { value: money(data.business.supplier_paid_range) })) +
        kpiTile(t("report.capital.funds"), money(data.business.funds_total), t("report.capital.fundsRange", { value: money(data.business.funds_range) })) +
        `</div>` +
        table(
          [t("report.table.date"), t("report.table.amount"), t("report.table.user"), t("report.table.note")],
          data.funds.map((f) => [
            `<span class="mono">${esc(f.date || "—")}</span>`,
            `<b class="${f.amount < 0 ? "bad" : "good"}">${f.amount < 0 ? "−" : "+"}${esc(money(Math.abs(f.amount)))}</b>`,
            esc(f.created_by || "—"),
            esc(f.note || "—"),
          ]),
          { aligns: ["l", "r", "l", "l"], empty: t("report.empty.funds") }
        )
    );

  // --- page 8: invoice log ------------------------------------------------
  const invoicePage = section(
    t("report.sections.invoices"),
    data.invoice_total > data.invoices.length
      ? t("report.sections.invoicesCapped", {
          shown: num(data.invoices.length),
          total: num(data.invoice_total),
        })
      : t("report.sections.invoicesHint", { count: num(data.invoice_total) }),
    table(
      [
        t("report.table.invoice"),
        t("report.table.date"),
        t("report.table.customer"),
        t("report.table.payment"),
        t("report.table.user"),
        t("report.table.qty"),
        t("report.metrics.discount"),
        t("report.table.total"),
      ],
      data.invoices.map((x) => [
        `<span class="mono">${esc(x.invoice_no)}</span>${x.is_backtrack ? `<span class="tag">${esc(t("report.table.backtrack"))}</span>` : ""}`,
        `<span class="mono">${esc((x.created_at || "").replace("T", " ").slice(0, 16))}</span>`,
        esc(x.customer || "—"),
        esc(x.payment || "—"),
        esc(x.user || "—"),
        esc(num(x.items)),
        esc(money(x.discount)),
        `<b>${esc(money(x.total))}</b>`,
      ]),
      { aligns: ["l", "l", "l", "l", "l", "c", "r", "r"], empty: t("report.empty.sales") }
    )
  );

  // --- assemble -----------------------------------------------------------
  const pages = [
    { body: cover, cover: true },
    { body: summaryPage, title: t("report.pages.summary") },
    { body: salesPage, title: t("report.pages.sales") },
    { body: productPage, title: t("report.pages.products") },
    { body: categoryPage, title: t("report.pages.categories") },
    { body: teamPage, title: t("report.pages.operations") },
    { body: moneyPage, title: t("report.pages.finance") },
    { body: invoicePage, title: t("report.pages.invoices") },
  ];

  const total = pages.length;
  const html = pages
    .map((p, i) => {
      const head = p.cover
        ? ""
        : `<div class="ph"><span class="ph-b">${esc(brand?.name || "")}</span>` +
          `<span class="ph-t">${esc(p.title)}</span>` +
          `<span class="ph-r" dir="ltr">${esc(rangeText)}</span></div>`;
      const foot =
        `<div class="pf"><span>${esc(t("report.footer.confidential"))}</span>` +
        `<span dir="ltr">${esc(generated)}</span>` +
        `<span>${esc(t("report.footer.page", { page: num(i + 1), total: num(total) }))}</span></div>`;
      return `<section class="pg${p.cover ? " pg-cover" : ""}">${head}<div class="pb">${p.body}</div>${foot}</section>`;
    })
    .join("");

  const style =
    `<style>` +
    (profile ? pageRule(profile) : `@page { size: A4; margin: 12mm; }`) +
    `html,body{margin:0;padding:0;background:#fff;color:${C.ink};` +
    `-webkit-print-color-adjust:exact;print-color-adjust:exact;}` +
    `*{box-sizing:border-box;}` +
    `body{font-family:'Poppins',system-ui,Segoe UI,Arial,sans-serif;font-size:9.5px;line-height:1.45;}` +
    `.pg{position:relative;display:flex;flex-direction:column;min-height:262mm;page-break-after:always;}` +
    `.pg:last-child{page-break-after:auto;}` +
    `.pb{flex:1;}` +
    `.ph{display:flex;justify-content:space-between;align-items:baseline;gap:8px;` +
    `border-bottom:1.5px solid ${C.ink};padding-bottom:4px;margin-bottom:9px;}` +
    `.ph-b{font-weight:800;letter-spacing:1px;font-size:10px;}` +
    `.ph-t{font-size:11px;font-weight:700;color:${C.ink};text-transform:uppercase;letter-spacing:1.5px;}` +
    `.ph-r{font-size:8px;color:${C.muted};}` +
    `.pf{display:flex;justify-content:space-between;gap:8px;border-top:1px solid ${C.line};` +
    `margin-top:8px;padding-top:4px;font-size:7.5px;color:${C.muted};}` +
    // cover
    `.pg-cover{justify-content:space-between;}` +
    `.cover{display:flex;flex-direction:column;gap:10mm;}` +
    `.cv-brand{display:flex;align-items:center;gap:10px;border-bottom:2px solid ${C.accent};padding-bottom:8px;}` +
    `.cv-brand img{height:54px;width:54px;object-fit:contain;}` +
    `.cv-nm{font-size:22px;font-weight:800;letter-spacing:1px;}` +
    `.cv-mt{font-size:10px;color:${C.muted};letter-spacing:2px;text-transform:uppercase;}` +
    `.cv-mid{margin-top:6mm;}` +
    `.cv-kicker{font-size:9px;letter-spacing:4px;text-transform:uppercase;color:${C.accent};font-weight:700;}` +
    `.cv-title{font-size:34px;line-height:1.1;margin:2mm 0 3mm;font-weight:800;letter-spacing:-0.5px;}` +
    `.cv-range{font-size:14px;font-weight:600;}` +
    `.cv-days{font-size:9px;color:${C.muted};margin-top:1mm;}` +
    `.cv-kpis{margin-top:2mm;}` +
    `.cv-meta{margin-top:8mm;border-top:1px solid ${C.line};padding-top:4mm;display:flex;` +
    `justify-content:space-between;gap:10px;font-size:9px;}` +
    `.cv-meta span{display:block;color:${C.muted};font-size:7.5px;text-transform:uppercase;letter-spacing:1px;}` +
    // kpi tiles
    `.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;}` +
    `.inv-kpis{margin-bottom:3mm;}` +
    `.kpi{border:1px solid ${C.line};border-inline-start:3px solid ${C.accent};border-radius:2mm;padding:2.5mm 3mm;}` +
    `.kl{font-size:7.5px;text-transform:uppercase;letter-spacing:1px;color:${C.muted};}` +
    `.kv{font-size:15px;font-weight:800;margin-top:0.6mm;}` +
    `.ks{font-size:7.5px;color:${C.soft};margin-top:0.4mm;}` +
    // sections
    `.sec{margin-bottom:5mm;break-inside:avoid;}` +
    `.st{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;` +
    `border-bottom:1px solid ${C.line};padding-bottom:2px;margin-bottom:2.5mm;` +
    `display:flex;justify-content:space-between;align-items:baseline;gap:8px;}` +
    `.sh{font-size:7.5px;font-weight:500;letter-spacing:0;text-transform:none;color:${C.muted};}` +
    `.cht{display:block;margin:0 auto 2mm;}` +
    `.lg{font-size:7.5px;color:${C.soft};display:flex;gap:4px;align-items:center;margin-bottom:2mm;}` +
    `.sw{display:inline-block;width:8px;height:8px;border-radius:2px;}` +
    `.sw.ln{margin-inline-start:10px;height:2px;border-radius:0;}` +
    // tables
    `table{width:100%;border-collapse:collapse;font-size:8.5px;margin-bottom:2mm;}` +
    `thead{display:table-header-group;}` +
    `th{background:${C.accentSoft};border-bottom:1px solid ${C.ink};padding:1.6mm 1.2mm;` +
    `font-size:7.5px;text-transform:uppercase;letter-spacing:0.6px;color:${C.ink};}` +
    `td{padding:1.4mm 1.2mm;border-bottom:0.5px solid ${C.grid};vertical-align:top;}` +
    `tbody tr:nth-child(even) td{background:#FAFAFA;}` +
    `th.l,td.l{text-align:start;} th.c,td.c{text-align:center;} th.r,td.r{text-align:end;}` +
    `.mono{font-family:'Courier New',monospace;font-size:8px;}` +
    `.sub{font-size:7px;color:${C.muted};}` +
    `.none{font-size:8.5px;color:${C.muted};font-style:italic;padding:2mm 0;}` +
    `.dl{font-weight:700;font-size:8px;}` +
    `.dl.up{color:${C.good};} .dl.dn{color:${C.bad};}` +
    `.good{color:${C.good};} .bad{color:${C.bad};}` +
    `.tag{display:inline-block;border:0.5px solid ${C.soft};border-radius:6px;padding:0 3px;` +
    `font-size:6.5px;margin-inline-start:3px;text-transform:uppercase;letter-spacing:0.5px;}` +
    `</style>`;

  return `${style}<div dir="${dir}">${html}</div>`;
}
