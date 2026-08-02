import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/lib/products";
import { IconImage, IconEye, IconEdit, IconCopy, IconTrash, IconCart } from "@/components/icons";

function formatPrice(v) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ProductTable({
  products,
  currency,
  selected,
  pageAllSelected,
  onToggleSelect,
  onToggleSelectAll,
  onView,
  onEdit,
  onCopy,
  onDelete,
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";

  return (
    // `h-full` lets the rows stretch to fill the container so a full page of 8
    // rows spans the available height (no leftover empty space at the bottom).
    <table className="h-full w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10 bg-surface">
        <tr className="h-px border-b border-border text-xs uppercase tracking-wide text-muted">
          <th className="w-10 px-3 py-3">
            <input type="checkbox" className="ctrl-check" checked={pageAllSelected} onChange={onToggleSelectAll} />
          </th>
          <th className="w-14 px-3 py-3" />
          <th className="px-3 py-3 text-start font-medium">{t("products.table.code")}</th>
          <th className="px-3 py-3 text-start font-medium">{t("products.table.name")}</th>
          <th className="px-3 py-3 text-start font-medium">{t("products.table.category")}</th>
          <th className="px-3 py-3 text-end font-medium">{t("products.table.price")}</th>
          <th className="px-3 py-3 text-center font-medium">{t("products.table.quantity")}</th>
          <th className="px-3 py-3 text-center font-medium">{t("products.table.stock")}</th>
          <th className="px-3 py-3 text-end font-medium">{t("products.table.actions")}</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => {
          const img = p.images?.[0];
          const categoryName = isAr ? p.category_name_ar : p.category_name_en;
          const inStock = Number(p.quantity || 0) > 0;
          return (
            <tr key={p.id} className="border-b border-border/60 transition hover:bg-elevated/40">
              <td className="px-3 py-2.5">
                <input type="checkbox" className="ctrl-check" checked={!!selected[p.id]}
                  onChange={() => onToggleSelect?.(p)} />
              </td>
              <td className="px-3 py-2.5">
                <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-elevated">
                  {img ? (
                    <img src={mediaUrl(img.url)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted">
                      <IconImage width={16} height={16} />
                    </div>
                  )}
                </div>
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-muted">{p.code}</td>
              <td className="px-3 py-2.5 font-medium text-text">{p.name}</td>
              <td className="px-3 py-2.5 text-muted">{categoryName || "—"}</td>
              <td className="px-3 py-2.5 text-end text-text">
                {formatPrice(p.price)} <span className="text-xs text-muted">{currency}</span>
              </td>
              <td className="px-3 py-2.5 text-center text-text">{Number(p.quantity || 0)}</td>
              <td className="px-3 py-2.5 text-center">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    inStock ? "bg-accent/20 text-accent" : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {inStock ? t("products.inStock") : t("products.soldOut")}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center justify-end gap-2">
                  <button title={t("products.addToCart")}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-black transition hover:brightness-95">
                    <IconCart width={15} height={15} />
                  </button>
                  <button title={t("products.viewAction")} className={iconBtn} onClick={() => onView?.(p)}>
                    <IconEye width={15} height={15} />
                  </button>
                  <button title={t("products.edit")} className={iconBtn} onClick={() => onEdit?.(p)}>
                    <IconEdit width={15} height={15} />
                  </button>
                  <button title={t("products.copy")} className={iconBtn} onClick={() => onCopy?.(p)}>
                    <IconCopy width={15} height={15} />
                  </button>
                  <button title={t("products.delete")}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition hover:bg-red-500 hover:text-white"
                    onClick={() => onDelete?.(p)}>
                    <IconTrash width={15} height={15} />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
