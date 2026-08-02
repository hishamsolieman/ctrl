import api from "@/lib/api";

// Point-of-Sale API client.

export async function posBootstrap() {
  const { data } = await api.get("/pos/bootstrap");
  return data;
}

export async function lookupCustomer(phone) {
  const { data } = await api.get("/pos/customers/lookup", { params: { phone } });
  return data;
}

// Scan a code: reserves +1 of the resolved stock unit for this cart (hold_key).
// Returns the resolved cart line, or throws with an API error key.
export async function posScan(holdKey, code) {
  const { data } = await api.post("/pos/holds/scan", { hold_key: holdKey, code });
  return data;
}

// Set the held quantity for a stock unit in this cart. Returns the clamped line
// (with `capped` true when stock wasn't enough for the requested quantity).
export async function posSetQty(holdKey, stockId, quantity) {
  const { data } = await api.post("/pos/holds/set", {
    hold_key: holdKey,
    stock_id: stockId,
    quantity,
  });
  return data;
}

// Switch a line to another in-stock unit for a changed attribute. `attributes`
// is the full target combo {attr_id: value_id}; `anchor` is the attribute the
// cashier just changed (kept fixed while other values adapt to availability).
export async function posSwitch(holdKey, stockId, attributes, anchor) {
  const { data } = await api.post("/pos/holds/switch", {
    hold_key: holdKey,
    stock_id: stockId,
    attributes,
    ...(anchor != null ? { anchor: Number(anchor) } : {}),
  });
  return data;
}

// Release a single line (stockId) or the whole cart's holds (omit stockId).
export async function posRelease(holdKey, stockId) {
  const { data } = await api.post("/pos/holds/release", {
    hold_key: holdKey,
    ...(stockId ? { stock_id: stockId } : {}),
  });
  return data;
}

export async function posCheckout(payload) {
  const { data } = await api.post("/pos/checkout", payload);
  return data;
}

// Log that a cashier opened a new cart tab (best-effort; no server state).
export async function posOpenCart(holdKey) {
  const { data } = await api.post("/pos/cart/open", { hold_key: holdKey });
  return data;
}
