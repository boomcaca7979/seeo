"use client";

import { useTranslations } from "next-intl";
import { Link as LocaleLink } from "@/i18n/routing";

// Final CTA：参考 Semrush 的收尾方式
// 左对齐大标题 + 一句说明 + 一个主 CTA，简洁紧凑。

export default function FinalCTA() {
  const t = useTranslations("pricing");

  return (
    <section className="py-16">
      <div className="mx-auto max-w-[1100px] px-6">
        <h2 className="font-display text-4xl font-semibold leading-[43px] tracking-tight text-ink">
          {t("ctaTitle")}
        </h2>
        <p className="mt-3 max-w-xl font-sans text-sm leading-[20px] text-ink-60">
          {t("ctaSubtitle")}
        </p>
        <div className="mt-6 flex items-center gap-4">
          <LocaleLink href="/signup" className="inline-flex h-10 items-center justify-center rounded-full bg-ink px-6 font-sans text-sm font-semibold text-white transition-colors hover:bg-ink-60">
            {t("ctaStartFree")}
          </LocaleLink>
          <LocaleLink href="/features" className="inline-flex h-10 items-center justify-center rounded-full border border-line bg-card px-6 font-sans text-sm font-medium text-ink transition-colors hover:border-ink-25">
            {t("ctaExploreFeatures")}
          </LocaleLink>
        </div>
        <p className="mt-4 font-sans text-sm/relaxed text-ink-40">{t("ctaRiskReversal")}</p>
      </div>
    </section>
  );
}
