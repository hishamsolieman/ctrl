import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { createFund, updateFund } from "@/lib/funds";

const today = () => new Date().toISOString().slice(0, 10);

const blank = () => ({ direction: "in", amount: "", occurred_at: today(), note: "" });

export default function FundModal({ open, mode, initial, currency, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const isView = mode === "view";
  const isEdit = mode === "edit";
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            direction: Number(initial.amount) < 0 ? "out" : "in",
            amount: Math.abs(Number(initial.amount || 0)).toFixed(2),
            occurred_at: initial.occurred_at || today(),
            note: initial.note || "",
          }
        : blank()
    );
  }, [open, initial]);

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const title = useMemo(() => {
    if (isView) return t("funds.modal.viewTitle");
    if (isEdit) return t("funds.modal.editTitle");
    return t("funds.modal.addTitle");
  }, [isView, isEdit, t]);

  async function submit() {
    if (isView) return onClose?.();
    if (!(Number(form.amount) > 0)) return toast.error(t("funds.errors.amountRequired"));
    if (!form.note.trim()) return toast.error(t("funds.errors.noteRequired"));
    if (!form.occurred_at) return toast.error(t("funds.errors.dateRequired"));

    const magnitude = Number(Number(form.amount).toFixed(2));
    const payload = {
      amount: form.direction === "out" ? -magnitude : magnitude,
      note: form.note.trim(),
      occurred_at: form.occurred_at,
    };
    setSaving(true);
    try {
      const saved = isEdit ? await updateFund(initial.id, payload) : await createFund(payload);
      toast.success(isEdit ? t("funds.modal.updated") : t("funds.modal.created"));
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  const dirBtn = (key, active) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
      active
        ? key === "in"
          ? "border-accent bg-accent/15 text-accent"
          : "border-red-500/60 bg-red-500/15 text-red-300"
        : "border-border text-muted hover:border-accent/50 hover:text-text"
    }`;

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
            {isView ? t("funds.modal.close") : t("funds.modal.cancel")}
          </button>
          {!isView && (
            <button type="button" onClick={submit} disabled={saving}
              className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95 disabled:opacity-50">
              {saving ? t("funds.modal.saving") : t("funds.modal.save")}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls}>{t("funds.modal.direction")} *</label>
          {isView ? (
            <p className="text-sm font-medium text-text">
              {form.direction === "out" ? t("funds.modal.out") : t("funds.modal.in")}
            </p>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={() => set("direction", "in")}
                className={dirBtn("in", form.direction === "in")}>
                {t("funds.modal.in")}
              </button>
              <button type="button" onClick={() => set("direction", "out")}
                className={dirBtn("out", form.direction === "out")}>
                {t("funds.modal.out")}
              </button>
            </div>
          )}
          {!isView && <p className="mt-1 text-xs text-muted">{t("funds.modal.directionHint")}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("funds.modal.amount")} *</label>
            {isView ? (
              <p className="text-sm font-medium text-text" dir="ltr">
                {Number(form.amount || 0).toFixed(2)} {currency}
              </p>
            ) : (
              <input type="number" min={0} step="0.01" dir="ltr" className={inputCls}
                value={form.amount} onChange={(e) => set("amount", e.target.value)}
                onBlur={(e) => set("amount", e.target.value ? Number(e.target.value).toFixed(2) : "")} />
            )}
          </div>
          <div>
            <label className={labelCls}>{t("funds.modal.date")} *</label>
            {isView ? (
              <p className="text-sm font-medium text-text" dir="ltr">{form.occurred_at}</p>
            ) : (
              <input type="date" className={inputCls} value={form.occurred_at}
                onChange={(e) => set("occurred_at", e.target.value)} />
            )}
          </div>
        </div>

        <div>
          <label className={labelCls}>{t("funds.modal.note")} *</label>
          {isView ? (
            <p className="whitespace-pre-wrap text-sm text-text">{form.note || "—"}</p>
          ) : (
            <textarea rows={3} className={inputCls} value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder={t("funds.modal.notePlaceholder")} />
          )}
        </div>

        {isView && initial?.created_by && (
          <div>
            <label className={labelCls}>{t("funds.modal.addedBy")}</label>
            <p className="text-sm font-medium text-text" dir="ltr">{initial.created_by}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
