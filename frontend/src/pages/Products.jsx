import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import {
  listProducts,
  listCategories,
  listSuppliers,
  listAttributes,
  deleteProduct,
  clearAllProducts,
  bulkDeleteProducts,
  exportProducts,
  importProducts,
} from "@/lib/products";
import FilterRail from "@/components/products/FilterRail";
import ProductCard from "@/components/products/ProductCard";
import ProductModal from "@/components/products/ProductModal";
import ProductViewModal from "@/components/products/ProductViewModal";
import ProductBulkEditModal from "@/components/products/ProductBulkEditModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  IconBox,
  IconSearch,
  IconDownload,
  IconUpload,
  IconPlus,
  IconX,
  IconEdit,
  IconTrash,
  IconFilter,
  IconChevronLeft,
  IconChevronRight,
} from "@/components/icons";

const PAGE_SIZE = 8;

function pad(n) {
  return String(n).padStart(2, "0");
}
function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
// End of the current local day ("today 23:59") — the default upper date bound.
function endOfTodayInput() {
  const n = new Date();
  return toLocalInput(new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59));
}
function makeDefaultFilters() {
  const now = new Date();
  return {
    q: "",
    categoryIds: [],
    // Default range: first day of the current year -> end of today.
    // Use end-of-day (not the current instant) so products created moments
    // ago — e.g. while the add-product form was open — stay within range.
    dateFrom: toLocalInput(new Date(now.getFullYear(), 0, 1, 0, 0)),
    dateTo: endOfTodayInput(),
    sort: "newest",
    priceMin: null,
    priceMax: null,
    attrValues: [],
  };
}

export default function Products() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();

  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [attributes, setAttributes] = useState([]);
  const [items, setItems] = useState([]);
  const [maxPrice, setMaxPrice] = useState(1000);
  const [currency, setCurrency] = useState("EGP");
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState(makeDefaultFilters);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const [modal, setModal] = useState({ open: false, mode: "add", product: null });
  const [viewing, setViewing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Selection persists across pages (server-paginated): keep the product object
  // per id so bulk-edit can prefill common values.
  const [selected, setSelected] = useState({});
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const importRef = useRef(null);
  const catInit = useRef(false);

  const loadRefData = useCallback(() => {
    listCategories().then(setCategories).catch(() => {});
    listSuppliers().then(setSuppliers).catch(() => {});
    listAttributes().then(setAttributes).catch(() => {});
  }, []);

  useEffect(() => {
    loadRefData();
  }, [loadRefData]);

  // Category filter defaults to ALL categories selected (once, on first load).
  useEffect(() => {
    if (!catInit.current && categories.length) {
      catInit.current = true;
      setFilters((f) => ({ ...f, categoryIds: categories.map((c) => c.id) }));
    }
  }, [categories]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const params = { sort: filters.sort, page, page_size: PAGE_SIZE };
    if (filters.q) params.q = filters.q;
    // Only constrain when a PARTIAL set is selected — all/none => no filter.
    if (filters.categoryIds.length && filters.categoryIds.length < categories.length) {
      params.category_ids = filters.categoryIds.join(",");
    }
    if (filters.dateFrom) params.date_from = filters.dateFrom;
    if (filters.dateTo) params.date_to = filters.dateTo;
    if (filters.priceMin != null) params.price_min = filters.priceMin;
    if (filters.priceMax != null) params.price_max = filters.priceMax;
    if (filters.attrValues.length) params.attr_values = filters.attrValues.join(",");
    try {
      const data = await listProducts(params);
      setItems(data.items);
      setPages(data.pages);
      setTotal(data.total);
      setMaxPrice(data.facets.max_price);
      setCurrency(data.currency);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [filters, page, t, toast, categories.length]);

  // Reset to first page whenever the filters change.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // Debounced fetch (coalesces the page-reset + filter change).
  useEffect(() => {
    const id = setTimeout(fetchProducts, 300);
    return () => clearTimeout(id);
  }, [fetchProducts]);

  function resetFilters() {
    setFilters({ ...makeDefaultFilters(), categoryIds: categories.map((c) => c.id) });
    toast.info(t("products.cleared"));
  }

  // Called after a product is created/edited. A product created just now can be
  // hidden by a "To" date bound that was pinned earlier in the session, so widen
  // it to end-of-today and (for new products) jump to the first page — where the
  // newest item sorts. Changing filters/page also re-triggers the fetch effect.
  const handleSaved = useCallback(
    (savedMode) => {
      const end = endOfTodayInput();
      setFilters((f) => (f.dateTo && f.dateTo >= end ? f : { ...f, dateTo: end }));
      if (savedMode !== "edit") setPage(1);
      fetchProducts();
    },
    [fetchProducts]
  );

  async function confirmClearAll() {
    setClearing(true);
    try {
      const res = await clearAllProducts();
      toast.success(t("products.clearAllDone", { count: res.count }));
      setClearAllOpen(false);
      fetchProducts();
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("auth.genericError"));
    } finally {
      setClearing(false);
    }
  }

  async function onExport() {
    try {
      await exportProducts();
    } catch {
      toast.error(t("auth.genericError"));
    }
  }
  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const res = await importProducts(file);
      toast.success(t("products.importDone", { count: res.created }));
      fetchProducts();
    } catch {
      toast.error(t("auth.genericError"));
    }
  }
  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteProduct(toDelete.id);
      toast.success(t("products.confirmDelete.deleted"));
      setSelected((s) => {
        if (!s[toDelete.id]) return s;
        const n = { ...s };
        delete n[toDelete.id];
        return n;
      });
      setToDelete(null);
      fetchProducts();
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setDeleting(false);
    }
  }

  // ---- Selection / bulk actions ----
  const selectedItems = Object.values(selected);
  const selectedCount = selectedItems.length;
  const pageAllSelected = items.length > 0 && items.every((p) => selected[p.id]);

  function toggleSelect(p) {
    setSelected((s) => {
      const n = { ...s };
      if (n[p.id]) delete n[p.id];
      else n[p.id] = p;
      return n;
    });
  }
  function toggleSelectAll() {
    setSelected((s) => {
      const n = { ...s };
      if (pageAllSelected) items.forEach((p) => delete n[p.id]);
      else items.forEach((p) => { n[p.id] = p; });
      return n;
    });
  }
  const clearSelection = () => setSelected({});

  async function confirmBulkDelete() {
    setDeleting(true);
    try {
      const res = await bulkDeleteProducts(selectedItems.map((p) => p.id));
      toast.success(t("products.bulk.deleted", { count: res.deleted.length }));
      setBulkDeleteOpen(false);
      clearSelection();
      fetchProducts();
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setDeleting(false);
    }
  }

  const openAdd = () => setModal({ open: true, mode: "add", product: null });
  const openEdit = (p) => setModal({ open: true, mode: "edit", product: p });
  const openCopy = (p) => setModal({ open: true, mode: "copy", product: p });

  const toolbarBtn = "ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header + toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("products.title")}</h1>
          <p className="text-sm text-muted">{t("products.resultsCount", { count: total })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onExport} className={toolbarBtn}>
            <IconDownload width={16} height={16} /> {t("products.export")}
          </button>
          <button onClick={() => importRef.current?.click()} className={toolbarBtn}>
            <IconUpload width={16} height={16} /> {t("products.import")}
          </button>
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImport} />
          <button onClick={() => setClearAllOpen(true)}
            className="ctrl-btn border border-red-500/50 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10">
            <IconTrash width={16} height={16} /> {t("products.clearAll")}
          </button>
          <button onClick={openAdd} className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95">
            <IconPlus width={16} height={16} /> {t("products.addProduct")}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
            <IconSearch width={18} height={18} />
          </span>
          <input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder={t("products.searchPlaceholder")}
            className="ctrl-input py-2.5 ps-10"
          />
        </div>
        <button onClick={() => setShowFilters((s) => !s)}
          className="ctrl-btn border border-border px-3 py-2.5 text-sm text-text hover:bg-elevated lg:hidden">
          <IconFilter width={18} height={18} />
        </button>
      </div>

      {/* Selection bar */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5">
          <span className="text-sm font-medium text-text">
            {t("products.selectedCount", { count: selectedCount })}
          </span>
          <div className="flex-1" />
          <button onClick={() => setBulkEditOpen(true)}
            className="ctrl-btn border border-border bg-surface px-3 py-1.5 text-sm text-text hover:bg-elevated">
            <IconEdit width={15} height={15} /> {t("products.bulkEdit")}
          </button>
          <button onClick={() => setBulkDeleteOpen(true)}
            className="ctrl-btn border border-red-500/50 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10">
            <IconTrash width={15} height={15} /> {t("products.bulkDelete")}
          </button>
          <button onClick={clearSelection}
            className="ctrl-btn px-2 py-1.5 text-sm text-muted hover:text-text">
            <IconX width={15} height={15} /> {t("products.clearSelection")}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="ctrl-card flex min-h-0 flex-1 overflow-hidden">
        {/* Filter rail */}
        <aside className={`shrink-0 overflow-y-auto border-e border-border ${
          showFilters ? "block" : "hidden"
        } w-full lg:block lg:w-64`}>
          <FilterRail
            categories={categories}
            attributes={attributes}
            maxPrice={maxPrice}
            currency={currency}
            filters={filters}
            setFilters={setFilters}
            onReset={resetFilters}
          />
        </aside>

        {/* Grid + pagination */}
        <section className={`flex min-w-0 flex-1 flex-col ${showFilters ? "hidden lg:flex" : "flex"}`}>
          {!loading && items.length > 0 && (
            <label className="flex w-fit cursor-pointer items-center gap-2 px-4 pt-4 text-xs text-muted">
              <input type="checkbox" className="ctrl-check" checked={pageAllSelected} onChange={toggleSelectAll} />
              {t("products.selectAll")}
            </label>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="grid h-full auto-rows-fr grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <div key={i} className="animate-pulse rounded-2xl bg-elevated" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-muted">
                  <IconBox width={30} height={30} />
                </span>
                <div>
                  <p className="text-lg font-semibold text-text">{t("products.emptyTitle")}</p>
                  <p className="mt-1 text-sm text-muted">{t("products.emptyBody")}</p>
                </div>
                <button onClick={openAdd} className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95">
                  <IconPlus width={16} height={16} /> {t("products.addProduct")}
                </button>
              </div>
            ) : (
              <div className="grid h-full auto-rows-fr grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    currency={currency}
                    selected={!!selected[p.id]}
                    onToggleSelect={toggleSelect}
                    onView={setViewing}
                    onEdit={openEdit}
                    onCopy={openCopy}
                    onDelete={setToDelete}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
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
        </section>
      </div>

      {/* Modals */}
      <ProductModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.product}
        categories={categories}
        suppliers={suppliers}
        attributes={attributes}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onSaved={handleSaved}
      />

      <ProductViewModal
        open={!!viewing}
        product={viewing}
        attributes={attributes}
        currency={currency}
        onClose={() => setViewing(null)}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title={t("products.confirmDelete.title")}
        body={t("products.confirmDelete.body", { name: toDelete?.name || "" })}
        confirmLabel={t("products.confirmDelete.confirm")}
        cancelLabel={t("products.confirmDelete.cancel")}
      />

      <ConfirmDialog
        open={clearAllOpen}
        onClose={() => setClearAllOpen(false)}
        onConfirm={confirmClearAll}
        loading={clearing}
        title={t("products.clearAllConfirm.title")}
        body={t("products.clearAllConfirm.body")}
        confirmLabel={t("products.clearAllConfirm.confirm")}
        cancelLabel={t("products.clearAllConfirm.cancel")}
      />

      <ProductBulkEditModal
        open={bulkEditOpen}
        products={selectedItems}
        categories={categories}
        suppliers={suppliers}
        onClose={() => setBulkEditOpen(false)}
        onApplied={() => {
          clearSelection();
          fetchProducts();
        }}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
        loading={deleting}
        title={t("products.bulk.confirmTitle")}
        body={t("products.bulk.confirmBody", { count: selectedCount })}
        confirmLabel={t("products.bulk.confirm")}
        cancelLabel={t("products.bulk.cancel")}
      />
    </div>
  );
}
