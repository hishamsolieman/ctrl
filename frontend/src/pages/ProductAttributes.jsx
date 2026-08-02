import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import {
  listAttributes,
  deleteAttribute,
  exportAttributes,
  importAttributes,
} from "@/lib/products";
import AttributeModal from "@/components/attributes/AttributeModal";
import AttributeViewModal from "@/components/attributes/AttributeViewModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  IconPlus,
  IconSearch,
  IconSliders,
  IconDownload,
  IconUpload,
  IconEye,
  IconEdit,
  IconCopy,
  IconTrash,
  IconChevronLeft,
  IconChevronRight,
} from "@/components/icons";

const PAGE_SIZE = 8;

function Badge({ children, tone = "muted" }) {
  const tones = {
    muted: "border-border bg-elevated text-muted",
    accent: "border-accent/40 bg-accent/10 text-accent",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function ProductAttributes() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState({ open: false, mode: "add", attribute: null });
  const [viewing, setViewing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const importRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listAttributes());
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
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((a) =>
      [a.name_en, a.name_ar, a.key, ...(a.values || []).flatMap((v) => [v.value_en, v.value_ar])]
        .some((v) => (v || "").toLowerCase().includes(s))
    );
  }, [items, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );
  useEffect(() => { setPage(1); }, [q]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const openAdd = () => setModal({ open: true, mode: "add", attribute: null });
  const openEdit = (a) => setModal({ open: true, mode: "edit", attribute: a });
  const openCopy = (a) => setModal({ open: true, mode: "copy", attribute: a });

  async function onExport() {
    try {
      await exportAttributes(q.trim() || undefined);
    } catch {
      toast.error(t("auth.genericError"));
    }
  }
  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const res = await importAttributes(file);
      if (res.skipped > 0) {
        toast.success(t("products.attrs.importDoneSkipped", { count: res.created, skipped: res.skipped }));
      } else {
        toast.success(t("products.attrs.importDone", { count: res.created }));
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
      await deleteAttribute(toDelete.id);
      toast.success(t("products.attrs.deleted"));
      setToDelete(null);
      load();
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(d ? t(d, { defaultValue: d }) : t("auth.genericError"));
    } finally {
      setDeleting(false);
    }
  }

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";

  function ValuePreview({ a }) {
    const vals = a.values || [];
    if (vals.length === 0) return <span className="text-xs text-muted">—</span>;
    const shown = vals.slice(0, 4);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((v) => (
          <span key={v.id}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-elevated px-1.5 py-0.5 text-xs text-text">
            {a.type === "color" && v.extra?.hex && (
              <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: v.extra.hex }} />
            )}
            {isAr ? v.value_ar : v.value_en}
          </span>
        ))}
        {vals.length > shown.length && (
          <span className="text-xs text-muted">+{vals.length - shown.length}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("products.attrs.title")}</h1>
          <p className="text-sm text-muted">{t("products.attrs.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onExport}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated">
            <IconDownload width={16} height={16} /> {t("products.export")}
          </button>
          <button onClick={() => importRef.current?.click()}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated">
            <IconUpload width={16} height={16} /> {t("products.import")}
          </button>
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImport} />
          <button onClick={openAdd} className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95">
            <IconPlus width={16} height={16} /> {t("products.attrs.add")}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
          <IconSearch width={18} height={18} />
        </span>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t("products.attrs.search")} className="ctrl-input py-2.5 ps-10" />
      </div>

      {/* Table */}
      <div className="ctrl-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-elevated" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-muted">
                <IconSliders width={30} height={30} />
              </span>
              <div>
                <p className="text-lg font-semibold text-text">{t("products.attrs.empty")}</p>
                <p className="mt-1 text-sm text-muted">{t("products.attrs.emptyBody")}</p>
              </div>
              <button onClick={openAdd} className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95">
                <IconPlus width={16} height={16} /> {t("products.attrs.add")}
              </button>
            </div>
          ) : (
            <table className="ctrl-table w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-medium">{t("products.attrs.col.name")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("products.attrs.col.type")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("products.attrs.col.values")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("products.attrs.col.mandatory")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("products.attrs.col.global")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("products.attrs.col.coding")}</th>
                  <th className="px-4 py-3 text-end font-medium">{t("products.attrs.col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((a) => (
                  <tr key={a.id} className="border-b border-border/60 transition hover:bg-elevated/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium text-text">{isAr ? a.name_ar : a.name_en}</div>
                          <div className="text-xs text-muted">{isAr ? a.name_en : a.name_ar}</div>
                        </div>
                        {a.in_use && <Badge tone="accent">{t("products.attrs.inUse")}</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="accent">{t(`products.attrs.type.${a.type}`)}</Badge>
                    </td>
                    <td className="px-4 py-3"><ValuePreview a={a} /></td>
                    <td className="px-4 py-3">
                      <Badge tone={a.is_required ? "accent" : "muted"}>
                        {a.is_required ? t("products.attrs.yes") : t("products.attrs.no")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={a.is_global ? "accent" : "muted"}>
                        {a.is_global ? t("products.attrs.yes") : t("products.attrs.no")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={a.coding ? "accent" : "muted"}>
                        {a.coding ? t("products.attrs.yes") : t("products.attrs.no")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button title={t("products.attrs.view")} className={iconBtn} onClick={() => setViewing(a)}>
                          <IconEye width={15} height={15} />
                        </button>
                        <button title={t("products.attrs.edit")} className={iconBtn} onClick={() => openEdit(a)}>
                          <IconEdit width={15} height={15} />
                        </button>
                        <button title={t("products.attrs.copy")} className={iconBtn} onClick={() => openCopy(a)}>
                          <IconCopy width={15} height={15} />
                        </button>
                        <button title={t("products.attrs.delete")}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition hover:bg-red-500 hover:text-white"
                          onClick={() => setToDelete(a)}>
                          <IconTrash width={15} height={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!loading && filtered.length > 0 && pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40">
              {isAr ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
              {t("products.pagination.prev")}
            </button>
            <span className="text-sm text-muted">{t("products.pagination.pageOf", { page, pages: pageCount })}</span>
            <button disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="ctrl-btn border border-border px-3 py-1.5 text-sm text-text hover:bg-elevated disabled:opacity-40">
              {t("products.pagination.next")}
              {isAr ? <IconChevronLeft width={16} height={16} /> : <IconChevronRight width={16} height={16} />}
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      <AttributeModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.attribute}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onSaved={load}
      />
      <AttributeViewModal open={!!viewing} attribute={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title={t("products.attrs.confirmDelete.title")}
        body={t("products.attrs.confirmDelete.body", { name: toDelete ? (isAr ? toDelete.name_ar : toDelete.name_en) : "" })}
        confirmLabel={t("products.attrs.confirmDelete.confirm")}
        cancelLabel={t("products.attrs.confirmDelete.cancel")}
      />
    </div>
  );
}
