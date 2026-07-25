import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import brand from "@/config/brand";
import {
  IconDashboard,
  IconBox,
  IconList,
  IconTag,
  IconSliders,
  IconChevronDown,
} from "@/components/icons";

const NAV = [
  { to: "/dashboard", key: "nav.dashboard", Icon: IconDashboard },
  {
    key: "nav.products",
    Icon: IconBox,
    children: [
      { to: "/products", key: "nav.productList", Icon: IconList, end: true },
      { to: "/products/categories", key: "nav.productCategories", Icon: IconTag },
      { to: "/products/attributes", key: "nav.productAttributes", Icon: IconSliders },
    ],
  },
];

const linkBase =
  "group flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition";

export default function Sidebar({ collapsed, mobileOpen, onClose, onToggleCollapse }) {
  const { t, i18n } = useTranslation();
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

          {NAV.map((item) => {
            if (!item.children) return leafLink(item);

            // Collapsed: render children as icon-only links (parent has no route).
            if (collapsed) {
              return (
                <div key={item.key} className="space-y-1 border-t border-border pt-1">
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
