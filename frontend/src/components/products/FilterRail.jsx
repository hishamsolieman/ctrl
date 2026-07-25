import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PriceRange from "@/components/products/PriceRange";
import { IconChevronDown } from "@/components/icons";

function Section({ title, children }) {
  return (
    <div className="border-b border-border px-4 py-4 last:border-b-0">
      {title && <h6 className="mb-3 text-sm font-semibold text-text">{title}</h6>}
      {children}
    </div>
  );
}

function SortDropdown({ value, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const options = [
    { key: "newest", label: t("products.sort.newest") },
    { key: "popular", label: t("products.sort.popular") },
    { key: "price_desc", label: t("products.sort.priceHighLow") },
    { key: "price_asc", label: t("products.sort.priceLowHigh") },
  ];
  const current = options.find((o) => o.key === value) || options[0];

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text transition hover:border-accent/50"
      >
        {current.label}
        <IconChevronDown width={16} height={16} className="text-muted" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-start text-sm transition hover:bg-elevated ${
                o.key === value ? "text-accent" : "text-text"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// One filter section per defined attribute. Colour-like attributes (values with
// a hex) render as swatches; everything else renders as chips.
function AttributeFilter({ attribute, isAr, selected, onToggle }) {
  const isColor =
    attribute.key === "color" || attribute.values.some((v) => v.extra?.hex);
  return (
    <Section title={isAr ? attribute.name_ar : attribute.name_en}>
      {isColor ? (
        <div className="flex flex-wrap gap-3">
          {attribute.values.map((v) => {
            const active = selected.includes(v.id);
            return (
              <button
                key={v.id}
                type="button"
                title={isAr ? v.value_ar : v.value_en}
                onClick={() => onToggle(v.id)}
                className={`relative h-7 w-7 rounded-full border-2 transition ${
                  active ? "border-accent" : "border-border hover:border-muted"
                }`}
                style={{ backgroundColor: v.extra?.hex || "#888" }}
              >
                {!v.extra?.hex && (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white">
                    {(isAr ? v.value_ar : v.value_en)?.slice(0, 2)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {attribute.values.map((v) => {
            const active = selected.includes(v.id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onToggle(v.id)}
                className={`min-w-[2.25rem] rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-accent bg-accent text-black"
                    : "border-border text-muted hover:border-accent/50 hover:text-text"
                }`}
              >
                {isAr ? v.value_ar : v.value_en}
              </button>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export default function FilterRail({
  categories,
  attributes,
  maxPrice,
  currency,
  filters,
  setFilters,
  onReset,
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";

  function toggleArray(field, val) {
    setFilters((f) => {
      const set = new Set(f[field]);
      set.has(val) ? set.delete(val) : set.add(val);
      return { ...f, [field]: [...set] };
    });
  }

  return (
    <div className="w-full">
      {/* Category */}
      <Section title={t("products.filters.byCategory")}>
        <div className="max-h-44 space-y-1 overflow-y-auto pe-1">
          {categories.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted transition hover:bg-elevated hover:text-text"
            >
              <input
                type="checkbox"
                checked={filters.categoryIds.includes(c.id)}
                onChange={() => toggleArray("categoryIds", c.id)}
                className="ctrl-check"
              />
              {isAr ? c.name_ar : c.name_en}
            </label>
          ))}
          {categories.length === 0 && <p className="px-2 py-1 text-sm text-muted">—</p>}
        </div>
      </Section>

      {/* Date */}
      <Section title={t("products.filters.byDate")}>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t("products.filters.from")}</span>
            <input
              type="datetime-local"
              value={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="ctrl-input-sm w-full text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t("products.filters.to")}</span>
            <input
              type="datetime-local"
              value={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="ctrl-input-sm w-full text-sm"
            />
          </label>
        </div>
      </Section>

      {/* Sort */}
      <Section title={t("products.filters.sortBy")}>
        <SortDropdown value={filters.sort} onChange={(v) => setFilters((f) => ({ ...f, sort: v }))} />
      </Section>

      {/* Price */}
      <Section title={t("products.filters.byPrice")}>
        <PriceRange
          min={0}
          max={maxPrice}
          value={[filters.priceMin ?? 0, filters.priceMax ?? maxPrice]}
          onChange={([lo, hi]) => setFilters((f) => ({ ...f, priceMin: lo, priceMax: hi }))}
          currency={currency}
        />
      </Section>

      {/* Dynamic attribute filters (Color, Size, ...) */}
      {attributes.map((attr) => (
        <AttributeFilter
          key={attr.id}
          attribute={attr}
          isAr={isAr}
          selected={filters.attrValues}
          onToggle={(id) => toggleArray("attrValues", id)}
        />
      ))}

      {/* Reset */}
      <Section title="">
        <button
          type="button"
          onClick={onReset}
          className="ctrl-btn w-full border border-border text-text hover:bg-elevated"
        >
          {t("products.filters.reset")}
        </button>
      </Section>
    </div>
  );
}
