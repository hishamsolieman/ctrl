import { IconEye, IconEyeOff } from "@/components/icons";

export const MASK = "\u2217\u2217\u2217"; // ***

const TONES = {
  emerald: { grad: "from-emerald-500/15 via-emerald-500/5", tile: "bg-emerald-500/20 text-emerald-300", glow: "bg-emerald-500/20" },
  amber: { grad: "from-amber-500/15 via-amber-500/5", tile: "bg-amber-500/20 text-amber-300", glow: "bg-amber-500/20" },
  sky: { grad: "from-sky-500/15 via-sky-500/5", tile: "bg-sky-500/20 text-sky-300", glow: "bg-sky-500/20" },
  violet: { grad: "from-violet-500/15 via-violet-500/5", tile: "bg-violet-500/20 text-violet-300", glow: "bg-violet-500/20" },
  rose: { grad: "from-rose-500/15 via-rose-500/5", tile: "bg-rose-500/20 text-rose-300", glow: "bg-rose-500/20" },
  accent: { grad: "from-accent/15 via-accent/5", tile: "bg-accent/20 text-accent", glow: "bg-accent/20" },
};

// Money/KPI tile. With `secret`, the value renders as *** until revealed.
export default function StatCard({
  Icon,
  label,
  value,
  foot,
  tone = "emerald",
  secret,
  revealed,
  onToggleSecret,
  revealLabel,
  hideLabel,
}) {
  const c = TONES[tone] || TONES.emerald;
  return (
    <div className={`ctrl-card relative flex h-full min-h-[7.5rem] flex-col overflow-hidden bg-gradient-to-br ${c.grad} to-transparent p-5`}>
      <span className={`pointer-events-none absolute -start-8 -top-10 h-24 w-24 rounded-full ${c.glow} blur-2xl`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
          <div className="mt-2 flex items-center gap-2">
            <p className="truncate text-2xl font-bold text-text" title={secret && !revealed ? undefined : String(value ?? "")}>
              {secret && !revealed ? MASK : value}
            </p>
            {secret && (
              <button
                type="button"
                onClick={onToggleSecret}
                title={revealed ? hideLabel : revealLabel}
                aria-label={revealed ? hideLabel : revealLabel}
                className="shrink-0 text-muted transition hover:text-text"
              >
                {revealed ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
              </button>
            )}
          </div>
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.tile}`}>
          <Icon width={22} height={22} />
        </span>
      </div>
      {foot && <div className="relative mt-auto border-t border-border/60 pt-2 text-xs text-muted">{foot}</div>}
    </div>
  );
}
