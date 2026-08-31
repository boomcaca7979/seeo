"use client";

import Link from "next/link";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

// ===== Creem 支付结果页 =====
// 浏览器从 Creem Checkout 回跳到此页（success_url 带 ?order=<out_trade_no>）。
// 重要：回跳本身不构成支付成功凭证 —— 本页只轮询 SeeO 自己的订单状态
// （/api/payment/creem/status），订单状态由 Creem webhook 驱动 completeOrder 写入。
// pending → 支付处理中（自动轮询）；paid → 成功；failed → 失败；refunded → 已退款。

type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

interface OrderStatusData {
  outTradeNo: string;
  plan: string;
  amount: number;
  currency: string;
  paymentStatus: PaymentStatus;
  paidAt: string | null;
  periodEnd: string | null;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 20;

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

  const [status, setStatus] = useState<"loading" | "notFound" | PaymentStatus>("loading");
  const [order, setOrder] = useState<OrderStatusData | null>(null);

  useEffect(() => {
    if (!orderNo) return;
    const orderParam = orderNo;
    let cancelled = false;
    // 最近一次查询到的状态（effect 闭包内维护，控制轮询是否继续）
    let last: "loading" | "notFound" | PaymentStatus = "loading";
    let count = 0;

    async function poll() {
      try {
        const res = await fetch(
          `/api/payment/creem/status?order=${encodeURIComponent(orderParam)}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        if (res.status === 404) {
          last = "notFound";
          setStatus("notFound");
          return;
        }
        if (!res.ok) return; // 401 / 5xx：按处理中对待，下轮重试
        const json = await res.json().catch(() => null);
        const data = json?.data as OrderStatusData | undefined;
        if (data) {
          last = data.paymentStatus;
          setOrder(data);
          setStatus(data.paymentStatus);
        }
      } catch {
        // 网络错误：保持当前状态，下轮重试
      }
    }

    void poll();
    const timer = setInterval(() => {
      count += 1;
      if (count >= MAX_POLLS) {
        clearInterval(timer);
        return;
      }
      // 仅 pending / loading 状态需要继续轮询
      if (last === "pending" || last === "loading") {
        void poll();
      } else {
        clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orderNo]);

  // 缺少订单号参数：直接按未找到展示（无需 setState）
  const viewStatus: "loading" | "notFound" | PaymentStatus = orderNo ? status : "notFound";

  const planName = order
    ? { lite: "Lite", pro: "Pro", custom: t("customService") }[order.plan] ?? order.plan
    : "";
  const amountText = order ? `${order.currency} ${order.amount.toFixed(2)}` : "";

  const view =
    viewStatus === "paid"
      ? { iconClass: "text-pos", bgClass: "bg-pos/10", title: t("paidTitle"), desc: t("paidDesc") }
      : viewStatus === "failed"
        ? { iconClass: "text-neg", bgClass: "bg-neg/10", title: t("failedTitle"), desc: t("failedDesc") }
        : viewStatus === "refunded"
          ? { iconClass: "text-warn", bgClass: "bg-warn/10", title: t("refundedTitle"), desc: t("refundedDesc") }
          : viewStatus === "notFound"
            ? { iconClass: "text-warn", bgClass: "bg-warn/10", title: t("notFoundTitle"), desc: t("notFoundDesc") }
            : { iconClass: "text-brand", bgClass: "bg-brand/10", title: t("pendingTitle"), desc: t("pendingDesc") };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      <div className="mx-auto max-w-2xl px-6 pt-16 pb-16">
        <div className="card-a p-8 text-center">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${view.bgClass}`}
          >
            {viewStatus === "paid" ? (
              <svg viewBox="0 0 24 24" fill="none" className={`h-7 w-7 ${view.iconClass}`}>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : viewStatus === "failed" || viewStatus === "refunded" || viewStatus === "notFound" ? (
              <svg viewBox="0 0 24 24" fill="none" className={`h-7 w-7 ${view.iconClass}`}>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-brand animate-spin">
                <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </div>

          <h1 className="mt-5 font-mono text-xl font-semibold text-ink">{view.title}</h1>
          <p className="mt-2 font-sans text-sm text-ink-60">{view.desc}</p>

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

          <div className="mt-6 flex gap-3">
            <Link href="/pricing" className="btn-primary flex-1 text-center">
              {t("backPricing")}
            </Link>
            <Link href="/app" className="btn-secondary flex-1 text-center">
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
