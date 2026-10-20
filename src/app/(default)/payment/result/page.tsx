"use client";

import Link from "next/link";
import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  INITIAL_MONITOR_STATE,
  PaymentStatusMonitor,
  canRetry,
  deriveResultView,
  type MonitorState,
  type ResultView,
} from "./status-monitor";

// ===== Creem 支付结果页 =====
// 浏览器从 Creem Checkout 回跳到此页（success_url 带 ?order=<out_trade_no>）。
// 重要：回跳本身不构成支付成功凭证 —— 本页只读取 /api/payment/creem/status 的订单
// 状态（由 Creem webhook → completeOrder 写入），判定与轮询生命周期见 status-monitor.ts。
// 每一种终止情况（已确认 / 仍在处理 / 无法确认 / 登录失效 / 无权查看 / 服务不可用 /
// 无效订单）都有准确说明和下一步动作，不会无限停留在「支付确认中」。

const VIEW_TONE: Record<ResultView, { iconClass: string; bgClass: string }> = {
  checking: { iconClass: "text-brand", bgClass: "bg-brand/10" },
  confirming: { iconClass: "text-brand", bgClass: "bg-brand/10" },
  processing: { iconClass: "text-brand", bgClass: "bg-brand/10" },
  paid: { iconClass: "text-pos", bgClass: "bg-pos/10" },
  failed: { iconClass: "text-neg", bgClass: "bg-neg/10" },
  refunded: { iconClass: "text-warn", bgClass: "bg-warn/10" },
  timeout: { iconClass: "text-warn", bgClass: "bg-warn/10" },
  authRequired: { iconClass: "text-warn", bgClass: "bg-warn/10" },
  forbidden: { iconClass: "text-warn", bgClass: "bg-warn/10" },
  serviceError: { iconClass: "text-warn", bgClass: "bg-warn/10" },
  invalidOrder: { iconClass: "text-warn", bgClass: "bg-warn/10" },
};

export default function PaymentResultPage() {
  return (
    <Suspense fallback={null}>
      <PaymentResultContent />
    </Suspense>
  );
}

function PaymentResultContent() {
  const t = useTranslations("paymentResult");
  const searchParams = useSearchParams();
  const orderNo = searchParams.get("order");

  const [state, setState] = useState<MonitorState>(INITIAL_MONITOR_STATE);
  const monitorRef = useRef<PaymentStatusMonitor | null>(null);

  // 卸载（返回、路由切换、StrictMode 双挂载）都会中止在途请求并清掉定时器
  useEffect(() => {
    if (!orderNo) return;
    const monitor = new PaymentStatusMonitor(orderNo, {
      fetch: (input, init) => fetch(input, init),
      onChange: setState,
    });
    monitorRef.current = monitor;
    monitor.startAuto();
    return () => {
      monitor.dispose();
      if (monitorRef.current === monitor) monitorRef.current = null;
    };
  }, [orderNo]);

  const view: ResultView = orderNo ? deriveResultView(state) : "invalidOrder";
  const order = state.outcome?.kind === "order" ? state.outcome.order : null;

  const copy: Record<ResultView, { title: string; desc: string }> = {
    checking: { title: t("pendingTitle"), desc: t("pendingDesc") },
    confirming: { title: t("pendingTitle"), desc: t("pendingDesc") },
    paid: { title: t("paidTitle"), desc: t("paidDesc") },
    failed: { title: t("failedTitle"), desc: t("failedDesc") },
    refunded: { title: t("refundedTitle"), desc: t("refundedDesc") },
    processing: { title: t("processingTitle"), desc: t("processingDesc") },
    timeout: { title: t("timeoutTitle"), desc: t("timeoutDesc") },
    authRequired: { title: t("authTitle"), desc: t("authDesc") },
    forbidden: { title: t("forbiddenTitle"), desc: t("forbiddenDesc") },
    serviceError: { title: t("serviceTitle"), desc: t("serviceDesc") },
    invalidOrder: { title: t("notFoundTitle"), desc: t("notFoundDesc") },
  };

  // 登录页的真实契约：/login?redirect=<登录后返回路径>
  const loginHref = `/login?redirect=${encodeURIComponent(`/payment/result?order=${orderNo ?? ""}`)}`;
  const tone = VIEW_TONE[view];
  const showPollCount = state.polls > 0 && (view === "timeout" || view === "serviceError");

  const planName = order
    ? { lite: "Lite", pro: "Pro", custom: t("customService") }[order.plan] ?? order.plan
    : "";
  const amountText = order ? `${order.currency} ${order.amount.toFixed(2)}` : "";

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      <div className="mx-auto max-w-2xl px-6 pt-16 pb-16">
        <div className="card-a p-8 text-center">
          <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${tone.bgClass}`}>
            {view === "paid" ? (
              <svg viewBox="0 0 24 24" fill="none" className={`h-7 w-7 ${tone.iconClass}`}>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M8 12.5l2.5 2.5L16 9.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : view === "checking" || view === "confirming" ? (
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 animate-spin text-brand">
                <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className={`h-7 w-7 ${tone.iconClass}`}>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
              </svg>
            )}
          </div>

          <div aria-live="polite">
            <h1 className="mt-5 font-mono text-xl font-semibold text-ink">{copy[view].title}</h1>
            <p className="mt-2 font-sans text-sm text-ink-60">{copy[view].desc}</p>
          </div>

          {order && (
            <div className="mt-6 space-y-1 font-mono text-xs text-ink-60">
              <p>
                {t("orderNo")}: {order.outTradeNo}
              </p>
              <p>
                {planName} · {amountText}
              </p>
            </div>
          )}

          {showPollCount && (
            <p className="mt-3 font-mono text-xs text-ink-40">{t("polledTimes", { count: state.polls })}</p>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {canRetry(view) && (
              <button
                type="button"
                onClick={() => monitorRef.current?.checkOnce()}
                className="btn-primary sm:col-span-2"
              >
                {t("retryAction")}
              </button>
            )}
            {view === "authRequired" && (
              <Link href={loginHref} className="btn-primary sm:col-span-2">
                {t("loginAction")}
              </Link>
            )}
            <Link
              href="/pricing"
              className={canRetry(view) || view === "authRequired" ? "btn-secondary" : "btn-primary"}
            >
              {t("backPricing")}
            </Link>
            <Link href="/app" className="btn-secondary">
              {t("backApp")}
            </Link>
          </div>

          <p className="mt-4 font-sans text-xs text-ink-40">{t("webhookNote")}</p>
        </div>
      </div>

      <Footer />
    </div>
  );
}
