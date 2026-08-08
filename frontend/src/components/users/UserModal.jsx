import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { createUser, updateUser } from "@/lib/users";
import { uploadImage, mediaUrl } from "@/lib/products";
import { IconImage, IconX, IconUser } from "@/components/icons";

const ADMIN_LEVEL = 30;

const ROLE_KEY = {
  SuperAdmin: "users.roles.SuperAdmin",
  Admin: "users.roles.Admin",
  Moderator: "users.roles.Moderator",
  Cashier: "users.roles.Cashier",
};

function blank(defaultRole) {
  return { username: "", full_name: "", role: defaultRole || "", is_active: true, password: "", image_url: "" };
}

export default function UserModal({ open, mode, initial, roles, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const isEdit = mode === "edit";
  const canImage = (user?.role_level ?? 0) >= ADMIN_LEVEL;

  // Assignable roles sorted highest→lowest (as returned by the API).
  const defaultRole = roles?.[roles.length - 1]?.name || "";
  const [form, setForm] = useState(blank(defaultRole));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            username: initial.username || "",
            full_name: initial.full_name || "",
            role: initial.role || defaultRole,
            is_active: initial.is_active ?? true,
            password: "",
            image_url: initial.image_url || "",
          }
        : blank(defaultRole)
    );
  }, [open, initial, defaultRole]);

  const title = isEdit ? t("users.modal.editTitle") : t("users.modal.addTitle");
  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const roleName = useMemo(
    () => (r) => t(ROLE_KEY[r] || r, { defaultValue: r }),
    [t]
  );

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      set("image_url", await uploadImage(file));
    } catch (err) {
      if (err?.code === "unsupported") toast.error(t("products.modal.imageUnsupported"));
      else {
        const detail = err?.response?.data?.detail;
        toast.error(detail ? t(detail, { defaultValue: t("auth.genericError") }) : t("auth.genericError"));
      }
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!isEdit) {
      if (form.username.trim().length < 3) return toast.error(t("users.errors.usernameShort"));
    }
    if (!form.role) return toast.error(t("users.errors.roleRequired"));
    if (!isEdit && form.password.trim() && form.password.trim().length < 8)
      return toast.error(t("users.errors.passwordShort"));

    setSaving(true);
    try {
      let saved;
      if (isEdit) {
        saved = await updateUser(initial.id, {
          full_name: form.full_name.trim() || null,
          role: form.role,
          is_active: form.is_active,
          ...(canImage ? { image_url: form.image_url || "" } : {}),
        });
        toast.success(t("users.modal.updated"));
      } else {
        saved = await createUser({
          username: form.username.trim(),
          full_name: form.full_name.trim() || null,
          role: form.role,
          password: form.password.trim() || null,
          ...(canImage ? { image_url: form.image_url || "" } : {}),
        });
        toast.success(t("users.modal.created"));
      }
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
            className="ctrl-btn border border-border text-text hover:bg-elevated">
            {t("users.modal.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="ctrl-btn bg-accent text-black hover:brightness-95">
            {saving ? t("users.modal.saving") : t("users.modal.save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {canImage && (
          <div className="flex flex-col items-center gap-2">
            <div className="relative h-24 w-24">
              <div className="h-24 w-24 overflow-hidden rounded-full border border-border bg-elevated">
                {form.image_url ? (
                  <img src={mediaUrl(form.image_url)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted">
                    <IconUser width={34} height={34} />
                  </span>
                )}
              </div>
              {form.image_url && (
                <button type="button" onClick={() => set("image_url", "")}
                  title={t("users.modal.removeImage")}
                  className="absolute -end-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white">
                  <IconX width={13} height={13} />
                </button>
              )}
            </div>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="ctrl-btn border border-border px-3 py-1.5 text-xs text-text hover:bg-elevated disabled:opacity-50">
              <IconImage width={14} height={14} />
              {uploading ? t("users.modal.uploading") : (form.image_url ? t("users.modal.changeImage") : t("users.modal.addImage"))}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          </div>
        )}

        <div>
          <label className={labelCls}>{t("users.modal.username")} *</label>
          <input className={inputCls} dir="ltr" value={form.username} disabled={isEdit}
            onChange={(e) => set("username", e.target.value)} />
          {isEdit && <p className="mt-1 text-[11px] text-muted">{t("users.modal.usernameLocked")}</p>}
        </div>

        <div>
          <label className={labelCls}>{t("users.modal.fullName")}</label>
          <input className={inputCls} value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>{t("users.modal.role")} *</label>
          <select className={`${inputCls} ctrl-select`} value={form.role}
            onChange={(e) => set("role", e.target.value)}>
            {(roles || []).map((r) => (
              <option key={r.name} value={r.name}>{roleName(r.name)}</option>
            ))}
          </select>
        </div>

        {!isEdit && (
          <div>
            <label className={labelCls}>{t("users.modal.password")}</label>
            <input className={inputCls} dir="ltr" value={form.password}
              placeholder={t("users.modal.passwordPlaceholder")}
              onChange={(e) => set("password", e.target.value)} />
            <p className="mt-1 text-[11px] text-muted">{t("users.modal.passwordHint")}</p>
          </div>
        )}

        {isEdit && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input type="checkbox" className="ctrl-check" checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)} />
            {t("users.modal.active")}
          </label>
        )}
      </div>
    </Modal>
  );
}
