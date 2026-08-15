import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import brand from "@/config/brand";
import {
  IconDashboard,
  IconBox,
  IconGrid,
  IconTrendUp,
  IconList,
  IconTag,
  IconSliders,
  IconTruck,
  IconCart,
  IconUser,
  IconUsers,
  IconReceipt,
  IconActivity,
  IconSettings,
  IconBarcode,
  IconBriefcase,
  IconCoins,
  IconWallet,
  IconChevronDown,
} from "@/components/icons";

// `minLevel` (when set) hides the item from users below that privilege level.
const NAV = [
  {
    key: "nav.dashboard",
    Icon: IconDashboard,
    children: [
      { to: "/dashboard", key: "nav.dashboardOverview", Icon: IconGrid, end: true, minLevel: 30 },
      { to: "/dashboard/today", key: "nav.todaySales", Icon: IconTrendUp },
    ],
  },
  { to: "/pos", key: "nav.pos", Icon: IconCart },
  {
    key: "nav.products",
    Icon: IconBox,
    children: [
      { to: "/products/list", key: "nav.productList", Icon: IconList },
      { to: "/products/categories", key: "nav.productCategories", Icon: IconTag, minLevel: 20 },
      { to: "/products/attributes", key: "nav.productAttributes", Icon: IconSliders, minLevel: 40 },
      { to: "/products/barcode", key: "nav.productBarcode", Icon: IconBarcode },
    ],
  },
  {
    key: "nav.business",
    Icon: IconBriefcase,
    children: [
      { to: "/suppliers", key: "nav.suppliers", Icon: IconTruck, minLevel: 20 },
      { to: "/customers", key: "nav.customers", Icon: IconUser, minLevel: 20 },
      { to: "/invoices", key: "nav.invoices", Icon: IconReceipt, minLevel: 20 },
      { to: "/business/expenses", key: "nav.expenses", Icon: IconWallet },
      { to: "/business/funds", key: "nav.funds", Icon: IconCoins, minLevel: 30 },
    ],
  },
  { to: "/users", key: "nav.users", Icon: IconUsers, minLevel: 20 },
  { to: "/logs", key: "nav.logs", Icon: IconActivity, minLevel: 40 },
  { to: "/settings", key: "nav.settings", Icon: IconSettings, minLevel: 30 },
];

const linkBase =
  "group flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition";

export default function Sidebar({ collapsed, mobileOpen, onClose, onToggleCollapse }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const level = user?.role_level ?? 0;
  // Hide items above the user's privilege level, children included; a group with
  // nothing left to show disappears entirely.
  const allowed = (item) => item.minLevel == null || level >= item.minLevel;
  const nav = NAV.filter(allowed)
    .map((item) =>
      item.children ? { ...item, children: item.children.filter(allowed) } : item
    )
    .filter((item) => !item.children || item.children.length > 0);
  const isRtl = i18n.dir() === "rtl";
  const { pathname } = useLocation();
  const chevronRotated = collapsed !== isRtl;

  const groupHasActive = (group) =>
    group.children.some((c) => pathname === c.to || pathname.startsWith(c.to + "/"));

  const [open, setOpen] = useState({});
  useEffect(() => {
    NAV.forEach((item) => {
      if (item.children && groupHasActive(item)) {
        setOpen((o) => ({ ...o, [item.key]: true }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function leafLink(item, indented = false) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={onClose}
        title={collapsed ? t(item.key) : undefined}
        className={({ isActive }) =>
          `${linkBase} ${collapsed ? "justify-center px-0" : indented ? "ps-11 pe-3" : "px-3"} ${
            isActive ? "bg-elevated text-text" : "text-muted hover:bg-elevated hover:text-text"
          }`
        }
      >
        {({ isActive }) => (
          <>
            <span className={isActive ? "text-accent" : "text-muted group-hover:text-text"}>
              <item.Icon />
            </span>
            {!collapsed && t(item.key)}
          </>
        )}
      </NavLink>
    );
  }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`fixed inset-y-0 start-0 z-40 flex flex-col border-e border-border bg-surface
                    transition-all duration-300 lg:static lg:translate-x-0
                    ${collapsed ? "lg:w-20" : "lg:w-64"} w-64
                    ${mobileOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full lg:rtl:translate-x-0"}`}
      >
        {/* Brand + collapse toggle */}
        <div
          className={`flex h-16 items-center justify-between border-b border-border px-5 ${
            collapsed ? "lg:justify-center lg:px-2" : ""
          }`}
        >
          <img src={brand.logo} alt={brand.name} className={`h-6 ${collapsed ? "lg:hidden" : ""}`} />
          <button
            type="button"
            onClick={onToggleCollapse}
            title={t("nav.menu")}
            aria-label={t("nav.menu")}
            className="hidden rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-text lg:inline-flex"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform duration-300 ${chevronRotated ? "rotate-180" : ""}`}>
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {!collapsed && (
            <p className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
              {t("nav.menu")}
            </p>
          )}

          {nav.map((item, index) => {
            if (!item.children) return leafLink(item);

            // Collapsed: render children as icon-only links (parent has no route).
            if (collapsed) {
              // After Business, a hard divider separates it from Users / Logs / Settings.
              const afterBusiness = item.key === "nav.business";
              return (
                <div
                  key={item.key}
                  className={`space-y-1 ${index > 0 ? "border-t border-border pt-1" : ""} ${
                    afterBusiness ? "mb-1 border-b border-border pb-1" : ""
                  }`}
                >
                  {item.children.map((c) => leafLink(c))}
                </div>
              );
            }

            const isOpen = !!open[item.key];
            const active = groupHasActive(item);
            return (
              <div key={item.key}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [item.key]: !o[item.key] }))}
                  className={`${linkBase} w-full px-3 ${
                    active ? "text-text" : "text-muted hover:bg-elevated hover:text-text"
                  }`}
                >
                  <span className={active ? "text-accent" : "text-muted group-hover:text-text"}>
                    <item.Icon />
                  </span>
                  <span className="flex-1 text-start">{t(item.key)}</span>
                  <IconChevronDown
                    width={16}
                    height={16}
                    className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && <div className="mt-1 space-y-1">{item.children.map((c) => leafLink(c, true))}</div>}
              </div>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="border-t border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted">{brand.motto}</p>
          </div>
        )}
      </aside>
    </>
  );
}
