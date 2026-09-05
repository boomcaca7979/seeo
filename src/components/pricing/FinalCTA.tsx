"use client";

import Link from "next/link";
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
          {/* /signup 为单语言认证页（无 /zh 路由），必须用 next/link：
              locale-aware Link 会输出 /zh/signup → 404（SEO 审计 S-01） */}
          <Link href="/signup" className="btn-pill btn-pill-primary">
            {t("ctaStartFree")}
          </Link>
          <LocaleLink href="/features/seo-audit" className="btn-pill btn-pill-secondary">
            {t("ctaExploreFeatures")}
          </LocaleLink>
        </div>
        <p className="mt-4 font-sans text-sm/relaxed text-ink-40">{t("ctaRiskReversal")}</p>
      </div>
    </section>
  );
}
