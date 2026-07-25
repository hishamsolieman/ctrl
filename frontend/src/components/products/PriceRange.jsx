import { useTranslation } from "react-i18next";

// Dual-thumb price slider (0 .. max), goes both ways.
export default function PriceRange({ min, max, value, onChange, currency }) {
  const { i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const lo = value[0] ?? min;
  const hi = value[1] ?? max;
  const range = Math.max(max - min, 1);
  const loPct = ((lo - min) / range) * 100;
  const hiPct = ((hi - min) / range) * 100;

  // Filled segment respects direction.
  const left = isRtl ? 100 - hiPct : loPct;
  const right = isRtl ? 100 - loPct : 100 - hiPct;

  function setLo(v) {
    onChange([Math.min(Number(v), hi), hi]);
  }
  function setHi(v) {
    onChange([lo, Math.max(Number(v), lo)]);
  }

  return (
    <div>
      <div className="relative h-6">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-elevated" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${left}%`, right: `${right}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step="any"
          value={lo}
          onChange={(e) => setLo(e.target.value)}
          className="ctrl-range pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
        />
        <input
          type="range"
          min={min}
          max={max}
          step="any"
          value={hi}
          onChange={(e) => setHi(e.target.value)}
          className="ctrl-range pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>
          {Number(lo).toLocaleString()} {currency}
        </span>
        <span>
          {Number(hi).toLocaleString()} {currency}
        </span>
      </div>
    </div>
  );
}
