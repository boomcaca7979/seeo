"use client";

import Link from "next/link";
import { useState } from "react";
import Navbar from "@/components/Navbar";

interface Plan {
  name: string;
  tagline: string;
  price: string;
  unit: string;
  /** checkoutPlan: 调用 /api/checkout 时传给后端的 plan 标识；undefined 表示不走 checkout（如免费版/企业版） */
  cta: {
    label: string;
    href?: string;
    checkoutPlan?: "pro" | "team" | "enterprise";
    disabled?: boolean;
  };
  features: { text: string; included: boolean }[];
  highlighted?: boolean;
}

const plans: Plan[] = [
  {
    name: "免费版",
    tagline: "适合个人站长和初学者",
    price: "¥0",
    unit: "/月",
    cta: { label: "免费开始", href: "/app" },
    features: [
      { text: "最多 10 个关键词追踪", included: true },
      { text: "每日排名刷新", included: true },
      { text: "技术审计（首页 quick 模式）", included: true },
      { text: "关键词研究", included: true },
      { text: "基础竞品排名对比", included: true },
      { text: "SerpApi 每月 100 次额度", included: true },
      { text: "深度审计（50 页 full 模式）", included: false },
      { text: "PDF/Excel 报告导出", included: false },
      { text: "邮件周报自动发送", included: false },
    ],
  },
  {
    name: "Pro 版",
    tagline: "适合专业 SEO 从业者",
    price: "¥69",
    unit: "/月",
    cta: { label: "升级到 Pro", checkoutPlan: "pro" },
    highlighted: true,
    features: [
      { text: "无限关键词追踪", included: true },
      { text: "每日排名刷新", included: true },
      { text: "深度审计（50 页 full 模式）", included: true },
      { text: "关键词研究", included: true },
      { text: "竞品分析 + SOV 计算", included: true },
      { text: "PDF/Excel 报告导出", included: true },
      { text: "邮件周报自动发送", included: true },
      { text: "多项目管理", included: true },
      { text: "更高 SerpApi 调用额度", included: true },
    ],
  },
  {
    name: "企业版",
    tagline: "适合团队与代理机构",
    price: "联系销售",
    unit: "",
    cta: { label: "联系我们", href: "mailto:support@seeo.local" },
    features: [
      { text: "Pro 版全部功能", included: true },
      { text: "团队协作与权限管理", included: false },
      { text: "多客户项目管理", included: false },
      { text: "API 接入", included: false },
      { text: "专属数据额度", included: true },
      { text: "优先支持", included: true },
    ],
  },
];

const faqs = [
  {
    q: "免费版有使用期限吗？",
    a: "没有。免费版永久可用，但有关键词数量与 SerpApi 调用次数限制。",
  },
  {
    q: "如何升级到 Pro 版？",
    a: "点击 Pro 版的「升级到 Pro」按钮，通过 Stripe 安全支付页面完成订阅后，权限立即生效。支持随时取消。",
  },
  {
    q: "SerpApi 额度是什么？",
    a: "SerpApi 是第三方 SERP 数据 API，按调用次数计费。免费版每月 100 次，超出后相关功能暂停至下月刷新。Pro 版将提供更高额度。",
  },
  {
    q: "数据存储在哪里？",
    a: "生产环境使用 Turso 云数据库，用户鉴权由 Supabase Auth 提供。每个用户的数据相互隔离。支付由 Stripe 处理，我们不存储信用卡信息。",
  },
];

export default function PricingPage() {
  const [loadingPlan, setLoadingPlan] = useState<"pro" | "team" | "enterprise" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        setErrorMsg(json?.error ?? "创建支付会话失败，请稍后重试");
        return;
      }
      if (json?.url) {
        // 跳转到 Stripe Checkout 托管页
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
      <div className="mx-auto max-w-5xl px-6 pb-16 grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`card-a p-8 relative ${plan.highlighted ? "border-brand" : ""}`}
          >
            {plan.highlighted && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="badge-warn text-xs px-3 py-1 bg-card">推荐</span>
              </div>
            )}
            <div className="mb-6">
              <h2 className="font-mono text-xl font-bold text-ink mb-1">{plan.name}</h2>
              <p className="font-sans text-sm text-ink-40">{plan.tagline}</p>
            </div>
            <div className="mb-6">
              <span className="font-mono text-3xl font-bold text-ink">{plan.price}</span>
              {plan.unit && <span className="font-sans text-sm text-ink-40">{plan.unit}</span>}
            </div>
            <ul className="space-y-3 mb-8">
              {plan.features.map((f) => (
                <li key={f.text} className="flex items-start gap-2 font-sans text-sm text-ink-60">
                  {f.included ? (
                    <span className="text-pos mt-0.5">✓</span>
                  ) : (
                    <span className="text-ink-40 mt-0.5">—</span>
                  )}
                  <span className={f.included ? "" : "text-ink-40"}>{f.text}</span>
                </li>
              ))}
            </ul>

            {/* CTA 按钮：支持 Link 跳转 / Checkout API 调用 */}
            {plan.cta.checkoutPlan ? (
              <button
                onClick={() => handleCheckout(plan.cta.checkoutPlan!)}
                disabled={loadingPlan !== null}
                className={`block w-full text-center py-3 ${
                  plan.highlighted ? "btn-primary" : "btn-secondary"
                } ${loadingPlan !== null ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {loadingPlan === plan.cta.checkoutPlan ? "正在跳转支付..." : plan.cta.label}
              </button>
            ) : plan.cta.disabled ? (
              <>
                <button className="w-full btn-primary py-3 opacity-50 cursor-not-allowed" disabled>
                  {plan.cta.label}
                </button>
                <p className="mt-2 text-center font-mono text-xs text-ink-40">支付系统开发中</p>
              </>
            ) : (
              <Link
                href={plan.cta.href ?? "#"}
                className={`block w-full text-center py-3 ${plan.highlighted ? "btn-primary" : "btn-secondary"}`}
              >
                {plan.cta.label}
              </Link>
            )}
          </div>
        ))}
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
            所有方案功能基于当前已实现能力。标注&ldquo;—&rdquo;的功能正在开发中，不代表已包含在当前方案内。
            支付由 Stripe 安全处理，我们不存储信用卡信息。
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
    </div>
  );
}
