import api from "@/lib/api";

// Customers directory (read-only, name-editable). Customers are created at POS.

export async function listCustomers() {
  const { data } = await api.get("/customers");
  return data;
}

export async function getCustomerStats() {
  const { data } = await api.get("/customers/stats");
  return data;
}

// A customer's invoices (with line items), newest first.
export async function listCustomerSales(id) {
  const { data } = await api.get(`/customers/${id}/sales`);
  return data;
}

// Only the name can be changed.
export async function updateCustomer(id, name) {
  const { data } = await api.patch(`/customers/${id}`, { name });
  return data;
}
