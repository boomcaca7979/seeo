"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PlanCardState } from "@/lib/pricing-plan-state";
import type { CardFeature, PlanDisplay } from "./types";

// Pricing Cards：高保真对标 Semrush
// Semrush 精确测量：
// container 1392px, card 333px, gap 20px, height 685px
// padding 24/24/32, border-radius 12px, no border
// shadow: 5px 5px 25px 0 rgba(137,141,154,0.3)
// H2 21px/600/28.35px, persona 14px/19.88px
// CTA: pill 24px radius, 40px height, dark bg, 16px/500
// Feature: 14px/19.88px, no gap between items

export interface MemberCardData {
  display: PlanDisplay;
  features: CardFeature[];
  state: PlanCardState;
}

export interface CustomCardData {
  name: string;
  tagline: string;
  price: string;
  priceUnit: string;
  features: string[];
  state: PlanCardState;
}

interface PricingCardsProps {
  memberCards: MemberCardData[];
  purchasing: string | null;
  onCheckout: (plan?: "lite" | "pro" | "custom") => void;
}

export default function PricingCards({
  memberCards,
  purchasing,
  onCheckout,
}: PricingCardsProps) {
  const t = useTranslations("pricing");

  return (
    <section className="mx-auto max-w-[1392px] px-6" aria-label={t("cardsLabel")}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {memberCards.map((c) => (
          <MemberCard
            key={c.display.plan}
            card={c}
            purchasing={purchasing === (c.state.checkoutPlan ?? c.display.checkoutPlan)}
            onCheckout={onCheckout}
          />
        ))}
      </div>
    </section>
  );
}

function MemberCard({
  card,
  purchasing,
  onCheckout,
}: {
  card: MemberCardData;
  purchasing: boolean;
  onCheckout: (plan?: "lite" | "pro" | "custom") => void;
}) {
  const t = useTranslations("pricing");
  const { display, features, state } = card;

  return (
    <div
      className="relative flex flex-col rounded-lg bg-card px-6 pt-6 pb-8"
      style={{ boxShadow: "5px 5px 25px 0 rgba(137,141,154,0.3)" }}
    >
      {/* Plan name: Semrush 21px/600 */}
      <h2 className="text-[21px] font-semibold leading-[28px] text-ink">
        {display.name}
      </h2>
      {/* Persona: Semrush 14px/19.88px */}
      <p className="mt-0.5 font-sans text-sm leading-5 text-ink-40">
        {display.tagline}
      </p>

      {/* Price：Semrush 风格 —— $ 小 + 主数字大 + /mo 小 */}
      <div className="mt-5 flex items-baseline gap-0.5">
        {display.plan === "free" ? (
          <span className="font-mono text-[44px] font-semibold leading-none tracking-tight text-ink">
            {display.price}
          </span>
        ) : (
          <>
            <span className="font-mono text-sm font-medium text-ink">$</span>
            <span className="font-mono text-[44px] font-semibold leading-none tracking-tight text-ink">
              {display.price.replace("$", "")}
            </span>
            <span className="ml-1 font-sans text-xs text-ink-40">/mo</span>
          </>
        )}
      </div>
      {display.plan !== "free" && (
        <p className="mt-1.5 font-sans text-xs leading-4 text-ink-40">{t("billingNote")}</p>
      )}
      {display.plan === "free" && <div className="mt-1.5 h-[16px]" />}

      {/* CTA：所有卡统一 dark filled，pill 形状，Semrush 24px radius, 40px height */}
      <div className="mt-5">
        {state.kind === "link" ? (
          <Link
            href={state.ctaHref ?? "/app"}
            className="flex h-10 w-full items-center justify-center rounded-full bg-ink font-sans text-sm font-medium text-white transition-colors hover:bg-ink-60"
          >
            {state.ctaLabel}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onCheckout(state.checkoutPlan ?? display.checkoutPlan)}
            disabled={state.disabled || purchasing}
            className="flex h-10 w-full cursor-pointer items-center justify-center rounded-full bg-ink font-sans text-sm font-medium text-white transition-colors hover:bg-ink-60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {purchasing ? t("paymentStarting") : state.ctaLabel}
          </button>
        )}
        {/* Secondary action：参考 Semrush "or subscribe" */}
        {display.plan !== "free" && state.kind !== "none" && (
          <p className="mt-2 text-center font-sans text-sm text-ink-40">
            {t("orRenew")}
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="my-5 h-px bg-line" />

      {/* Feature list：Semrush 14px/19.88px, gap 0 */}
      <ul className="flex-1 space-y-0">
        {features.map((f) => (
          <li key={f.text} className="flex items-start gap-2 py-[3px] font-sans text-sm leading-5">
            {f.included ? (
              <span aria-hidden="true" className="mt-[2px] flex-shrink-0 text-pos">✓</span>
            ) : (
              <span aria-hidden="true" className="mt-[2px] flex-shrink-0 text-ink-40">✗</span>
            )}
            <span className={f.included ? "text-ink-60" : "text-ink-40"}>{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
