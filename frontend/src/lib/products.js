import api from "@/lib/api";
import { compressImage } from "@/lib/image";

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

// Warns (does not block) when another product already uses this exact name.
export async function checkProductName(name, excludeId) {
  const { data } = await api.get("/products/check-name", {
    params: { name, ...(excludeId ? { exclude_id: excludeId } : {}) },
  });
  return data.exists;
}

// A fresh, unique 8-char code (used to pre-fill the locked code field).
export async function generateCode() {
  const { data } = await api.get("/products/generate-code");
  return data.code;
}

// Validates a (user-edited) code: { valid, exists }. `kind` is "product" | "variant".
export async function checkCode(code, kind = "product", excludeId) {
  const { data } = await api.get("/products/check-code", {
    params: { code, kind, ...(excludeId ? { exclude_id: excludeId } : {}) },
  });
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

// Soft-deletes every product (empties the store).
export async function clearAllProducts() {
  const { data } = await api.post("/products/clear-all");
  return data;
}

export async function bulkUpdateProducts(payload) {
  const { data } = await api.post("/products/bulk-update", payload);
  return data;
}

export async function bulkDeleteProducts(ids) {
  const { data } = await api.post("/products/bulk-delete", { ids });
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

// Uploads an image into the DB (base64) and returns its "/images/{id}" reference.
// Images are downscaled/compressed to <=512KB first so they fit within MySQL's
// max_allowed_packet (the DB stores them base64-encoded).
export async function uploadImage(file) {
  const prepared = await compressImage(file, 512 * 1024);
  const form = new FormData();
  form.append("file", prepared);
  const { data } = await api.post("/images", form, {
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

// ---- Categories ----
export async function listCategories() {
  const { data } = await api.get("/categories");
  return data;
}

export async function getCategory(id) {
  const { data } = await api.get(`/categories/${id}`);
  return data;
}

export async function createCategory(payload) {
  const { data } = await api.post("/categories", payload);
  return data;
}

export async function updateCategory(id, payload) {
  const { data } = await api.put(`/categories/${id}`, payload);
  return data;
}

export async function deleteCategory(id) {
  const { data } = await api.delete(`/categories/${id}`);
  return data;
}

export async function bulkUpdateCategories(payload) {
  const { data } = await api.post("/categories/bulk-update", payload);
  return data;
}

export async function bulkDeleteCategories(ids) {
  const { data } = await api.post("/categories/bulk-delete", { ids });
  return data;
}

export async function exportCategories(q) {
  const res = await api.get("/categories/export/csv", {
    responseType: "blob",
    params: q ? { q } : undefined,
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "categories.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importCategories(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/categories/import/csv", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function listSuppliers() {
  const { data } = await api.get("/suppliers");
  return data;
}

export async function getSupplierStats() {
  const { data } = await api.get("/suppliers/stats");
  return data;
}

export async function createSupplier(payload) {
  const { data } = await api.post("/suppliers", payload);
  return data;
}

export async function updateSupplier(id, payload) {
  const { data } = await api.put(`/suppliers/${id}`, payload);
  return data;
}

export async function deleteSupplier(id) {
  const { data } = await api.delete(`/suppliers/${id}`);
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

export async function exportAttributes(q) {
  const res = await api.get("/attributes/export/csv", {
    responseType: "blob",
    params: q ? { q } : undefined,
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "attributes.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importAttributes(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/attributes/import/csv", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
