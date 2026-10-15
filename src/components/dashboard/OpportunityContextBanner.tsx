"use client";

// ===== 机会上下文条（execution page 顶部）=====
// 用户从机会卡进入执行页时，URL 携带 from/otype/otitle/otitlezh/oreason 上下文参数；
// 本组件据此显示「你为什么来到这里」，防止用户在执行界面里忘记初衷。
// 只读 URL 参数，不复制任何状态、不新建存储；参数缺失时完全不渲染。

import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";

const TYPE_TO_CAT: Record<string, "regain" | "capture" | "improve" | "issue"> = {
  lost_recovery: "regain",
  rank_improvement: "capture",
  competitor_gap: "capture",
  ctr: "capture",
  content_refresh: "improve",
  technical: "issue",
};

export default function OpportunityContextBanner() {
  const t = useTranslations("dashboard.opportunityContext");
  const tg = useTranslations("dashboard.growth");
  const tr = useTranslations("dashboard.actions");
  const locale = useLocale() as string;
  const params = useSearchParams();

  if (params.get("from") !== "opportunity") return null;
  const titleEn = params.get("otitle");
  const titleZh = params.get("otitlezh");
  const title = locale === "zh" ? titleZh || titleEn : titleEn || titleZh;
  if (!title) return null;

  const otype = params.get("otype") ?? "";
  const cat = TYPE_TO_CAT[otype];
  const reasonCode = params.get("oreason");
  let reasonText: string | null = null;
  if (reasonCode) {
    try {
      reasonText = tr(`reason.${reasonCode}` as "reason.effort_low");
    } catch {
      reasonText = null;
    }
  }

  return (
    <div
      className="mb-5 rounded-lg border border-line bg-paper px-4 py-3"
      data-testid="opportunity-context-banner"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-info">{tg("title")}</span>
        {cat && (
          <span className="font-sans text-xs font-semibold text-ink-60">
            {tg(`cat.${cat}` as "cat.regain")}
          </span>
        )}
      </div>
      <div className="mt-1 font-sans text-sm text-ink">{title}</div>
      {reasonText && (
        <div className="mt-0.5 font-sans text-xs text-ink-60">
          {t("whyPrefix")}
          {reasonText}
        </div>
      )}
    </div>
  );
}
