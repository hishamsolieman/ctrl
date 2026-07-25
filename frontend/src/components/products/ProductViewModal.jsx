import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { mediaUrl } from "@/lib/products";
import { IconImage } from "@/components/icons";

function formatPrice(v) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function ProductViewModal({ open, product, attributes, currency, onClose }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  if (!product) return null;

  const attrById = Object.fromEntries((attributes || []).map((a) => [a.id, a]));
  const valueById = {};
  (attributes || []).forEach((a) =>
    a.values.forEach((v) => (valueById[v.id] = { ...v, attribute: a }))
  );

  function variantChips(variant) {
    const entries = Object.entries(variant.attributes || {});
    return entries.map(([aid, vid]) => {
      const attr = attrById[aid];
      const val = valueById[vid];
      if (!attr || !val) return null;
      const label = `${isAr ? attr.name_ar : attr.name_en}: ${
        isAr ? val.value_ar : val.value_en
      }`;
      return (
        <span
          key={aid}
          className="inline-flex items-center gap-1.5 rounded-md bg-elevated px-2 py-1 text-xs text-muted"
        >
          {val.extra?.hex && (
            <span
              className="h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: val.extra.hex }}
            />
          )}
          {label}
        </span>
      );
    });
  }

  const categoryName = isAr ? product.category_name_ar : product.category_name_en;

  return (
    <Modal open={open} onClose={onClose} title={t("products.detail.title")} size="lg">
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-bold text-text">{product.name}</h3>
          {categoryName && <p className="mt-0.5 text-sm text-accent">{categoryName}</p>}
        </div>

        {/* Prices */}
        <div className="grid grid-cols-3 gap-3">
          {[
            ["detail.price", product.price],
            ["detail.minPrice", product.min_price],
            ["detail.supplierPrice", product.supplier_price],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-elevated px-3 py-2">
              <p className="text-[11px] text-muted">{t(`products.${k}`)}</p>
              <p className="text-sm font-semibold text-text">
                {formatPrice(v)} <span className="text-xs text-muted">{currency}</span>
              </p>
            </div>
          ))}
        </div>

        {product.description && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t("products.detail.description")}</p>
            <p className="text-sm text-text">{product.description}</p>
          </div>
        )}
        {product.note && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t("products.detail.note")}</p>
            <p className="text-sm text-text">{product.note}</p>
          </div>
        )}
        {product.supplier_name && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t("products.detail.supplier")}</p>
            <p className="text-sm text-text">{product.supplier_name}</p>
          </div>
        )}
        {product.tags?.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t("products.detail.tags")}</p>
            <div className="flex flex-wrap gap-2">
              {product.tags.map((tag) => (
                <span key={tag} className="rounded-md bg-accent/15 px-2 py-1 text-xs text-accent">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Variants */}
        <div>
          <p className="mb-2 text-xs font-medium text-muted">{t("products.detail.variants")}</p>
          <div className="space-y-3">
            {product.variants.map((v) => (
              <div key={v.id} className="rounded-xl border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm text-text">{v.code}</span>
                  <div className="flex flex-wrap justify-end gap-2">{variantChips(v)}</div>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                  {v.images.length > 0 ? (
                    v.images.map((img) => (
                      <img
                        key={img.id}
                        src={mediaUrl(img.url)}
                        alt=""
                        className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover"
                      />
                    ))
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-border text-muted">
                      <IconImage width={20} height={20} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
