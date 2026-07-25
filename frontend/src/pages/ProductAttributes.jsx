import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import {
  listAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
} from "@/lib/products";
import { IconPlus, IconTrash, IconX, IconSliders } from "@/components/icons";

let _k = 1;
const key = () => `a${_k++}`;

function toLocal(attrs) {
  return (attrs || []).map((a) => ({
    key: key(),
    id: a.id,
    attrKey: a.key,
    name_en: a.name_en,
    name_ar: a.name_ar,
    values: a.values.map((v) => ({
      key: key(),
      id: v.id,
      value_en: v.value_en,
      value_ar: v.value_ar,
      hex: v.extra?.hex || "",
    })),
  }));
}

export default function ProductAttributes() {
  const { t } = useTranslation();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = () => listAttributes().then((a) => setList(toLocal(a))).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const inputCls = "ctrl-input-sm w-full text-sm";

  const patchAttr = (k, patch) => setList((l) => l.map((a) => (a.key === k ? { ...a, ...patch } : a)));
  const addAttr = () =>
    setList((l) => [...l, { key: key(), id: null, attrKey: "", name_en: "", name_ar: "", values: [] }]);
  const addValue = (ak) =>
    setList((l) =>
      l.map((a) =>
        a.key === ak
          ? { ...a, values: [...a.values, { key: key(), id: null, value_en: "", value_ar: "", hex: "" }] }
          : a
      )
    );
  const patchValue = (ak, vk, patch) =>
    setList((l) =>
      l.map((a) =>
        a.key === ak ? { ...a, values: a.values.map((v) => (v.key === vk ? { ...v, ...patch } : v)) } : a
      )
    );
  const removeValue = (ak, vk) =>
    setList((l) => l.map((a) => (a.key === ak ? { ...a, values: a.values.filter((v) => v.key !== vk) } : a)));

  async function onDeleteAttr(a) {
    if (pendingDelete !== a.key) {
      setPendingDelete(a.key);
      return;
    }
    if (a.id) {
      try {
        await deleteAttribute(a.id);
        toast.success(t("products.attrs.deleted"));
      } catch (err) {
        toast.error(err?.response?.data?.detail || t("auth.genericError"));
        return;
      }
    }
    setList((l) => l.filter((x) => x.key !== a.key));
    setPendingDelete(null);
  }

  async function save() {
    setSaving(true);
    try {
      for (const a of list) {
        if (!a.attrKey.trim() || !a.name_en.trim() || !a.name_ar.trim()) continue;
        const payload = {
          key: a.attrKey.trim(),
          name_en: a.name_en.trim(),
          name_ar: a.name_ar.trim(),
          values: a.values
            .filter((v) => v.value_en.trim() && v.value_ar.trim())
            .map((v) => ({
              ...(v.id ? { id: v.id } : {}),
              value_en: v.value_en.trim(),
              value_ar: v.value_ar.trim(),
              extra: v.hex ? { hex: v.hex } : null,
            })),
        };
        if (a.id) await updateAttribute(a.id, payload);
        else await createAttribute(payload);
      }
      toast.success(t("products.attrs.saved"));
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("products.attrs.title")}</h1>
          <p className="text-sm text-muted">{t("products.attrs.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={addAttr}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated">
            <IconPlus width={16} height={16} /> {t("products.attrs.addAttribute")}
          </button>
          <button onClick={save} disabled={saving}
            className="ctrl-btn bg-accent px-4 py-2 text-sm text-black hover:brightness-95">
            {saving ? t("products.attrs.saving") : t("products.attrs.save")}
          </button>
        </div>
      </div>

      <div className="ctrl-card min-h-0 flex-1 overflow-y-auto p-4">
        {list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated text-muted">
              <IconSliders width={28} height={28} />
            </span>
            <p className="text-sm text-muted">{t("products.attrs.empty")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {list.map((a) => {
              const isColor = a.attrKey.toLowerCase().includes("color") || a.values.some((v) => v.hex);
              return (
                <div key={a.key} className="rounded-xl border border-border p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <input className={inputCls} placeholder={t("products.attrs.key")}
                      value={a.attrKey} onChange={(e) => patchAttr(a.key, { attrKey: e.target.value })} />
                    <input className={inputCls} placeholder={t("products.attrs.nameEn")}
                      value={a.name_en} onChange={(e) => patchAttr(a.key, { name_en: e.target.value })} />
                    <input className={inputCls} placeholder={t("products.attrs.nameAr")}
                      value={a.name_ar} onChange={(e) => patchAttr(a.key, { name_ar: e.target.value })} />
                    <button type="button" onClick={() => onDeleteAttr(a)}
                      className={`ctrl-btn justify-center border px-2 py-2 text-sm ${
                        pendingDelete === a.key
                          ? "border-red-500 bg-red-500 text-white"
                          : "border-border text-red-400 hover:bg-red-500/10"
                      }`}>
                      <IconTrash width={15} height={15} />
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-muted">{t("products.attrs.values")}</p>
                    {a.values.map((v) => (
                      <div key={v.key} className="flex flex-wrap items-center gap-2">
                        <input className="ctrl-input-sm w-32 text-sm" placeholder={t("products.attrs.valueEn")}
                          value={v.value_en} onChange={(e) => patchValue(a.key, v.key, { value_en: e.target.value })} />
                        <input className="ctrl-input-sm w-32 text-sm" placeholder={t("products.attrs.valueAr")}
                          value={v.value_ar} onChange={(e) => patchValue(a.key, v.key, { value_ar: e.target.value })} />
                        {isColor && (
                          <input type="color" title={t("products.attrs.colorHex")}
                            className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent"
                            value={v.hex || "#8eff19"}
                            onChange={(e) => patchValue(a.key, v.key, { hex: e.target.value })} />
                        )}
                        <button type="button" onClick={() => removeValue(a.key, v.key)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-red-400">
                          <IconX width={14} height={14} />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => addValue(a.key)}
                      className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                      <IconPlus width={13} height={13} /> {t("products.attrs.addValue")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
