import { pageRule } from "@/lib/barcode";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Build a standalone, print-ready invoice document body (its own <style> +
// `@page`). `profile` sizes the page; when null the OS default paper is used.
// `labels` holds already-translated strings; `money`/`num2` are formatters.
export function buildInvoiceHtml({ inv, brand, isAr, isCash, labels, profile, money, num2 }) {
  const dir = isAr ? "rtl" : "ltr";
  const date = inv.created_at
    ? new Date(inv.created_at).toLocaleString(isAr ? "ar-EG" : "en-US")
    : "";

  const rows = inv.items
    .map((it) => {
      const attrs = (it.attributes || [])
        .map((a) => (isAr ? a.value_ar : a.value_en) || a.value_en)
        .filter(Boolean)
        .join(", ");
      return (
        `<tr>` +
        `<td class="l">${esc(it.name)}${attrs ? `<div class="attr">${esc(attrs)}</div>` : ""}</td>` +
        `<td class="c">${it.quantity}</td>` +
        `<td class="c" dir="ltr">${esc(num2(it.unit_price))}</td>` +
        `<td class="r">${esc(money(it.line_total))}</td>` +
        `</tr>`
      );
    })
    .join("");

  const cash = isCash
    ? `<div class="cash">` +
      `<div class="row"><span>${esc(labels.paid)}</span><span>${esc(money(inv.paid))}</span></div>` +
      `<div class="row" style="font-weight:700"><span>${esc(labels.changeRaw)}</span><span>${esc(money(inv.changeRaw))}</span></div>` +
      `<div class="row" style="font-size:10px;color:#666"><span>${esc(labels.changeExact)}</span><span>${esc(money(inv.changeExact))}</span></div>` +
      `</div>`
    : "";

  const style =
    `<style>` +
    pageRule(profile) +
    `html,body{margin:0;padding:0;background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}` +
    `*{box-sizing:border-box;}` +
    `.inv{font-family:'Poppins',system-ui,Arial,sans-serif;font-size:12px;padding:2mm;}` +
    `.hdr{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid #000;padding-bottom:8px;margin-bottom:8px;}` +
    `.brand{display:flex;gap:8px;align-items:center;}` +
    `.brand img{height:34px;width:34px;object-fit:contain;}` +
    `.brand .nm{font-weight:800;font-size:15px;}` +
    `.brand .mt{font-size:10px;color:#555;}` +
    `.meta{text-align:${isAr ? "start" : "end"};}` +
    `.meta .tt{font-weight:700;letter-spacing:2px;font-size:10px;text-transform:uppercase;color:#111;}` +
    `.meta .no{font-family:monospace;font-size:12px;}` +
    `.meta .dt{font-size:10px;color:#555;}` +
    `.badge{display:inline-block;border:1px solid #000;border-radius:10px;padding:0 6px;font-size:9px;font-weight:700;margin-top:2px;}` +
    `.bill{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed #999;padding-bottom:8px;margin-bottom:8px;font-size:11px;}` +
    `.bill .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;}` +
    `.bill .v{font-weight:600;}` +
    `table{width:100%;border-collapse:collapse;font-size:11px;}` +
    `th{border-bottom:1px solid #000;padding:4px 3px;font-size:10px;text-transform:uppercase;color:#333;}` +
    `td{padding:4px 3px;border-bottom:1px solid #eee;vertical-align:top;}` +
    `th.l,td.l{text-align:start;} th.c,td.c{text-align:center;} th.r,td.r{text-align:end;}` +
    `.attr{font-size:9px;color:#666;margin-top:2px;}` +
    `.tot{margin-top:8px;font-size:12px;}` +
    `.tot .row{display:flex;justify-content:space-between;padding:2px 0;color:#333;}` +
    `.tot .grand{border-top:1px solid #000;margin-top:4px;padding-top:4px;font-weight:800;font-size:13px;color:#000;}` +
    `.cash{margin-top:6px;border:1px dashed #999;padding:6px;}` +
    `.cash .row{display:flex;justify-content:space-between;padding:1px 0;}` +
    `.thanks{margin-top:10px;text-align:center;font-size:10px;color:#555;border-top:1px dashed #999;padding-top:6px;}` +
    `</style>`;

  const logo = brand?.logo ? `<img src="${esc(brand.logo)}" alt="">` : "";

  return (
    style +
    `<div class="inv" dir="${dir}">` +
    `<div class="hdr">` +
    `<div class="brand">${logo}<div><div class="nm">${esc(brand?.name || "")}</div>` +
    `${brand?.motto ? `<div class="mt">${esc(brand.motto)}</div>` : ""}</div></div>` +
    `<div class="meta"><div class="tt">${esc(labels.title)}</div>` +
    `<div class="no" dir="ltr">${esc(inv.invoice_no || "")}</div>` +
    `<div class="dt" dir="ltr">${esc(date)}</div>` +
    `<div class="badge">${esc(labels.paidBadge)}</div></div>` +
    `</div>` +
    `<div class="bill">` +
    `<div><div class="lbl">${esc(labels.billTo)}</div>` +
    `<div class="v">${esc(inv.customer_name || "—")}</div>` +
    `${inv.customer_phone ? `<div dir="ltr">${esc(inv.customer_phone)}</div>` : ""}</div>` +
    `<div style="text-align:${isAr ? "start" : "end"}"><div class="lbl">${esc(labels.payment)}</div>` +
    `<div class="v">${esc(inv.payment_method || "—")}</div></div>` +
    `</div>` +
    `<table><thead><tr>` +
    `<th class="l">${esc(labels.item)}</th><th class="c">${esc(labels.qty)}</th>` +
    `<th class="c">${esc(labels.price)}</th><th class="r">${esc(labels.total)}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="tot">` +
    `<div class="row"><span>${esc(labels.subtotal)}</span><span>${esc(money(inv.subtotal))}</span></div>` +
    `<div class="row"><span>${esc(labels.discount)}</span><span>−${esc(money(inv.discount))}</span></div>` +
    `<div class="row grand"><span>${esc(labels.totalLabel)}</span><span>${esc(money(inv.total))}</span></div>` +
    cash +
    `</div>` +
    `<div class="thanks">${esc(labels.thanks)}</div>` +
    `</div>`
  );
}
