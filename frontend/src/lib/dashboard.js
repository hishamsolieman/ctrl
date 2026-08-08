import api from "@/lib/api";

export async function businessOverview() {
  const { data } = await api.get("/dashboard/overview");
  return data;
}

// Full report dataset for a date range (Admin+). Dates are YYYY-MM-DD.
export async function businessReport(dateFrom, dateTo) {
  const { data } = await api.get("/reports/business", {
    params: { date_from: dateFrom, date_to: dateTo },
  });
  return data;
}

// Today's sales + shift figures for the signed-in user.
export async function todaySales() {
  const { data } = await api.get("/dashboard/today");
  return data;
}
