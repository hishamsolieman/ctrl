import { useEffect } from "react";
import { IconX } from "@/components/icons";

// Reusable modal. `dismissable` controls backdrop-click / Escape closing.
// The product add/edit modal passes dismissable={false} (no outside close).
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  dismissable = true,
  size = "md",
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape" && dismissable) onClose?.();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, dismissable, onClose]);

  if (!open) return null;

  const sizes = {
    sm: "max-w-md",
    md: "max-w-2xl",
    lg: "max-w-4xl",
    xl: "max-w-5xl",
    "2xl": "max-w-6xl",
    "3xl": "max-w-7xl",
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => dismissable && onClose?.()}
      />
      <div
        className={`relative my-auto w-full ${sizes[size]} animate-fade-in rounded-2xl border border-border bg-surface shadow-2xl`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-text"
            aria-label="Close"
          >
            <IconX width={18} height={18} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
