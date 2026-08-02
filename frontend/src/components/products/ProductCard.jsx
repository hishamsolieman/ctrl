import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/lib/products";
import {
  IconCart,
  IconImage,
  IconEye,
  IconEdit,
  IconCopy,
  IconTrash,
} from "@/components/icons";

function formatPrice(v) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ProductCard({ product, currency, selected, onToggleSelect, onView, onEdit, onCopy, onDelete, onAddToCart }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const images = product.images || [];
  const [idx, setIdx] = useState(0);

  // Advance the carousel on a randomized 1.5–3s cadence (re-rolled every tick)
  // so cards across the grid don't all swipe in unison.
  useEffect(() => {
    if (images.length <= 1) return;
    let timer;
    const rand = () => 1500 + Math.random() * 1500;
    const tick = () => {
      setIdx((i) => (i + 1) % images.length);
      timer = setTimeout(tick, rand());
    };
    timer = setTimeout(tick, rand());
    return () => clearTimeout(timer);
  }, [images.length]);

  const categoryName = isAr ? product.category_name_ar : product.category_name_en;
  const variantCount = product.variants?.length || 0;
  const inStock = Number(product.quantity || 0) > 0;

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-full bg-bg/80 text-text backdrop-blur transition hover:bg-accent hover:text-black";

  return (
    <div
      className={`group relative flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-surface transition ${
        selected ? "border-accent" : "border-border hover:border-accent/60"
      }`}
    >
      {/* Image / carousel — fills the available height so cards adapt to the page */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-elevated">
        {images.length > 0 ? (
          <div
            className="flex h-full w-full transition-transform duration-700 ease-in-out"
            style={{ transform: `translateX(${isAr ? "" : "-"}${idx * 100}%)` }}
          >
            {images.map((img) => (
              <img
                key={img.id}
                src={mediaUrl(img.url)}
                alt={product.name}
                className="h-full w-full shrink-0 object-cover"
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <IconImage width={44} height={44} />
          </div>
        )}

        {/* Select checkbox — top-left (matches product categories) */}
        <label className="absolute start-3 top-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect?.(product)}
            className="h-5 w-5 cursor-pointer rounded-md border-0 bg-white/90 shadow-md ring-1 ring-black/10 accent-accent"
          />
        </label>

        {/* Stock status — bottom-left */}
        <span
          className={`absolute bottom-3 start-3 rounded-full px-2.5 py-1 text-[10px] font-semibold shadow-md backdrop-blur ${
            inStock ? "bg-accent/90 text-black" : "bg-red-500/90 text-white"
          }`}
        >
          {inStock ? t("products.inStock") : t("products.soldOut")}
        </span>

        {/* Add to cart — bottom-right */}
        <button
          type="button"
          title={t("products.addToCart")}
          onClick={() => onAddToCart?.(product)}
          className="absolute bottom-3 end-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-black shadow-accent transition hover:scale-105"
        >
          <IconCart width={17} height={17} />
        </button>

        {/* Actions (hover) */}
        <div className="absolute end-3 top-3 flex gap-2 opacity-0 transition group-hover:opacity-100">
          <button type="button" title={t("products.viewAction")} className={iconBtn}
            onClick={() => onView?.(product)}>
            <IconEye width={15} height={15} />
          </button>
          <button type="button" title={t("products.edit")} className={iconBtn}
            onClick={() => onEdit?.(product)}>
            <IconEdit width={15} height={15} />
          </button>
          <button type="button" title={t("products.copy")} className={iconBtn}
            onClick={() => onCopy?.(product)}>
            <IconCopy width={15} height={15} />
          </button>
          <button type="button" title={t("products.delete")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-bg/80 text-red-400 backdrop-blur transition hover:bg-red-500 hover:text-white"
            onClick={() => onDelete?.(product)}>
            <IconTrash width={15} height={15} />
          </button>
        </div>

        {/* Carousel dots */}
        {images.length > 1 && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {images.map((img, i) => (
              <span
                key={img.id}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "w-4 bg-accent" : "w-1.5 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex shrink-0 flex-col p-3">
        <div className="flex items-center justify-between">
          {categoryName ? (
            <p className="text-[11px] font-medium uppercase tracking-wide text-accent">
              {categoryName}
            </p>
          ) : (
            <span />
          )}
          <span className="text-[10px] text-muted">
            {variantCount <= 1 ? t("products.oneVariant") : t("products.variantsCount", { count: variantCount })}
          </span>
        </div>
        <h6 className="mt-1 truncate text-sm font-semibold text-text group-hover:text-accent">
          {product.name}
        </h6>
        <p className="mt-2 text-base font-bold text-text">
          {formatPrice(product.price)}{" "}
          <span className="text-xs font-medium text-muted">{currency}</span>
        </p>
      </div>
    </div>
  );
}
