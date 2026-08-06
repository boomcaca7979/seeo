"use client";

import { useEffect, useState } from "react";

export type ToastType = "success" | "info" | "error";

export interface ToastState {
  message: string;
  type: ToastType;
}

function ToastView({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;

  const color =
    toast.type === "success"
      ? "text-pos border-pos"
      : toast.type === "error"
        ? "text-neg border-neg"
        : "text-warn border-warn";

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div
        className={`flex items-center gap-2.5 rounded-lg border bg-card px-4 py-3 ${color}`}
      >
        <span className="font-mono text-sm">
          {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ"}
        </span>
        <span className="font-sans text-sm text-ink">{toast.message}</span>
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = (message: string, type: ToastType = "success") => {
    setToast({ message, type });
  };

  const dismiss = () => setToast(null);

  const Toast = () => <ToastView toast={toast} onClose={dismiss} />;

  return { show, Toast };
}
