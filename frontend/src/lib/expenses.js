import api from "@/lib/api";

export async function expenseMeta() {
  const { data } = await api.get("/expenses/meta");
  return data; // { types, users, is_admin, currency, self }
}

export async function expenseStats() {
  const { data } = await api.get("/expenses/stats");
  return data; // { total_expenses, month_expenses, sales_count, sales_total, currency }
}

export async function listExpenses({ q, user_id, page, page_size } = {}) {
  const params = {};
  if (q) params.q = q;
  if (user_id != null) params.user_id = user_id;
  if (page != null) params.page = page;
  if (page_size != null) params.page_size = page_size;
  const { data } = await api.get("/expenses", { params });
  return data;
}

export async function createExpense(payload) {
  const { data } = await api.post("/expenses", payload);
  return data;
}

export async function updateExpense(id, payload) {
  const { data } = await api.put(`/expenses/${id}`, payload);
  return data;
}

export async function deleteExpense(id) {
  const { data } = await api.delete(`/expenses/${id}`);
  return data;
}
