import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { mediaUrl } from "@/lib/products";
import { IconImage } from "@/components/icons";

export default function CategoryViewModal({ open, category, onClose }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  if (!category) return null;

  return (
    <Modal open={open} onClose={onClose} title={t("categories.detail.title")} size="lg">
      <div className="space-y-4">
        <div className="mx-auto aspect-[3/4] w-[336px] max-w-full overflow-hidden rounded-xl border border-border bg-elevated">
          {category.image_url ? (
            <img src={mediaUrl(category.image_url)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted">
              <IconImage width={32} height={32} />
            </div>
          )}
        </div>
        <div>
          <h3 className="text-lg font-bold text-text">{isAr ? category.name_ar : category.name_en}</h3>
          <p className="text-sm text-muted">{isAr ? category.name_en : category.name_ar}</p>
        </div>
        {category.description && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t("categories.detail.description")}</p>
            <p className="text-sm text-text">{category.description}</p>
          </div>
        )}
        <div className="rounded-lg border border-border bg-elevated px-3 py-2">
          <p className="text-xs text-muted">{t("categories.detail.products")}</p>
          <p className="text-sm font-semibold text-text">{category.product_count}</p>
        </div>
      </div>
    </Modal>
  );
}
