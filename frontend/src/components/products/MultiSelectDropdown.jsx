import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { IconChevronDown, IconSearch } from "@/components/icons";

/**
 * A dropdown multi-select with a search box and checkboxes.
 * - `options`: [{ id, label, hex? }]
 * - `selected`: array of ids
 * - `onChange(nextIds)`
 * - `showColors`: render a coloured circle next to each option (hex)
 * - `summaryAll` / `summaryEmpty`: button text when all / none are selected
 *
 * The panel is rendered in a portal (fixed-positioned) so it is never clipped by
 * the filter rail's scroll area, and its height is fitted to the remaining space
 * down to the bottom of the viewport — its own list scrolls, not the filter area.
 */
export default function MultiSelectDropdown({
  options,
  selected,
  onChange,
  showColors = false,
  summaryAll,
  summaryEmpty,
  searchPlaceholder,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    // Open upward only when there's clearly more room above than below.
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(180, Math.min(openUp ? spaceAbove : spaceBelow, 520));
    setRect({
      left: r.left,
      width: r.width,
      openUp,
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
      maxHeight,
    });
  };

  const close = () => setOpen(false);
  const openPanel = () => {
    place();
    setQuery("");
    setOpen(true);
  };

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

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => (o.label || "").toLowerCase().includes(s));
  }, [options, query]);

  const count = selected.length;
  const summary =
    count === 0
      ? summaryEmpty ?? t("products.filters.any")
      : count === options.length
      ? summaryAll ?? t("products.filters.allSelected")
      : t("products.filters.nSelected", { count });

  function toggle(id) {
    const next = new Set(selectedSet);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange([...next]);
  }
  const selectAll = () => onChange(options.map((o) => o.id));
  const clearAll = () => onChange([]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={() => (open ? close() : openPanel())}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text transition hover:border-accent/50"
      >
        <span className="truncate">{summary}</span>
        <IconChevronDown width={16} height={16} className="shrink-0 text-muted" />
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
            {/* Search + bulk actions */}
            <div className="shrink-0 border-b border-border p-2">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-muted">
                  <IconSearch width={15} height={15} />
                </span>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder ?? t("common.search")}
                  className="ctrl-input-sm w-full ps-8 text-sm"
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <button type="button" onClick={selectAll} className="font-medium text-accent hover:underline">
                  {t("products.filters.selectAll")}
                </button>
                <button type="button" onClick={clearAll} className="font-medium text-muted hover:text-text">
                  {t("products.filters.clear")}
                </button>
              </div>
            </div>

            {/* Options */}
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted">—</p>
              ) : (
                filtered.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted transition hover:bg-elevated hover:text-text"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="ctrl-check"
                    />
                    {showColors && (
                      <span
                        className="h-4 w-4 shrink-0 rounded-full border border-white/20"
                        style={{ backgroundColor: o.hex || "#888" }}
                      />
                    )}
                    <span className="truncate">{o.label}</span>
                  </label>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
