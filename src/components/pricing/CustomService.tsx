"use client";

import { useTranslations } from "next-intl";
import type { PlanCardState } from "@/lib/pricing-plan-state";

// Custom Service：参考 Semrush Enterprise 区块
// 深色背景 + 左侧标题说明 + 右侧 CTA + 特性列表
// 与会员套餐形成明显的视觉层次分离。
// 正文颜色：white/60（深色背景上合法的高对比正文色，非 ink-25 装饰色）。

interface CustomServiceProps {
  card: {
    name: string;
    tagline: string;
    price: string;
    priceUnit: string;
    features: string[];
    state: PlanCardState;
  };
  purchasing: boolean;
  onCheckout: (plan?: "custom") => void;
}

export default function CustomService({ card, purchasing, onCheckout }: CustomServiceProps) {
  const t = useTranslations("pricing");

  return (
    <section className="py-12">
      <div className="wide-shell px-6">
        <div className="overflow-hidden rounded-xl bg-[rgb(24,30,21)]">
          <div className="flex flex-col gap-8 p-10 md:flex-row md:items-center">
            {/* 左侧：标题 + 说明 + 特性 */}
            <div className="flex-1">
              <h2 className="font-display text-[1.75rem] font-semibold leading-8 text-white">
                {card.name}
              </h2>
              <p className="mt-2 font-sans text-sm leading-[20px] text-white/70">
                {card.tagline}
              </p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-mono text-sm font-medium text-white/70">$</span>
                <span className="font-mono text-4xl font-semibold leading-none tracking-tight text-white">
                  {card.price.replace("$", "")}
                </span>
                <span className="ml-1 font-sans text-xs text-white/70">{card.priceUnit}</span>
              </div>
              <p className="mt-2 font-sans text-xs text-white/70">{t("customNote")}</p>
            </div>

            {/* 右侧：特性 + CTA */}
            <div className="md:w-[340px] md:flex-shrink-0">
              <ul className="space-y-3">
                {card.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 font-sans text-sm leading-[18px] text-white/70">
                    <span aria-hidden="true" className="mt-px flex-shrink-0 text-pos">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => onCheckout(card.state.checkoutPlan as "custom")}
                disabled={card.state.disabled || purchasing}
                className="btn-pill btn-pill-inverse mt-6 w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {purchasing ? t("paymentStarting") : card.state.ctaLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
