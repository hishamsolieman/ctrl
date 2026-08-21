import Modal from "@/components/Modal";
import { IconTrash } from "@/components/icons";

const TONES = {
  danger: {
    wrap: "bg-red-500/15 text-red-400",
    btn: "ctrl-btn bg-red-500 text-white hover:bg-red-600",
  },
  accent: {
    wrap: "bg-accent/15 text-accent",
    btn: "ctrl-btn-accent",
  },
};

// Confirmation dialog. Defaults match delete (trash + red). Pass `icon` / `tone`
// for other actions such as restore.
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  loading = false,
  icon: Icon = IconTrash,
  tone = "danger",
}) {
  const look = TONES[tone] || TONES.danger;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="ctrl-btn border border-border text-text hover:bg-elevated"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={look.btn}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${look.wrap}`}>
          <Icon width={20} height={20} />
        </span>
        <p className="pt-1.5 text-sm text-muted">{body}</p>
      </div>
    </Modal>
  );
}
