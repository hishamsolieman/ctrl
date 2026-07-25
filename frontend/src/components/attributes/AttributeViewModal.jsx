import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";

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

export default function AttributeViewModal({ open, attribute, onClose }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  if (!attribute) return null;
  const a = attribute;

  const field = (label, value) => (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{label}</p>
      <div className="text-sm text-text">{value}</div>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={t("products.attrs.modal.viewTitle")} size="lg">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-bold text-text">{isAr ? a.name_ar : a.name_en}</h3>
          <p className="text-sm text-muted">{isAr ? a.name_en : a.name_ar}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {field(t("products.attrs.modal.type"), <Badge tone="accent">{t(`products.attrs.type.${a.type}`)}</Badge>)}
          {field(t("products.attrs.col.mandatory"), <Badge tone={a.is_required ? "accent" : "muted"}>{a.is_required ? t("products.attrs.yes") : t("products.attrs.no")}</Badge>)}
          {field(t("products.attrs.col.coding"), <Badge tone={a.coding ? "accent" : "muted"}>{a.coding ? t("products.attrs.yes") : t("products.attrs.no")}</Badge>)}
          {field(t("products.attrs.col.values"), <span>{(a.values || []).length}</span>)}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted">{t("products.attrs.col.values")}</p>
          <div className="flex flex-wrap gap-2">
            {(a.values || []).map((v) => (
              <span key={v.id}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-elevated px-2.5 py-1 text-sm text-text">
                {a.type === "color" && v.extra?.hex && (
                  <span className="h-3.5 w-3.5 rounded-full border border-white/20"
                    style={{ backgroundColor: v.extra.hex }} />
                )}
                <span>{isAr ? v.value_ar : v.value_en}</span>
              </span>
            ))}
            {(a.values || []).length === 0 && (
              <span className="text-sm text-muted">{t("products.attrs.modal.noValues")}</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
