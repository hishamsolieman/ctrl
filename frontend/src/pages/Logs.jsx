import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { listLogUsers, listLogs, clearLogs } from "@/lib/logs";
import Modal from "@/components/Modal";
import {
  IconActivity,
  IconSearch,
  IconUser,
  IconChevronDown,
  IconDownload,
  IconTrash,
} from "@/components/icons";

const SUPERADMIN_LEVEL = 40;
const ALL = "all";

// Prettify "product.create" → "Product create".
function prettyAction(a) {
  if (!a) return "";
  const s = a.replace(/[._]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Per-status colours split by role so the timeline dot and the detail badge
// can pull exactly the class they need.
function statusTone(status) {
  if (status === "failure") return { dot: "bg-red-500", text: "text-red-300", ring: "ring-red-500/40" };
  if (status === "success") return { dot: "bg-emerald-500", text: "text-emerald-300", ring: "ring-emerald-500/40" };
  return { dot: "bg-sky-500", text: "text-sky-300", ring: "ring-sky-500/40" };
}

export default function Logs() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const canAccess = !!user && user.role_level >= SUPERADMIN_LEVEL;

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [userId, setUserId] = useState(ALL);
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBeforeId, setNextBeforeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const searchTimer = useRef(null);
  const [debouncedQ, setDebouncedQ] = useState("");

  // Date-only bounds → full-day range: start of the "from" day, end of the "to" day.
  const fromParam = dateFrom ? `${dateFrom}T00:00:00` : undefined;
  const toParam = dateTo ? `${dateTo}T23:59:59` : undefined;

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [q]);

  useEffect(() => {
    if (!canAccess) return;
    listLogUsers()
      .then((d) => {
        setUsers(d.users);
        setTotal(d.total);
      })
      .catch(() => {});
  }, [canAccess]);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    try {
      const res = await listLogs({
        user_id: userId === ALL ? undefined : Number(userId),
        q: debouncedQ || undefined,
        date_from: fromParam,
        date_to: toParam,
      });
      setItems(res.items);
      setHasMore(res.has_more);
      setNextBeforeId(res.next_before_id);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [userId, debouncedQ, fromParam, toParam, t, toast]);

  useEffect(() => {
    if (canAccess) loadFirst();
  }, [canAccess, loadFirst]);

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listLogs({
        user_id: userId === ALL ? undefined : Number(userId),
        q: debouncedQ || undefined,
        date_from: fromParam,
        date_to: toParam,
        before_id: nextBeforeId,
      });
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.has_more);
      setNextBeforeId(res.next_before_id);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoadingMore(false);
    }
  }

  const fmtDate = useCallback(
    (iso) => {
      if (!iso) return "—";
      try {
        return new Date(iso).toLocaleString(isAr ? "ar-EG" : "en-US", {
          year: "numeric", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
      } catch {
        return iso;
      }
    },
    [isAr]
  );

  const detailJson = useMemo(() => {
    if (!selected || selected.details == null) return null;
    if (typeof selected.details === "string") return selected.details;
    try {
      return JSON.stringify(selected.details, null, 2);
    } catch {
      return String(selected.details);
    }
  }, [selected]);

  // The user currently in scope (for the Clear action + its confirmation copy).
  const scopedUser = useMemo(
    () => (userId === ALL ? null : users.find((u) => String(u.id) === String(userId)) || null),
    [userId, users]
  );

  // Export the currently-loaded (visible) rows to a UTF-8 CSV (BOM for Excel).
  function onExport() {
    if (!items.length) return;
    const cols = [
      "id", "created_at", "username", "action", "entity", "entity_id",
      "status", "ip_address", "user_agent", "details",
    ];
    const cell = (v) => {
      if (v == null) return "";
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = items.map((it) =>
      cols.map((c) => cell(c === "details" ? it.details : it[c])).join(",")
    );
    const csv = "\uFEFF" + [cols.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-logs${scopedUser ? "-" + scopedUser.username : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onClear() {
    setClearing(true);
    try {
      const res = await clearLogs(scopedUser ? scopedUser.id : undefined);
      toast.success(t("logs.cleared", { count: res.deleted }));
      setConfirmClear(false);
      setSelected(null);
      const fresh = await listLogUsers();
      setUsers(fresh.users);
      setTotal(fresh.total);
      await loadFirst();
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setClearing(false);
    }
  }

  if (authLoading) return null;
  if (!canAccess) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("logs.title")}</h1>
          <p className="text-sm text-muted">{t("logs.subtitle", { count: total })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onExport} disabled={!items.length}
            className="ctrl-btn inline-flex items-center gap-2 border border-border px-3 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50">
            <IconDownload width={16} height={16} /> {t("logs.export")}
          </button>
          <button type="button" onClick={() => setConfirmClear(true)}
            className="ctrl-btn inline-flex items-center gap-2 border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">
            <IconTrash width={16} height={16} /> {t("logs.clear")}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[24rem_1fr]">
        {/* Left: user selector + activity timeline */}
        <div className="ctrl-card flex min-h-0 flex-col overflow-hidden">
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
                <IconUser width={16} height={16} />
              </span>
              <select value={userId} onChange={(e) => setUserId(e.target.value)}
                className="ctrl-input-sm ctrl-select w-full ps-9 text-sm">
                <option value={ALL}>{t("logs.allUsers")} ({total})</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.full_name || u.username)} · {u.count}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
                <IconSearch width={16} height={16} />
              </span>
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={t("logs.search")} className="ctrl-input-sm w-full ps-9 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">{t("logs.from")}</span>
                <input type="date" value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="ctrl-input-sm w-full text-sm" title={t("logs.from")} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">{t("logs.to")}</span>
                <input type="date" value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="ctrl-input-sm w-full text-sm" title={t("logs.to")} />
              </label>
            </div>
            {(dateFrom || dateTo) && (
              <button type="button"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-xs text-muted underline-offset-2 hover:text-text hover:underline">
                {t("logs.clearDates")}
              </button>
            )}
          </div>

          {/* Timeline */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-elevated/70" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated text-muted">
                  <IconActivity width={26} height={26} />
                </span>
                <p className="text-sm text-muted">{t("logs.empty")}</p>
              </div>
            ) : (
              <ol className="relative ms-2 space-y-1 border-s border-border ps-5">
                {items.map((it) => {
                  const active = selected?.id === it.id;
                  return (
                    <li key={it.id} className="relative">
                      {/* Node dot on the timeline */}
                      <span className={`absolute -start-[1.6rem] top-3 h-3 w-3 rounded-full ring-4 ring-surface ${statusTone(it.status).dot}`} />
                      <button type="button" onClick={() => setSelected(it)}
                        className={`w-full rounded-lg border px-3 py-2 text-start transition ${
                          active
                            ? "border-accent bg-accent/10"
                            : "border-transparent hover:border-border hover:bg-elevated/50"
                        }`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-text">{prettyAction(it.action)}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted">#{it.id}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="truncate font-mono text-[11px] text-muted" dir="ltr">{it.action}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                          <span className="truncate">{it.username || t("logs.system")}</span>
                          <span className="shrink-0">{fmtDate(it.created_at)}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {hasMore && (
                  <li className="relative pt-2">
                    <button type="button" onClick={loadMore} disabled={loadingMore}
                      className="ctrl-btn w-full border border-border py-2 text-sm text-text hover:bg-elevated disabled:opacity-50">
                      {loadingMore ? t("logs.loading") : t("logs.seeMore")}
                    </button>
                  </li>
                )}
              </ol>
            )}
          </div>
        </div>

        {/* Right: activity detail */}
        <div className="ctrl-card min-h-0 overflow-y-auto p-5">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-muted">
                <IconChevronDown width={28} height={28} className="-rotate-90 rtl:rotate-90" />
              </span>
              <p className="text-sm text-muted">{t("logs.selectHint")}</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-text">{prettyAction(selected.action)}</h2>
                  <p className="mt-0.5 font-mono text-xs text-muted" dir="ltr">{selected.action}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone(selected.status).text} ${statusTone(selected.status).ring}`}>
                  <span className={`h-2 w-2 rounded-full ${statusTone(selected.status).dot}`} />
                  {t(`logs.status.${selected.status}`, { defaultValue: selected.status })}
                </span>
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label={t("logs.field.id")} value={`#${selected.id}`} mono />
                <Field label={t("logs.field.time")} value={fmtDate(selected.created_at)} />
                <Field label={t("logs.field.user")} value={selected.username || t("logs.system")} />
                <Field label={t("logs.field.entity")}
                  value={selected.entity ? `${selected.entity}${selected.entity_id ? " #" + selected.entity_id : ""}` : "—"} mono />
                <Field label={t("logs.field.ip")} value={selected.ip_address || "—"} mono />
                <Field label={t("logs.field.agent")} value={selected.user_agent || "—"} />
              </dl>

              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{t("logs.field.details")}</p>
                {detailJson ? (
                  <pre className="max-h-[50vh] overflow-auto rounded-xl border border-border bg-bg p-4 text-xs leading-relaxed text-text" dir="ltr">
                    {detailJson}
                  </pre>
                ) : (
                  <p className="rounded-xl border border-border bg-elevated/30 p-4 text-sm text-muted">{t("logs.noDetails")}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal open={confirmClear} onClose={() => !clearing && setConfirmClear(false)}
        title={t("logs.clearTitle")} size="sm"
        footer={
          <>
            <button type="button" onClick={() => setConfirmClear(false)} disabled={clearing}
              className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50">
              {t("logs.cancel")}
            </button>
            <button type="button" onClick={onClear} disabled={clearing}
              className="ctrl-btn bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50">
              {clearing ? t("logs.clearing") : t("logs.clearConfirm")}
            </button>
          </>
        }>
        <p className="text-sm text-text">
          {scopedUser
            ? t("logs.clearUserBody", { name: scopedUser.full_name || scopedUser.username })
            : t("logs.clearAllBody")}
        </p>
        <p className="mt-2 text-xs text-muted">{t("logs.clearIrreversible")}</p>
      </Modal>
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-text ${mono ? "font-mono" : ""}`} dir={mono ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}
