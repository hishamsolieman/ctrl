import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/context/ToastContext";
import { useBrand } from "@/context/BrandContext";
import {
  listPrintProfiles,
  deletePrintProfile,
  getPrintAssignments,
  setPrintAssignment,
  listPrinters,
  logTestPrint,
  runTestPrint,
  isDesktop,
} from "@/lib/settings";
import PrintProfileModal from "@/components/settings/PrintProfileModal";
import Modal from "@/components/Modal";
import {
  IconPrinter,
  IconPlus,
  IconEdit,
  IconTrash,
  IconBox,
  IconReceipt,
  IconActivity,
} from "@/components/icons";

const TARGETS = [
  { key: "barcode", Icon: IconBox },
  { key: "invoice", Icon: IconReceipt },
  { key: "report", Icon: IconActivity },
];

export default function PrinterSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const brand = useBrand();

  const [profiles, setProfiles] = useState([]);
  const [assignments, setAssignments] = useState({ barcode: null, invoice: null, report: null });
  const [printers, setPrinters] = useState([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, mode: "add", profile: null });
  const [confirmDel, setConfirmDel] = useState(null);
  const [testing, setTesting] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([listPrintProfiles(), getPrintAssignments()]);
      setProfiles(p);
      setAssignments(a);
    } catch {
      toast.error(t("auth.genericError"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  const refreshPrinters = useCallback(async () => {
    setPrintersLoading(true);
    try {
      setPrinters(await listPrinters());
    } catch {
      setPrinters([]);
    } finally {
      setPrintersLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    refreshPrinters();
  }, [load, refreshPrinters]);

  const byId = useMemo(() => {
    const m = new Map();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const sizeLabel = useCallback(
    (p) =>
      p.size_mode === "custom"
        ? `${p.width}×${p.height} ${p.unit}`
        : p.standard_size || "—",
    []
  );

  async function onAssign(target, value) {
    const profileId = value ? Number(value) : null;
    setAssignments((a) => ({ ...a, [target]: profileId }));
    try {
      await setPrintAssignment(target, profileId);
    } catch {
      toast.error(t("auth.genericError"));
      load();
    }
  }

  function testHtml(target, profile) {
    const head = `<div style="font-weight:700;font-size:14px">${brand?.name || "CTRL"}</div>`;
    if (target === "barcode") {
      return (
        `${head}<div style="margin-top:6px;font-size:11px">${t("settings.printer.test.barcode")}</div>` +
        `<div style="font-family:monospace;letter-spacing:2px;font-size:20px;margin-top:4px">ABC12345</div>` +
        `<div style="height:32px;margin-top:4px;background:repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)"></div>` +
        `<div style="font-family:monospace;text-align:center;margin-top:2px">ABC12345</div>`
      );
    }
    if (target === "invoice") {
      return (
        `${head}<div style="margin-top:6px;font-size:11px">${t("settings.printer.test.invoice")}</div>` +
        `<hr><div style="display:flex;justify-content:space-between"><span>Sample item ×1</span><span>100.00</span></div>` +
        `<div style="display:flex;justify-content:space-between;font-weight:700;margin-top:4px"><span>Total</span><span>100.00</span></div>`
      );
    }
    return (
      `${head}<div style="margin-top:6px;font-size:11px">${t("settings.printer.test.report")}</div>` +
      `<div style="margin-top:4px">${new Date().toLocaleString()}</div>` +
      `<div>${t("settings.printer.test.sample")}</div>`
    );
  }

  function testText(target, profile) {
    const size =
      profile.size_mode === "custom"
        ? `${profile.width}x${profile.height} ${profile.unit}`
        : profile.standard_size;
    return (
      `${brand?.name || "CTRL"}\n` +
      `${t(`settings.printer.test.${target}`)}\n` +
      `${t("settings.printer.modal.printer")}: ${profile.printer_name}\n` +
      `${t("settings.printer.table.size")}: ${size}\n` +
      `${new Date().toLocaleString()}\n` +
      `${t("settings.printer.test.sample")}\n`
    );
  }

  async function onTest(target) {
    const profile = byId.get(assignments[target]);
    if (!profile) return;
    setTesting(target);
    try {
      await runTestPrint(profile, target, testHtml(target, profile), testText(target, profile));
      logTestPrint(target, profile.id).catch(() => {});
      toast.success(t("settings.printer.test.sent"));
    } catch {
      toast.error(t("settings.printer.test.failed"));
    } finally {
      setTesting("");
    }
  }

  async function onDelete() {
    if (!confirmDel) return;
    try {
      await deletePrintProfile(confirmDel.id);
      toast.success(t("settings.printer.deleted"));
      setConfirmDel(null);
      load();
    } catch {
      toast.error(t("auth.genericError"));
    }
  }

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text transition hover:border-accent hover:text-accent";

  return (
    <div className="space-y-6">
      {/* Assignments */}
      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold text-text">{t("settings.printer.assignTitle")}</h2>
          <p className="text-sm text-muted">{t("settings.printer.assignSubtitle")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TARGETS.map(({ key, Icon }) => {
            const assigned = byId.get(assignments[key]);
            return (
              <div key={key} className="ctrl-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-elevated text-accent">
                    <Icon width={18} height={18} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-text">{t(`settings.printer.targets.${key}`)}</p>
                    <p className="text-[11px] text-muted">{t(`settings.printer.targetsSub.${key}`)}</p>
                  </div>
                </div>
                <select className="ctrl-input-sm ctrl-select w-full text-sm"
                  value={assignments[key] ?? ""} onChange={(e) => onAssign(key, e.target.value)}>
                  <option value="">{t("settings.printer.none")}</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" disabled={!assigned || testing === key}
                  onClick={() => onTest(key)}
                  className="ctrl-btn mt-3 w-full border border-border py-2 text-sm text-text hover:bg-elevated disabled:opacity-40">
                  <IconPrinter width={15} height={15} />
                  {testing === key ? t("settings.printer.test.sending") : t("settings.printer.test.action")}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Profiles */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text">{t("settings.printer.profilesTitle")}</h2>
            <p className="text-sm text-muted">
              {t("settings.printer.profilesSubtitle")}
              {!isDesktop() && <span className="ms-1 text-amber-400">· {t("settings.printer.browserMode")}</span>}
            </p>
          </div>
          <button onClick={() => setModal({ open: true, mode: "add", profile: null })}
            className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95">
            <IconPlus width={16} height={16} /> {t("settings.printer.addProfile")}
          </button>
        </div>

        <div className="ctrl-card overflow-hidden">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-elevated/70" />
              ))}
            </div>
          ) : profiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated text-muted">
                <IconPrinter width={26} height={26} />
              </span>
              <p className="text-sm text-muted">{t("settings.printer.empty")}</p>
            </div>
          ) : (
            <table className="ctrl-table w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-medium">{t("settings.printer.table.name")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("settings.printer.table.printer")}</th>
                  <th className="px-4 py-3 text-center font-medium">{t("settings.printer.table.size")}</th>
                  <th className="px-4 py-3 text-end font-medium">{t("settings.printer.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 transition hover:bg-elevated/40">
                    <td className="px-4 py-3 font-medium text-text">{p.name}</td>
                    <td className="px-4 py-3 text-muted" dir="ltr">{p.printer_name}</td>
                    <td className="px-4 py-3 text-center text-muted">{sizeLabel(p)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button title={t("settings.printer.edit")} className={iconBtn}
                          onClick={() => setModal({ open: true, mode: "edit", profile: p })}>
                          <IconEdit width={15} height={15} />
                        </button>
                        <button title={t("settings.printer.delete")}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition hover:bg-red-500 hover:text-white"
                          onClick={() => setConfirmDel(p)}>
                          <IconTrash width={15} height={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <PrintProfileModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.profile}
        printers={printers}
        printersLoading={printersLoading}
        onRefreshPrinters={refreshPrinters}
        onSaved={load}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
      />

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)}
        title={t("settings.printer.confirmDelete.title")} size="sm"
        footer={
          <>
            <button type="button" onClick={() => setConfirmDel(null)}
              className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated">
              {t("settings.printer.modal.cancel")}
            </button>
            <button type="button" onClick={onDelete}
              className="ctrl-btn bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600">
              {t("settings.printer.delete")}
            </button>
          </>
        }>
        <p className="text-sm text-text">
          {t("settings.printer.confirmDelete.body", { name: confirmDel?.name })}
        </p>
      </Modal>
    </div>
  );
}
