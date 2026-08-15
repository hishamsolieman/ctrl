import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { uploadImage, mediaUrl } from "@/lib/products";
import { IconImage, IconUser, IconX } from "@/components/icons";

export default function ProfileSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, updateProfile } = useAuth();
  const fileRef = useRef(null);

  const [fullName, setFullName] = useState(user?.full_name || "");
  const [imageUrl, setImageUrl] = useState(user?.image_url || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setFullName(user?.full_name || "");
    setImageUrl(user?.image_url || "");
  }, [user?.full_name, user?.image_url]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      setImageUrl(await uploadImage(file));
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

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        full_name: fullName.trim(),
        image_url: imageUrl || "",
      });
      toast.success(t("settings.profile.saved"));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";

  return (
    <form onSubmit={submit} className="mx-auto max-w-lg">
      <div className="ctrl-card space-y-5 p-5 sm:p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-24 w-24">
            <div className="h-24 w-24 overflow-hidden rounded-full border border-border bg-elevated">
              {imageUrl ? (
                <img src={mediaUrl(imageUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted">
                  <IconUser width={34} height={34} />
                </span>
              )}
            </div>
            {imageUrl && (
              <button
                type="button"
                onClick={() => setImageUrl("")}
                title={t("settings.profile.removeImage")}
                className="absolute -end-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <IconX width={13} height={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="ctrl-btn border border-border px-3 py-1.5 text-xs text-text hover:bg-elevated disabled:opacity-50"
          >
            <IconImage width={14} height={14} />
            {uploading
              ? t("settings.profile.uploading")
              : imageUrl
                ? t("settings.profile.changeImage")
                : t("settings.profile.addImage")}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>

        <div>
          <label className={labelCls}>{t("settings.profile.username")}</label>
          <input className={inputCls} dir="ltr" value={user?.username || ""} disabled />
        </div>

        <div>
          <label className={labelCls}>{t("settings.profile.fullName")}</label>
          <input
            className={inputCls}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div className="flex justify-end pt-1">
          <button type="submit" disabled={saving || uploading} className="ctrl-btn-accent px-5 py-2.5 text-sm">
            {saving ? t("settings.profile.saving") : t("settings.profile.save")}
          </button>
        </div>
      </div>
    </form>
  );
}
