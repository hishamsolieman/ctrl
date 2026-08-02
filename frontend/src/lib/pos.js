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

// Scan a code: reserves +1 of the resolved variant for this cart (hold_key).
// Returns the resolved cart line, or throws with an API error key.
export async function posScan(holdKey, code) {
  const { data } = await api.post("/pos/holds/scan", { hold_key: holdKey, code });
  return data;
}

// Set the held quantity for a variant in this cart. Returns the clamped line
// (with `capped` true when stock wasn't enough for the requested quantity).
export async function posSetQty(holdKey, variantId, quantity) {
  const { data } = await api.post("/pos/holds/set", {
    hold_key: holdKey,
    variant_id: variantId,
    quantity,
  });
  return data;
}

// Release a single line (variantId) or the whole cart's holds (omit variantId).
export async function posRelease(holdKey, variantId) {
  const { data } = await api.post("/pos/holds/release", {
    hold_key: holdKey,
    ...(variantId ? { variant_id: variantId } : {}),
  });
  return data;
}

export async function posCheckout(payload) {
  const { data } = await api.post("/pos/checkout", payload);
  return data;
}
