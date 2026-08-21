import { invoke } from "@tauri-apps/api/core";
import api from "@/lib/api";
import { isDesktop } from "@/lib/settings";

export { isDesktop };

export async function readDesktopHwid() {
  if (!isDesktop()) return "";
  const raw = await invoke("get_hwid");
  return String(raw || "").trim();
}

export async function checkDesktopLicense() {
  if (!isDesktop()) return { ok: true, hwid: "" };
  let hwid = "";
  try {
    hwid = await readDesktopHwid();
  } catch {
    return { ok: false, hwid: "" };
  }
  if (!hwid) return { ok: false, hwid: "" };
  try {
    const { data } = await api.post("/license/check", { hwid });
    return { ok: !!data?.allowed, hwid };
  } catch {
    return { ok: false, hwid };
  }
}
