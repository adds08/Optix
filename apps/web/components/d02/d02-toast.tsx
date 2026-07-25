"use client";
import { createContext, useContext, useState, useCallback, useRef } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { ReactNode } from "react";

type Toast = { id: number; type: "ok" | "err"; message: string; removing?: boolean };
type AddToast = (type: "ok" | "err", message: string) => void;

const ToastCtx = createContext<AddToast>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const add = useCallback((type: "ok" | "err", message: string) => {
    const id = idRef.current++;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.map((t) => t.id === id ? { ...t, removing: true } : t)), 3000);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3300);
  }, []);

  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-3.5 rounded-lg text-sm font-medium shadow-lg max-w-[400px] transition-all duration-200 ${
              t.type === "ok"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            } ${t.removing ? "opacity-0 translate-x-10" : "opacity-100 translate-x-0"}`}
          >
            {t.type === "ok" ? <CheckCircle2 size={20} className="shrink-0" /> : <XCircle size={20} className="shrink-0" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
