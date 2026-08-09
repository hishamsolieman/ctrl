import { useTranslation } from "react-i18next";
import { useBrand } from "@/context/BrandContext";
import UserMenu from "./UserMenu";
import { IconMenu } from "@/components/icons";

export default function Topbar({ onOpenMobile, collapsed }) {
  const { t } = useTranslation();
  const brand = useBrand();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-border bg-bg/80 px-4 backdrop-blur lg:px-6">
      {/* Mobile-only: open the sidebar drawer. Desktop collapse lives in the sidebar. */}
      <button
        type="button"
        onClick={onOpenMobile}
        className="rounded-lg p-2 text-muted transition hover:bg-elevated hover:text-text lg:hidden"
        aria-label={t("nav.menu")}
      >
        <IconMenu />
      </button>

      {/* When the desktop sidebar is collapsed the brand leaves that rail —
          keep the logo here so it stays visible. */}
      <div className="flex min-w-0 flex-1 items-center">
        {collapsed && (
          <img
            src={brand.logo}
            alt={brand.name}
            className="hidden h-6 lg:block"
          />
        )}
      </div>

      <UserMenu />
    </header>
  );
}
