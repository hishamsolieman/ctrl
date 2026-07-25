import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import brand from "@/config/brand";
import { IconDashboard, IconBox } from "@/components/icons";

const NAV = [
  { to: "/dashboard", key: "nav.dashboard", Icon: IconDashboard },
  { to: "/products", key: "nav.products", Icon: IconBox },
];

export default function Sidebar({
  collapsed,
  mobileOpen,
  onClose,
  onToggleCollapse,
}) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  // Chevron points "outward" (collapse) when expanded, "inward" (expand) when
  // collapsed — mirrored for RTL where the sidebar sits on the right.
  const chevronRotated = collapsed !== isRtl;

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={onClose}
        />
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
          <img
            src={brand.logo}
            alt={brand.name}
            className={`h-6 ${collapsed ? "lg:hidden" : ""}`}
          />
          <button
            type="button"
            onClick={onToggleCollapse}
            title={t("nav.menu")}
            aria-label={t("nav.menu")}
            className="hidden rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-text lg:inline-flex"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-300 ${
                chevronRotated ? "rotate-180" : ""
              }`}
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {!collapsed && (
            <p className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
              {t("nav.menu")}
            </p>
          )}
          {NAV.map(({ to, key, Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              title={collapsed ? t(key) : undefined}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${
                  isActive
                    ? "bg-elevated text-text"
                    : "text-muted hover:bg-elevated hover:text-text"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`transition-colors ${
                      isActive ? "text-accent" : "text-muted group-hover:text-text"
                    }`}
                  >
                    <Icon />
                  </span>
                  {!collapsed && t(key)}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {!collapsed && (
          <div className="border-t border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted">
              {brand.motto}
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
