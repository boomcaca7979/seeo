"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useToast } from "@/components/dashboard/Toast";
import { getPlanCardState } from "@/lib/pricing-plan-state";
import PricingHero from "@/components/pricing/PricingHero";
import PricingCards from "@/components/pricing/PricingCards";
import FeatureComparison from "@/components/pricing/FeatureComparison";
import CustomService from "@/components/pricing/CustomService";
import PricingFAQ from "@/components/pricing/PricingFAQ";
import FinalCTA from "@/components/pricing/FinalCTA";
import type { CardFeature, PlanDisplay } from "@/components/pricing/types";

// 前端类型（与后端 PlanInfo 对应，只取展示所需字段）
interface PlanInfo {
  plan: string;
  isCustomService?: boolean;
  max_projects: number;
  max_tracked_keywords: number;
  max_competitors: number;
  max_keyword_groups: number;
  audit_daily_limit: number;
  audit_max_depth: number;
  serpapi_monthly_limit: number;
  serpapi_daily_limit: number;
  dataforseo_monthly_limit: number;
  content_check_monthly_limit: number;
  can_export_pdf: boolean;
  can_export_excel: boolean;
  can_email_report: boolean;
  display: {
    name: string;
    tagline: string;
    price: string;
    priceUnit: string;
    ctaLabel: string;
    checkoutPlan?: "lite" | "pro" | "custom";
    ctaHref?: string;
    highlighted?: boolean;
  };
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

  const { show, Toast } = useToast();
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 正在创建支付订单的 plan key（防止重复提交）
  const [purchasing, setPurchasing] = useState<string | null>(null);

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

  // 发起 Creem Checkout：
  // POST /api/payment/creem/create → 服务端创建 pending 订单 + Creem checkout → 跳转支付
  // 前端不传金额 / Product ID，仅传 plan key；支付结果以 Creem webhook 为准
  async function handleCheckoutClick(plan?: "lite" | "pro" | "custom") {
    if (!plan) {
      show(t("pricing.paymentMigrating"), "info");
      return;
    }
    if (purchasing) return;
    setPurchasing(plan);
    try {
      const res = await fetch("/api/payment/creem/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (res.status === 401) {
        show(t("pricing.loginRequired"), "info");
        return;
      }
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.checkoutUrl) {
        window.location.assign(json.data.checkoutUrl as string);
        return; // 跳转后组件卸载，无需复位 purchasing
      }
      show(json?.error ?? t("pricing.paymentCreateFailed"), "error");
    } catch {
      show(t("pricing.paymentCreateFailed"), "error");
    } finally {
      setPurchasing(null);
    }
  }

  // ===== 展示数据派生（文案走 messages，额度为 /api/plans 真实数据） =====
  const fmt = (v: number) =>
    v >= UNLIMITED ? tp("unlimited") : v.toLocaleString();

  const memberPlans = (plans ?? []).filter(
    (p) => !p.isCustomService && ["free", "lite", "pro"].includes(p.plan)
  );
  const customPlan = (plans ?? []).find(
    (p) => p.isCustomService || p.plan === "custom"
  );

  const memberCards = memberPlans.map((p) => {
    const planKey = p.plan as "free" | "lite" | "pro";
    const features: CardFeature[] = [
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
      { text: tp("features.pdf"), included: p.can_export_pdf },
      { text: tp("features.excel"), included: p.can_export_excel },
      { text: tp("features.email"), included: p.can_email_report },
    ];
    const display: PlanDisplay = {
      plan: planKey,
      name: tp(`${planKey}.name` as "free.name"),
      tagline: tp(`${planKey}.tagline` as "free.tagline"),
      price: p.display.price,
      priceUnit: planKey === "free" ? "" : tp("priceUnit"),
      ctaLabel:
        planKey === "lite"
          ? tp("cta.upgradeLite")
          : planKey === "pro"
            ? tp("cta.upgradePro")
            : tp("cta.start"),
      checkoutPlan: p.display.checkoutPlan as "lite" | "pro" | undefined,
      ctaHref: p.display.ctaHref,
      highlighted: p.display.highlighted,
    };
    const state = getPlanCardState(
      currentPlan,
      planKey,
      {
        ctaLabel: display.ctaLabel,
        checkoutPlan: display.checkoutPlan,
        ctaHref: display.ctaHref,
        highlighted: display.highlighted,
      },
      { renew: tp("cta.renew"), noDowngrade: tp("cta.noDowngrade") }
    );
    return { display, features, state };
  });

  const customCard = customPlan
    ? {
        name: tp("custom.name"),
        tagline: tp("custom.tagline"),
        price: customPlan.display.price,
        priceUnit: tp("custom.priceUnit"),
        features: t.raw("pricing.customService.features") as string[],
        state: getPlanCardState(
          currentPlan,
          "custom",
          {
            ctaLabel: tp("cta.purchaseCustom"),
            checkoutPlan: customPlan.display.checkoutPlan,
            ctaHref: customPlan.display.ctaHref,
            highlighted: customPlan.display.highlighted,
          },
          { renew: tp("cta.renew"), noDowngrade: tp("cta.noDowngrade") }
        ),
      }
    : null;

  const planNames: Record<string, string> = {};
  for (const p of ["free", "lite", "pro"] as const) {
    planNames[p] = tp(`${p}.name` as "free.name");
  }

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      <PricingHero />

      {/* 定价卡 */}
      <div className="pb-0">
        {loading ? (
          <div className="wide-shell px-6 py-16 text-center font-mono text-xs text-ink-40">
            {t("pricing.loading")}
          </div>
        ) : memberCards.length > 0 ? (
          <PricingCards
            memberCards={memberCards}
            purchasing={purchasing}
            onCheckout={(plan) => void handleCheckoutClick(plan)}
          />
        ) : (
          <div className="wide-shell px-6 py-16 text-center font-mono text-xs text-ink-40">
            {errorMsg ?? t("pricing.noPlans")}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div className="mx-auto max-w-3xl px-6 pb-8">
          <div className="card-a border-neg p-4">
            <p className="font-sans text-sm text-neg text-center">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Compare Plans */}
      {memberPlans.length > 0 && (
        <FeatureComparison plans={memberPlans} planNames={planNames} />
      )}

      {/* Custom / Enterprise Service（独立区块，参考 Semrush Enterprise） */}
      {customCard && (
        <CustomService
          card={customCard}
          purchasing={purchasing === "custom"}
          onCheckout={(plan) => void handleCheckoutClick(plan)}
        />
      )}

      {/* FAQ */}
      <PricingFAQ />

      {/* 底部 CTA */}
      <FinalCTA />

      <Footer />
      <Toast />
    </div>
  );
}