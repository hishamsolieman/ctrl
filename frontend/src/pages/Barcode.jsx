import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import { listBarcodeItems, logBarcodePrint } from "@/lib/products";
import { getPrintTarget, printDocument } from "@/lib/settings";
import { buildLabelSheet, money, labelInfo } from "@/lib/barcode";
import BarcodeSvg from "@/components/Barcode";
import {
  IconBarcode,
  IconSearch,
  IconPrinter,
  IconSettings,
  IconRefresh,
  IconChevronLeft,
  IconChevronRight,
} from "@/components/icons";

const PAGE_SIZE = 10;
const MAX_COPIES = 1000;

const clampCount = (v) => Math.max(1, Math.min(MAX_COPIES, Math.floor(Number(v) || 1)));

function sanitizePrice(raw) {
  let s = String(raw ?? "").replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot === -1) return s;
  s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  const [a, b = ""] = s.split(".");
  return `${a}.${b.slice(0, 2)}`;
}

function sanitizeInt(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

function printCode(it, source) {
  return source === "product" ? it.product_code || it.code : it.code;
}

export default function BarcodePage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [currency, setCurrency] = useState("");
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState({});
  const [printing, setPrinting] = useState(false);
  const [codeSource, setCodeSource] = useState("variant");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, target] = await Promise.all([
        listBarcodeItems(),
        getPrintTarget("barcode").catch(() => ({ profile: null })),
      ]);
      setItems(data.items);
      setCurrency(data.currency);
      setProfile(target.profile);
      setRows(
        Object.fromEntries(
          data.items.map((it) => [
            it.variant_id,
            {
              selected: false,
              price: Number(it.price || 0).toFixed(2),
              count: String(it.quantity),
              discountOn: false,
              salePrice: "",
            },
          ])
        )
      );
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (it) =>
        (it.product_name || "").toLowerCase().includes(term) ||
        (it.code || "").toLowerCase().includes(term) ||
        (it.product_code || "").toLowerCase().includes(term)
    );
  }, [items, q]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const setField = (id, key, val) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], [key]: val } }));

  const toggleAll = (checked) =>
    setRows((r) => {
      const next = { ...r };
      pageItems.forEach((it) => {
        next[it.variant_id] = { ...next[it.variant_id], selected: checked };
      });
      return next;
    });

  const allSelected = pageItems.length > 0 && pageItems.every((it) => rows[it.variant_id]?.selected);

  const selectedItems = useMemo(
    () => items.filter((it) => rows[it.variant_id]?.selected),
    [items, rows]
  );

  const totalLabels = useMemo(
    () => selectedItems.reduce((sum, it) => sum + clampCount(rows[it.variant_id]?.count), 0),
    [selectedItems, rows]
  );

  const active = useMemo(() => {
    const pick = selectedItems[0] || pageItems[0] || null;
    if (!pick) return null;
    const st = rows[pick.variant_id] || {};
    const price = Number(st.price);
    const sale = Number(st.salePrice);
    const hasDiscount = st.discountOn && sale > 0 && sale < price;
    return { it: pick, price, sale, hasDiscount, code: printCode(pick, codeSource) };
  }, [selectedItems, pageItems, rows, codeSource]);

  const info = useMemo(() => labelInfo(profile), [profile]);

  async function onPrint() {
    if (!profile) return toast.error(t("barcode.noProfile"));
    const printRows = selectedItems
      .map((it) => {
        const st = rows[it.variant_id] || {};
        const price = Number(st.price) || 0;
        const sale = Number(st.salePrice);
        const salePrice = st.discountOn && sale > 0 && sale < price ? sale : null;
        return {
          name: it.product_name,
          code: printCode(it, codeSource),
          price,
          salePrice,
          count: clampCount(st.count),
        };
      })
      .filter((r) => r.count > 0);
    if (printRows.length === 0) return toast.error(t("barcode.selectSome"));

    const total = printRows.reduce((s, r) => s + r.count, 0);
    setPrinting(true);
    try {
      const body = buildLabelSheet({ rows: printRows, currency, profile });
      await printDocument(body);
      logBarcodePrint(total, printRows.map((r) => ({ code: r.code, count: r.count })));
      toast.success(t("barcode.sent", { count: total }));
    } catch {
      toast.error(t("barcode.failed"));
    } finally {
      setPrinting(false);
    }
  }

  const inputCls = "ctrl-input-sm w-full text-sm text-center";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("barcode.title")}</h1>
          <p className="text-sm text-muted">{t("barcode.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-stretch gap-1 rounded-lg border border-border p-1">
            {["variant", "product"].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setCodeSource(key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  codeSource === key ? "bg-accent text-black" : "text-muted hover:text-text"
                }`}
              >
                {t(`barcode.codeSource.${key}`)}
              </button>
            ))}
          </div>
          <button onClick={onPrint} disabled={printing || selectedItems.length === 0 || !profile}
            className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95 disabled:opacity-40">
            <IconPrinter width={16} height={16} />
            {printing ? t("barcode.printing") : t("barcode.printBtn", { count: totalLabels })}
          </button>
        </div>
      </div>

      {profile ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-text">
            <IconPrinter width={14} height={14} className="text-accent" />
            {t("barcode.assigned")}
          </span>
          <span className="text-text">{profile.name}</span>
          <span className="text-muted" dir="ltr">· {profile.printer_name}</span>
          <span className="text-muted">· {info.size}</span>
          <span className="text-muted">· {t("barcode.margin", { mm: info.margin })}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <IconSettings width={14} height={14} />
          {t("barcode.noProfileHint")}
          <Link to="/settings" className="font-semibold text-accent underline">
            {t("barcode.goSettings")}
          </Link>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="relative">
            <IconSearch width={16} height={16}
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted" style={{ [isAr ? "right" : "left"]: 12 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t("barcode.searchPlaceholder")}
              className="ctrl-input w-full py-2.5 ps-10" />
          </div>

          <div className="ctrl-card flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="ctrl-table h-full w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="h-px">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" className="ctrl-check" checked={allSelected}
                        onChange={(e) => toggleAll(e.target.checked)} />
                    </th>
                    <th className="px-3 py-3 text-start font-medium">{t("barcode.table.product")}</th>
                    <th className="px-3 py-3 text-center font-medium">{t("barcode.table.code")}</th>
                    <th className="px-3 py-3 text-center font-medium">{t("barcode.table.available")}</th>
                    <th className="px-3 py-3 text-center font-medium">{t("barcode.table.price")}</th>
                    <th className="px-3 py-3 text-center font-medium">{t("barcode.table.discount")}</th>
                    <th className="px-3 py-3 text-center font-medium">{t("barcode.table.copies")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: PAGE_SIZE }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={7} className="px-3 py-2">
                          <div className="h-9 animate-pulse rounded bg-elevated/70" />
                        </td>
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-sm text-muted">
                        {t("barcode.empty")}
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((it) => {
                      const st = rows[it.variant_id] || {};
                      const price = Number(st.price) || 0;
                      const sale = Number(st.salePrice);
                      const invalidSale = st.discountOn && !(sale > 0 && sale < price);
                      const shownCode = printCode(it, codeSource);
                      return (
                        <tr key={it.variant_id} className={st.selected ? "bg-accent/5" : ""}>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" className="ctrl-check" checked={!!st.selected}
                              onChange={() => setField(it.variant_id, "selected", !st.selected)} />
                          </td>
                          <td className="max-w-[220px] px-3 py-2">
                            <span className="block truncate font-medium text-text" title={it.product_name}>
                              {it.product_name}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-xs text-muted" dir="ltr">{shownCode}</td>
                          <td className="px-3 py-2 text-center text-muted tabular-nums">{it.quantity}</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              className={inputCls}
                              value={st.price ?? ""}
                              onChange={(e) => setField(it.variant_id, "price", sanitizePrice(e.target.value))}
                              onBlur={(e) =>
                                setField(it.variant_id, "price", (Number(e.target.value) || 0).toFixed(2))
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-2">
                              <input type="checkbox" className="ctrl-check" checked={!!st.discountOn}
                                onChange={() => setField(it.variant_id, "discountOn", !st.discountOn)} />
                              {st.discountOn && (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  dir="ltr"
                                  className={`ctrl-input-sm w-24 text-center text-sm ${invalidSale ? "border-red-500/70" : ""}`}
                                  placeholder={t("barcode.newPrice")}
                                  value={st.salePrice}
                                  onChange={(e) => setField(it.variant_id, "salePrice", sanitizePrice(e.target.value))}
                                  onBlur={(e) => {
                                    if (e.target.value === "") return;
                                    setField(it.variant_id, "salePrice", (Number(e.target.value) || 0).toFixed(2));
                                  }}
                                />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1.5">
                              <input
                                type="text"
                                inputMode="numeric"
                                dir="ltr"
                                className="ctrl-input-sm w-20 text-center text-sm"
                                value={st.count ?? ""}
                                onChange={(e) => setField(it.variant_id, "count", sanitizeInt(e.target.value))}
                                onBlur={(e) => setField(it.variant_id, "count", String(clampCount(e.target.value)))}
                              />
                              <button
                                type="button"
                                title={t("barcode.reset")}
                                onClick={() => setField(it.variant_id, "count", String(it.quantity))}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition hover:border-accent hover:text-accent"
                              >
                                <IconRefresh width={14} height={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40"
                >
                  {isAr ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
                  {t("products.pagination.prev")}
                </button>
                <span className="text-sm text-muted">
                  {t("products.pagination.pageOf", { page, pages })}
                </span>
                <button
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40"
                >
                  {t("products.pagination.next")}
                  {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="lg:w-80">
          <div className="ctrl-card p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
              <IconBarcode width={16} height={16} className="text-accent" />
              {t("barcode.preview")}
            </p>
            {active ? (
              <div className="flex flex-col items-center gap-3">
                <div
                  className="mx-auto flex w-full max-w-[260px] flex-col items-center justify-start gap-[2%] overflow-hidden rounded-md border border-border bg-white p-1.5 text-center text-black"
                  style={{ aspectRatio: info.ratio || 1.6 }}
                >
                  <div
                    className="w-full shrink-0 px-0.5 font-bold leading-tight"
                    dir="auto"
                    style={{
                      fontSize: "clamp(0.55rem, 3.4cqi, 0.8rem)",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                    title={active.it.product_name}
                  >
                    {active.it.product_name}
                  </div>
                  <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                    <BarcodeSvg
                      value={active.code}
                      height={active.hasDiscount ? 32 : 40}
                      displayValue={false}
                      className="max-h-full max-w-full"
                    />
                  </div>
                  <div className="w-full shrink-0 truncate font-mono leading-tight text-neutral-700" dir="ltr"
                    style={{ fontSize: "clamp(0.5rem, 3cqi, 0.7rem)" }}>
                    {active.code}
                  </div>
                  <div className="flex w-full shrink-0 flex-col items-center leading-tight"
                    style={{ fontSize: "clamp(0.55rem, 3.2cqi, 0.8rem)" }}>
                    {active.hasDiscount ? (
                      <>
                        <span className="text-neutral-500 line-through">{money(active.price, currency)}</span>
                        <span className="font-bold">{money(active.sale, currency)}</span>
                      </>
                    ) : (
                      <span className="font-bold">{money(active.price, currency)}</span>
                    )}
                  </div>
                </div>
                <p className="text-center text-[11px] text-muted">
                  {t("barcode.previewNote", { size: info.size })}
                </p>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted">{t("barcode.previewEmpty")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
