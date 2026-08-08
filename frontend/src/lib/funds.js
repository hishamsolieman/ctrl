import api from "@/lib/api";

export async function fundsOverview() {
  const { data } = await api.get("/funds/overview");
  return data; // { currency, totals, baseline, months, top_suppliers, expense_types }
}

export async function listFunds({ q, page, page_size } = {}) {
  const params = {};
  if (q) params.q = q;
  if (page != null) params.page = page;
  if (page_size != null) params.page_size = page_size;
  const { data } = await api.get("/funds", { params });
  return data;
}

export async function createFund(payload) {
  const { data } = await api.post("/funds", payload);
  return data;
}

export async function updateFund(id, payload) {
  const { data } = await api.put(`/funds/${id}`, payload);
  return data;
}

export async function deleteFund(id) {
  const { data } = await api.delete(`/funds/${id}`);
  return data;
}
