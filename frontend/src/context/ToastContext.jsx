import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

const ToastContext = createContext(null);

const DEFAULT_DURATION = 4000;

// Toast type -> accent color classes (themed, works in dark + RTL).
const VARIANTS = {
  error: {
    ring: "border-red-500/40",
    bar: "bg-red-500",
    icon: "text-red-400",
    glyph: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  },
  success: {
    ring: "border-accent/40",
    bar: "bg-accent",
    icon: "text-accent",
    glyph: "M20 6 9 17l-5-5",
  },
  info: {
    ring: "border-border",
    bar: "bg-muted",
    icon: "text-muted",
    glyph: "M12 16v-4m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  },
};

function ToastIcon({ variant }) {
  const v = VARIANTS[variant] || VARIANTS.info;
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={v.icon}
    >
      <path d={v.glyph} />
    </svg>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, { type = "info", duration = DEFAULT_DURATION } = {}) => {
      const id = ++idRef.current;
      setToasts((list) => [...list, { id, message, type }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  // Convenience API: toast.error(msg), toast.success(msg), toast.info(msg)
  const toast = useMemo(
    () => ({
      show: push,
      error: (msg, opts) => push(msg, { ...opts, type: "error" }),
      success: (msg, opts) => push(msg, { ...opts, type: "success" }),
      info: (msg, opts) => push(msg, { ...opts, type: "info" }),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Toast viewport — bottom-end: bottom-right in LTR, bottom-left in RTL */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-end gap-2 px-4 sm:px-6">
        {toasts.map((t) => {
          const v = VARIANTS[t.type] || VARIANTS.info;
          return (
            <div
              key={t.id}
              role="alert"
              className={`pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border ${v.ring} bg-surface px-4 py-3 ps-5 shadow-2xl animate-fade-in`}
            >
              <span className={`absolute inset-y-0 start-0 w-1 ${v.bar}`} />
              <ToastIcon variant={t.type} />
              <p className="flex-1 text-sm text-text">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="text-muted transition hover:text-text"
                aria-label="Dismiss"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
