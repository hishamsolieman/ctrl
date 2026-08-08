import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { createExpense, updateExpense } from "@/lib/expenses";

const today = () => new Date().toISOString().slice(0, 10);

function blank(meta) {
  return {
    user_id: meta?.self?.id ?? null,
    type: meta?.types?.[0] || "rent",
    name: "",
    amount: "",
    spent_at: today(),
    note: "",
  };
}

export default function ExpenseModal({ open, mode, initial, meta, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const isView = mode === "view";
  const isEdit = mode === "edit";
  const [form, setForm] = useState(blank(meta));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            user_id: initial.user_id,
            type: initial.type || "rent",
            name: initial.name || "",
            amount: initial.amount != null ? Number(initial.amount).toFixed(2) : "",
            spent_at: initial.spent_at || today(),
            note: initial.note || "",
          }
        : blank(meta)
    );
  }, [open, initial, meta]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isOther = form.type === "other";

  const title = useMemo(() => {
    if (isView) return t("expenses.modal.viewTitle");
    if (isEdit) return t("expenses.modal.editTitle");
    return t("expenses.modal.addTitle");
  }, [isView, isEdit, t]);

  async function submit() {
    if (isView) return onClose?.();
    if (isOther && !form.name.trim()) return toast.error(t("expenses.errors.nameRequired"));
    if (!(Number(form.amount) > 0)) return toast.error(t("expenses.errors.amountRequired"));
    if (!form.spent_at) return toast.error(t("expenses.errors.dateRequired"));

    const payload = {
      type: form.type,
      name: isOther ? form.name.trim() : null,
      amount: Number(form.amount),
      spent_at: form.spent_at,
      note: form.note.trim() || null,
      ...(meta?.is_admin ? { user_id: form.user_id } : {}),
    };
    setSaving(true);
    try {
      const saved = isEdit ? await updateExpense(initial.id, payload) : await createExpense(payload);
      toast.success(isEdit ? t("expenses.modal.updated") : t("expenses.modal.created"));
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      dismissable={false}
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated">
            {isView ? t("expenses.modal.close") : t("expenses.modal.cancel")}
          </button>
          {!isView && (
            <button type="button" onClick={submit} disabled={saving}
              className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95 disabled:opacity-50">
              {saving ? t("expenses.modal.saving") : t("expenses.modal.save")}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {meta?.is_admin && (
          <div>
            <label className={labelCls}>{t("expenses.modal.onBehalf")}</label>
            {isView ? (
              <p className="text-sm font-medium text-text">{initial?.username || "—"}</p>
            ) : (
              <select className={`${inputCls} ctrl-select`} value={form.user_id ?? ""}
                onChange={(e) => set("user_id", Number(e.target.value))}>
                {(meta.users || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}{u.full_name ? ` — ${u.full_name}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div>
          <label className={labelCls}>{t("expenses.modal.type")} *</label>
          {isView ? (
            <p className="text-sm font-medium text-text">
              {isOther ? initial?.name : t(`expenses.types.${form.type}`)}
            </p>
          ) : (
            <select className={`${inputCls} ctrl-select`} value={form.type}
              onChange={(e) => set("type", e.target.value)}>
              {(meta?.types || []).map((k) => (
                <option key={k} value={k}>{t(`expenses.types.${k}`)}</option>
              ))}
            </select>
          )}
        </div>

        {isOther && !isView && (
          <div>
            <label className={labelCls}>{t("expenses.modal.name")} *</label>
            <input className={inputCls} value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("expenses.modal.namePlaceholder")} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("expenses.modal.amount")} *</label>
            {isView ? (
              <p className="text-sm font-medium text-text" dir="ltr">
                {Number(form.amount || 0).toFixed(2)} {meta?.currency}
              </p>
            ) : (
              <input type="number" min={0} step="0.01" dir="ltr" className={inputCls}
                value={form.amount} onChange={(e) => set("amount", e.target.value)}
                onBlur={(e) => set("amount", e.target.value ? Number(e.target.value).toFixed(2) : "")} />
            )}
          </div>
          <div>
            <label className={labelCls}>{t("expenses.modal.date")} *</label>
            {isView ? (
              <p className="text-sm font-medium text-text" dir="ltr">{form.spent_at}</p>
            ) : (
              <input type="date" className={inputCls} value={form.spent_at}
                onChange={(e) => set("spent_at", e.target.value)} />
            )}
          </div>
        </div>

        <div>
          <label className={labelCls}>{t("expenses.modal.note")}</label>
          {isView ? (
            <p className="whitespace-pre-wrap text-sm text-text">{form.note || "—"}</p>
          ) : (
            <textarea rows={3} className={inputCls} value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder={t("expenses.modal.notePlaceholder")} />
          )}
        </div>
      </div>
    </Modal>
  );
}
