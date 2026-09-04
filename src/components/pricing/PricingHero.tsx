"use client";

import { useTranslations } from "next-intl";

// Pricing Hero：高保真对标 Semrush
// Semrush 测量：H1 36px/600/43px 行高, y=124, 左对齐
// 副标题 14px/19.88px
// H1 → 卡片间距 ~199px（含副标题 + toggle 区域空间）
// 本组件保持等效的垂直节奏，无 toggle（SeeO 无年度计费）。

export default function PricingHero() {
  const t = useTranslations("pricing");

  return (
    <header className="mx-auto max-w-[1392px] px-6 pt-10 pb-6">
      <h1 className="text-4xl font-semibold leading-[43px] text-ink">
        {t("title")}
      </h1>
      <p className="mt-4 font-sans text-sm leading-5 text-ink-60">
        {t("subtitle")}
      </p>
    </header>
  );
}
