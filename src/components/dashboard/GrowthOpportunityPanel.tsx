// ===== /app 首屏「Search Growth Opportunities」面板（机会优先的决策入口）=====
//
// 产品定位：进入 SeeO 第一眼看到的不是"待管理任务"，而是
//   「我的网站现在有哪些值得处理的搜索增长机会」。
// 每个机会卡必须独立回答四件事：
//   WHAT（发生了什么）→ WHY（为什么是现在）→ EVIDENCE（真实证据）→ ACTION（现在做什么）。
//
// 数据与 /app/actions **同源**（getWorkspaceActionSummary 复用 buildWorkQueue；
// growth.top 只是从同一排序结果里筛选价值分层 regain/capture/improve 的 open 任务，
// 按分层稳定重排，不存在第二套优先级或第二套任务系统）。
// 技术问题（audit / technical / ai_visibility）不冒充增长机会——单独以 issue 语义呈现。
// 无数据时如实说明需要什么数据才能解锁，绝不伪造机会或填 0。

"use client";

// 2026-10 概况页单项目范围改造：本组件需要随「当前项目 / 全部项目」范围切换而
// 用客户端取回的数据重新渲染，因此从 server component（getTranslations）改为
// client component（useTranslations/useLocale）。渲染输出与之前逐字一致。

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { TopOpportunity } from "@/lib/seo/work-queue";

type LocalizedText = string | { en: string; zh: string };

export interface GrowthOpportunityPanelProps {
  summary: {
    open: number;
    inProgress: number;
    fixedClaimed: number;
    verifiedResolved: number;
    auditedDomains: number;
    topAction: {
      taskId: string;
      domain: string;
      level: "P0" | "P1" | "P2";
      source: "audit" | "opportunity";
      type: string;
      title: LocalizedText | null;
      fallbackTitle: string | null;
      target: string | null;
      reasonCodes: Array<{ code: string; value?: number }>;
      execution: {
        available: boolean;
        href: string | null;
        labelKey: string | null;
        unavailableReason: string | null;
      };
    } | null;
    growth: {
      counts: { regain: number; capture: number; improve: number };
      top: TopOpportunity[];
      gaps: string[];
    };
  };
}

const LEVEL_BADGE: Record<string, string> = {
  P0: "badge-err",
  P1: "badge-warn",
  P2: "badge-info",
};

const CAT_BADGE: Record<string, string> = {
  regain: "badge-err",
  capture: "badge-info",
  improve: "badge-warn",
  issue: "badge-info",
};

function pickText(value: LocalizedText | null, locale: string): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return locale === "zh" ? value.zh : value.en;
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return locale === "zh"
    ? `（${d.getMonth() + 1} 月 ${d.getDate()} 日观测）`
    : ` (observed ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
}

export default function GrowthOpportunityPanel({ summary }: GrowthOpportunityPanelProps) {
  const tg = useTranslations("dashboard.growth");
  const tp = useTranslations("dashboard.actions.panel");
  // 注意：reason.* / act.* / unavailableReason 自带命名空间前缀，用上一级命名空间渲染
  const ta = useTranslations("dashboard.actions");
  const locale = useLocale();
  const hasAudit = summary.auditedDomains > 0;
  const top = summary.growth.top;
  const featured = top[0] ?? null;
  const rest = top.slice(1);
  const technicalTop = top.length === 0 ? summary.topAction : null;

  const featuredTitle = featured
    ? pickText(featured.recommendationI18n, locale) ??
      pickText(featured.title, locale) ??
      featured.fallbackTitle ??
      featured.type
    : null;

  return (
    <section className="card-a p-5 sm:p-6" aria-label={tg("title")}>
      {/* ---- 区块头：产品定位 ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">{tg("title")}</h2>
            {hasAudit && (
              <span className="badge-info">{tp("auditedDomains", { n: summary.auditedDomains })}</span>
            )}
          </div>
          <p className="mt-1 font-sans text-sm text-ink-60">{tg("subtitle")}</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {hasAudit ? (
            <Link href="/app/actions" className="btn-secondary">
              {tp("cta")}
            </Link>
          ) : (
            <Link href="/app/audit" className="btn-primary">
              {tp("auditCta")}
            </Link>
          )}
        </div>
      </div>

      {/* ---- 首位机会卡：WHAT / WHY / EVIDENCE / ACTION ---- */}
      {featured && featuredTitle && (
        <div className="mt-4 rounded-lg border border-line bg-paper p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={CAT_BADGE[featured.valueCategory] ?? "badge-info"}>
              {tg(`cat.${featured.valueCategory}` as "cat.regain")}
            </span>
            <span className={LEVEL_BADGE[featured.level] ?? "badge-info"}>{featured.level}</span>
          </div>
          {/* WHAT：一句话说清发生了什么（机会引擎的推荐语，含目标与关键数字） */}
          <div className="mt-1.5 font-sans text-sm font-medium text-ink">{featuredTitle}</div>
          {featured.target && (
            <div className="mt-0.5 truncate font-mono text-xs text-ink-40">
              {featured.target.replace(/^https?:\/\//, "")}
            </div>
          )}
          {/* WHY：可解释的优先级理由（与 Action Center 同一套词表） */}
          <div className="mt-2 font-sans text-xs font-semibold uppercase tracking-wide text-ink-40">
            {tg("whyLabel")}
          </div>
          <ul className="mt-1 list-disc pl-4">
            {featured.reasonCodes.map((r, i) => (
              <li key={`${r.code}-${i}`} className="font-sans text-xs text-ink-60">
                {r.value !== undefined
                  ? ta(`reason.${r.code}` as "reason.effort_low", { value: r.value })
                  : ta(`reason.${r.code}` as "reason.effort_low")}
              </li>
            ))}
          </ul>
          {/* EVIDENCE：真实证据（排名历史 / 审计 / 内容实测），绝不伪造 */}
          {featured.evidence.length > 0 && (
            <>
              <div className="mt-2 font-sans text-xs font-semibold uppercase tracking-wide text-ink-40">
                {tg("evidenceLabel")}
              </div>
              <ul className="mt-1 list-disc pl-4">
                {featured.evidence.map((e, i) => (
                  <li key={i} className="font-sans text-xs text-ink-60">
                    {e.summary}
                    <span className="text-ink-40">{formatDate(e.capturedAt, locale)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* ACTION：进入真实执行页（URL 携带机会上下文，执行页显示"你为什么来到这里"） */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {featured.execution.available && featured.execution.href ? (
              <Link href={featured.execution.href} className="btn-primary px-3 py-1.5 text-xs">
                {featured.execution.labelKey
                  ? ta(featured.execution.labelKey as "act.openIssue")
                  : tg("defaultAction")}{" "}
                →
              </Link>
            ) : (
              <span className="font-sans text-xs text-ink-40">
                {featured.execution.unavailableReason
                  ? ta(featured.execution.unavailableReason as "act.executionUnavailable")
                  : ta("executionUnavailable")}
              </span>
            )}
            <Link href="/app/actions" className="btn-secondary px-3 py-1.5 text-xs">
              {tp("viewAll")}
            </Link>
          </div>
        </div>
      )}

      {/* ---- 其余机会：紧凑行 ---- */}
      {rest.length > 0 && (
        <ul className="mt-3 divide-y divide-line-soft rounded-lg border border-line bg-card">
          {rest.map((o) => {
            const title =
              pickText(o.recommendationI18n, locale) ?? pickText(o.title, locale) ?? o.fallbackTitle ?? o.type;
            return (
              <li key={o.taskId} className="flex items-center gap-3 px-4 py-2">
                <span className={CAT_BADGE[o.valueCategory] ?? "badge-info"}>
                  {tg(`cat.${o.valueCategory}` as "cat.regain")}
                </span>
                <span className="min-w-0 flex-1 truncate font-sans text-xs text-ink">{title}</span>
                <span className={LEVEL_BADGE[o.level] ?? "badge-info"}>{o.level}</span>
                {o.execution.available && o.execution.href && (
                  <Link
                    href={o.execution.href}
                    className="flex-none font-sans text-xs text-accent hover:underline"
                  >
                    {o.execution.labelKey ? ta(o.execution.labelKey as "act.openIssue") : tg("defaultAction")} →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ---- 无增长机会时：技术问题以 issue 语义呈现（不冒充增长），并如实说明数据缺口 ---- */}
      {top.length === 0 && technicalTop && (
        <div className="mt-4 rounded-lg border border-line bg-paper p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={CAT_BADGE.issue}>{tg("cat.issue")}</span>
            <span className={LEVEL_BADGE[technicalTop.level] ?? "badge-info"}>
              {technicalTop.level}
            </span>
          </div>
          <div className="mt-1.5 font-sans text-sm font-medium text-ink">
            {pickText(technicalTop.title, locale) ?? technicalTop.fallbackTitle ?? technicalTop.type}
          </div>
          {technicalTop.target && (
            <div className="mt-0.5 truncate font-mono text-xs text-ink-40">
              {technicalTop.target.replace(/^https?:\/\//, "")}
            </div>
          )}
          <p className="mt-2 font-sans text-xs text-ink-60">{tg("technicalNote")}</p>
          <ul className="mt-2 list-disc pl-4">
            {technicalTop.reasonCodes.map((r, i) => (
              <li key={`${r.code}-${i}`} className="font-sans text-xs text-ink-60">
                {r.value !== undefined
                  ? ta(`reason.${r.code}` as "reason.effort_low", { value: r.value })
                  : ta(`reason.${r.code}` as "reason.effort_low")}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {technicalTop.execution.available && technicalTop.execution.href ? (
              <Link href={technicalTop.execution.href} className="btn-secondary px-3 py-1.5 text-xs">
                {technicalTop.execution.labelKey
                  ? ta(technicalTop.execution.labelKey as "act.openIssue")
                  : tg("defaultAction")}{" "}
                →
              </Link>
            ) : (
              <span className="font-sans text-xs text-ink-40">
                {technicalTop.execution.unavailableReason
                  ? ta(technicalTop.execution.unavailableReason as "act.executionUnavailable")
                  : ta("executionUnavailable")}
              </span>
            )}
            <Link href="/app/actions" className="btn-secondary px-3 py-1.5 text-xs">
              {tp("viewAll")}
            </Link>
          </div>
        </div>
      )}

      {/* ---- 数据缺口：如实解释"为什么现在没有增长机会"，不伪造、不填 0 ---- */}
      {hasAudit && top.length === 0 && (
        <div className="mt-3 space-y-1.5">
          {summary.growth.gaps.includes("no_tracked_keywords") && (
            <p className="rounded-md border border-line bg-paper px-3 py-2 font-sans text-xs text-ink-60">
              {tg("unlock.noRankData")}
            </p>
          )}
          {!summary.growth.gaps.includes("no_tracked_keywords") &&
            summary.growth.gaps.includes("no_growth_opportunities") && (
              <p className="rounded-md border border-line bg-paper px-3 py-2 font-sans text-xs text-ink-60">
                {tg("unlock.noGrowth")}
              </p>
            )}
        </div>
      )}
      {!hasAudit && (
        <p className="mt-4 rounded-md border border-line bg-paper px-3 py-2 font-sans text-sm text-ink-60">
          {tp("noAudit")}
        </p>
      )}

      {/* ---- 队列摘要（次要信息：与 Action Center 同一数据源，只计数不抢决策位）---- */}
      {hasAudit && (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-card px-4 py-3">
            <div className="font-mono text-2xl font-semibold text-ink">{summary.open}</div>
            <div className="font-sans text-xs text-ink-40">{tp("open", { n: summary.open })}</div>
          </div>
          <div className="rounded-lg border border-line bg-card px-4 py-3">
            <div className="font-mono text-2xl font-semibold text-ink">{summary.inProgress}</div>
            <div className="font-sans text-xs text-ink-40">{tp("inProgress", { n: summary.inProgress })}</div>
          </div>
          <div className="rounded-lg border border-line bg-card px-4 py-3">
            <div className="font-mono text-2xl font-semibold text-ink">{summary.fixedClaimed}</div>
            <div className="font-sans text-xs text-ink-40">
              {tp("fixedUnverified", { n: summary.fixedClaimed })}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-card px-4 py-3">
            <div className="font-mono text-2xl font-semibold text-pos">{summary.verifiedResolved}</div>
            <div className="font-sans text-xs text-ink-40">{tp("verified", { n: summary.verifiedResolved })}</div>
          </div>
        </div>
      )}
    </section>
  );
}
