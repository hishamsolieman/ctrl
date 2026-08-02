// Shared POS cart helpers. Both the Cashier page (which owns the cart tabs) and
// the Products page (which can push a product into an open cart) use these so the
// persisted tab/line shapes stay identical.

export const CART_SLOTS = ["A", "B", "C", "D", "E"];
export const MAX_CARTS = CART_SLOTS.length;

export const cartsStorageKey = (username) => `pos:tabs:${username || "anon"}`;

export const newCartKey = () =>
  crypto?.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`;

// First slot letter not already taken by an existing tab (freed slots are reused
// so cart names stay stable/consistent).
export function firstFreeSlot(tabs) {
  const used = new Set((tabs || []).map((tb) => tb.slot));
  return CART_SLOTS.find((s) => !used.has(s)) || CART_SLOTS[CART_SLOTS.length - 1];
}

export function blankCart(slot = "A") {
  return {
    id: newCartKey(),
    slot,
    holdKey: newCartKey(),
    items: [],
    step: 1,
    customer: { phone: "", name: "", existing: false },
    paymentMethodId: null,
    paidAmount: "",
    skipInvoice: false,
    sale: null,
  };
}

// Canonical cart-line shape shared by scan/switch/add-to-cart. Keep in sync with
// the fields the backend `_line` returns.
export function mapCartLine(line) {
  return {
    stock_id: line.stock_id,
    variant_id: line.variant_id,
    product_id: line.product_id,
    code: line.code,
    name: line.name,
    category_en: line.category_en,
    category_ar: line.category_ar,
    variant_en: line.variant_en,
    variant_ar: line.variant_ar,
    image: line.image,
    price: line.price,
    min_price: line.min_price,
    quantity: line.quantity,
    available: line.available,
    on_hand: line.on_hand,
    coding_editable: !!line.coding_editable,
    coding_attrs: line.coding_attrs || [],
    nc_attrs: line.nc_attrs || [],
    selected: line.selected || {},
    siblings: line.siblings || [],
  };
}

// A line pushed from the product list needs its variant attributes finalized by
// the cashier before checkout — but only when there is actually something to
// choose (a flexible/coding line, or one with switchable non-coding attributes).
export function lineNeedsFinalize(line) {
  return !!line.coding_editable || (line.nc_attrs || []).length > 0;
}

export function loadCarts(username) {
  try {
    const raw = localStorage.getItem(cartsStorageKey(username));
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* ignore parse/storage errors */
  }
  return [];
}

export function saveCarts(username, tabs) {
  try {
    localStorage.setItem(cartsStorageKey(username), JSON.stringify(tabs));
  } catch {
    /* ignore quota errors */
  }
}
