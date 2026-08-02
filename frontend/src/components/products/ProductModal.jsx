import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import CategoryModal from "@/components/categories/CategoryModal";
import { useToast } from "@/context/ToastContext";
import {
  createProduct,
  updateProduct,
  uploadImage,
  checkProductName,
  generateCode,
  checkCode,
  mediaUrl,
} from "@/lib/products";
import { IconPlus, IconX, IconImage, IconTrash, IconEdit } from "@/components/icons";

let _uid = 1;
const nextKey = () => `v${_uid++}`;
const CODE_RE = /^[A-Za-z0-9]{8}$/;

// A code input that shows the (auto-generated) code locked, with a pencil to
// unlock it for manual editing. Text is padded/ellipsised so it never sits
// under the pencil icon.
function CodeField({ value, onChange, className, width = "" }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  return (
    <div className={`relative ${width}`}>
      <input
        ref={ref}
        className={`${className} truncate pe-9 font-mono uppercase ${
          editing ? "" : "cursor-default"
        }`}
        value={value}
        maxLength={8}
        readOnly={!editing}
        onChange={(e) => onChange(e.target.value)}
      />
      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="edit"
          className="absolute end-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-elevated hover:text-accent"
        >
          <IconEdit width={13} height={13} />
        </button>
      )}
    </div>
  );
}

// Keep only the {attrId: valueId} entries whose attribute is in `attrs`.
function pickAttrs(map, attrs) {
  const ids = new Set(attrs.map((a) => String(a.id)));
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (ids.has(String(k)) && v) out[String(k)] = Number(v);
  }
  return out;
}

// Format a price value to a 2-decimal string ("" stays empty).
function money(v) {
  if (v === "" || v == null) return "";
  const n = Number(v);
  return Number.isNaN(n) ? "" : n.toFixed(2);
}

function emptyVariant() {
  return { key: nextKey(), id: null, code: "", attributes: {}, images: [], quantity: 0 };
}

function fromProduct(p, mode) {
  if (!p) return { ...blankForm(), variants: [emptyVariant()] };
  const isCopy = mode === "copy";
  return {
    code: isCopy ? "" : p.code || "", // copy => new auto product code
    name: p.name || "",
    description: p.description || "",
    note: p.note || "",
    category_id: p.category_id ?? "",
    supplier_id: p.supplier_id ?? "",
    supplier_price: money(p.supplier_price),
    min_price: money(p.min_price),
    price: money(p.price),
    tags: [...(p.tags || [])],
    attributes: Object.fromEntries(
      Object.entries(p.attributes || {}).map(([k, val]) => [String(k), Number(val)])
    ),
    variants: (p.variants || []).map((v) => ({
      key: nextKey(),
      id: isCopy ? null : v.id,
      code: isCopy ? "" : v.code, // copy => new auto codes
      attributes: Object.fromEntries(
        Object.entries(v.attributes || {}).map(([k, val]) => [String(k), val])
      ),
      images: (v.images || []).map((im) => im.url),
      quantity: v.quantity ?? 0,
    })),
  };
}

function blankForm() {
  return {
    code: "",
    name: "",
    description: "",
    note: "",
    category_id: "",
    supplier_id: "",
    supplier_price: "",
    min_price: "",
    price: "",
    tags: [],
    attributes: {},
    variants: [],
  };
}

export default function ProductModal({
  open,
  mode,
  initial,
  categories,
  suppliers,
  attributes,
  onClose,
  onSaved,
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const toast = useToast();
  const [form, setForm] = useState(blankForm());
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState(null);
  // Local category list so a category created via the nested modal appears
  // instantly without waiting on a parent refetch.
  const [cats, setCats] = useState(categories || []);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const fileRefs = useRef({});

  useEffect(() => {
    if (open) {
      setForm(fromProduct(initial, mode));
      setTagDraft("");
    }
  }, [open, initial, mode]);

  // Pre-fill fresh, unique codes for add/copy so the (locked) code field shows a
  // real value instead of asking the user to "leave blank". Editing keeps codes.
  useEffect(() => {
    if (!open || mode === "edit") return;
    let cancelled = false;
    const count = mode === "copy" ? initial?.variants?.length || 1 : 1;
    (async () => {
      try {
        const codes = await Promise.all(
          Array.from({ length: count + 1 }, () => generateCode())
        );
        if (cancelled) return;
        const productCode = codes[0];
        const variantCodes = codes.slice(1);
        setForm((f) => ({
          ...f,
          code: f.code || productCode,
          variants: f.variants.map((v, i) =>
            v.code ? v : { ...v, code: variantCodes[i] || "" }
          ),
        }));
      } catch {
        /* fall back to server-side auto-generation on submit */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, initial]);

  useEffect(() => {
    setCats(categories || []);
  }, [categories]);

  const title = useMemo(() => {
    if (mode === "edit") return t("products.modal.editTitle");
    if (mode === "copy") return t("products.modal.copyTitle");
    return t("products.modal.addTitle");
  }, [mode, t]);

  // Coding attributes differentiate variants; non-coding ("global") attributes
  // apply to the whole product (same across all variants).
  const codingAttrs = (attributes || []).filter((a) => a.coding);
  const globalAttrs = (attributes || []).filter((a) => !a.coding);
  const hasVariants = codingAttrs.length > 0;
  // Widen the modal as the variant table grows more columns, instead of
  // forcing a horizontal scrollbar.
  const modalSize = !hasVariants
    ? "lg"
    : codingAttrs.length <= 1
      ? "lg"
      : codingAttrs.length === 2
        ? "xl"
        : codingAttrs.length === 3
          ? "2xl"
          : "3xl";
  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Normalize a price field to a 2-decimal float on blur (e.g. "400" -> "400.00").
  function formatMoney(field) {
    setForm((f) => ({ ...f, [field]: money(f[field]) }));
  }

  function onCategoryChange(value) {
    if (value === "__add__") {
      // Open the category modal on top of this one. The <select> value stays
      // unchanged (we never commit "__add__"), so the previous selection holds.
      setCatModalOpen(true);
      return;
    }
    set("category_id", value);
  }

  // Category created via the nested modal → add it locally and auto-select it.
  function onCategorySaved(created) {
    setCatModalOpen(false);
    if (created?.id != null) {
      setCats((prev) =>
        prev.some((c) => c.id === created.id) ? prev : [...prev, created]
      );
      set("category_id", String(created.id));
    }
  }

  // Category modal dismissed/failed → if nothing is selected yet, fall back to
  // the first existing category (or leave "none" when there are no categories).
  function onCategoryModalClose() {
    setCatModalOpen(false);
    setForm((f) =>
      f.category_id ? f : { ...f, category_id: cats.length ? String(cats[0].id) : "" }
    );
  }

  // ---- Tags ----
  function addTag() {
    const v = tagDraft.trim();
    if (v && !form.tags.includes(v)) set("tags", [...form.tags, v]);
    setTagDraft("");
  }

  // ---- Variants ----
  function updateVariant(key, patch) {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)),
    }));
  }
  async function addVariant() {
    let code = "";
    try {
      code = await generateCode();
    } catch {
      /* server will auto-generate if left blank */
    }
    // Default any colour attribute to the previous row's value (a new row is
    // usually the same colour in another size); the user can still change it.
    const colorIds = codingAttrs.filter((a) => a.type === "color").map((a) => String(a.id));
    setForm((f) => {
      const last = f.variants[f.variants.length - 1];
      const attributes = {};
      if (last) {
        for (const id of colorIds) {
          if (last.attributes[id] != null) attributes[id] = last.attributes[id];
        }
      }
      return { ...f, variants: [...f.variants, { ...emptyVariant(), code, attributes }] };
    });
  }
  function removeVariant(key) {
    setForm((f) => ({ ...f, variants: f.variants.filter((v) => v.key !== key) }));
  }
  function setVariantAttr(key, attrId, valueId) {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v) => {
        if (v.key !== key) return v;
        const attrs = { ...v.attributes };
        if (valueId) attrs[String(attrId)] = Number(valueId);
        else delete attrs[String(attrId)];
        return { ...v, attributes: attrs };
      }),
    }));
  }
  function setGlobalAttr(attrId, valueId) {
    setForm((f) => {
      const attrs = { ...f.attributes };
      if (valueId) attrs[String(attrId)] = Number(valueId);
      else delete attrs[String(attrId)];
      return { ...f, attributes: attrs };
    });
  }

  function imageErrorMessage(err, name) {
    if (err?.code === "unsupported") return t("products.modal.imageUnsupported");
    const detail = err?.response?.data?.detail;
    if (detail) {
      return t(detail, { defaultValue: t("products.modal.imageUploadFailed", { name }) });
    }
    return t("products.modal.imageUploadFailed", { name });
  }

  async function onFiles(key, e) {
    const files = [...e.target.files];
    e.target.value = "";
    const variant = form.variants.find((v) => v.key === key);
    const room = 5 - (variant?.images.length || 0);
    if (room <= 0) return;
    setUploadingKey(key);
    const urls = [];
    const failures = [];
    for (const file of files.slice(0, room)) {
      try {
        urls.push(await uploadImage(file));
      } catch (err) {
        failures.push({ name: file.name, err });
      }
    }
    if (urls.length) {
      setForm((f) => ({
        ...f,
        variants: f.variants.map((v) =>
          v.key === key ? { ...v, images: [...v.images, ...urls].slice(0, 5) } : v
        ),
      }));
    }
    for (const { name, err } of failures) toast.error(imageErrorMessage(err, name));
    setUploadingKey(null);
  }
  function removeImage(key, url) {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v) =>
        v.key === key ? { ...v, images: v.images.filter((u) => u !== url) } : v
      ),
    }));
  }

  function renderImages(v, thumb = "h-16 w-16") {
    return (
      <div className="flex flex-wrap gap-2">
        {v.images.map((url) => (
          <div key={url} className={`relative ${thumb} overflow-hidden rounded-lg border border-border`}>
            <img src={mediaUrl(url)} alt="" className="h-full w-full object-cover" />
            <button type="button" onClick={() => removeImage(v.key, url)}
              className="absolute end-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white">
              <IconX width={10} height={10} />
            </button>
          </div>
        ))}
        {v.images.length < 5 && (
          <button type="button" onClick={() => fileRefs.current[v.key]?.click()}
            disabled={uploadingKey === v.key}
            className={`flex ${thumb} flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted transition hover:border-accent hover:text-accent`}>
            {uploadingKey === v.key ? <span className="text-[10px]">…</span> : (
              <><IconImage width={16} height={16} /><span className="text-[9px]">{t("products.modal.addImage")}</span></>
            )}
          </button>
        )}
        <input ref={(el) => (fileRefs.current[v.key] = el)} type="file" accept="image/*"
          multiple className="hidden" onChange={(e) => onFiles(v.key, e)} />
      </div>
    );
  }

  // ---- Submit ----
  async function submit() {
    if (!form.name.trim()) {
      toast.error(t("products.modal.nameRequired"));
      return;
    }
    if (!form.category_id) {
      toast.error(t("products.modal.categoryRequired"));
      return;
    }
    if (Number(form.price || 0) < Number(form.min_price || 0)) {
      toast.error(t("products.modal.priceBelowMin"));
      return;
    }
    if (form.variants.length === 0) {
      toast.error(t("products.modal.variantRequired"));
      return;
    }
    if (form.code && !CODE_RE.test(form.code.trim())) {
      toast.error(t("products.modal.codeInvalid"));
      return;
    }
    for (const v of form.variants) {
      if (v.code && !CODE_RE.test(v.code.trim())) {
        toast.error(t("products.modal.codeInvalid"));
        return;
      }
    }
    // Codes must be unique — first within this form, then against the server
    // (a user may have edited a locked code to one that already exists).
    const localCodes = [];
    if (hasVariants && form.code.trim()) localCodes.push(form.code.trim().toUpperCase());
    for (const v of form.variants) {
      if (v.code.trim()) localCodes.push(v.code.trim().toUpperCase());
    }
    if (localCodes.some((c, i) => localCodes.indexOf(c) !== i)) {
      toast.error(t("products.modal.codeInUse"));
      return;
    }
    try {
      const checks = [];
      if (hasVariants && form.code.trim()) {
        checks.push(checkCode(form.code.trim(), "product", mode === "edit" ? initial?.id : undefined));
      }
      for (const v of form.variants) {
        if (v.code.trim()) {
          checks.push(checkCode(v.code.trim(), "variant", mode === "edit" ? v.id : undefined));
        }
      }
      const results = await Promise.all(checks);
      if (results.some((r) => r.exists)) {
        toast.error(t("products.modal.codeInUse"));
        return;
      }
    } catch {
      /* non-blocking: the backend re-validates and rejects on conflict */
    }
    // Required global attributes must be selected at the product level.
    for (const a of globalAttrs.filter((x) => x.is_required)) {
      if (!form.attributes[String(a.id)]) {
        toast.error(t("products.modal.requiredAttr", { name: isAr ? a.name_ar : a.name_en }));
        return;
      }
    }
    // Required coding attributes must be selected on every variant.
    for (const a of codingAttrs.filter((x) => x.is_required)) {
      if (form.variants.some((v) => !v.attributes[String(a.id)])) {
        toast.error(t("products.modal.requiredAttr", { name: isAr ? a.name_ar : a.name_en }));
        return;
      }
    }

    // A name isn't an identifier: warn (don't block) when it's already used.
    try {
      const dup = await checkProductName(form.name.trim(), mode === "edit" ? initial?.id : undefined);
      if (dup) toast.info(t("products.modal.nameDuplicate"));
    } catch {
      /* non-blocking */
    }

    const payload = {
      code: form.code ? form.code.trim().toUpperCase() : null,
      name: form.name.trim(),
      description: form.description || null,
      note: form.note || null,
      category_id: form.category_id ? Number(form.category_id) : null,
      supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
      supplier_price: Number(form.supplier_price) || 0,
      min_price: Number(form.min_price) || 0,
      price: Number(form.price) || 0,
      tags: form.tags,
      attributes: pickAttrs(form.attributes, globalAttrs),
      variants: form.variants.map((v) => ({
        ...(mode === "edit" && v.id ? { id: v.id } : {}),
        code: v.code ? v.code.trim().toUpperCase() : null,
        attributes: pickAttrs(v.attributes, codingAttrs),
        image_urls: v.images,
        quantity: Math.max(0, Math.trunc(Number(v.quantity) || 0)),
      })),
    };

    setSaving(true);
    try {
      if (mode === "edit") {
        await updateProduct(initial.id, payload);
        toast.success(t("products.modal.updated"));
      } else {
        await createProduct(payload);
        toast.success(t("products.modal.created"));
      }
      onSaved?.(mode);
      onClose?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={modalSize}
      dismissable={false}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("products.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("products.modal.saving") : t("products.modal.save")}
          </button>
        </>
      }
    >
      {/* Shared fields */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {hasVariants && (
          <div>
            <label className={labelCls}>{t("products.modal.productCode")}</label>
            <CodeField className={inputCls} value={form.code} onChange={(v) => set("code", v)} />
          </div>
        )}
        <div>
          <label className={labelCls}>{t("products.modal.name")} *</label>
          <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.category")} *</label>
          <select className={`${inputCls} ctrl-select`} value={form.category_id}
            onChange={(e) => onCategoryChange(e.target.value)}>
            <option value="">{t("products.modal.selectCategory")}</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{isAr ? c.name_ar : c.name_en}</option>
            ))}
            <option value="__add__">＋ {t("products.modal.addCategory")}</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.supplier")}</label>
          <select className={`${inputCls} ctrl-select`} value={form.supplier_id}
            onChange={(e) => set("supplier_id", e.target.value)}>
            <option value="">{t("products.modal.selectSupplier")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.supplierPrice")}</label>
          <input type="number" step="0.01" min="0" className={inputCls} value={form.supplier_price}
            onChange={(e) => set("supplier_price", e.target.value)}
            onBlur={() => formatMoney("supplier_price")} />
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.minPrice")}</label>
          <input type="number" step="0.01" min="0" className={inputCls} value={form.min_price}
            onChange={(e) => set("min_price", e.target.value)}
            onBlur={() => formatMoney("min_price")} />
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.price")}</label>
          <input type="number" step="0.01" min="0" className={inputCls} value={form.price}
            onChange={(e) => set("price", e.target.value)}
            onBlur={() => formatMoney("price")} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={labelCls}>{t("products.modal.description")}</label>
          <textarea rows={2} className={inputCls} value={form.description}
            onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.note")}</label>
          <textarea rows={2} className={inputCls} value={form.note}
            onChange={(e) => set("note", e.target.value)} />
        </div>
      </div>

      {/* Tags */}
      <div className="mt-4">
        <label className={labelCls}>{t("products.modal.tags")}</label>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated p-2">
          {form.tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-xs text-accent">
              {tag}
              <button type="button" onClick={() => set("tags", form.tags.filter((x) => x !== tag))}>
                <IconX width={12} height={12} />
              </button>
            </span>
          ))}
          <input className="min-w-[8rem] flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
            placeholder={t("products.modal.tagsHint")} value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
        </div>
      </div>

      {/* Global (non-coding) attributes — one selection shared by all variants */}
      {globalAttrs.length > 0 && (
        <div className="mt-5">
          <label className={labelCls + " mb-2 block"}>{t("products.modal.productAttributes")}</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {globalAttrs.map((attr) => {
              const selId = form.attributes[String(attr.id)];
              const selVal = attr.values.find((x) => x.id === Number(selId));
              return (
                <div key={attr.id}>
                  <label className={labelCls}>
                    {isAr ? attr.name_ar : attr.name_en}
                    {attr.is_required && <span className="text-accent"> *</span>}
                  </label>
                  <div className="relative">
                    {attr.type === "color" && selVal?.extra?.hex && (
                      <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center">
                        <span className="h-4 w-4 rounded-full border border-white/20"
                          style={{ backgroundColor: selVal.extra.hex }} />
                      </span>
                    )}
                    <select className={`${inputCls} ctrl-select ${attr.type === "color" && selVal?.extra?.hex ? "ps-9" : ""}`}
                      value={selId || ""} onChange={(e) => setGlobalAttr(attr.id, e.target.value)}>
                      <option value="">{t("products.modal.selectValue")}</option>
                      {attr.values.map((val) => (
                        <option key={val.id} value={val.id}>{isAr ? val.value_ar : val.value_en}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Variants — shown only when coding attributes exist */}
      {hasVariants ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <label className={labelCls + " mb-0"}>{t("products.modal.variants")}</label>
            <button type="button" onClick={addVariant}
              className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <IconPlus width={14} height={14} /> {t("products.modal.addVariant")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-elevated/40 text-xs text-muted">
                  <th className="whitespace-nowrap px-3 py-2 text-start font-medium">
                    {t("products.modal.code")}
                  </th>
                  {codingAttrs.map((attr) => (
                    <th key={attr.id} className="whitespace-nowrap px-3 py-2 text-start font-medium">
                      {isAr ? attr.name_ar : attr.name_en}
                      {attr.is_required && <span className="text-accent"> *</span>}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-2 text-start font-medium">
                    {t("products.modal.quantity")}
                  </th>
                  <th className="px-3 py-2 text-start font-medium">
                    {t("products.modal.variantImages")}
                  </th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {form.variants.map((v) => (
                  <tr key={v.key} className="border-b border-border align-top last:border-0">
                    <td className="px-3 py-2">
                      <CodeField className={inputCls} width="w-32" value={v.code}
                        onChange={(val) => updateVariant(v.key, { code: val })} />
                    </td>
                    {codingAttrs.map((attr) => {
                      const selId = v.attributes[String(attr.id)];
                      const selVal = attr.values.find((x) => x.id === Number(selId));
                      return (
                        <td key={attr.id} className="px-3 py-2">
                          <div className="relative min-w-[8.5rem]">
                            {attr.type === "color" && selVal?.extra?.hex && (
                              <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center">
                                <span className="h-4 w-4 rounded-full border border-white/20"
                                  style={{ backgroundColor: selVal.extra.hex }} />
                              </span>
                            )}
                            <select className={`${inputCls} ctrl-select ${attr.type === "color" && selVal?.extra?.hex ? "ps-9" : ""}`}
                              value={selId || ""}
                              onChange={(e) => setVariantAttr(v.key, attr.id, e.target.value)}>
                              <option value="">{t("products.modal.selectValue")}</option>
                              {attr.values.map((val) => (
                                <option key={val.id} value={val.id}>
                                  {isAr ? val.value_ar : val.value_en}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="1"
                        className={inputCls + " w-20"} value={v.quantity}
                        onChange={(e) => updateVariant(v.key, { quantity: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">{renderImages(v, "h-12 w-12")}</td>
                    <td className="px-2 py-2">
                      {form.variants.length > 1 && (
                        <button type="button" onClick={() => removeVariant(v.key)}
                          title={t("products.modal.removeVariant")}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10">
                          <IconTrash width={15} height={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        // No coding attributes: a single implicit piece — no "variant" wording.
        form.variants[0] && (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls}>{t("products.modal.code")}</label>
              <CodeField className={inputCls} value={form.variants[0].code}
                onChange={(v) => updateVariant(form.variants[0].key, { code: v })} />
            </div>
            <div>
              <label className={labelCls}>{t("products.modal.quantity")}</label>
              <input type="number" min="0" step="1" className={inputCls}
                value={form.variants[0].quantity}
                onChange={(e) => updateVariant(form.variants[0].key, { quantity: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>{t("products.modal.images")}</label>
              {renderImages(form.variants[0])}
            </div>
          </div>
        )
      )}
    </Modal>

    {/* Nested "Add category" modal — sits on top and blocks this modal until closed. */}
    <CategoryModal
      open={catModalOpen}
      mode="add"
      initial={null}
      onClose={onCategoryModalClose}
      onSaved={onCategorySaved}
    />
    </>
  );
}
