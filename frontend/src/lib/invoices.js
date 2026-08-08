import api from "@/lib/api";

// Invoice / sales management API client.

export async function listInvoices(params = {}) {
  const { data } = await api.get("/invoices", { params });
  return data; // { items, total, page, page_size, pages }
}

export async function getInvoiceStats() {
  const { data } = await api.get("/invoices/stats");
  return data; // { overall, month, currency }
}

export async function getInvoice(id) {
  const { data } = await api.get(`/invoices/${id}`);
  return data;
}

// Search sellable stock units for the "select from inventory" picker.
export async function searchStock(q) {
  const { data } = await api.get("/invoices/stock/search", { params: { q } });
  return data;
}

// Back-dated / manual invoice (Admin+). Adding items deducts inventory.
export async function createInvoice(payload) {
  const { data } = await api.post("/invoices", payload);
  return data;
}

// Modify an existing sale (Admin+). Returns/deducts stock per the diff.
export async function updateInvoice(id, payload) {
  const { data } = await api.put(`/invoices/${id}`, payload);
  return data;
}
