import { useTranslation } from "react-i18next";
import UserMenu from "./UserMenu";
import { IconMenu } from "@/components/icons";

export default function Topbar({ onOpenMobile }) {
  const { t } = useTranslation();

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

      <div className="flex flex-1 items-center" />

      <UserMenu />
    </header>
  );
}
