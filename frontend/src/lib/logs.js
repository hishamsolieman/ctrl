import api from "@/lib/api";

// Action-log browser API client (SuperAdmin only).

export async function listLogUsers() {
  const { data } = await api.get("/logs/users");
  return data; // { total, users: [{id, username, full_name, role, count}] }
}

// Keyset-paginated activity feed. Pass `before_id` to load older entries.
export async function listLogs({ user_id, q, date_from, date_to, before_id, limit } = {}) {
  const params = {};
  if (user_id != null) params.user_id = user_id;
  if (q) params.q = q;
  if (date_from) params.date_from = date_from;
  if (date_to) params.date_to = date_to;
  if (before_id != null) params.before_id = before_id;
  if (limit != null) params.limit = limit;
  const { data } = await api.get("/logs", { params });
  return data; // { items, has_more, next_before_id }
}

// Purge logs. Pass a `user_id` to clear just that user; omit to clear everything.
export async function clearLogs(user_id) {
  const { data } = await api.delete("/logs", {
    params: user_id != null ? { user_id } : undefined,
  });
  return data; // { deleted }
}
