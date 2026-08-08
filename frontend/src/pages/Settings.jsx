import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import PrinterSettings from "@/components/settings/PrinterSettings";
import { IconSettings, IconPrinter } from "@/components/icons";

const ADMIN_LEVEL = 30;

const TABS = [
  { key: "general", Icon: IconSettings },
  { key: "printer", Icon: IconPrinter },
];

export default function Settings() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [tab, setTab] = useState("printer");

  if (loading) return null;
  if (!user || (user.role_level ?? 0) < ADMIN_LEVEL) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text">{t("settings.title")}</h1>
        <p className="text-sm text-muted">{t("settings.subtitle")}</p>
      </div>

      {/* Horizontal tabs — fill the width */}
      <div className="flex rounded-xl border border-border bg-surface p-1">
        {TABS.map(({ key, Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
              tab === key ? "bg-accent text-black" : "text-muted hover:bg-elevated hover:text-text"
            }`}>
            <Icon width={16} height={16} />
            {t(`settings.tabs.${key}`)}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "printer" ? (
          <PrinterSettings />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated">
              <IconSettings width={26} height={26} />
            </span>
            <p className="text-sm">{t("settings.general.placeholder")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
