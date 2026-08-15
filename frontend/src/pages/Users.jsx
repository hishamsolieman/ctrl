import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { listUsers, getUserStats, listAssignableRoles } from "@/lib/users";
import UserModal from "@/components/users/UserModal";
import ResetPasswordModal from "@/components/users/ResetPasswordModal";
import CredentialDialog from "@/components/users/CredentialDialog";
import {
  IconUsers,
  IconUser,
  IconCheck,
  IconStar,
  IconShield,
  IconKey,
  IconSearch,
  IconPlus,
  IconEdit,
  IconTrendUp,
  IconChevronLeft,
  IconChevronRight,
  IconEye,
  IconEyeOff,
} from "@/components/icons";
import { mediaUrl } from "@/lib/products";

const PAGE_SIZE = 10;
const MODERATOR_LEVEL = 20;
const MASK = "\u2217\u2217\u2217"; // ***

const TONES = {
  emerald: { grad: "from-emerald-500/15 via-emerald-500/5", tile: "bg-emerald-500/20 text-emerald-300", glow: "bg-emerald-500/20" },
  amber: { grad: "from-amber-500/15 via-amber-500/5", tile: "bg-amber-500/20 text-amber-300", glow: "bg-amber-500/20" },
  sky: { grad: "from-sky-500/15 via-sky-500/5", tile: "bg-sky-500/20 text-sky-300", glow: "bg-sky-500/20" },
  violet: { grad: "from-violet-500/15 via-violet-500/5", tile: "bg-violet-500/20 text-violet-300", glow: "bg-violet-500/20" },
};

const ROLE_TONE = {
  SuperAdmin: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Admin: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Moderator: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Cashier: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function StatCard({ Icon, label, value, sub, foot, tone = "emerald", secretSub, revealed, onToggleSecret, revealLabel, hideLabel }) {
  const c = TONES[tone] || TONES.emerald;
  return (
    <div className={`ctrl-card relative flex min-h-[7.5rem] flex-col overflow-hidden bg-gradient-to-br ${c.grad} to-transparent p-5`}>
      <span className={`pointer-events-none absolute -start-8 -top-10 h-24 w-24 rounded-full ${c.glow} blur-2xl`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
          <p className="mt-2 truncate text-2xl font-bold text-text">{value}</p>
          {sub && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <span className="truncate">{secretSub && !revealed ? MASK : sub}</span>
              {secretSub && (
                <button type="button" onClick={onToggleSecret} title={revealed ? hideLabel : revealLabel}
                  className="shrink-0 text-muted transition hover:text-text">
                  {revealed ? <IconEyeOff width={14} height={14} /> : <IconEye width={14} height={14} />}
                </button>
              )}
            </p>
          )}
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.tile}`}>
          <Icon width={22} height={22} />
        </span>
      </div>
      {foot && <div className="relative mt-auto border-t border-border/60 pt-2">{foot}</div>}
    </div>
  );
}

function RoleBadge({ role, label }) {
  const cls = ROLE_TONE[role] || "bg-elevated text-muted border-border";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      <IconShield width={12} height={12} /> {label}
    </span>
  );
}

export default function Users() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [showRevenue, setShowRevenue] = useState(false); // masked ("***") on every load

  const [modal, setModal] = useState({ open: false, mode: "add", user: null });
  const [resetting, setResetting] = useState(null);
  const [cred, setCred] = useState(null);

  const canAccess = !!user && user.role_level >= MODERATOR_LEVEL;

  const roleLabel = useCallback(
    (r) => t(`users.roles.${r}`, { defaultValue: r }),
    [t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, s, rl] = await Promise.all([listUsers(), getUserStats(), listAssignableRoles()]);
      setItems(rows);
      setStats(s);
      setRoles(rl);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (canAccess) load();
  }, [canAccess, load]);

  const money = useCallback(
    (n) => {
      const value = Number(n || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${value} ${stats?.currency || ""}`.trim();
    },
    [stats]
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) =>
      [x.username, x.full_name, x.role].some((v) => (v || "").toLowerCase().includes(s))
    );
  }, [items, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  useEffect(() => setPage(1), [q]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  if (authLoading) return null;
  if (!canAccess) return <Navigate to="/dashboard" replace />;

  function afterSaved(saved) {
    load();
    if (saved?.password) setCred({ username: saved.username, password: saved.password });
  }

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text";

  const topFoot = (label, seller) => (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 font-semibold text-accent">
        <IconTrendUp width={14} height={14} />
        {seller ? seller.name : t("users.stats.none")}
      </span>
      <span className="truncate text-muted">{label}</span>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("users.title")}</h1>
          <p className="text-sm text-muted">{t("users.subtitle")}</p>
        </div>
        <button onClick={() => setModal({ open: true, mode: "add", user: null })}
          disabled={roles.length === 0}
          className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95 disabled:opacity-40">
          <IconPlus width={16} height={16} /> {t("users.add")}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard tone="emerald" Icon={IconUsers} label={t("users.stats.total")}
          value={stats?.total ?? "—"}
          foot={
            <div className="flex items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                <IconTrendUp width={14} height={14} />{stats?.newThisMonth ?? 0}
              </span>
              <span className="truncate text-muted">{t("users.stats.newThisMonth")}</span>
            </div>
          } />
        <StatCard tone="sky" Icon={IconCheck} label={t("users.stats.active")}
          value={stats ? `${stats.active}/${stats.total}` : "—"}
          foot={<p className="truncate text-xs text-muted">{t("users.stats.activeSub")}</p>} />
        <StatCard tone="violet" Icon={IconStar} label={t("users.stats.topSeller")}
          value={stats?.topSeller ? stats.topSeller.name : t("users.stats.none")}
          sub={stats?.topSeller ? money(stats.topSeller.revenue) : ""}
          secretSub={!!stats?.topSeller} revealed={showRevenue}
          onToggleSecret={() => setShowRevenue((v) => !v)}
          revealLabel={t("users.show")} hideLabel={t("users.hide")}
          foot={topFoot(t("users.stats.topThisMonth"), stats?.topSellerMonth)} />
        <StatCard tone="amber" Icon={IconShield} label={t("users.stats.roles")}
          value={stats ? Object.keys(stats.byRole || {}).length : "—"}
          foot={
            <div className="flex flex-wrap gap-1">
              {stats && Object.entries(stats.byRole || {}).map(([r, n]) => (
                <span key={r} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
                  {roleLabel(r)}: {n}
                </span>
              ))}
            </div>
          } />
      </div>

      {/* Search */}
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
          <IconSearch width={18} height={18} />
        </span>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t("users.search")} className="ctrl-input py-2.5 ps-10" />
      </div>

      {/* Table */}
      <div className="ctrl-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-4">
              <div className="h-9 animate-pulse rounded-lg bg-elevated" />
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-elevated/70" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-muted">
                <IconUsers width={30} height={30} />
              </span>
              <div>
                <p className="text-lg font-semibold text-text">{t("users.empty")}</p>
                <p className="mt-1 text-sm text-muted">{t("users.emptyBody")}</p>
              </div>
            </div>
          ) : (
            <table className="ctrl-table w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-medium">{t("users.table.username")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("users.table.fullName")}</th>
                  <th className="px-4 py-3 text-center font-medium">{t("users.table.role")}</th>
                  <th className="px-4 py-3 text-center font-medium">{t("users.table.status")}</th>
                  <th className="px-4 py-3 text-center font-medium">{t("users.table.sales")}</th>
                  <th className="px-4 py-3 text-end font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {t("users.table.revenue")}
                      <button type="button" onClick={() => setShowRevenue((v) => !v)}
                        title={showRevenue ? t("users.hide") : t("users.show")}
                        className="text-muted transition hover:text-text">
                        {showRevenue ? <IconEyeOff width={15} height={15} /> : <IconEye width={15} height={15} />}
                      </button>
                    </span>
                  </th>
                  <th className="px-4 py-3 text-end font-medium">{t("users.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 transition hover:bg-elevated/40">
                    <td className="px-4 py-3 font-medium text-text" dir="ltr">
                      <span className="inline-flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-elevated text-muted">
                          {u.image_url ? (
                            <img src={mediaUrl(u.image_url)} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <IconUser width={15} height={15} />
                          )}
                        </span>
                        {u.username}
                        {u.is_self && (
                          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                            {t("users.you")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{u.full_name || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <RoleBadge role={u.role} label={roleLabel(u.role)} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.is_active ? (
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                          {t("users.active")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-300">
                          {t("users.inactive")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-muted">{u.sales}</td>
                    <td className="px-4 py-3 text-end font-medium text-text tabular-nums">{showRevenue ? money(u.revenue) : MASK}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button title={t("users.edit")} className={iconBtn}
                          disabled={!u.manageable}
                          onClick={() => setModal({ open: true, mode: "edit", user: u })}>
                          <IconEdit width={15} height={15} />
                        </button>
                        <button title={t("users.reset.action")} className={iconBtn}
                          disabled={!u.manageable}
                          onClick={() => setResetting(u)}>
                          <IconKey width={15} height={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!loading && filtered.length > 0 && pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40">
              {isAr ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
              {t("products.pagination.prev")}
            </button>
            <span className="text-sm text-muted">{t("products.pagination.pageOf", { page, pages: pageCount })}</span>
            <button disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40">
              {t("products.pagination.next")}
              {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      <UserModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.user}
        roles={roles}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onSaved={afterSaved}
      />
      <ResetPasswordModal
        open={!!resetting}
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={(c) => setCred(c)}
      />
      <CredentialDialog
        open={!!cred}
        cred={cred}
        onClose={() => setCred(null)}
      />
    </div>
  );
}
