"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const t = useTranslations("dashboard.shared.modal");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 蒙层 */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      {/* 模态框：浅色卡片 */}
      <div className="relative w-full max-w-md rounded-lg border border-line bg-card">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
          <h3 className="font-display text-base font-semibold text-ink">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-40 hover:bg-paper hover:text-ink"
            aria-label={t("close")}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
