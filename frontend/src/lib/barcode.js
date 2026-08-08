import JsBarcode from "jsbarcode";

// --- units -----------------------------------------------------------------
const MM = { mm: 1, cm: 10, in: 25.4 };
const toMm = (v, unit) => Number(v || 0) * (MM[unit] || 1);
const PX_PER_MM = 96 / 25.4; // CSS px at 96dpi
const mmToPx = (mm) => mm * PX_PER_MM;

// Physical size (mm) of the known standard papers we expose in the profile UI.
const STANDARD_MM = {
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  Letter: [215.9, 279.4],
  "80mm": [80, 120],
  "58mm": [58, 100],
};

// CSS names that `@page { size: ... }` understands natively.
const CSS_PAGE_NAMES = new Set(["A4", "A5", "A6", "Letter"]);

const DEFAULT_PROFILE = { size_mode: "custom", width: 50, height: 30, unit: "mm" };

// Page dimensions in mm for any profile shape.
function dimsMm(profile) {
  const p = profile || DEFAULT_PROFILE;
  if (p.size_mode === "custom" && p.width && p.height) {
    return [toMm(p.width, p.unit), toMm(p.height, p.unit)];
  }
  return STANDARD_MM[p.standard_size] || STANDARD_MM.A6;
}

// Margin: 1%–2% of the smaller side, scaling from 2% (≤50mm) down to 1% (≥150mm).
export function marginMm(profile) {
  const [w, h] = dimsMm(profile);
  const minSide = Math.min(w, h);
  let pct;
  if (minSide <= 50) pct = 0.02;
  else if (minSide >= 150) pct = 0.01;
  else pct = 0.02 - ((minSide - 50) / 100) * 0.01;
  return Math.max(0.5, minSide * pct); // never below 0.5mm
}

// CSS `@page { size: ... }` value for the profile.
function pageSizeCss(profile) {
  const p = profile || DEFAULT_PROFILE;
  if (p.size_mode === "custom" && p.width && p.height) {
    return `${p.width}${p.unit} ${p.height}${p.unit}`;
  }
  if (CSS_PAGE_NAMES.has(p.standard_size)) return p.standard_size;
  const [w, h] = dimsMm(profile);
  return `${w}mm ${h}mm`;
}

// CSS `@page` rule for a profile. With no profile, only a sensible margin is
// set so the OS uses the default printer's default paper size.
export function pageRule(profile) {
  if (!profile) return "@page { margin: 8mm; }";
  const m = marginMm(profile);
  return `@page { size: ${pageSizeCss(profile)}; margin: ${m.toFixed(2)}mm; }`;
}

// Render a CODE128 barcode to a standalone SVG markup string.
export function barcodeSvg(value, { widthPx = 180, heightPx = 60, fontSize = 14, displayValue = true } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const moduleWidth = Math.min(4, Math.max(0.8, widthPx / 150));
  try {
    JsBarcode(svg, String(value), {
      format: "CODE128",
      width: moduleWidth,
      height: heightPx,
      displayValue,
      fontSize,
      textMargin: Math.max(1, Math.round(fontSize * 0.15)),
      margin: 2,
      background: "#ffffff",
      lineColor: "#000000",
    });
  } catch {
    return "";
  }
  return new XMLSerializer().serializeToString(svg);
}

// Currency-prefixed amount, e.g. "EGP 199.99".
export function money(n, currency) {
  return `${currency} ${Number(n || 0).toFixed(2)}`.trim();
}

// Physical info about a profile's label, for previews and hints.
export function labelInfo(profile) {
  const [w, h] = dimsMm(profile);
  const r = (n) => Math.round(n * 10) / 10;
  return { w, h, ratio: w / h, size: `${r(w)}×${r(h)} mm`, margin: r(marginMm(profile)) };
}

// One <div class="lbl"> for a single physical label.
function labelHtml({ name, code, price, salePrice, currency, sizes }) {
  const hasDiscount = salePrice != null && Number(salePrice) < Number(price);
  const priceHtml = hasDiscount
    ? `<span class="old">${money(price, currency)}</span>` +
      `<span class="new">${money(salePrice, currency)}</span>`
    : `<span class="new">${money(price, currency)}</span>`;
  const svg = barcodeSvg(code, {
    widthPx: sizes.barW,
    heightPx: sizes.barH,
    fontSize: sizes.codeFont,
  });
  return (
    `<div class="lbl">` +
    `<div class="nm" dir="auto">${escapeHtml(name)}</div>` +
    `<div class="bc">${svg}</div>` +
    `<div class="pr">${priceHtml}</div>` +
    `</div>`
  );
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Build the full printable body: <style> (with @page) + one page per copy.
// `rows`: [{ name, code, price, salePrice?, count }]. `count` = how many copies.
export function buildLabelSheet({ rows, currency, profile }) {
  const [wMm, hMm] = dimsMm(profile);
  const m = marginMm(profile);
  const contentWmm = Math.max(1, wMm - 2 * m);
  const contentHmm = Math.max(1, hMm - 2 * m);
  const contentHpx = mmToPx(contentHmm);
  const contentWpx = mmToPx(contentWmm);

  const sizes = {
    nameFont: Math.max(7, Math.round(contentHpx * 0.15)),
    priceFont: Math.max(7, Math.round(contentHpx * 0.15)),
    codeFont: Math.max(7, Math.round(contentHpx * 0.12)),
    barH: Math.max(20, Math.round(contentHpx * 0.4)),
    barW: Math.round(contentWpx * 0.92),
  };

  const labels = [];
  for (const r of rows) {
    const one = labelHtml({ ...r, currency, sizes });
    const n = Math.max(1, Math.min(1000, Math.floor(Number(r.count) || 1)));
    for (let i = 0; i < n; i++) labels.push(one);
  }

  const style =
    `<style>` +
    `@page { size: ${pageSizeCss(profile)}; margin: ${m.toFixed(2)}mm; }` +
    `html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}` +
    `*{box-sizing:border-box;}` +
    `.lbl{width:${contentWmm}mm;height:${contentHmm}mm;display:flex;flex-direction:column;` +
    `align-items:center;justify-content:space-evenly;text-align:center;overflow:hidden;` +
    `font-family:'Poppins',system-ui,Arial,sans-serif;color:#000;page-break-after:always;}` +
    `.lbl:last-child{page-break-after:auto;}` +
    `.nm{font-weight:700;line-height:1.1;font-size:${sizes.nameFont}px;width:100%;` +
    `overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}` +
    `.bc{display:flex;align-items:center;justify-content:center;width:100%;}` +
    `.bc svg{max-width:100%;height:auto;}` +
    `.pr{font-size:${sizes.priceFont}px;line-height:1.1;display:flex;gap:.4em;align-items:baseline;justify-content:center;flex-wrap:wrap;}` +
    `.pr .old{text-decoration:line-through;color:#666;font-weight:500;}` +
    `.pr .new{font-weight:700;}` +
    `</style>`;

  return style + labels.join("");
}
