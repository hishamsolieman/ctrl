import api from "@/lib/api";

// User management (Moderator+). Visibility & privilege are enforced server-side.

export async function listUsers() {
  const { data } = await api.get("/users");
  return data;
}

export async function getUserStats() {
  const { data } = await api.get("/users/stats");
  return data;
}

// Roles the current actor is allowed to assign.
export async function listAssignableRoles() {
  const { data } = await api.get("/users/roles");
  return data;
}

export async function createUser(payload) {
  const { data } = await api.post("/users", payload);
  return data; // includes the generated `password` (shown once)
}

export async function updateUser(id, payload) {
  const { data } = await api.patch(`/users/${id}`, payload);
  return data;
}

// Reset (or set) a user's password. Omit `password` to auto-generate a strong one.
export async function resetUserPassword(id, password) {
  const { data } = await api.post(`/users/${id}/reset-password`, {
    password: password || null,
  });
  return data; // { id, username, password }
}
