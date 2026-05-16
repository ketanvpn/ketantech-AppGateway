"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Toast notification — global, dipakai oleh useToast() dari komponen mana saja.
 * Ringan, tanpa dependency. Auto-dismiss 4 detik (5 detik untuk error).
 *
 * Pemakaian:
 *   const toast = useToast();
 *   toast.success("Tersimpan");
 *   toast.error("Gagal: " + e.message);
 *   toast.info("Sync dimulai");
 */

type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastCtxValue {
  push: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastCtx = createContext<ToastCtxValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const id = nextId++;
      setItems((prev) => [...prev, { id, type, message }]);
      // Auto-dismiss
      const ttl = type === "error" ? 5000 : 4000;
      setTimeout(() => remove(id), ttl);
    },
    [remove],
  );

  const ctx: ToastCtxValue = {
    push,
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
    warning: (m) => push("warning", m),
  };

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      <ToastViewport items={items} onClose={remove} />
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastCtxValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // No-op fallback — biar tidak crash kalau dipakai di luar provider
    return {
      push: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
    };
  }
  return ctx;
}

function ToastViewport({
  items,
  onClose,
}: {
  items: ToastItem[];
  onClose: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4 sm:right-4 sm:top-auto sm:bottom-4 sm:items-end sm:left-auto sm:px-0">
      {items.map((t) => (
        <ToastItemView key={t.id} item={t} onClose={() => onClose(t.id)} />
      ))}
    </div>
  );
}

const styles: Record<
  ToastType,
  { bg: string; border: string; text: string; icon: string; iconBg: string }
> = {
  success: {
    bg: "bg-white",
    border: "border-emerald-200",
    text: "text-emerald-900",
    icon: "✓",
    iconBg: "bg-emerald-100 text-emerald-700",
  },
  error: {
    bg: "bg-white",
    border: "border-red-200",
    text: "text-red-900",
    icon: "⨯",
    iconBg: "bg-red-100 text-red-700",
  },
  info: {
    bg: "bg-white",
    border: "border-sky-200",
    text: "text-sky-900",
    icon: "ⓘ",
    iconBg: "bg-sky-100 text-sky-700",
  },
  warning: {
    bg: "bg-white",
    border: "border-amber-200",
    text: "text-amber-900",
    icon: "!",
    iconBg: "bg-amber-100 text-amber-700",
  },
};

function ToastItemView({
  item,
  onClose,
}: {
  item: ToastItem;
  onClose: () => void;
}) {
  const s = styles[item.type];
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    // Mount animation
    const t = setTimeout(() => {}, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border ${s.border} ${s.bg} p-3 shadow-card ${
        closing ? "animate-fade-out" : "animate-slide-up"
      }`}
      role="status"
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.iconBg}`}
      >
        {s.icon}
      </span>
      <div className={`flex-1 text-sm ${s.text}`}>{item.message}</div>
      <button
        onClick={() => {
          setClosing(true);
          setTimeout(onClose, 150);
        }}
        className="-mr-1 -mt-1 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label="Tutup"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
