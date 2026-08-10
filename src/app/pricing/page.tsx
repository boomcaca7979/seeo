"use client";

import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import { handleBillingError } from "@/lib/billing-error-client";
import { useToast } from "@/components/dashboard/Toast";

// 前端类型（与后端 PlanInfo 对应，只取展示所需字段）
interface PlanDisplayInfo {
  name: string;
  tagline: string;
  price: string;
  priceUnit: string;
  ctaLabel: string;
  checkoutPlan?: "pro" | "team" | "enterprise";
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
  can_team_collaboration: boolean;
  can_white_label: boolean;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

function formatLimit(v: number): string {
  if (v >= UNLIMITED) return "无限";
  return v.toLocaleString();
}

// 将 PlanInfo 转为展示用 feature 列表
function buildFeatureList(p: PlanInfo): { text: string; included: boolean }[] {
  return [
    { text: `项目数 ${formatLimit(p.max_projects)}`, included: true },
    { text: `关键词追踪 ${formatLimit(p.max_tracked_keywords)}`, included: true },
    { text: `每日审计 ${p.audit_daily_limit >= UNLIMITED ? "无限" : p.audit_daily_limit + " 次/天"}`, included: true },
    { text: `内容检查 ${formatLimit(p.content_check_monthly_limit)} 次/月`, included: p.content_check_monthly_limit > 0 },
    { text: `SerpApi ${formatLimit(p.serpapi_monthly_limit)} 次/月`, included: p.serpapi_monthly_limit > 0 },
    { text: "PDF 报告导出", included: p.can_export_pdf },
    { text: "Excel 报告导出", included: p.can_export_excel },
    { text: "邮件周报", included: p.can_email_report },
    { text: "团队协作", included: p.can_team_collaboration },
    { text: "白标报告", included: p.can_white_label },
  ];
}

const faqs = [
  {
    q: "免费版有使用期限吗？",
    a: "没有。免费版永久可用，但有关键词数量与 SerpApi 调用次数限制。",
  },
  {
    q: "如何升级套餐？",
    a: "点击对应套餐的升级按钮，通过 Stripe 安全支付页面完成订阅后，权限立即生效。支持随时取消。",
  },
  {
    q: "SerpApi 额度是什么？",
    a: "SerpApi 是第三方 SERP 数据 API，按调用次数计费。免费版每月 50 次，超出后相关功能暂停至下月刷新。升级套餐可获得更高额度。",
  },
  {
    q: "数据存储在哪里？",
    a: "生产环境使用 Turso 云数据库，用户鉴权由 Supabase Auth 提供。每个用户的数据相互隔离。支付由 Stripe 处理，我们不存储信用卡信息。",
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
  const { show, Toast } = useToast();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState<"pro" | "team" | "enterprise" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Checkout 取消回流提示（仅一次，不阻断浏览）
  const isCheckoutCancel = searchParams.get("checkout") === "cancel";
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

  async function handleCheckout(plan: "pro" | "team" | "enterprise") {
    setErrorMsg(null);
    setLoadingPlan(plan);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (!res.ok) {
        // billing 错误走升级引导，普通错误 toast
        const { message } = handleBillingError(json, "创建支付会话失败，请稍后重试");
        show(message, "error");
        return;
      }
      if (json?.url) {
        window.location.assign(json.url);
      } else {
        setErrorMsg("未收到 Stripe Checkout URL");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "网络错误，请稍后重试");
    } finally {
      setLoadingPlan(null);
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
          从免费开始，随时升级。所有方案均包含核心 SEO 功能。
        </p>
      </div>

      {/* 定价卡 */}
      <div className="mx-auto max-w-6xl px-6 pb-16">
        {loading ? (
          <div className="text-center font-mono text-xs text-ink-40">加载中…</div>
        ) : plans && plans.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((p) => {
              const features = buildFeatureList(p);
              const isCheckout = !!p.display.checkoutPlan;
              return (
                <div
                  key={p.plan}
                  className={`card-a p-6 relative ${p.display.highlighted ? "border-brand" : ""}`}
                >
                  {p.display.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="badge-warn text-xs px-3 py-1 bg-card">推荐</span>
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

                  {/* CTA：checkout / link */}
                  {isCheckout ? (
                    <button
                      onClick={() => handleCheckout(p.display.checkoutPlan!)}
                      disabled={loadingPlan !== null}
                      className={`block w-full text-center py-2.5 ${
                        p.display.highlighted ? "btn-primary" : "btn-secondary"
                      } ${loadingPlan !== null ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      {loadingPlan === p.display.checkoutPlan ? "正在跳转支付..." : p.display.ctaLabel}
                    </button>
                  ) : (
                    <Link
                      href={p.display.ctaHref ?? "/app"}
                      className={`block w-full text-center py-2.5 ${
                        p.display.highlighted ? "btn-primary" : "btn-secondary"
                      }`}
                    >
                      {p.display.ctaLabel}
                    </Link>
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
            套餐价格与限制统一由 billing 层管理。支付由 Stripe 安全处理，我们不存储信用卡信息。
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

      <Toast />
    </div>
  );
}
