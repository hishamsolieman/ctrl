import api from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:2830";

// Turn a stored "/uploads/x.jpg" into an absolute URL the browser can load.
export function mediaUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

// ---- Products ----
export async function listProducts(params = {}) {
  const { data } = await api.get("/products", { params });
  return data;
}

export async function getProduct(id) {
  const { data } = await api.get(`/products/${id}`);
  return data;
}

export async function createProduct(payload) {
  const { data } = await api.post("/products", payload);
  return data;
}

export async function updateProduct(id, payload) {
  const { data } = await api.put(`/products/${id}`, payload);
  return data;
}

export async function deleteProduct(id) {
  const { data } = await api.delete(`/products/${id}`);
  return data;
}

export async function uploadProductImage(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/products/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.url;
}

export async function importProducts(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/products/import/csv", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function exportProducts() {
  const res = await api.get("/products/export/csv", { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "products.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Catalog ----
export async function listCategories() {
  const { data } = await api.get("/categories");
  return data;
}

export async function createCategory(payload) {
  const { data } = await api.post("/categories", payload);
  return data;
}

export async function listSuppliers() {
  const { data } = await api.get("/suppliers");
  return data;
}

export async function createSupplier(payload) {
  const { data } = await api.post("/suppliers", payload);
  return data;
}

export async function getCurrency() {
  const { data } = await api.get("/currency");
  return data.currency;
}

// ---- Attributes ----
export async function listAttributes() {
  const { data } = await api.get("/attributes");
  return data;
}

export async function createAttribute(payload) {
  const { data } = await api.post("/attributes", payload);
  return data;
}

export async function updateAttribute(id, payload) {
  const { data } = await api.put(`/attributes/${id}`, payload);
  return data;
}

export async function deleteAttribute(id) {
  const { data } = await api.delete(`/attributes/${id}`);
  return data;
}
