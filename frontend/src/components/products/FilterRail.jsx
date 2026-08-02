import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PriceRange from "@/components/products/PriceRange";
import MultiSelectDropdown from "@/components/products/MultiSelectDropdown";
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

// One dropdown filter per defined attribute (search + checkboxes; colour
// attributes show a coloured circle beside each value).
function AttributeFilter({ attribute, isAr, filters, setFilters }) {
  const { t } = useTranslation();
  const valueIds = attribute.values.map((v) => v.id);
  const selected = filters.attrValues.filter((id) => valueIds.includes(id));
  const options = attribute.values.map((v) => ({
    id: v.id,
    label: isAr ? v.value_ar : v.value_en,
    hex: v.extra?.hex,
  }));
  const showColors = attribute.type === "color";

  function onChange(ids) {
    setFilters((f) => {
      const others = f.attrValues.filter((id) => !valueIds.includes(id));
      return { ...f, attrValues: [...others, ...ids] };
    });
  }

  return (
    <Section title={isAr ? attribute.name_ar : attribute.name_en}>
      <MultiSelectDropdown
        options={options}
        selected={selected}
        onChange={onChange}
        showColors={showColors}
        summaryEmpty={t("products.filters.any")}
        summaryAll={t("products.filters.allSelected")}
        searchPlaceholder={t("products.filters.searchValues")}
      />
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

  const stockOptions = [
    { key: "all", label: t("products.filters.stockAll") },
    { key: "in", label: t("products.filters.stockIn") },
    { key: "out", label: t("products.filters.stockOut") },
  ];

  return (
    <div className="w-full">
      {/* Stock status — segmented control (default: All) */}
      <Section title={t("products.filters.byStock")}>
        <div className="flex gap-1 rounded-lg border border-border bg-elevated p-1">
          {stockOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, stock: o.key }))}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                (filters.stock || "all") === o.key
                  ? "bg-accent text-black"
                  : "text-muted hover:text-text"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Category — dropdown with search + checkboxes (all selected by default) */}
      <Section title={t("products.filters.byCategory")}>
        <MultiSelectDropdown
          options={categories.map((c) => ({ id: c.id, label: isAr ? c.name_ar : c.name_en }))}
          selected={filters.categoryIds}
          onChange={(ids) => setFilters((f) => ({ ...f, categoryIds: ids }))}
          summaryEmpty={t("products.filters.allCategories")}
          summaryAll={t("products.filters.allCategories")}
          searchPlaceholder={t("products.filters.searchCategory")}
        />
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

      {/* Dynamic attribute filters (dropdown with search + checkboxes) */}
      {attributes.map((attr) => (
        <AttributeFilter
          key={attr.id}
          attribute={attr}
          isAr={isAr}
          filters={filters}
          setFilters={setFilters}
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
