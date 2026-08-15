import api from "@/lib/api";

export async function fundsOverview({ period, date_from, date_to } = {}) {
  const params = {};
  if (period) params.period = period;
  if (date_from) params.date_from = date_from;
  if (date_to) params.date_to = date_to;
  const { data } = await api.get("/funds/overview", { params });
  return data; // { currency, period, metrics, estimates, cashflow, margin_trend, profit_path, capital, expense_types }
}

export async function downloadFundsDocs(locale = "en") {
  const { data, headers } = await api.get("/funds/docs", {
    params: { locale },
    responseType: "blob",
  });
  const cd = headers["content-disposition"] || "";
  const match = /filename="?([^";]+)"?/i.exec(cd);
  const filename = match?.[1] || `funds-metrics-${locale}.pdf`;
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
