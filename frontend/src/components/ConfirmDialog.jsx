import Modal from "@/components/Modal";
import { IconTrash } from "@/components/icons";

// Confirmation dialog (used for the soft-delete confirmation).
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  loading = false,
}) {
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
            className="ctrl-btn bg-red-500 text-white hover:bg-red-600"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
          <IconTrash width={20} height={20} />
        </span>
        <p className="pt-1.5 text-sm text-muted">{body}</p>
      </div>
    </Modal>
  );
}
