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

// Switch a line to a sibling stock unit (same code, different non-coding attrs).
// `attributes` is the full target non-coding combo {attr_id: value_id}.
export async function posSwitch(holdKey, stockId, attributes) {
  const { data } = await api.post("/pos/holds/switch", {
    hold_key: holdKey,
    stock_id: stockId,
    attributes,
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
