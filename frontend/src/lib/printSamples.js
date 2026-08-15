import { buildLabelSheet } from "@/lib/barcode";
import { buildInvoiceHtml } from "@/lib/invoicePrint";
import { buildReportHtml } from "@/lib/reportPrint";
import { mediaUrl } from "@/lib/products";
import { resolveInvoiceLanguage } from "@/lib/settings";

function invoiceLabels(tInv) {
  return {
    title: tInv("pos.invoice.title"),
    paidBadge: tInv("pos.invoice.paidBadge"),
    billTo: tInv("pos.invoice.billTo"),
    sellerName: tInv("pos.invoice.sellerName"),
    payment: tInv("pos.invoice.payment"),
    item: tInv("pos.invoice.item"),
    qty: tInv("pos.table.qty"),
    price: tInv("pos.table.price"),
    total: tInv("pos.table.total"),
    subtotal: tInv("pos.invoice.subtotal"),
    discount: tInv("pos.stats.discount"),
    totalLabel: tInv("pos.stats.total"),
    paid: tInv("pos.payment.paid"),
    changeRaw: tInv("pos.payment.changeRaw"),
    changeExact: tInv("pos.payment.changeExact"),
    thanks: tInv("pos.invoice.thanks"),
  };
}

function locOf(isAr) {
  return isAr ? "ar-EG" : "en-US";
}

function moneyFn(isAr, currency) {
  return (n) =>
    `${Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency || ""}`.trim();
}

function num2Fn(isAr) {
  return (n) =>
    Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
}

// One real-looking barcode label (name + code + price) using the barcode profile.
export function sampleBarcodeHtml({ t, isAr, currency, profile }) {
  return buildLabelSheet({
    rows: [
      {
        name: t("settings.printer.sample.productTee"),
        code: "CTRL-TEE-001",
        price: 349.99,
        count: 1,
      },
    ],
    currency: currency || "EGP",
    profile,
  });
}

// A cash POS invoice with two clothing lines — same layout as a real checkout.
function firstNameOf(fullName) {
  return String(fullName || "").trim().split(/\s+/).filter(Boolean)[0] || "";
}

export function sampleInvoiceHtml({ t, i18n, brand, general, profile, user }) {
  const invLang = resolveInvoiceLanguage(general?.invoice_language, i18n.resolvedLanguage);
  const isAr = invLang === "ar";
  const tInv = i18n.getFixedT(invLang);
  const currency = general?.currency || "EGP";
  const money = moneyFn(isAr, currency);
  const num2 = num2Fn(isAr);
  const logo = general?.invoice_logo ? mediaUrl(general.invoice_logo) : brand?.logo;

  const inv = {
    invoice_no: "INV-TEST-0001",
    created_at: new Date().toISOString(),
    customer_name: tInv("settings.printer.sample.customer"),
    seller_name: firstNameOf(user?.full_name),
    customer_phone: "+201099379989",
    payment_method: isAr ? "نقدي" : "Cash",
    items: [
      {
        name: tInv("settings.printer.sample.productTee"),
        attributes: [
          { value_en: "Black", value_ar: "أسود" },
          { value_en: "L", value_ar: "L" },
        ],
        quantity: 2,
        unit_price: 349.99,
        line_total: 699.98,
      },
      {
        name: tInv("settings.printer.sample.productJeans"),
        attributes: [
          { value_en: "Indigo", value_ar: "نيلي" },
          { value_en: "32", value_ar: "32" },
        ],
        quantity: 1,
        unit_price: 599,
        line_total: 599,
      },
    ],
    subtotal: 1298.98,
    discount: 50,
    total: 1248.98,
    paid: 1300,
    changeExact: 51.02,
    changeRaw: 51.02,
  };

  return buildInvoiceHtml({
    inv,
    brand: { ...brand, logo, address: general?.branch_address || "" },
    isAr,
    isCash: true,
    labels: invoiceLabels(tInv),
    profile,
    money,
    num2,
  });
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthKey(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function sampleReportData({ currency, generatedBy }) {
  const to = isoDaysAgo(0);
  const from = isoDaysAgo(6);
  const prevTo = isoDaysAgo(7);
  const prevFrom = isoDaysAgo(13);
  const dailyAmt = [4200, 5100, 3800, 6400, 7200, 8900, 6100];
  const daily = dailyAmt.map((amount, i) => ({
    date: isoDaysAgo(6 - i),
    count: 8 + i,
    amount,
    profit: Math.round(amount * 0.38),
  }));
  const summary = {
    sales_count: 74,
    sales_amount: 41700,
    subtotal: 43200,
    discount: 1500,
    items: 186,
    avg_ticket: 563.51,
    gross_profit: 15846,
    margin_pct: 38,
    expenses: 4200,
    net_profit: 11646,
    cash: 25100,
    card: 16600,
    cost: 25854,
  };
  const previous = {
    sales_count: 61,
    sales_amount: 35200,
    subtotal: 36400,
    discount: 1200,
    items: 154,
    avg_ticket: 577.05,
    gross_profit: 12900,
    margin_pct: 36.6,
    expenses: 3900,
    net_profit: 9000,
    cash: 21000,
    card: 14200,
    cost: 22300,
  };
  const deltas = Object.fromEntries(
    Object.keys(summary).map((k) => {
      const a = summary[k];
      const b = previous[k] || 0;
      return [k, b ? ((a - b) / Math.abs(b)) * 100 : 0];
    })
  );

  return {
    currency: currency || "EGP",
    generated_at: new Date().toISOString(),
    generated_by: generatedBy || { username: "admin", full_name: "CTRL" },
    range: { from, to, days: 7 },
    previous_range: { from: prevFrom, to: prevTo },
    summary,
    previous,
    deltas,
    customers_served: 48,
    new_customers: 11,
    daily,
    monthly: [
      { month: monthKey(2), count: 210, sales: 118000, profit: 43000, expenses: 14000 },
      { month: monthKey(1), count: 248, sales: 141000, profit: 52000, expenses: 15500 },
      { month: monthKey(0), count: 74, sales: 41700, profit: 15846, expenses: 4200 },
    ],
    hourly: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      count: h >= 10 && h <= 21 ? 4 : 0,
      amount: h >= 10 && h <= 21 ? 800 + h * 90 : 0,
    })),
    weekday: [
      { dow: 0, count: 6, amount: 4200 },
      { dow: 1, count: 11, amount: 6100 },
      { dow: 2, count: 10, amount: 5800 },
      { dow: 3, count: 9, amount: 5400 },
      { dow: 4, count: 12, amount: 7200 },
      { dow: 5, count: 14, amount: 8100 },
      { dow: 6, count: 12, amount: 4900 },
    ],
    payments: [
      { code: "cash", name_en: "Cash", name_ar: "نقدي", count: 41, amount: 25100 },
      { code: "card", name_en: "Bank Card", name_ar: "بطاقة بنكية", count: 33, amount: 16600 },
    ],
    categories: [
      { name_en: "T-Shirts", name_ar: "تيشيرت", quantity: 72, amount: 18400, profit: 7200, margin_pct: 39.1 },
      { name_en: "Jeans", name_ar: "جينز", quantity: 38, amount: 15200, profit: 5600, margin_pct: 36.8 },
      { name_en: "Jackets", name_ar: "جاكيت", quantity: 16, amount: 8100, profit: 3046, margin_pct: 37.6 },
    ],
    products: [
      { code: "CTRL-TEE-001", name: "Classic Cotton Tee", quantity: 28, amount: 9797, profit: 3920, margin_pct: 40 },
      { code: "CTRL-JNS-032", name: "Slim Fit Jeans", quantity: 14, amount: 8386, profit: 3010, margin_pct: 35.9 },
      { code: "CTRL-JKT-008", name: "Light Bomber Jacket", quantity: 7, amount: 6293, profit: 2380, margin_pct: 37.8 },
    ],
    customers: [
      { name: "Ahmed Hassan", phone: "+201099379989", orders: 4, items: 9, amount: 2840 },
      { name: "Sara Ali", phone: "+201111223344", orders: 3, items: 6, amount: 1910 },
    ],
    staff: [
      { username: "cashier", full_name: "Mona Saleh", orders: 46, items: 112, amount: 25100, discount: 820, avg_ticket: 545.65 },
      { username: "admin", full_name: "CTRL Admin", orders: 28, items: 74, amount: 16600, discount: 680, avg_ticket: 592.86 },
    ],
    expenses_by_type: [
      { type: "rent", name: null, count: 1, amount: 2500 },
      { type: "utilities", name: null, count: 2, amount: 900 },
      { type: "other", name: "Packaging", count: 3, amount: 800 },
    ],
    expenses: [
      { date: isoDaysAgo(2), user: "admin", type: "rent", name: null, amount: 2500, note: "Shop rent" },
      { date: isoDaysAgo(1), user: "admin", type: "utilities", name: null, amount: 450, note: "Electricity" },
    ],
    suppliers: [{ name: "Nile Textiles", invoices: 2, amount: 18400 }],
    supplier_invoices: [
      { date: isoDaysAgo(5), supplier: "Nile Textiles", name: "Summer restock", quantity: 80, amount: 18400 },
    ],
    funds: [
      { date: isoDaysAgo(6), amount: 5000, created_by: "admin", note: "Opening float" },
      { date: isoDaysAgo(0), amount: -800, created_by: "admin", note: "Owner draw" },
    ],
    inventory: {
      products: 48,
      variants: 162,
      stock_qty: 940,
      stock_units: 310,
      cost_value: 86200,
      retail_value: 148500,
      potential_profit: 62300,
      out_of_stock: 4,
      low_stock: 7,
      by_category: [
        { name_en: "T-Shirts", name_ar: "تيشيرت", quantity: 420, cost: 28000, retail: 50400 },
        { name_en: "Jeans", name_ar: "جينز", quantity: 210, cost: 32000, retail: 54600 },
      ],
      low_stock_items: [
        { name: "Classic Cotton Tee", code: "CTRL-TEE-001", quantity: 3, price: 349.99 },
        { name: "Slim Fit Jeans", code: "CTRL-JNS-032", quantity: 2, price: 599 },
      ],
    },
    business: {
      gross_value: 148500,
      supplier_paid_total: 86200,
      supplier_paid_range: 18400,
      funds_total: 4200,
      funds_range: 4200,
    },
    invoices: [
      {
        invoice_no: "INV-1042",
        created_at: new Date().toISOString(),
        customer: "Ahmed Hassan",
        payment: "Cash",
        user: "cashier",
        items: 3,
        discount: 50,
        total: 1248.98,
        is_backtrack: false,
      },
    ],
    invoice_total: 74,
    limits: { invoices: 200, products: 50 },
  };
}

export function sampleReportHtml({ t, i18n, brand, general, profile, user }) {
  const isAr = i18n.resolvedLanguage === "ar";
  const loc = locOf(isAr);
  const currency = general?.currency || "EGP";
  const money = moneyFn(isAr, currency);
  const num = (n) => Number(n || 0).toLocaleString(loc);
  const pctFmt = (n) => `${Number(n || 0).toLocaleString(loc, { maximumFractionDigits: 1 })}%`;
  const dateFmt = (s) =>
    new Date(s).toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" });
  const dayLabel = (s) => new Date(s).toLocaleDateString(loc, { day: "numeric", month: "short" });
  const monthLabel = (s) => {
    const [y, m] = String(s).split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(loc, { month: "short", year: "2-digit" });
  };
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + i).toLocaleDateString(loc, { weekday: "short" })
  );
  const logo = general?.report_logo ? mediaUrl(general.report_logo) : brand?.logo;

  return buildReportHtml({
    data: sampleReportData({
      currency,
      generatedBy: { username: user?.username || "admin", full_name: user?.full_name || user?.username },
    }),
    brand: { ...brand, logo, address: general?.branch_address || "" },
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
  });
}
