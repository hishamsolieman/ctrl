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

/** Search in-stock units for the invoice picker (requires a non-empty query). */
export async function searchStock(q) {
  const term = (q || "").trim();
  if (!term) return [];
  const { data } = await api.get("/invoices/stock/search", { params: { q: term } });
  return data;
}

/** Download invoices.csv for the current filters (all matching pages). */
export async function exportInvoices(params = {}) {
  const res = await api.get("/invoices/export/csv", {
    responseType: "blob",
    params,
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "invoices.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
