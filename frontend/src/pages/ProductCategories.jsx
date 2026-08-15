import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import {
  listCategories,
  deleteCategory,
  bulkDeleteCategories,
  exportCategories,
  importCategories,
  mediaUrl,
} from "@/lib/products";
import CategoryModal from "@/components/categories/CategoryModal";
import CategoryViewModal from "@/components/categories/CategoryViewModal";
import CategoryBulkEditModal from "@/components/categories/CategoryBulkEditModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  IconTag,
  IconSearch,
  IconDownload,
  IconUpload,
  IconPlus,
  IconX,
  IconImage,
  IconEye,
  IconEdit,
  IconCopy,
  IconTrash,
  IconChevronLeft,
  IconChevronRight,
} from "@/components/icons";

const PAGE_SIZE = 8;
const MODERATOR_LEVEL = 20;

export default function ProductCategories() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const { user } = useAuth();
  const toast = useToast();
  const canAccess = (user?.role_level ?? 0) >= MODERATOR_LEVEL;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());

  const [modal, setModal] = useState({ open: false, mode: "add", category: null });
  const [viewing, setViewing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const importRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listCategories());
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (canAccess) load();
  }, [load, canAccess]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((c) =>
      [c.name_en, c.name_ar, c.description].some((v) => (v || "").toLowerCase().includes(s))
    );
  }, [items, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  // Reset to first page when the search changes; clamp when the page count shrinks.
  useEffect(() => {
    setPage(1);
  }, [q]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const selectedItems = items.filter((c) => selected.has(c.id));
  const allVisibleSelected = pageItems.length > 0 && pageItems.every((c) => selected.has(c.id));

  function toggle(id) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      if (allVisibleSelected) {
        const n = new Set(s);
        pageItems.forEach((c) => n.delete(c.id));
        return n;
      }
      return new Set([...s, ...pageItems.map((c) => c.id)]);
    });
  }
  const clearSelection = () => setSelected(new Set());

  async function onExport() {
    try {
      await exportCategories(q.trim() || undefined);
    } catch {
      toast.error(t("auth.genericError"));
    }
  }
  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const res = await importCategories(file);
      if (res.skipped > 0) {
        toast.success(t("categories.importDoneSkipped", { count: res.created, skipped: res.skipped }));
      } else {
        toast.success(t("categories.importDone", { count: res.created }));
      }
      load();
    } catch {
      toast.error(t("auth.genericError"));
    }
  }
  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteCategory(toDelete.id);
      toast.success(t("categories.confirmDelete.deleted"));
      setToDelete(null);
      clearSelection();
      load();
    } catch (err) {
      toast.error(
        err?.response?.data?.detail ||
          t("categories.confirmDelete.blocked", { name: toDelete.name_en, count: toDelete.product_count })
      );
    } finally {
      setDeleting(false);
    }
  }
  async function confirmBulkDelete() {
    setDeleting(true);
    try {
      const res = await bulkDeleteCategories([...selected]);
      toast.success(
        t("categories.bulk.result", { deleted: res.deleted.length, blocked: res.blocked.length })
      );
      setBulkDeleteOpen(false);
      clearSelection();
      load();
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setDeleting(false);
    }
  }

  const openAdd = () => setModal({ open: true, mode: "add", category: null });
  const openEdit = (c) => setModal({ open: true, mode: "edit", category: c });
  const openCopy = (c) => setModal({ open: true, mode: "copy", category: c });

  const toolbarBtn = "ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated";
  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-full bg-bg/80 text-text backdrop-blur transition hover:bg-accent hover:text-black";

  if (!canAccess) return <Navigate to="/products/list" replace />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header + toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("categories.title")}</h1>
          <p className="text-sm text-muted">{t("categories.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onExport} className={toolbarBtn}>
            <IconDownload width={16} height={16} /> {t("categories.export")}
          </button>
          <button onClick={() => importRef.current?.click()} className={toolbarBtn}>
            <IconUpload width={16} height={16} /> {t("categories.import")}
          </button>
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImport} />
          <button onClick={openAdd} className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95">
            <IconPlus width={16} height={16} /> {t("categories.add")}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
          <IconSearch width={18} height={18} />
        </span>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t("categories.search")} className="ctrl-input py-2.5 ps-10" />
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5">
          <span className="text-sm font-medium text-text">
            {t("categories.selectedCount", { count: selected.size })}
          </span>
          <div className="flex-1" />
          <button onClick={() => setBulkEditOpen(true)}
            className="ctrl-btn border border-border bg-surface px-3 py-1.5 text-sm text-text hover:bg-elevated">
            <IconEdit width={15} height={15} /> {t("categories.bulkEdit")}
          </button>
          <button onClick={() => setBulkDeleteOpen(true)}
            className="ctrl-btn border border-red-500/50 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10">
            <IconTrash width={15} height={15} /> {t("categories.bulkDelete")}
          </button>
          <button onClick={clearSelection}
            className="ctrl-btn px-2 py-1.5 text-sm text-muted hover:text-text">
            <IconX width={15} height={15} /> {t("categories.clearSelection")}
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="ctrl-card flex min-h-0 flex-1 flex-col p-4">
        {!loading && filtered.length > 0 && (
          <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="ctrl-check" checked={allVisibleSelected} onChange={toggleAll} />
            {t("categories.selectAll")}
          </label>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="grid h-full auto-rows-fr grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-2xl bg-elevated" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-muted">
                <IconTag width={30} height={30} />
              </span>
              <div>
                <p className="text-lg font-semibold text-text">{t("categories.empty")}</p>
                <p className="mt-1 text-sm text-muted">{t("categories.emptyBody")}</p>
              </div>
              <button onClick={openAdd} className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95">
                <IconPlus width={16} height={16} /> {t("categories.add")}
              </button>
            </div>
          ) : (
            <div className="grid h-full auto-rows-fr grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {pageItems.map((c) => {
                const isSel = selected.has(c.id);
                return (
                  <div key={c.id}
                    className={`group relative flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-surface transition ${
                      isSel ? "border-accent" : "border-border hover:border-accent/60"
                    }`}>
                    <div className="relative min-h-0 flex-1 overflow-hidden bg-elevated">
                      {c.image_url ? (
                        <img src={mediaUrl(c.image_url)} alt={c.name_en} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted">
                          <IconImage width={34} height={34} />
                        </div>
                      )}
                      {/* Select checkbox */}
                      <label className="absolute start-3 top-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(c.id)}
                          className="h-5 w-5 cursor-pointer rounded-md border-0 bg-white/90 shadow-md ring-1 ring-black/10 accent-accent"
                        />
                      </label>
                      {/* Actions */}
                      <div className="absolute end-3 top-3 flex gap-2 opacity-0 transition group-hover:opacity-100">
                        <button title={t("categories.view")} className={iconBtn} onClick={() => setViewing(c)}>
                          <IconEye width={15} height={15} />
                        </button>
                        <button title={t("categories.edit")} className={iconBtn} onClick={() => openEdit(c)}>
                          <IconEdit width={15} height={15} />
                        </button>
                        <button title={t("categories.copy")} className={iconBtn} onClick={() => openCopy(c)}>
                          <IconCopy width={15} height={15} />
                        </button>
                        <button title={t("categories.delete")}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-bg/80 text-red-400 backdrop-blur transition hover:bg-red-500 hover:text-white"
                          onClick={() => setToDelete(c)}>
                          <IconTrash width={15} height={15} />
                        </button>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col p-3">
                      <h6 className="truncate text-sm font-semibold text-text">
                        {isAr ? c.name_ar : c.name_en}
                      </h6>
                      <p className="truncate text-xs text-muted">{isAr ? c.name_en : c.name_ar}</p>
                      {c.description && (
                        <p className="mt-1 truncate text-xs text-muted">{c.description}</p>
                      )}
                      <p className="mt-1 text-[11px] font-medium text-accent">
                        {t("categories.productsUsing", { count: c.product_count })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && filtered.length > 0 && pageCount > 1 && (
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40"
            >
              {isAr ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
              {t("products.pagination.prev")}
            </button>
            <span className="text-sm text-muted">
              {t("products.pagination.pageOf", { page, pages: pageCount })}
            </span>
            <button
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40"
            >
              {t("products.pagination.next")}
              {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      <CategoryModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.category}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onSaved={load}
      />
      <CategoryViewModal open={!!viewing} category={viewing} onClose={() => setViewing(null)} />
      <CategoryBulkEditModal
        open={bulkEditOpen}
        categories={selectedItems}
        onClose={() => setBulkEditOpen(false)}
        onApplied={() => {
          clearSelection();
          load();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title={t("categories.confirmDelete.title")}
        body={t("categories.confirmDelete.body", { name: toDelete ? (isAr ? toDelete.name_ar : toDelete.name_en) : "" })}
        confirmLabel={t("categories.confirmDelete.confirm")}
        cancelLabel={t("categories.confirmDelete.cancel")}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
        loading={deleting}
        title={t("categories.bulk.confirmTitle")}
        body={t("categories.bulk.confirmBody", { count: selected.size })}
        confirmLabel={t("categories.bulk.confirm")}
        cancelLabel={t("categories.bulk.cancel")}
      />
    </div>
  );
}
