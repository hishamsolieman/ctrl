import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import { useBrand } from "@/context/BrandContext";
import { businessReport } from "@/lib/dashboard";
import { buildReportHtml } from "@/lib/reportPrint";
import { getPrintTarget, printDocument } from "@/lib/settings";
import { IconPrinter, IconCalendar, IconFileText } from "@/components/icons";

const iso = (d) => d.toISOString().slice(0, 10);

function presets() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const monthStart = new Date(y, m, 1);
  const prevStart = new Date(y, m - 1, 1);
  return {
    thisMonth: [iso(monthStart), iso(now)],
    lastMonth: [iso(prevStart), iso(new Date(y, m, 0))],
    last30: [iso(new Date(now.getTime() - 29 * 864e5)), iso(now)],
    thisYear: [iso(new Date(y, 0, 1)), iso(now)],
  };
}

export default function ReportModal({ open, onClose }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.resolvedLanguage === "ar";
  const loc = isAr ? "ar-EG" : "en-US";
  const toast = useToast();
  const brand = useBrand();

  const P = useMemo(presets, []);
  const [from, setFrom] = useState(P.thisMonth[0]);
  const [to, setTo] = useState(P.thisMonth[1]);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!open) return;
    getPrintTarget("report")
      .then((r) => setProfile(r?.profile || null))
      .catch(() => setProfile(null))
      .finally(() => setChecked(true));
  }, [open]);

  const days = useMemo(() => {
    const a = new Date(from);
    const b = new Date(to);
    if (Number.isNaN(+a) || Number.isNaN(+b) || b < a) return 0;
    return Math.round((b - a) / 864e5) + 1;
  }, [from, to]);

  const money = (n) =>
    `${Number(n || 0).toLocaleString(loc, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const num = (n) => Number(n || 0).toLocaleString(loc);
  const pctFmt = (n) => `${Number(n || 0).toLocaleString(loc, { maximumFractionDigits: 1 })}%`;
  const dateFmt = (s) =>
    new Date(s).toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" });
  const dayLabel = (s) => new Date(s).toLocaleDateString(loc, { day: "numeric", month: "short" });
  const monthLabel = (s) => {
    const [y, m] = String(s).split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(loc, { month: "short", year: "2-digit" });
  };
  // Sunday-first weekday names (7 Jan 2024 was a Sunday).
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 7 + i).toLocaleDateString(loc, { weekday: "short" })
      ),
    [loc]
  );

  async function generate() {
    if (!from || !to) return toast.error(t("report.errors.datesRequired"));
    if (days <= 0) return toast.error(t("report.errors.range"));
    setBusy(true);
    try {
      const data = await businessReport(from, to);
      const currency = data.currency || "";
      const withCcy = (n) => `${money(n)} ${currency}`.trim();
      const body = buildReportHtml({
        data,
        brand,
        isAr,
        t,
        profile,
        money: withCcy,
        num,
        pctFmt,
        dateFmt,
        dayLabel,
        monthLabel,
        weekdays,
      });
      await printDocument(body);
      toast.success(t("report.sent"));
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail ? t(detail, { defaultValue: detail }) : t("auth.genericError"));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "ctrl-input-sm w-full text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const chip =
    "rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-accent";

  const apply = ([a, b]) => {
    setFrom(a);
    setTo(b);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("report.modal.title")}
      dismissable={false}
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="ctrl-btn border border-border px-3 py-2 text-sm text-text hover:bg-elevated">
            {t("report.modal.cancel")}
          </button>
          <button type="button" onClick={generate} disabled={busy || days <= 0}
            className="ctrl-btn bg-accent px-3 py-2 text-sm text-black hover:brightness-95 disabled:opacity-50">
            <IconPrinter width={16} height={16} />
            {busy ? t("report.modal.working") : t("report.modal.generate")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{t("report.modal.intro")}</p>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip} onClick={() => apply(P.thisMonth)}>
            {t("report.presets.thisMonth")}
          </button>
          <button type="button" className={chip} onClick={() => apply(P.lastMonth)}>
            {t("report.presets.lastMonth")}
          </button>
          <button type="button" className={chip} onClick={() => apply(P.last30)}>
            {t("report.presets.last30")}
          </button>
          <button type="button" className={chip} onClick={() => apply(P.thisYear)}>
            {t("report.presets.thisYear")}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("report.modal.from")} *</label>
            <input type="date" className={inputCls} value={from} max={to}
              onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t("report.modal.to")} *</label>
            <input type="date" className={inputCls} value={to} min={from}
              onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-border bg-elevated/40 px-3 py-2.5 text-xs">
          <IconCalendar width={15} height={15} className="shrink-0 text-accent" />
          <span className="text-muted">
            {days > 0 ? t("report.modal.span", { count: days }) : t("report.errors.range")}
          </span>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-border bg-elevated/40 px-3 py-2.5 text-xs">
          <IconFileText width={15} height={15} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 text-muted">
            <p className="truncate">
              {!checked
                ? t("report.modal.checkingPrinter")
                : profile
                  ? t("report.modal.usingProfile", {
                      name: profile.name,
                      printer: profile.printer_name || t("report.modal.systemDefault"),
                    })
                  : t("report.modal.noProfile")}
            </p>
            <p className="mt-0.5">{t("report.modal.pagesNote")}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
