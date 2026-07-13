"use client";
import { useEffect, useCallback } from "react";

type Props = { open: boolean; onClose: () => void; title: string; children: React.ReactNode };

export function Modal({ open, onClose, title, children }: Props) {
  const handleKey = useCallback((e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }, [onClose]);
  useEffect(() => {
    if (open) { document.addEventListener("keydown", handleKey); document.body.style.overflow = "hidden"; }
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = ""; };
  }, [open, handleKey]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
