"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { explainTechnicalPriority } from "@/lib/seo/issue-priority";
import {
  DEMO_AUDIT_META,
  DEMO_EVIDENCE,
  DEMO_RESOLUTION,
  DEMO_RESOLUTION_STATES,
  DEMO_RULE_SNAPSHOT,
  DEMO_RULE_TEXT,
} from "@/lib/demo/audit-demo-data";

// ===== 首页「真实审计演示」区 =====
// 数据来自 2026-10-15 对 www.seeo.asia 的真实审计快照（仅首页快速审计），
// 五步结构（范围 / 发现 / 依据 / 行动 / 验证）与 /app/audit 结果页一一对应。
// 快照静态、非实时，带时间与范围标注；不冒充实时结果，不声称任何改善效果。

const TABS = ["scope", "what", "why", "action", "verify"] as const;
type TabKey = (typeof TABS)[number];

export default function DashboardPreview() {
  const t = useTranslations("preview");
  const ta = useTranslations("dashboard.actions");
  const locale = useLocale();
  const ruleText = locale.toLowerCase().startsWith("zh") ? DEMO_RULE_TEXT.zh : DEMO_RULE_TEXT.en;
  const [active, setActive] = useState<TabKey>("what");

  // 优先级在渲染时由唯一来源实时计算（不预存结论）
  const { priority, effort } = explainTechnicalPriority({
    severity: DEMO_RULE_SNAPSHOT.severity,
    affectedRatio: DEMO_RULE_SNAPSHOT.affectedRatio,
    scoreImpact: DEMO_RULE_SNAPSHOT.scoreImpact,
    pattern: DEMO_RULE_SNAPSHOT.pattern,
    pageLevel: DEMO_RULE_SNAPSHOT.pageLevel,
  });

  return (
    <section id="dashboard" className="bg-paper px-5 py-10 sm:px-8 sm:py-12">
      <div className="site-shell">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
              {t("sectionHeading")}
            </h2>
            <p className="mt-3 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {t("sectionSubheading")}
            </p>
            <p className="mt-4 text-sm text-ink-60 sm:text-base">
              {t("realDemo.sectionSubtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2 card-a px-3 py-2 font-mono text-xs text-ink-60">
            <span className="h-2 w-2 rounded-full bg-pos" />
            {t("realDemo.badge", { time: DEMO_AUDIT_META.auditedAtLabel })}
          </div>
        </div>

        {/* 真实快照卡 */}
        <div className="mt-10 card-a overflow-hidden">
          {/* 卡头：真实审计上下文 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 sm:px-6">
            <div className="font-mono text-xs text-ink-60">
              {DEMO_AUDIT_META.domain} · SEO audit
            </div>
            <span className="badge-info">{t("realDemo.snapshotTag")}</span>
          </div>

          {/* 快照摘要条：健康分 / 页面 / 检查项 / 深度 */}
          <div className="grid grid-cols-2 gap-3 border-b border-line px-5 py-4 sm:grid-cols-4 sm:px-6">
            <SummaryStat
              value={String(DEMO_AUDIT_META.healthScore)}
              label={t("realDemo.summary.healthScore")}
            />
            <SummaryStat
              value={String(DEMO_AUDIT_META.pagesCrawled)}
              label={t("realDemo.summary.pagesCrawled")}
            />
            <SummaryStat
              value={`${DEMO_AUDIT_META.checksPassed}/${DEMO_AUDIT_META.checksTotal}`}
              label={t("realDemo.summary.checksPassed")}
            />
            <SummaryStat
              value={DEMO_AUDIT_META.engine}
              label={t("realDemo.summary.engine")}
            />
          </div>

          {/* 五步交互 Tabs */}
          <div
            role="tablist"
            aria-label={t("sectionHeading")}
            className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 sm:px-4"
          >
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active === key}
                onClick={() => setActive(key)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 font-sans text-sm font-semibold transition-colors ${
                  active === key
                    ? "bg-ink text-white"
                    : "text-ink-60 hover:bg-line-soft hover:text-ink"
                }`}
              >
                {t(`realDemo.tabs.${key}`)}
              </button>
            ))}
          </div>

          <div className="px-5 py-6 sm:px-6" role="tabpanel">
            {active === "scope" && (
              <ScopeTab t={t} />
            )}
            {active === "what" && (
              <WhatTab t={t} ta={ta} ruleText={ruleText} />
            )}
            {active === "why" && (
              <WhyTab t={t} ta={ta} priority={priority} effort={effort} />
            )}
            {active === "action" && (
              <ActionTab t={t} ruleText={ruleText} />
            )}
            {active === "verify" && (
              <VerifyTab t={t} ta={ta} />
            )}
          </div>

          {/* 诚实声明脚注 */}
          <div className="border-t border-line bg-line-soft px-5 py-3 sm:px-6">
            <p className="font-mono text-xs leading-relaxed text-ink-40">
              {t("realDemo.footer")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="card-a p-3">
      <div className="truncate font-mono text-lg font-semibold text-ink">{value}</div>
      <div className="mt-0.5 font-mono text-xs text-ink-40">{label}</div>
    </div>
  );
}

type PreviewT = ReturnType<typeof useTranslations<"preview">>;
type ActionsT = ReturnType<typeof useTranslations<"dashboard.actions">>;
type RuleText = (typeof DEMO_RULE_TEXT)[keyof typeof DEMO_RULE_TEXT];

function ScopeTab({ t }: { t: PreviewT }) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ScopeRow label={t("realDemo.scope.domain")} value={DEMO_AUDIT_META.domain} mono />
        <ScopeRow label={t("realDemo.scope.time")} value={DEMO_AUDIT_META.auditedAtLabel} mono />
        <ScopeRow
          label={t("realDemo.scope.depth")}
          value={t("realDemo.scope.depthValue")}
        />
        <ScopeRow
          label={t("realDemo.scope.pages")}
          value={String(DEMO_AUDIT_META.pagesCrawled)}
          mono
        />
      </div>
      <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-ink-60">
        <span aria-hidden className="mt-0.5 text-warn">▲</span>
        {t("realDemo.scope.note")}
      </p>
    </div>
  );
}

function ScopeRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card-a px-4 py-3">
      <div className="font-mono text-xs text-ink-40">{label}</div>
      <div className={`mt-1 truncate text-sm font-semibold text-ink ${mono ? "font-mono" : "font-sans"}`}>
        {value}
      </div>
    </div>
  );
}

function WhatTab({ t, ta, ruleText }: { t: PreviewT; ta: ActionsT; ruleText: RuleText }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-xl font-semibold text-ink">
          {ruleText.name}
        </h3>
        <span className="badge-info">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {ta("sev.notice")}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-60">
        {ruleText.description}
      </p>

      {/* 实测证据 */}
      <div className="mt-5 font-mono text-xs font-semibold uppercase tracking-wide text-ink-40">
        {t("evidence.label")}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="card-a p-3">
          <div className="font-mono text-lg font-semibold text-ink">
            {DEMO_EVIDENCE.visibleTextSize.toLocaleString()}
          </div>
          <div className="mt-0.5 font-mono text-xs text-ink-40">
            {t("realDemo.evidence.visibleText")}
          </div>
        </div>
        <div className="card-a p-3">
          <div className="font-mono text-lg font-semibold text-ink">
            {DEMO_EVIDENCE.htmlSize.toLocaleString()}
          </div>
          <div className="mt-0.5 font-mono text-xs text-ink-40">
            {t("realDemo.evidence.htmlSize")}
          </div>
        </div>
        <div className="card-a p-3">
          <div className="font-mono text-lg font-semibold text-ink">
            {DEMO_EVIDENCE.ratioPercent}%
          </div>
          <div className="mt-0.5 font-mono text-xs text-ink-40">
            {t("realDemo.evidence.ratio")}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 font-mono text-xs text-ink-60">
        <span className="h-1 w-1 flex-none rounded-full bg-accent" />
        <span className="truncate">{DEMO_RULE_SNAPSHOT.sampleUrl}</span>
      </div>
    </div>
  );
}

function WhyTab({
  t,
  ta,
  priority,
  effort,
}: {
  t: PreviewT;
  ta: ActionsT;
  priority: ReturnType<typeof explainTechnicalPriority>["priority"];
  effort: ReturnType<typeof explainTechnicalPriority>["effort"];
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-lg bg-ink px-3 py-1 font-mono text-xs font-semibold text-white">
          {priority.level}
        </span>
        <span className="font-mono text-xs text-ink-60">
          {t("realDemo.why.score", { score: priority.score })}
        </span>
        <span className="font-mono text-xs text-ink-40">
          {ta("effort." + effort)}
        </span>
      </div>

      <div className="mt-5 font-mono text-xs font-semibold uppercase tracking-wide text-ink-40">
        {ta("priority.why")}
      </div>
      <ul className="mt-3 space-y-2">
        {priority.reasons.map((reason) => (
          <li key={reason.code} className="flex items-center gap-2 font-mono text-xs text-ink-60">
            <span className="h-1 w-1 flex-none rounded-full bg-accent" />
            {ta(`reason.${reason.code}`, reason.value === undefined ? {} : { value: reason.value })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionTab({ t, ruleText }: { t: PreviewT; ruleText: RuleText }) {
  return (
    <div>
      <div className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">
        {ruleText.recommendation}
        <span aria-hidden>→</span>
      </div>
      <ul className="mt-5 space-y-2">
        {(["step1", "step2", "step3"] as const).map((key) => (
          <li key={key} className="flex items-start gap-2 text-sm leading-relaxed text-ink-60">
            <span aria-hidden className="mt-0.5 text-accent">·</span>
            {t(`realDemo.action.${key}`)}
          </li>
        ))}
      </ul>
      <p className="mt-4 font-mono text-xs text-ink-40">{t("realDemo.action.genericNote")}</p>
    </div>
  );
}

function VerifyTab({ t, ta }: { t: PreviewT; ta: ActionsT }) {
  return (
    <div>
      {/* 当前真实状态：fixed_claimed + 再审计 fail */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-info">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {ta("status.fixed_claimed")}
        </span>
        <span className="font-mono text-xs text-ink-40">
          {ta("status.fixed_claimed_hint")}
        </span>
      </div>

      <div className="mt-4 card-a p-4">
        <div className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-40">
          {ta("verificationTitle")}
        </div>
        <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-ink-60">
          <span aria-hidden className="mt-0.5 text-neg">✕</span>
          {ta("verification.fail", {
            auditId: DEMO_RESOLUTION.verifiedAuditId,
            findings: DEMO_RESOLUTION.verifyFindings,
            pages: DEMO_RESOLUTION.verifyPages,
          })}
        </p>
        <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-ink-60">
          <span aria-hidden className="mt-0.5 text-warn">▲</span>
          {t("realDemo.verify.notFixedNote")}
        </p>
        {DEMO_RESOLUTION.note && (
          <p className="mt-2 font-mono text-xs text-ink-40">
            {t("realDemo.verify.userNote", { note: DEMO_RESOLUTION.note })} ·{" "}
            {t("realDemo.verify.attempts", { n: DEMO_RESOLUTION.attempts })}
          </p>
        )}
      </div>

      {/* 五状态机制说明 */}
      <div className="mt-5 font-mono text-xs font-semibold uppercase tracking-wide text-ink-40">
        {t("realDemo.verify.mechanismTitle")}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {DEMO_RESOLUTION_STATES.map((state) => (
          <li key={state} className="card-a px-3 py-2">
            <div className="font-mono text-xs font-semibold text-ink">
              {ta(`status.${state}`)}
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-ink-40">
              {ta(`status.${state}_hint`)}
            </div>
          </li>
        ))}
      </ul>

      <Link
        href={`/app/audit?domain=${DEMO_AUDIT_META.domain}`}
        className="mt-5 inline-flex items-center gap-2 font-sans text-sm font-semibold text-accent transition-colors hover:text-ink"
      >
        {t("verify.cta")}
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
