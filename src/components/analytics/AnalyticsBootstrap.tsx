"use client";

// ===== Analytics Bootstrap =====
// 挂载于两个 root layout（(default) 与 [locale]），负责：
//   1. 路由变化时上报 page_view（含 UTM / referrer，服务端做 first/last touch 归因）
//   2. 遵循现有 Cookie Consent：未「同意」前不建身份、不上报；同意后立即生效
// 防重：同一路由 1s 内只上报一次（dev StrictMode 双触发 / RSC prefetch 抖动）

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { track, hasAnalyticsConsent, onConsentGranted } from "@/lib/analytics/client";

export default function AnalyticsBootstrap() {
  const pathname = usePathname();
  const locale = useLocale();
  const lastFired = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    const fire = () => {
      const now = Date.now();
      if (lastFired.current && lastFired.current.path === pathname && now - lastFired.current.at < 1000) {
        return;
      }
      lastFired.current = { path: pathname, at: now };
      track("page_view");
    };

    if (hasAnalyticsConsent()) {
      fire();
    }
    // 用户在浏览中途点「同意」：无需刷新立即开始追踪
    return onConsentGranted(fire);
  }, [pathname, locale]);

  return null;
}
