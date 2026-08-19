"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

interface OnboardingProps {
  displayName: string;
}

export default function Onboarding({ displayName }: OnboardingProps) {
  const t = useTranslations("dashboard.shared.onboarding");

  const STEPS = [
    {
      n: "01",
      title: t("step1Title"),
      desc: t("step1Desc"),
    },
    {
      n: "02",
      title: t("step2Title"),
      desc: t("step2Desc"),
    },
    {
      n: "03",
      title: t("step3Title"),
      desc: t("step3Desc"),
    },
  ];

  return (
    <div className="dash-container px-6 py-8 sm:px-8">
      {/* eyebrow 行 */}
      <div className="flex items-center justify-between font-sans text-xs text-ink-40">
        <span>{t("eyebrowWelcome")}</span>
        <span>{t("eyebrowUpdated")}</span>
      </div>

      {/* 主标题 */}
      <div className="mt-3">
        <h1
          className="font-display font-semibold tracking-tight text-ink"
          style={{ fontSize: 32, lineHeight: 1.2 }}
        >
          {t("greeting", { name: displayName })}
        </h1>
        <p className="mt-2 font-sans text-sm text-ink-60">
          {t("subtitle")}
        </p>
      </div>

      {/* Onboarding 区块 */}
      <section className="mt-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-40">01</span>
          <h2 className="font-display text-base font-semibold text-ink">{t("sectionTitle")}</h2>
          <div className="hairline flex-1" />
        </div>

        <div className="mt-4 card-a p-8 sm:p-10">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="flex flex-col">
                <span className="font-mono text-xs text-brand">{s.n}</span>
                <div className="mt-2 font-display text-base font-semibold text-ink">
                  {s.title}
                </div>
                <p className="mt-2 font-sans text-sm text-ink-60 leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>

          {/* 主 CTA */}
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link href="/app/audit" className="btn-primary px-8 py-3 text-base">
              {t("cta")}
            </Link>
            <p className="font-mono text-xs text-ink-40">
              {t("ctaNote")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
