"use client";

import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useToast } from "@/components/dashboard/Toast";
import { getPlanCardState } from "@/lib/pricing-plan-state";

// 前端类型（与后端 PlanInfo 对应，只取展示所需字段）
interface PlanDisplayInfo {
  name: string;
  tagline: string;
  price: string;
  priceUnit: string;
  ctaLabel: string;
  checkoutPlan?: "lite" | "pro" | "custom";
  ctaHref?: string;
  highlighted?: boolean;
}

interface PlanInfo {
  plan: string;
  display: PlanDisplayInfo;
  /** 定制服务卡标记：非会员套餐，渲染服务说明而非额度列表 */
  isCustomService?: boolean;
  // 核心限制
  max_projects: number;
  max_tracked_keywords: number;
  max_competitors: number;
  audit_daily_limit: number;
  audit_max_depth: number;
  serpapi_monthly_limit: number;
  serpapi_daily_limit: number;
  content_check_monthly_limit: number;
  // feature flags
  can_export_pdf: boolean;
  can_export_excel: boolean;
  can_email_report: boolean;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

export default function PricingPage() {
  return (
    <>
      {/* Checkout 取消回流提示单独包 Suspense：useSearchParams 会触发 CSR bailout，
          若包住整页会导致 SSR 输出空 body（缺 H1/H2/H3，技术审计误报） */}
      <Suspense fallback={null}>
        <CheckoutCancelToast />
      </Suspense>
      <PricingContent />
    </>
  );
}

/** Checkout 取消回流提示（?payment=cancel）：唯一依赖 useSearchParams 的部分 */
function CheckoutCancelToast() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const { show, Toast } = useToast();
  const isCheckoutCancel = searchParams.get("payment") === "cancel";
  useEffect(() => {
    if (isCheckoutCancel) {
      show(t("pricing.cancelToast"), "info");
    }
  }, [isCheckoutCancel, show, t]);
  return <Toast />;
}

function PricingContent() {
  const t = useTranslations();
  const tp = useTranslations("plans");

  // 将 PlanInfo 转为展示用 feature 列表（文案走 messages，额度为 /api/plans 真实数据）
  const buildFeatureList = (p: PlanInfo): { text: string; included: boolean }[] => {
    const fmt = (v: number) =>
      v >= UNLIMITED ? tp("unlimited") : v.toLocaleString();
    return [
      { text: tp("features.projects", { count: fmt(p.max_projects) }), included: true },
      { text: tp("features.keywords", { count: fmt(p.max_tracked_keywords) }), included: p.max_tracked_keywords > 0 },
      {
        text:
          p.audit_daily_limit >= UNLIMITED
            ? tp("features.auditsUnlimited")
            : tp("features.audits", { count: p.audit_daily_limit }),
        included: true,
      },
      { text: tp("features.contentChecks", { count: fmt(p.content_check_monthly_limit) }), included: p.content_check_monthly_limit > 0 },
      { text: tp("features.serpapi", { count: fmt(p.serpapi_monthly_limit) }), included: p.serpapi_monthly_limit > 0 },
      { text: tp("features.serpapiDaily", { count: p.serpapi_daily_limit }), included: p.serpapi_daily_limit > 0 },
      { text: tp("features.pdf"), included: p.can_export_pdf },
      { text: tp("features.excel"), included: p.can_export_excel },
      { text: tp("features.email"), included: p.can_email_report },
    ];
  };

  const { show, Toast } = useToast();
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
          setErrorMsg(t("pricing.loadFailed"));
        }
      } catch {
        if (!cancelled) setErrorMsg(t("pricing.networkError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  // 支付系统迁移中（原支付渠道已下线，新渠道接入前暂不可购买）
  // 点击购买按钮仅提示，不进入任何支付流程
  function handleCheckoutClick() {
    show(t("pricing.paymentMigrating"), "info");
  }

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      {/* 页头 */}
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-8 text-center">
        <span className="font-mono text-xs text-brand">{t("pricing.eyebrow")}</span>
        <h1 className="mt-3 font-mono text-3xl font-semibold text-ink">{t("pricing.title")}</h1>
        <p className="mt-3 font-sans text-sm text-ink-60 max-w-xl mx-auto">
          {t("pricing.subtitle")}
        </p>
      </div>

      {/* 定价卡 */}
      <div className="site-shell px-6 pb-16">
        {loading ? (
          <div className="text-center font-mono text-xs text-ink-40">{t("pricing.loading")}</div>
        ) : plans && plans.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((p) => {
              // 定制服务卡：渲染服务说明而非额度列表
              if (p.isCustomService || p.plan === "custom") {
                const card = getPlanCardState(
                  currentPlan,
                  "custom",
                  {
                    ctaLabel: tp("cta.purchaseCustom"),
                    checkoutPlan: p.display.checkoutPlan,
                    ctaHref: p.display.ctaHref,
                    highlighted: p.display.highlighted,
                  },
                  { renew: tp("cta.renew"), noDowngrade: tp("cta.noDowngrade") }
                );
                const customFeatures = t.raw("pricing.customService.features") as string[];
                return (
                  <div key="custom" className="card-a p-6 relative">
                    <div className="mb-5">
                      <h2 className="font-mono text-lg font-semibold text-ink mb-1">
                        {tp("custom.name")}
                      </h2>
                      <p className="font-sans text-xs text-ink-40">{tp("custom.tagline")}</p>
                    </div>
                    <div className="mb-5">
                      <span className="font-mono text-2xl font-semibold text-ink">{p.display.price}</span>
                      <span className="font-sans text-xs text-ink-40">{tp("custom.priceUnit")}</span>
                    </div>
                    <ul className="space-y-2 mb-6">
                      {customFeatures.map((f) => (
                        <li key={f} className="flex items-start gap-2 font-sans text-xs text-ink-60">
                          <span className="text-pos mt-0.5 flex-shrink-0">✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={handleCheckoutClick}
                      disabled={card.disabled}
                      className="btn-secondary block w-full h-10 text-center"
                    >
                      {card.ctaLabel}
                    </button>
                  </div>
                );
              }
              const features = buildFeatureList(p);
              // 套餐名/tagline/CTA 文案按 locale 从 messages 输出；
              // 价格与额度为 /api/plans（billing 层）真实数据
              const planKey = p.plan as "free" | "lite" | "pro";
              const displayName = tp(`${planKey}.name` as "free.name" | "lite.name" | "pro.name");
              const displayTagline = tp(`${planKey}.tagline` as "free.tagline" | "lite.tagline" | "pro.tagline");
              const base = {
                ctaLabel:
                  planKey === "lite"
                    ? tp("cta.upgradeLite")
                    : planKey === "pro"
                      ? tp("cta.upgradePro")
                      : tp("cta.start"),
                checkoutPlan: p.display.checkoutPlan,
                ctaHref: p.display.ctaHref,
                highlighted: p.display.highlighted,
              };
              const card = getPlanCardState(
                currentPlan,
                planKey,
                base,
                {
                  renew: tp("cta.renew"),
                  noDowngrade: tp("cta.noDowngrade"),
                }
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
                        {card.badge === "current"
                          ? tp("badge.current")
                          : tp("badge.recommended")}
                      </span>
                    </div>
                  )}
                  <div className="mb-5">
                    <h2 className="font-mono text-lg font-semibold text-ink mb-1">{displayName}</h2>
                    <p className="font-sans text-xs text-ink-40">{displayTagline}</p>
                  </div>
                  <div className="mb-5">
                    <span className="font-mono text-2xl font-semibold text-ink">{p.display.price}</span>
                    <span className="font-sans text-xs text-ink-40">{tp("priceUnit")}</span>
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
                      className={`block w-full h-10 text-center ${
                        card.badge || p.display.highlighted ? "btn-primary" : "btn-secondary"
                      }`}
                    >
                      {card.ctaLabel}
                    </Link>
                  ) : (
                    <button
                      onClick={handleCheckoutClick}
                      disabled={card.disabled}
                      className={`block w-full h-10 text-center ${
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
            {errorMsg ?? t("pricing.noPlans")}
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
            {t("pricing.note")}
          </p>
        </div>
      </div>

      {/* FAQ */}
      <div className="mx-auto max-w-3xl px-6 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <span className="font-mono text-xs text-brand">{t("pricing.faqEyebrow")}</span>
          <h2 className="font-mono text-xl font-semibold text-ink">{t("pricing.faqTitle")}</h2>
          <div className="hairline flex-1" />
        </div>
        <div className="space-y-4">
          {(t.raw("pricing.faqs") as Array<{ q: string; a: string }>).map((item) => (
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
            {t("pricing.backHome")}
          </Link>
        </div>
      </div>

      <Footer />
      <Toast />
    </div>
  );
}
