import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { posBootstrap, posRelease } from "@/lib/pos";
import CartWorkspace from "@/components/pos/CartWorkspace";
import ConfirmDialog from "@/components/ConfirmDialog";
import { IconPlus, IconX, IconCart } from "@/components/icons";

const MAX_TABS = 5;

const newKey = () =>
  (crypto?.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`);

function blankTab() {
  return {
    id: newKey(),
    holdKey: newKey(),
    items: [],
    step: 1,
    customer: { phone: "", name: "", existing: false },
    paymentMethodId: null,
    sale: null,
  };
}

export default function Cashier() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();

  const storageKey = useMemo(
    () => `pos:tabs:${user?.username || "anon"}`,
    [user]
  );

  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [boot, setBoot] = useState(null);
  const [closing, setClosing] = useState(null); // tab pending close-confirm
  const loadedRef = useRef(false);

  // Load persisted tabs (per username) once, or start with one fresh cart.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    let restored = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) restored = JSON.parse(raw);
    } catch {
      restored = null;
    }
    if (Array.isArray(restored) && restored.length) {
      setTabs(restored);
      setActiveId(restored[0].id);
    } else {
      const t0 = blankTab();
      setTabs([t0]);
      setActiveId(t0.id);
    }
  }, [storageKey]);

  // Persist on every change.
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(tabs));
    } catch {
      /* ignore quota errors */
    }
  }, [tabs, storageKey]);

  useEffect(() => {
    posBootstrap()
      .then(setBoot)
      .catch(() => toast.error(t("auth.genericError")));
  }, [t, toast]);

  const patchTab = useCallback((id, partial) => {
    setTabs((prev) =>
      prev.map((tb) =>
        tb.id === id ? { ...tb, ...(typeof partial === "function" ? partial(tb) : partial) } : tb
      )
    );
  }, []);

  const addTab = () => {
    if (tabs.length >= MAX_TABS) {
      toast.info(t("pos.maxTabs"));
      return;
    }
    const nt = blankTab();
    setTabs((prev) => [...prev, nt]);
    setActiveId(nt.id);
  };

  async function reallyClose(tab) {
    try {
      await posRelease(tab.holdKey);
    } catch {
      /* releasing is best-effort */
    }
    setTabs((prev) => {
      const remaining = prev.filter((tb) => tb.id !== tab.id);
      if (remaining.length === 0) {
        const nt = blankTab();
        setActiveId(nt.id);
        return [nt];
      }
      if (tab.id === activeId) setActiveId(remaining[0].id);
      return remaining;
    });
    setClosing(null);
  }

  const requestClose = (tab) => {
    // No items and not yet checked out → close immediately, else confirm.
    if (!tab.items.length && !tab.sale) reallyClose(tab);
    else setClosing(tab);
  };

  const activeTab = tabs.find((tb) => tb.id === activeId) || tabs[0];

  const tabLabel = (tab, idx) => {
    const n = idx + 1;
    const count = tab.items.reduce((s, i) => s + (i.quantity || 0), 0);
    return { title: t("pos.tab", { n }), count };
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{t("pos.title")}</h1>
          <p className="text-sm text-muted">{t("pos.subtitle")}</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-2 overflow-x-auto">
        {tabs.map((tab, idx) => {
          const { title, count } = tabLabel(tab, idx);
          const active = tab.id === activeTab?.id;
          return (
            <div
              key={tab.id}
              className={`group flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                active
                  ? "border-accent/60 bg-accent/10 text-text"
                  : "border-border bg-surface text-muted hover:text-text"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveId(tab.id)}
                className="flex items-center gap-2"
              >
                <IconCart width={16} height={16} className={active ? "text-accent" : ""} />
                <span className="font-medium">{title}</span>
                {count > 0 && (
                  <span className="rounded-full bg-accent/20 px-1.5 text-xs font-semibold text-accent">
                    {count}
                  </span>
                )}
              </button>
              <button
                type="button"
                title={t("pos.closeTab")}
                onClick={() => requestClose(tab)}
                className="rounded-md p-0.5 text-muted transition hover:bg-elevated hover:text-red-400"
              >
                <IconX width={14} height={14} />
              </button>
            </div>
          );
        })}
        {tabs.length < MAX_TABS && (
          <button
            type="button"
            onClick={addTab}
            title={t("pos.newTab")}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted transition hover:border-accent hover:text-accent"
          >
            <IconPlus width={16} height={16} /> {t("pos.newTab")}
          </button>
        )}
      </div>

      {/* Active cart workspace */}
      {activeTab && boot && (
        <CartWorkspace
          key={activeTab.id}
          tab={activeTab}
          boot={boot}
          patch={(partial) => patchTab(activeTab.id, partial)}
        />
      )}

      <ConfirmDialog
        open={!!closing}
        onClose={() => setClosing(null)}
        onConfirm={() => closing && reallyClose(closing)}
        title={t("pos.closeConfirm.title")}
        body={t("pos.closeConfirm.body")}
        confirmLabel={t("pos.closeConfirm.confirm")}
        cancelLabel={t("pos.closeConfirm.cancel")}
      />
    </div>
  );
}
