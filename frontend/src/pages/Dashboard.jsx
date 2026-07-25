import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { IconBox } from "@/components/icons";

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const brand = useBrand();

  return (
    <div className="flex w-full flex-1 flex-col gap-8">
      <div>
        <p className="text-sm text-accent">{t("dashboard.welcome")}</p>
        <h1 className="mt-1 text-2xl font-bold text-text">
          {user?.full_name || user?.username}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {t("dashboard.overview", { brand: brand.name })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="ctrl-card p-5">
          <p className="text-xs uppercase tracking-widest text-muted">
            {t("dashboard.roleLabel")}
          </p>
          <p className="mt-2 text-lg font-semibold text-accent">{user?.role}</p>
        </div>

        <a
          href="/products"
          className="ctrl-card group flex items-center gap-4 p-5 transition hover:border-accent"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <IconBox />
          </span>
          <div>
            <p className="font-semibold text-text">{t("nav.products")}</p>
            <p className="text-xs text-muted">{t("products.subtitle")}</p>
          </div>
        </a>
      </div>
    </div>
  );
}
