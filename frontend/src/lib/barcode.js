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

// Custom height 0 (or omitted) = continuous thermal roll. Width still applies.
export function isRollProfile(profile) {
  if (!profile || profile.size_mode !== "custom") return false;
  return Number(profile.width) > 0 && !(Number(profile.height) > 0);
}

// Invoice-only: roll when height is 0, or when the named size is a thermal roll.
export function isInvoiceRoll(profile) {
  if (!profile) return false;
  if (isRollProfile(profile)) return true;
  const s = profile.standard_size;
  return profile.size_mode === "standard" && (s === "80mm" || s === "58mm");
}

// Physical width of an invoice roll (profile width, or 80/58mm named sizes).
export function invoiceRollWidth(profile) {
  if (!profile) return null;
  if (profile.size_mode === "custom" && Number(profile.width) > 0) {
    return { value: Number(profile.width), unit: profile.unit || "mm" };
  }
  if (profile.standard_size === "80mm") return { value: 80, unit: "mm" };
  if (profile.standard_size === "58mm") return { value: 58, unit: "mm" };
  return null;
}

// Page dimensions in mm for any profile shape.
function dimsMm(profile) {
  const p = profile || DEFAULT_PROFILE;
  if (p.size_mode === "custom" && Number(p.width) > 0) {
    const w = toMm(p.width, p.unit);
    const h = Number(p.height) > 0 ? toMm(p.height, p.unit) : w * 1.5;
    return [w, h];
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
// `roll: true` uses width only — length follows the content (thermal receipt).
function pageSizeCss(profile, { roll } = {}) {
  const p = profile || DEFAULT_PROFILE;
  const useRoll = roll || isRollProfile(p);
  if (useRoll) {
    if (p.size_mode === "custom" && Number(p.width) > 0) return `${p.width}${p.unit} auto`;
    if (p.standard_size === "80mm" || p.standard_size === "58mm") return `${p.standard_size} auto`;
    const [w] = dimsMm(p);
    return `${w}mm auto`;
  }
  if (p.size_mode === "custom" && Number(p.width) > 0 && Number(p.height) > 0) {
    return `${p.width}${p.unit} ${p.height}${p.unit}`;
  }
  if (CSS_PAGE_NAMES.has(p.standard_size)) return p.standard_size;
  const [w, h] = dimsMm(profile);
  return `${w}mm ${h}mm`;
}

// CSS `@page` rule for a profile. With no profile, only a sensible margin is
// set so the OS uses the default printer's default paper size.
export function pageRule(profile, opts = {}) {
  if (!profile) return "@page { margin: 8mm; }";
  const useRoll = opts.roll || isRollProfile(profile);
  const m = useRoll ? 2 : marginMm(profile);
  return `@page { size: ${pageSizeCss(profile, { roll: useRoll })}; margin: ${m.toFixed(2)}mm; }`;
}

function fitFontPx(availablePx, text, maxPx, minPx = 6) {
  const t = String(text || "");
  if (!t) return maxPx;
  const est = availablePx / (t.length * 0.62);
  return Math.max(minPx, Math.min(maxPx, Math.floor(est)));
}

// Render a CODE128 barcode to a standalone SVG markup string.
export function barcodeSvg(value, { widthPx = 180, heightPx = 60, fontSize = 14, displayValue = true } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const chars = Math.max(8, String(value || "").length);
  const moduleWidth = Math.min(2.4, Math.max(0.7, widthPx / (chars * 11)));
  try {
    JsBarcode(svg, String(value), {
      format: "CODE128",
      width: moduleWidth,
      height: heightPx,
      displayValue,
      fontSize,
      textMargin: Math.max(1, Math.round(fontSize * 0.15)),
      margin: 1,
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
  const oldTxt = money(price, currency);
  const newTxt = money(hasDiscount ? salePrice : price, currency);
  const priceHtml = hasDiscount
    ? `<span class="old">${oldTxt}</span><span class="new">${newTxt}</span>`
    : `<span class="new">${newTxt}</span>`;
  const svg = barcodeSvg(code, {
    widthPx: sizes.barW,
    heightPx: sizes.barH,
    fontSize: sizes.codeFont,
    displayValue: false,
  });
  return (
    `<div class="lbl${hasDiscount ? " disc" : ""}">` +
    `<div class="nm" dir="auto" style="font-size:${sizes.nameFont}px">${escapeHtml(name)}</div>` +
    `<div class="bc">${svg}</div>` +
    `<div class="cd" dir="ltr" style="font-size:${sizes.codeFont}px">${escapeHtml(code)}</div>` +
    `<div class="pr" style="font-size:${sizes.priceFont}px">${priceHtml}</div>` +
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

  const labels = [];
  for (const r of rows) {
    const hasDisc = r.salePrice != null && Number(r.salePrice) < Number(r.price);
    const priceText = hasDisc
      ? [money(r.price, currency), money(r.salePrice, currency)].sort((a, b) => b.length - a.length)[0]
      : money(r.price, currency);
    const sizes = {
      nameFont: fitFontPx(contentWpx, (r.name || "").slice(0, 32), Math.round(contentHpx * 0.12), 6),
      codeFont: fitFontPx(contentWpx, r.code, Math.round(contentHpx * 0.09), 6),
      priceFont: fitFontPx(contentWpx, priceText, Math.round(contentHpx * (hasDisc ? 0.1 : 0.13)), 6),
      barH: Math.max(14, Math.round(contentHpx * (hasDisc ? 0.28 : 0.36))),
      barW: Math.round(contentWpx * 0.96),
    };
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
    `align-items:center;justify-content:flex-start;gap:2%;text-align:center;overflow:hidden;` +
    `font-family:'Poppins',system-ui,Arial,sans-serif;color:#000;page-break-after:always;}` +
    `.lbl:last-child{page-break-after:auto;}` +
    `.nm{flex:0 0 auto;max-height:20%;font-weight:700;line-height:1.15;width:100%;` +
    `overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}` +
    `.bc{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;width:100%;}` +
    `.bc svg{max-width:100%;max-height:100%;width:auto;height:auto;}` +
    `.cd{flex:0 0 auto;font-family:ui-monospace,Consolas,monospace;` +
    `letter-spacing:.04em;line-height:1.1;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}` +
    `.pr{flex:0 0 auto;max-height:26%;line-height:1.15;display:flex;` +
    `flex-direction:column;align-items:center;justify-content:center;gap:0;width:100%;}` +
    `.pr .old{text-decoration:line-through;color:#555;font-weight:500;font-size:0.85em;}` +
    `.pr .new{font-weight:700;}` +
    `</style>`;

  return style + labels.join("");
}
