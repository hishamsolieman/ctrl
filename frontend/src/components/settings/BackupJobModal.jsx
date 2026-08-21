import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { getBackupStatus } from "@/lib/settings";

export default function BackupJobModal({ open, kind, onClose }) {
  const { t } = useTranslation();
  const [job, setJob] = useState({
    kind: kind || "backup",
    state: "running",
    progress: 0,
    phase: "backup.phase.starting",
    filename: "",
    error: null,
  });

  useEffect(() => {
    if (!open) return;
    let stop = false;
    const tick = async () => {
      try {
        const data = await getBackupStatus();
        if (!stop) setJob(data);
        if (data.state === "done" || data.state === "error") return;
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(tick, 400);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [open]);

  const running = job.state === "running" || job.state === "idle";
  const failed = job.state === "error";
  const done = job.state === "done";
  const title =
    kind === "restore" ? t("settings.backup.restoreTitle") : t("settings.backup.nowTitle");

  return (
    <Modal
      open={open}
      onClose={running ? undefined : onClose}
      dismissable={!running}
      size="sm"
      title={title}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {failed
            ? t(job.error || "backup.errors.failed", { defaultValue: t("auth.genericError") })
            : t(job.phase || "backup.phase.starting", { defaultValue: t("settings.backup.working") })}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-elevated">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              failed ? "bg-red-500" : "bg-accent"
            }`}
            style={{ width: `${Math.max(2, job.progress || 0)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{Math.max(0, job.progress || 0)}%</span>
          {job.filename && <span className="font-mono" dir="ltr">{job.filename}</span>}
        </div>
        {done && (
          <p className="text-sm text-accent">
            {kind === "restore" ? t("settings.backup.restoreDone") : t("settings.backup.nowDone")}
          </p>
        )}
        {!running && (
          <div className="flex justify-end">
            <button type="button" className="ctrl-btn-accent px-4 py-2 text-sm" onClick={onClose}>
              {t("settings.backup.close")}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
