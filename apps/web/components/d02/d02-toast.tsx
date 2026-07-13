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
      <div className="d02-toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`d02-toast d02-toast-${t.type}`} style={t.removing ? { animation: "d02-toast-out .2s ease forwards" } : undefined}>
            {t.type === "ok" ? <CheckCircle2 /> : <XCircle />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
