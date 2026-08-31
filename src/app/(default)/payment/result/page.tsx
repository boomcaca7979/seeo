"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import { resolvePaymentPageStatus } from "@/lib/payment/result-status";

// ===== 支付结果页 =====
// 支持：支付处理中（pending）、支付成功（paid）、支付失败（failed）
// 订单不存在（not_found）、已退款（refunded）
// pending 状态下前端轮询订单状态，不同步等待支付完成

type PageStatus = "loading" | "pending" | "paid" | "failed" | "not_found" | "refunded";

interface OrderData {
  out_trade_no: string;
  plan: string;
  amount: number;
  payment_channel: string | null;
  payment_status: string;
  created_at: string;
  period_end: string | null;
}

const POLL_INTERVAL = 3000; // 3 秒轮询一次
const MAX_POLL_DURATION = 10 * 60 * 1000; // 最多轮询 10 分钟

const PLAN_LABELS: Record<string, string> = {
  lite: "Lite 版",
  pro: "专业版",
  custom: "定制服务",
};

const CHANNEL_LABELS: Record<string, string> = {
  alipay: "支付宝",
  wxpay: "微信支付",
};

export default function PaymentResultPage() {
  return (
    <Suspense fallback={null}>
      <PaymentResultContent />
    </Suspense>
  );
}

function PaymentResultContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 兼容两种来源：
  //   - SeeO 内部跳转：?order=S2026...&pay_type=jump&channel=alipay&pay_info=...
  //   - 耀立支付完成回跳：?pid=...&out_trade_no=S2026...&trade_no=...&sign=...
  const outTradeNo = searchParams.get("order") ?? searchParams.get("out_trade_no") ?? "";
  const payType = searchParams.get("pay_type") ?? "";
  const channel = searchParams.get("channel") ?? "";
  const payInfo = searchParams.get("pay_info") ?? "";

  const [status, setStatus] = useState<PageStatus>(() => outTradeNo ? "loading" : "not_found");
  const [order, setOrder] = useState<OrderData | null>(null);
  const [polling, setPolling] = useState(() => !!outTradeNo);
  const startTimeRef = useRef(0);

  // 轮询订单状态
  useEffect(() => {
    if (!outTradeNo) return;

    if (startTimeRef.current === 0) startTimeRef.current = Date.now();

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      const elapsed = Date.now() - startTimeRef.current;
      if (elapsed > MAX_POLL_DURATION) {
        setPolling(false);
        return;
      }

      try {
        const res = await fetch("/api/payment/yaolipay/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ out_trade_no: outTradeNo }),
        });

        if (res.status === 404) {
          if (!cancelled) {
            setStatus("not_found");
            setPolling(false);
          }
          return;
        }

        if (!res.ok) {
          // 非 404 错误不停止轮询
          if (!cancelled && status === "loading") setStatus("pending");
          return;
        }

        const json = await res.json();
        if (cancelled) return;

        const data = json.data;

        if (data?.order) {
          setOrder(data.order as OrderData);
        }

        // 状态判定统一走纯函数：
        // paid/failed/refunded 唯一依据是服务端 payment_status，浏览器参数不参与
        const nextStatus = resolvePaymentPageStatus({
          hasOrderNo: true,
          serverPaymentStatus: data?.payment_status as string | undefined,
        });

        if (nextStatus === "paid" || nextStatus === "failed" || nextStatus === "refunded") {
          if (!cancelled) {
            setStatus(nextStatus);
            setPolling(false);
          }
          return;
        }

        // 仍然 pending
        if (!cancelled) setStatus("pending");
      } catch {
        // 网络错误，继续轮询
        if (!cancelled && status === "loading") setStatus("pending");
      }
    };

    // 首次立即查询
    void poll();

    const interval = setInterval(() => void poll(), POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outTradeNo]);

  // 支付成功后自动跳转
  useEffect(() => {
    if (status !== "paid") return;
    const timer = setTimeout(() => router.push("/app"), 5000);
    return () => clearTimeout(timer);
  }, [status, router]);

  const planLabel = order?.plan ? PLAN_LABELS[order.plan] ?? order.plan : "";
  const channelLabel = channel ? CHANNEL_LABELS[channel] ?? channel : "";
  const amountText = order ? `¥${order.amount.toFixed(2)}` : "";

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      <div className="mx-auto max-w-2xl px-6 pt-16 pb-16">
        {/* 订单基本信息 */}
        {order && (
          <div className="mb-6 flex items-center justify-between">
            <span className="font-mono text-xs text-ink-40">PAYMENT</span>
            <span className="font-mono text-xs text-ink-40">
              订单号 {outTradeNo}
            </span>
          </div>
        )}

        {/* 根据状态渲染 */}
        {status === "loading" && <LoadingCard />}

        {status === "not_found" && (
          <ErrorCard
            title="订单不存在"
            message="未找到对应的订单信息，请返回定价页重新发起支付。"
            actionHref="/pricing"
            actionLabel="返回定价页"
          />
        )}

        {status === "failed" && (
          <ErrorCard
            title="支付失败"
            message="订单支付未成功，可以重新发起支付。"
            actionHref="/pricing"
            actionLabel="重新购买"
          />
        )}

        {status === "refunded" && (
          <ErrorCard
            title="订单已退款"
            message="此订单已退款，会员权益已调整。"
            actionHref="/pricing"
            actionLabel="返回定价页"
          />
        )}

        {status === "paid" && (
          <SuccessCard
            planLabel={planLabel}
            amountText={amountText}
            channelLabel={channelLabel}
            periodEnd={order?.period_end ?? null}
          />
        )}

        {status === "pending" && (
          <PendingCard
            payType={payType}
            payInfo={payInfo}
            channelLabel={channelLabel}
            planLabel={planLabel}
            amountText={amountText}
            polling={polling}
          />
        )}
      </div>
    </div>
  );
}

// ===== 加载中 =====
function LoadingCard() {
  return (
    <div className="card-a p-8 text-center">
      <div className="mx-auto h-8 w-8 loading-spin rounded-full border-2 border-line border-t-brand" />
      <p className="mt-4 font-mono text-xs text-ink-40">正在获取订单信息…</p>
    </div>
  );
}

// ===== 支付处理中 =====
function PendingCard({
  payType,
  payInfo,
  channelLabel,
  planLabel,
  amountText,
  polling,
}: {
  payType: string;
  payInfo: string;
  channelLabel: string;
  planLabel: string;
  amountText: string;
  polling: boolean;
}) {
  // 判断是否需要展示二维码
  const showQrcode = payType === "qrcode" && payInfo;
  const showRedirect = (payType === "jump" || payType === "html" || payType === "urlscheme") && payInfo;

  // 跳转型支付：自动前往支付页（当前标签页导航，支付完成后经 return_url 回流恢复轮询）
  useEffect(() => {
    if (
      (payType === "jump" || payType === "urlscheme") &&
      payInfo &&
      /^https?:\/\//i.test(payInfo)
    ) {
      const timer = setTimeout(() => {
        window.location.href = payInfo;
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [payType, payInfo]);

  return (
    <div className="space-y-6">
      {/* 支付信息卡片 */}
      <div className="card-a p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="font-mono text-lg font-semibold text-ink">等待支付</h1>
            <p className="mt-1 font-sans text-xs text-ink-40">
              {planLabel}
              {planLabel === "定制服务" ? "" : " · 30 天会员"}
              {channelLabel ? ` · ${channelLabel}` : ""}
            </p>
          </div>
          <span className="badge-info">处理中</span>
        </div>

        {amountText && (
          <div className="mb-5 rounded-lg border border-line-soft bg-paper p-4">
            <div className="flex items-center justify-between">
              <span className="font-sans text-sm text-ink-40">支付金额</span>
              <span className="font-mono text-xl font-semibold text-ink">{amountText}</span>
            </div>
          </div>
        )}

        {/* 支付方式展示 */}
        {showQrcode && (
          <div className="flex flex-col items-center py-4">
            <div className="rounded-lg border border-line bg-white p-3">
              <Image
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(payInfo)}`}
                alt="支付二维码"
                width={200}
                height={200}
                unoptimized
                className="block"
              />
            </div>
            <p className="mt-4 font-sans text-sm text-ink-60">
              请使用{channelLabel || "手机"}扫描二维码完成支付
            </p>
            <p className="mt-1 font-mono text-xs text-ink-40">
              支付完成后页面将自动跳转
            </p>
          </div>
        )}

        {showRedirect && (
          <div className="flex flex-col items-center py-6">
            <a
              href={payInfo}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              点击前往支付页面
            </a>
            <p className="mt-4 font-mono text-xs text-ink-40">
              {payType === "jump" || payType === "urlscheme"
                ? "即将自动跳转支付页面，若未跳转请点击上方按钮"
                : "支付完成后返回此页面，系统将自动确认"}
            </p>
          </div>
        )}

        {!showQrcode && !showRedirect && (
          <div className="flex flex-col items-center py-6">
            <p className="font-sans text-sm text-ink-60">
              请在{channelLabel || "支付平台"}中完成支付
            </p>
            <p className="mt-1 font-mono text-xs text-ink-40">
              支付完成后页面将自动跳转
            </p>
          </div>
        )}
      </div>

      {/* 轮询状态 */}
      <div className="card-a p-4">
        <div className="flex items-center justify-center gap-2">
          {polling ? (
            <>
              <span className="h-2 w-2 rounded-full bg-brand loading-spin" />
              <span className="font-mono text-xs text-ink-40">正在等待支付结果…</span>
            </>
          ) : (
            <span className="font-mono text-xs text-ink-40">等待超时，请手动查询</span>
          )}
        </div>
      </div>

      {/* 返回 */}
      <div className="text-center">
        <Link href="/pricing" className="font-mono text-xs text-ink-40 hover:text-ink">
          ← 返回定价页
        </Link>
      </div>
    </div>
  );
}

// ===== 支付成功 =====
function SuccessCard({
  planLabel,
  amountText,
  channelLabel,
  periodEnd,
}: {
  planLabel: string;
  amountText: string;
  channelLabel: string;
  periodEnd: string | null;
}) {
  const periodEndText = periodEnd
    ? new Date(periodEnd).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="space-y-6">
      <div className="card-a p-8 text-center">
        {/* 成功图标 */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-pos/10">
          <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-pos">
            <path
              d="M5 13l4 4L19 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="mt-5 font-mono text-xl font-semibold text-ink">支付成功</h1>
        <p className="mt-2 font-sans text-sm text-ink-60">
          {planLabel === "定制服务"
            ? "定制服务订单已确认，我们将尽快与你联系安排交付"
            : `${planLabel}会员已开通，感谢你的购买`}
        </p>

        {/* 订单详情 */}
        <div className="mt-6 rounded-lg border border-line-soft bg-paper p-4 text-left">
          {amountText && (
            <div className="flex items-center justify-between py-1">
              <span className="font-sans text-xs text-ink-40">支付金额</span>
              <span className="font-mono text-sm text-ink">{amountText}</span>
            </div>
          )}
          {channelLabel && (
            <div className="flex items-center justify-between py-1">
              <span className="font-sans text-xs text-ink-40">支付方式</span>
              <span className="font-sans text-sm text-ink">{channelLabel}</span>
            </div>
          )}
          {periodEndText && (
            <div className="flex items-center justify-between py-1">
              <span className="font-sans text-xs text-ink-40">会员到期</span>
              <span className="font-mono text-sm text-ink">{periodEndText}</span>
            </div>
          )}
        </div>

        <p className="mt-4 font-mono text-xs text-ink-40">
          5 秒后自动跳转到控制台…
        </p>
      </div>

      <div className="flex gap-3">
        <Link href="/app" className="btn-primary flex-1 text-center">
          进入控制台
        </Link>
        <Link href="/pricing" className="btn-secondary flex-1 text-center">
          返回定价页
        </Link>
      </div>
    </div>
  );
}

// ===== 错误状态 =====
function ErrorCard({
  title,
  message,
  actionHref,
  actionLabel,
}: {
  title: string;
  message: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="space-y-6">
      <div className="card-a p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neg/10">
          <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-neg">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h1 className="mt-5 font-mono text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 font-sans text-sm text-ink-60">{message}</p>
      </div>

      <div className="flex gap-3">
        <Link href={actionHref} className="btn-primary flex-1 text-center">
          {actionLabel}
        </Link>
        <Link href="/" className="btn-secondary flex-1 text-center">
          返回首页
        </Link>
      </div>
    </div>
  );
}
