import api from "@/lib/api";

// ---------------------------------------------------------------------------
// General settings (GET any role; PUT Admin+)
// ---------------------------------------------------------------------------
export async function getGeneralSettings() {
  const { data } = await api.get("/settings/general");
  return data;
}

export async function updateGeneralSettings(payload) {
  const { data } = await api.put("/settings/general", payload);
  return data;
}

// "auto" follows the current UI language; otherwise force en/ar on invoices.
export function resolveInvoiceLanguage(setting, uiLang) {
  if (setting === "en" || setting === "ar") return setting;
  return uiLang === "ar" ? "ar" : "en";
}

// ---------------------------------------------------------------------------
// Print profiles + assignments API (Admin+ enforced server-side)
// ---------------------------------------------------------------------------
export async function listPrintProfiles() {
  const { data } = await api.get("/settings/print/profiles");
  return data;
}

export async function createPrintProfile(payload) {
  const { data } = await api.post("/settings/print/profiles", payload);
  return data;
}

export async function updatePrintProfile(id, payload) {
  const { data } = await api.put(`/settings/print/profiles/${id}`, payload);
  return data;
}

export async function deletePrintProfile(id) {
  const { data } = await api.delete(`/settings/print/profiles/${id}`);
  return data;
}

export async function getPrintAssignments() {
  const { data } = await api.get("/settings/print/assignments");
  return data; // { barcode, invoice, report }
}

export async function setPrintAssignment(target, profileId) {
  const { data } = await api.put("/settings/print/assignments", {
    target,
    profile_id: profileId ?? null,
  });
  return data;
}

// Records the test-print in the action log (the actual print runs on the client).
export async function logTestPrint(target, profileId) {
  const { data } = await api.post("/settings/print/test", { target, profile_id: profileId });
  return data;
}

// Resolve the profile assigned to a target (barcode|invoice|report). Any role.
export async function getPrintTarget(target) {
  const { data } = await api.get(`/settings/print/target/${target}`);
  return data; // { target, profile: {...}|null }
}

// ---------------------------------------------------------------------------
// Desktop shell (Tauri 2.0) bridge — degrades gracefully in a plain browser.
// ---------------------------------------------------------------------------
// `@tauri-apps/api/core` is browser-safe to import; `invoke` only touches the
// Tauri runtime when actually called (guarded by `isDesktop`).
import { invoke } from "@tauri-apps/api/core";

export function isDesktop() {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

// Returns a list of OS printer names. Empty array when not running under the
// desktop shell (the browser has no access to the system printer list).
export async function listPrinters() {
  if (!isDesktop()) return [];
  try {
    const res = await invoke("list_printers");
    return (res || []).map((p) => (typeof p === "string" ? p : p?.name)).filter(Boolean);
  } catch {
    return [];
  }
}

// Convert a profile's size to CSS `@page` size for the browser print fallback.
function pageSize(profile) {
  if (!profile) return "auto";
  if (profile.size_mode === "custom" && Number(profile.width) > 0) {
    if (!(Number(profile.height) > 0)) return `${profile.width}${profile.unit} auto`;
    return `${profile.width}${profile.unit} ${profile.height}${profile.unit}`;
  }
  return profile.standard_size || "auto";
}

// Print sample content for a target using the assigned profile.
// Desktop: hand off to the shell (`test_print`, plain text). Browser: sized
// hidden-iframe `window.print()` with the profile's paper size.
export async function runTestPrint(profile, target, html, text) {
  if (isDesktop()) {
    await invoke("test_print", {
      printer: profile.printer_name,
      text: text || `CTRL test print — ${target}`,
    });
    return;
  }
  // Browser fallback: print a correctly-sized hidden iframe.
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `@page { size: ${pageSize(profile)}; margin: 6mm; }` +
      `body { font-family: system-ui, sans-serif; color:#000; padding:8px; }` +
      `</style></head><body>${html}</body></html>`
  );
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow.focus();
  frame.contentWindow.onafterprint = done;
  frame.contentWindow.print();
  done();
}

function waitForImages(doc) {
  const imgs = [...doc.images];
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((res) => {
        img.onload = img.onerror = () => res();
      });
    })
  );
}

function cssLenToPx(value, unit, win) {
  const probe = win.document.createElement("div");
  probe.style.cssText = `position:absolute;width:${value}${unit};visibility:hidden;`;
  win.document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  if (px > 0) return px;
  const n = Number(value) || 0;
  if (unit === "in") return n * 96;
  if (unit === "cm") return n * (96 / 2.54);
  return n * (96 / 25.4);
}

// Print a full body string (caller supplies its own <style>/@page) via a hidden
// iframe. Works in the browser and inside the Tauri webview (native dialog,
// pre-select the assigned device).
//
// Roll invoices (`[data-roll="1"]`): the iframe is laid out at the profile
// width, then `@page` is set to that width × the measured content height so
// the printed page is exactly as tall as the receipt.
export function printDocument(bodyHtml) {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:-12000px;top:0;border:0;visibility:hidden;";
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`);
    doc.close();

    const cleanup = () => {
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    frame.contentWindow.onafterprint = cleanup;

    const go = async () => {
      const roll = doc.querySelector("[data-roll='1']");
      if (roll) {
        const width = roll.getAttribute("data-roll-width");
        const unit = roll.getAttribute("data-roll-unit") || "mm";
        const widthPx = cssLenToPx(width, unit, frame.contentWindow);
        frame.style.width = `${Math.ceil(widthPx)}px`;
        frame.style.height = "20000px";
        await waitForImages(doc);
        const hPx = Math.ceil(roll.scrollHeight || roll.getBoundingClientRect().height);
        const hMm = Math.ceil((hPx * 25.4) / 96 * 10) / 10;
        const page = doc.createElement("style");
        page.textContent =
          `@page { size: ${width}${unit} ${hMm}mm; margin: 0; }` +
          `html,body{width:${width}${unit};height:${hMm}mm;overflow:hidden;}`;
        doc.head.appendChild(page);
      } else {
        frame.style.width = "0";
        frame.style.height = "0";
        await waitForImages(doc);
      }
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(cleanup, 1500);
    };

    setTimeout(() => {
      go().catch(cleanup);
    }, 80);
  });
}
