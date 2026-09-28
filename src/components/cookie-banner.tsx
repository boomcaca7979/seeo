"use client";

import { useSyncExternalStore, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

const CONSENT_EVENT = "seeo:cookie-consent-change";

function getConsentSnapshot(): string | null {
  if (typeof window === "undefined") return "ssr";
  return localStorage.getItem("cookie-consent");
}

function subscribeConsent(callback: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CONSENT_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function CookieBanner() {
  const t = useTranslations("cookieBanner");
  const consent = useSyncExternalStore(subscribeConsent, getConsentSnapshot, () => "ssr" as string | null);

  const setConsent = useCallback((value: "accepted" | "declined") => {
    localStorage.setItem("cookie-consent", value);
    window.dispatchEvent(new Event(CONSENT_EVENT));
  }, []);

  // SSR 阶段或已有选择时不显示
  if (consent === "ssr" || consent) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-card p-4">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="font-sans text-sm text-ink-60">
          {t("notice")}
          <Link href="/privacy" className="ml-1 text-brand hover:underline">{t("learnMore")}</Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setConsent("declined")}
            className="btn-secondary px-4 py-2 text-sm"
          >
            {t("decline")}
          </button>
          <button
            onClick={() => setConsent("accepted")}
            className="btn-primary px-4 py-2 text-sm"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
