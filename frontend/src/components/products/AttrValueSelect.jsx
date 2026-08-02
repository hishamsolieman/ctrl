import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { IconSearch, IconChevronDown, IconPlus, IconCheck } from "@/components/icons";

// A searchable value picker for a product attribute. Renders its dropdown in a
// portal (fixed-positioned) so it is never clipped by the modal's scroll area.
// Supports an optional "add value" action and colour swatches for colour attrs.
export default function AttrValueSelect({
  attr,
  value,
  onChange,
  onAddValue,
  placeholder,
  className = "",
  allowAdd = true,
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const isColor = attr.type === "color";
  const values = attr.values || [];

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const label = (v) => (isAr ? v.value_ar : v.value_en) || v.value_en || v.value_ar;
  const selected = values.find((v) => v.id === Number(value));

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    // Open upward only when there's clearly more room above than below.
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(180, Math.min(openUp ? spaceAbove : spaceBelow, 440));
    setRect({
      left: r.left,
      width: r.width,
      openUp,
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
      maxHeight,
    });
  };

  function openPanel() {
    place();
    setQ("");
    setOpen(true);
  }
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      close();
    };
    const onScroll = (e) => {
      // Ignore scrolling inside the panel's own list.
      if (panelRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const term = q.trim().toLowerCase();
  const filtered = term
    ? values.filter((v) =>
        [v.value_en, v.value_ar].some((s) => (s || "").toLowerCase().includes(term))
      )
    : values;

  const swatch = (hex) => (
    <span className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: hex }} />
  );

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={() => (open ? close() : openPanel())}
        className={`${className} flex cursor-pointer items-center justify-between gap-2 text-start`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {isColor && selected?.extra?.hex && swatch(selected.extra.hex)}
          <span className={`truncate ${selected ? "text-text" : "text-muted"}`}>
            {selected ? label(selected) : placeholder || t("products.modal.selectValue")}
          </span>
        </span>
        <IconChevronDown width={15} height={15} className="shrink-0 text-muted" />
      </button>

      {open && rect &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              left: rect.left,
              width: Math.max(rect.width, 220),
              maxHeight: rect.maxHeight,
              ...(rect.openUp ? { bottom: rect.bottom } : { top: rect.top }),
            }}
            className="z-[110] flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
          >
            <div className="shrink-0 border-b border-border p-2">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-muted">
                  <IconSearch width={15} height={15} />
                </span>
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("products.modal.searchValue")}
                  className="ctrl-input-sm w-full ps-8 text-sm"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {!term && (
                <button
                  type="button"
                  onClick={() => { onChange(""); close(); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-elevated"
                >
                  {placeholder || t("products.modal.selectValue")}
                </button>
              )}
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted">
                  {t("products.modal.noResults")}
                </p>
              ) : (
                filtered.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => { onChange(String(v.id)); close(); }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text hover:bg-elevated"
                  >
                    {isColor && v.extra?.hex && swatch(v.extra.hex)}
                    <span className="min-w-0 flex-1 truncate text-start">{label(v)}</span>
                    {Number(value) === v.id && <IconCheck width={14} height={14} className="text-accent" />}
                  </button>
                ))
              )}
            </div>

            {allowAdd && (
              <div className="shrink-0 border-t border-border p-1">
                <button
                  type="button"
                  onClick={() => { close(); onAddValue?.(); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-accent hover:bg-elevated"
                >
                  <IconPlus width={14} height={14} /> {t("products.modal.addValue")}
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
