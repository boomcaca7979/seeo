"use client";

import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import { handleBillingError } from "@/lib/billing-error-client";
import { useToast } from "@/components/dashboard/Toast";
import { getPlanCardState } from "@/lib/pricing-plan-state";

// 前端类型（与后端 PlanInfo 对应，只取展示所需字段）
interface PlanDisplayInfo {
  name: string;
  tagline: string;
  price: string;
  priceUnit: string;
  ctaLabel: string;
  checkoutPlan?: "lite" | "pro";
  ctaHref?: string;
  highlighted?: boolean;
}

interface PlanInfo {
  plan: string;
  display: PlanDisplayInfo;
  // 核心限制
  max_projects: number;
  max_tracked_keywords: number;
  max_competitors: number;
  audit_daily_limit: number;
  audit_max_depth: number;
  serpapi_monthly_limit: number;
  content_check_monthly_limit: number;
  // feature flags
  can_export_pdf: boolean;
  can_export_excel: boolean;
  can_email_report: boolean;
}

type PaymentChannel = "alipay" | "wxpay";

const UNLIMITED = Number.MAX_SAFE_INTEGER;

function formatLimit(v: number): string {
  if (v >= UNLIMITED) return "无限";
  return v.toLocaleString();
}

// 将 PlanInfo 转为展示用 feature 列表
function buildFeatureList(p: PlanInfo): { text: string; included: boolean }[] {
  return [
    { text: `项目数 ${formatLimit(p.max_projects)}`, included: true },
    { text: `关键词追踪 ${formatLimit(p.max_tracked_keywords)}`, included: p.max_tracked_keywords > 0 },
    { text: `每日审计 ${p.audit_daily_limit >= UNLIMITED ? "无限" : p.audit_daily_limit + " 次/天"}`, included: true },
    { text: `内容检查 ${formatLimit(p.content_check_monthly_limit)} 次/月`, included: p.content_check_monthly_limit > 0 },
    { text: `SerpApi ${formatLimit(p.serpapi_monthly_limit)} 次/月`, included: p.serpapi_monthly_limit > 0 },
    { text: "PDF 报告导出", included: p.can_export_pdf },
    { text: "Excel 报告导出", included: p.can_export_excel },
    { text: "邮件周报", included: p.can_email_report },
  ];
}

const faqs = [
  {
    q: "免费版有使用期限吗？",
    a: "没有。免费版永久可用，但有关键词数量与 SerpApi 调用次数限制。",
  },
  {
    q: "如何升级套餐？",
    a: "点击对应套餐的升级按钮，选择支付宝或微信支付，完成支付后权益立即生效。一次性购买 30 天会员，到期后自动恢复为免费版。",
  },
  {
    q: "支持哪些支付方式？",
    a: "目前支持支付宝和微信支付两种方式，由耀立支付提供聚合支付技术服务。",
  },
  {
    q: "会员到期后会怎样？",
    a: "到期后套餐将自动恢复为免费版，已创建的数据（项目、关键词、报告等）不会丢失，但功能与额度将按免费版限制。可以随时重新购买。",
  },
  {
    q: "SerpApi 额度是什么？",
    a: "SerpApi 是第三方 SERP 数据 API，按调用次数计费。免费版每月 50 次，超出后相关功能暂停至下月刷新。升级套餐可获得更高额度。",
  },
  {
    q: "数据存储在哪里？",
    a: "生产环境使用 Turso 云数据库，用户鉴权由 Supabase Auth 提供。每个用户的数据相互隔离。",
  },
];

export default function PricingPage() {
  return (
    <Suspense fallback={null}>
      <PricingContent />
    </Suspense>
  );
}

function PricingContent() {
  const router = useRouter();
  const { show, Toast } = useToast();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 支付方式选择弹窗
  const [selectedPlan, setSelectedPlan] = useState<"lite" | "pro" | null>(null);
  const [creating, setCreating] = useState(false);

  // 当前用户套餐：undefined = 加载中；null = 未登录（anonymous/free）
  // 401 视为未登录，不是系统错误
  const [currentPlan, setCurrentPlan] = useState<"free" | "lite" | "pro" | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/account/usage", { cache: "no-store" });
        if (res.status === 401) {
          if (!cancelled) setCurrentPlan(null);
          return;
        }
        const json = await res.json();
        if (!cancelled && res.ok && json?.data?.plan) {
          setCurrentPlan(json.data.plan as "free" | "lite" | "pro");
        } else {
          // 查询失败按未登录处理，保持可购买（后端会再拦截）
          setCurrentPlan(null);
        }
      } catch {
        if (!cancelled) setCurrentPlan(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Checkout 取消回流提示
  const isCheckoutCancel = searchParams.get("payment") === "cancel";
  useEffect(() => {
    if (isCheckoutCancel) {
      show("支付已取消，套餐未发生变化", "info");
    }
  }, [isCheckoutCancel, show]);

  // 从 /api/plans 拉取套餐数据（统一数据源）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/plans", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok && Array.isArray(json.data)) {
          setPlans(json.data as PlanInfo[]);
        } else if (!cancelled) {
          setErrorMsg("加载套餐信息失败");
        }
      } catch {
        if (!cancelled) setErrorMsg("网络错误，加载套餐失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 创建耀立支付订单
  async function handleCreatePayment(plan: "lite" | "pro", channel: PaymentChannel) {
    setCreating(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/payment/yaolipay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, payment_channel: channel }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, "创建订单失败，请稍后重试");
        show(message, "error");
        return;
      }

      const data = json.data;
      if (!data) {
        setErrorMsg("未收到支付信息");
        return;
      }

      // 根据 pay_type 决定展示方式
      const payType = data.pay_type as string | null;
      const payInfo = data.pay_info as string | null;
      const outTradeNo = data.out_trade_no as string;

      // 跳转到支付结果页，由该页处理支付展示与轮询
      const params = new URLSearchParams({
        order: outTradeNo,
        pay_type: payType ?? "",
        channel,
      });
      // 把 pay_info 编码后传过去（可能较长）
      if (payInfo) params.set("pay_info", payInfo);
      router.push(`/payment/result?${params.toString()}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "网络错误，请稍后重试");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      {/* 页头 */}
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-8 text-center">
        <span className="font-mono text-xs text-brand">PRICING</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink">选择适合你的方案</h1>
        <p className="mt-3 font-sans text-sm text-ink-60 max-w-xl mx-auto">
          从免费开始，随时升级。一次性购买 30 天会员，支持支付宝 / 微信支付。
        </p>
      </div>

      {/* 定价卡 */}
      <div className="mx-auto max-w-6xl px-6 pb-16">
        {loading ? (
          <div className="text-center font-mono text-xs text-ink-40">加载中…</div>
        ) : plans && plans.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((p) => {
              const features = buildFeatureList(p);
              const card = getPlanCardState(
                currentPlan,
                p.plan as "free" | "lite" | "pro",
                p.display
              );
              return (
                <div
                  key={p.plan}
                  className={`card-a p-6 relative ${
                    card.badge === "current" || p.display.highlighted ? "border-brand" : ""
                  }`}
                >
                  {(card.badge === "current" || card.badge === "recommended") && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span
                        className={`text-xs px-3 py-1 bg-card ${
                          card.badge === "current" ? "badge-pos" : "badge-warn"
                        }`}
                      >
                        {card.badge === "current" ? "当前套餐" : "推荐"}
                      </span>
                    </div>
                  )}
                  <div className="mb-5">
                    <h2 className="font-mono text-lg font-bold text-ink mb-1">{p.display.name}</h2>
                    <p className="font-sans text-xs text-ink-40">{p.display.tagline}</p>
                  </div>
                  <div className="mb-5">
                    <span className="font-mono text-2xl font-bold text-ink">{p.display.price}</span>
                    {p.display.priceUnit && (
                      <span className="font-sans text-xs text-ink-40">{p.display.priceUnit}</span>
                    )}
                  </div>
                  <ul className="space-y-2 mb-6">
                    {features.map((f) => (
                      <li key={f.text} className="flex items-start gap-2 font-sans text-xs text-ink-60">
                        {f.included ? (
                          <span className="text-pos mt-0.5 flex-shrink-0">✓</span>
                        ) : (
                          <span className="text-ink-40 mt-0.5 flex-shrink-0">—</span>
                        )}
                        <span className={f.included ? "" : "text-ink-40"}>{f.text}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA：按当前套餐状态渲染（购买/升级/续费/当前套餐/不可降级） */}
                  {card.kind === "link" ? (
                    <Link
                      href={card.ctaHref ?? "/app"}
                      className={`block w-full text-center py-2.5 ${
                        card.badge || p.display.highlighted ? "btn-primary" : "btn-secondary"
                      }`}
                    >
                      {card.ctaLabel}
                    </Link>
                  ) : (
                    <button
                      onClick={() => card.checkoutPlan && setSelectedPlan(card.checkoutPlan)}
                      disabled={card.disabled}
                      className={`block w-full text-center py-2.5 ${
                        card.badge || p.display.highlighted ? "btn-primary" : "btn-secondary"
                      }`}
                    >
                      {card.ctaLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center font-mono text-xs text-ink-40">
            {errorMsg ?? "暂无套餐信息"}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div className="mx-auto max-w-3xl px-6 pb-8">
          <div className="card-a p-4 border-neg">
            <p className="font-sans text-sm text-neg text-center">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* 说明 */}
      <div className="mx-auto max-w-3xl px-6 pb-8">
        <div className="card-a p-4">
          <p className="font-sans text-xs text-ink-40 text-center">
            套餐价格与限制统一由 billing 层管理。支付由耀立支付聚合支付服务处理，支持支付宝与微信支付。
          </p>
        </div>
      </div>

      {/* FAQ */}
      <div className="mx-auto max-w-3xl px-6 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <span className="font-mono text-xs text-brand">FAQ</span>
          <h2 className="font-mono text-xl font-bold text-ink">常见问题</h2>
          <div className="hairline flex-1" />
        </div>
        <div className="space-y-4">
          {faqs.map((item) => (
            <div key={item.q} className="card-a p-4">
              <h3 className="font-sans text-sm font-medium text-ink mb-1">{item.q}</h3>
              <p className="font-sans text-sm text-ink-60">{item.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 返回首页 */}
      <div className="border-t border-line">
        <div className="mx-auto max-w-5xl px-6 py-6 text-center">
          <Link href="/" className="font-mono text-xs text-ink-40 transition-colors hover:text-ink">
            ← 返回首页
          </Link>
        </div>
      </div>

      {/* 支付方式选择弹窗 */}
      {selectedPlan && (
        <PaymentChannelModal
          plan={selectedPlan}
          loading={creating}
          onClose={() => setSelectedPlan(null)}
          onSelect={(channel) => handleCreatePayment(selectedPlan, channel)}
        />
      )}

      <Toast />
    </div>
  );
}

// ===== 支付方式选择弹窗 =====
function PaymentChannelModal({
  plan,
  loading,
  onClose,
  onSelect,
}: {
  plan: "lite" | "pro";
  loading: boolean;
  onClose: () => void;
  onSelect: (channel: PaymentChannel) => void;
}) {
  const planLabel = plan === "lite" ? "Lite 版" : "专业版";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-line bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">选择支付方式</h3>
            <p className="mt-1 font-mono text-xs text-ink-40">
              {planLabel} · 30 天会员
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-40 hover:bg-line-soft hover:text-ink"
            aria-label="关闭"
            disabled={loading}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => onSelect("alipay")}
            disabled={loading}
            className="flex w-full items-center gap-3 rounded-lg border border-line p-4 text-left transition-colors hover:border-brand hover:bg-brand/5 disabled:opacity-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded bg-[#1677FF] text-white">
              <span className="font-mono text-xs">支</span>
            </div>
            <div>
              <div className="font-display text-sm font-bold text-ink">支付宝</div>
              <div className="font-sans text-xs text-ink-40">跳转支付宝完成支付</div>
            </div>
          </button>

          <button
            onClick={() => onSelect("wxpay")}
            disabled={loading}
            className="flex w-full items-center gap-3 rounded-lg border border-line p-4 text-left transition-colors hover:border-brand hover:bg-brand/5 disabled:opacity-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded bg-[#09BB07] text-white">
              <span className="font-mono text-xs">微</span>
            </div>
            <div>
              <div className="font-display text-sm font-bold text-ink">微信支付</div>
              <div className="font-sans text-xs text-ink-40">扫码或跳转微信完成支付</div>
            </div>
          </button>
        </div>

        {loading && (
          <div className="mt-4 text-center font-mono text-xs text-ink-40">
            正在创建订单…
          </div>
        )}
      </div>
    </div>
  );
}
