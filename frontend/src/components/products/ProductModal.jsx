import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { createProduct, updateProduct, uploadProductImage, mediaUrl } from "@/lib/products";
import { IconPlus, IconX, IconImage, IconTrash } from "@/components/icons";

let _uid = 1;
const nextKey = () => `v${_uid++}`;
const CODE_RE = /^[A-Za-z0-9]{3,32}$/;

function emptyVariant() {
  return { key: nextKey(), id: null, code: "", attributes: {}, images: [] };
}

function fromProduct(p, mode) {
  if (!p) return { ...blankForm(), variants: [emptyVariant()] };
  const isCopy = mode === "copy";
  return {
    name: p.name || "",
    description: p.description || "",
    note: p.note || "",
    category_id: p.category_id ?? "",
    supplier_id: p.supplier_id ?? "",
    supplier_price: p.supplier_price ?? "",
    min_price: p.min_price ?? "",
    price: p.price ?? "",
    tags: [...(p.tags || [])],
    variants: (p.variants || []).map((v) => ({
      key: nextKey(),
      id: isCopy ? null : v.id,
      code: isCopy ? "" : v.code, // copy => new auto codes
      attributes: Object.fromEntries(
        Object.entries(v.attributes || {}).map(([k, val]) => [String(k), val])
      ),
      images: (v.images || []).map((im) => im.url),
    })),
  };
}

function blankForm() {
  return {
    name: "",
    description: "",
    note: "",
    category_id: "",
    supplier_id: "",
    supplier_price: "",
    min_price: "",
    price: "",
    tags: [],
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
  const fileRefs = useRef({});

  useEffect(() => {
    if (open) {
      setForm(fromProduct(initial, mode));
      setTagDraft("");
    }
  }, [open, initial, mode]);

  const title = useMemo(() => {
    if (mode === "edit") return t("products.modal.editTitle");
    if (mode === "copy") return t("products.modal.copyTitle");
    return t("products.modal.addTitle");
  }, [mode, t]);

  const hasAttributes = (attributes?.length || 0) > 0;
  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
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
  function addVariant() {
    setForm((f) => ({ ...f, variants: [...f.variants, emptyVariant()] }));
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

  async function onFiles(key, e) {
    const files = [...e.target.files];
    e.target.value = "";
    const variant = form.variants.find((v) => v.key === key);
    const room = 5 - (variant?.images.length || 0);
    if (room <= 0) return;
    setUploadingKey(key);
    try {
      const urls = [];
      for (const file of files.slice(0, room)) urls.push(await uploadProductImage(file));
      setForm((f) => ({
        ...f,
        variants: f.variants.map((v) =>
          v.key === key ? { ...v, images: [...v.images, ...urls].slice(0, 5) } : v
        ),
      }));
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setUploadingKey(null);
    }
  }
  function removeImage(key, url) {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v) =>
        v.key === key ? { ...v, images: v.images.filter((u) => u !== url) } : v
      ),
    }));
  }

  // ---- Submit ----
  async function submit() {
    if (!form.name.trim()) {
      toast.error(t("products.modal.nameRequired"));
      return;
    }
    if (form.variants.length === 0) {
      toast.error(t("products.modal.variantRequired"));
      return;
    }
    for (const v of form.variants) {
      if (v.code && !CODE_RE.test(v.code.trim())) {
        toast.error(t("products.modal.codeInvalid"));
        return;
      }
    }
    // Every required attribute must have a value selected on every variant.
    const requiredAttrs = (attributes || []).filter((a) => a.is_required);
    for (const a of requiredAttrs) {
      const missing = form.variants.some((v) => !v.attributes[String(a.id)]);
      if (missing) {
        toast.error(t("products.modal.requiredAttr", { name: isAr ? a.name_ar : a.name_en }));
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      note: form.note || null,
      category_id: form.category_id ? Number(form.category_id) : null,
      supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
      supplier_price: Number(form.supplier_price) || 0,
      min_price: Number(form.min_price) || 0,
      price: Number(form.price) || 0,
      tags: form.tags,
      variants: form.variants.map((v) => ({
        ...(mode === "edit" && v.id ? { id: v.id } : {}),
        code: v.code ? v.code.trim().toUpperCase() : null,
        attributes: v.attributes,
        image_urls: v.images,
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
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
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
        <div className="md:col-span-2">
          <label className={labelCls}>{t("products.modal.name")} *</label>
          <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.category")}</label>
          <select className={`${inputCls} ctrl-select`} value={form.category_id}
            onChange={(e) => set("category_id", e.target.value)}>
            <option value="">{t("products.modal.selectCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{isAr ? c.name_ar : c.name_en}</option>
            ))}
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
          <input type="number" step="any" className={inputCls} value={form.supplier_price}
            onChange={(e) => set("supplier_price", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.minPrice")}</label>
          <input type="number" step="any" className={inputCls} value={form.min_price}
            onChange={(e) => set("min_price", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{t("products.modal.price")}</label>
          <input type="number" step="any" className={inputCls} value={form.price}
            onChange={(e) => set("price", e.target.value)} />
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

      {/* Variants */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <label className={labelCls + " mb-0"}>{t("products.modal.variants")}</label>
          {hasAttributes && (
            <button type="button" onClick={addVariant}
              className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <IconPlus width={14} height={14} /> {t("products.modal.addVariant")}
            </button>
          )}
        </div>

        {!hasAttributes && (
          <p className="mb-2 text-xs text-muted">{t("products.modal.noAttributesHint")}</p>
        )}

        <div className="space-y-3">
          {form.variants.map((v, i) => (
            <div key={v.key} className="rounded-xl border border-border bg-elevated/40 p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-text">
                  {t("products.modal.variant", { n: i + 1 })}
                </span>
                {form.variants.length > 1 && (
                  <button type="button" onClick={() => removeVariant(v.key)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10">
                    <IconTrash width={15} height={15} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Code */}
                <div>
                  <label className={labelCls}>{t("products.modal.code")}</label>
                  <input className={inputCls + " font-mono uppercase"} value={v.code}
                    placeholder={t("products.modal.codeAuto")}
                    onChange={(e) => updateVariant(v.key, { code: e.target.value })} />
                </div>
                {/* Attribute selects */}
                {attributes.map((attr) => {
                  const selId = v.attributes[String(attr.id)];
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
                    </div>
                  );
                })}
              </div>

              {/* Variant images */}
              <div className="mt-3">
                <label className={labelCls}>{t("products.modal.variantImages")}</label>
                <div className="flex flex-wrap gap-2">
                  {v.images.map((url) => (
                    <div key={url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
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
                      className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted transition hover:border-accent hover:text-accent">
                      {uploadingKey === v.key ? <span className="text-[10px]">…</span> : (
                        <><IconImage width={16} height={16} /><span className="text-[9px]">{t("products.modal.addImage")}</span></>
                      )}
                    </button>
                  )}
                  <input ref={(el) => (fileRefs.current[v.key] = el)} type="file" accept="image/*"
                    multiple className="hidden" onChange={(e) => onFiles(v.key, e)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
