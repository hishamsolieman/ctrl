// Card shell for a chart: title, optional hint, and an empty-state fallback so
// a quiet day renders a message instead of a blank canvas.
export default function ChartCard({ title, hint, badge, empty, emptyText, height = 300, children }) {
  return (
    <div className="ctrl-card flex h-full flex-col p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-text">{title}</h3>
          {hint && <p className="mt-0.5 truncate text-xs text-muted" title={hint}>{hint}</p>}
        </div>
        {badge}
      </div>
      {empty ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted" style={{ minHeight: height }}>
          {emptyText}
        </div>
      ) : (
        <div className="min-h-0 flex-1" style={{ minHeight: height }}>{children}</div>
      )}
    </div>
  );
}
