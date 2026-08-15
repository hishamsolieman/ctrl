import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import PrinterSettings from "@/components/settings/PrinterSettings";
import GeneralSettings from "@/components/settings/GeneralSettings";
import ProfileSettings from "@/components/settings/ProfileSettings";
import { IconSettings, IconPrinter, IconUser } from "@/components/icons";

const ADMIN_LEVEL = 30;

export default function Settings() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const isAdmin = (user?.role_level ?? 0) >= ADMIN_LEVEL;

  const tabs = [
    { key: "profile", Icon: IconUser },
    ...(isAdmin
      ? [
          { key: "general", Icon: IconSettings },
          { key: "printer", Icon: IconPrinter },
        ]
      : []),
  ];

  const [tab, setTab] = useState(null);
  const fallback = isAdmin ? "general" : "profile";
  const active = tabs.some((x) => x.key === tab) ? tab : fallback;

  if (loading) return null;
  if (!user) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">{t("settings.title")}</h1>
        <p className="text-sm text-muted">{t("settings.subtitle")}</p>
      </div>

      <div className="flex rounded-xl border border-border bg-surface p-1">
        {tabs.map(({ key, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
              active === key ? "bg-accent text-black" : "text-muted hover:bg-elevated hover:text-text"
            }`}
          >
            <Icon width={16} height={16} />
            {t(`settings.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {active === "profile" && <ProfileSettings />}
        {active === "general" && isAdmin && <GeneralSettings />}
        {active === "printer" && isAdmin && <PrinterSettings />}
      </div>
    </div>
  );
}
