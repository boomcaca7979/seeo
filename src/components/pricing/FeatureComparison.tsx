"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanLimitFields } from "./types";

// Compare Plans：参考 Semrush 默认折叠 + "Expand details" 模式
// 桌面端：默认只显示摘要行，点击展开全部；移动端：sticky 迷你表头 + details 折叠。

type ComparePlan = PlanLimitFields & { plan: string };

interface ComparisonRow {
  labelKey: string;
  getValue: (p: ComparePlan) => string;
  expanded?: boolean;
}

interface ComparisonGroup {
  titleKey: string;
  rows: ComparisonRow[];
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

function fmt(v: number): string {
  if (v >= UNLIMITED) return "∞";
  if (v <= 0) return "";
  return v.toLocaleString();
}

function bool(v: boolean): string {
  return v ? "✓" : "";
}

function buildGroups(): ComparisonGroup[] {
  return [
    {
      titleKey: "audit",
      rows: [
        { labelKey: "auditsPerDay", getValue: (p) => fmt(p.audit_daily_limit) },
        { labelKey: "auditDepth", getValue: (p) => fmt(p.audit_max_depth), expanded: true },
      ],
    },
    {
      titleKey: "rankTracking",
      rows: [
        { labelKey: "projects", getValue: (p) => fmt(p.max_projects) },
        { labelKey: "keywords", getValue: (p) => fmt(p.max_tracked_keywords) },
        { labelKey: "keywordGroups", getValue: (p) => fmt(p.max_keyword_groups), expanded: true },
      ],
    },
    {
      titleKey: "competitors",
      rows: [
        { labelKey: "competitors", getValue: (p) => fmt(p.max_competitors) },
        { labelKey: "sov", getValue: () => "✓" },
      ],
    },
    {
      titleKey: "serpData",
      rows: [
        { labelKey: "serpMonthly", getValue: (p) => fmt(p.serpapi_monthly_limit) },
        { labelKey: "dataforseo", getValue: (p) => fmt(p.dataforseo_monthly_limit), expanded: true },
        { labelKey: "backlinks", getValue: (p) => (p.plan === "pro" ? "✓" : ""), expanded: true },
      ],
    },
    {
      titleKey: "content",
      rows: [{ labelKey: "contentChecks", getValue: (p) => fmt(p.content_check_monthly_limit) }],
    },
    {
      titleKey: "reports",
      rows: [
        { labelKey: "pdf", getValue: (p) => bool(p.can_export_pdf) },
        { labelKey: "excel", getValue: (p) => bool(p.can_export_excel), expanded: true },
        { labelKey: "email", getValue: (p) => bool(p.can_email_report), expanded: true },
      ],
    },
  ];
}

interface FeatureComparisonProps {
  plans: ComparePlan[];
  planNames: Record<string, string>;
}

export default function FeatureComparison({ plans, planNames }: FeatureComparisonProps) {
  const t = useTranslations("pricing");
  const [expanded, setExpanded] = useState(false);
  const groups = buildGroups();
  const groupLabel = (key: string) => t.raw(`compareGroups.${key}`) as string;
  const rowLabel = (key: string) => t.raw(`compareRows.${key}`) as string;

  const memberPlans = plans.filter((p) => p.plan !== "custom");
  if (memberPlans.length === 0) return null;

  const summaryRows = groups.flatMap((g) => g.rows.filter((r) => !r.expanded));
  const hiddenRows = groups.flatMap((g) => g.rows.filter((r) => r.expanded));

  return (
    <section className="py-16" aria-labelledby="compare-plans-title">
      <div className="mx-auto max-w-[1100px] px-6">
        <h2 id="compare-plans-title" className="font-display text-[1.75rem] font-semibold leading-8 text-ink">
          {t("compareTitle")}
        </h2>
        <p className="mt-1 font-sans text-sm text-ink-60">{t("compareSubtitle")}</p>

        {/* 桌面端：折叠式对比表 */}
        <div className="mt-8 hidden lg:block">
          <div className="card-a overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line bg-paper">
                  <th scope="col" className="w-[40%] px-5 py-3 text-left font-sans text-sm font-medium text-ink-40">
                    {t("compareFeatureCol")}
                  </th>
                  {memberPlans.map((p) => (
                    <th key={p.plan} scope="col" className="w-[20%] px-4 py-3 text-center font-display text-sm font-semibold text-ink">
                      {planNames[p.plan] ?? p.plan}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row, i) => (
                  <tr key={row.labelKey} className={i < summaryRows.length - 1 ? "border-b border-line-soft" : ""}>
                    <td className="px-5 py-2 font-sans text-sm text-ink-60">{rowLabel(row.labelKey)}</td>
                    {memberPlans.map((p) => (
                      <td key={p.plan} className="px-4 py-2 text-center font-mono text-sm text-ink">
                        {row.getValue(p) || <span className="text-ink-40">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
                {expanded && hiddenRows.map((row, i) => (
                  <tr key={row.labelKey} className={i < hiddenRows.length - 1 ? "border-b border-line-soft" : ""}>
                    <td className="px-5 py-2 font-sans text-sm text-ink-60">{rowLabel(row.labelKey)}</td>
                    {memberPlans.map((p) => (
                      <td key={p.plan} className="px-4 py-2 text-center font-mono text-sm text-ink">
                        {row.getValue(p) || <span className="text-ink-40">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-line-soft px-5 py-3 text-center">
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full border border-line bg-card px-6 font-sans text-sm font-medium text-ink transition-colors hover:border-ink-25"
              >
                {expanded ? t("collapseDetails") : t("expandDetails")}
              </button>
            </div>
          </div>
        </div>

        {/* 移动端 */}
        <div className="mt-8 lg:hidden">
          <div className="sticky top-16 z-10 -mx-1 rounded-md border border-line bg-card/95 px-4 py-2 backdrop-blur-sm">
            <div className="grid grid-cols-[1fr_56px_56px_56px] items-center">
              <span className="font-sans text-xs font-medium text-ink-40">{t("compareFeatureCol")}</span>
              {memberPlans.map((p) => (
                <span key={p.plan} className="text-center font-display text-xs font-semibold text-ink">
                  {planNames[p.plan] ?? p.plan}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {groups.map((g, gi) => (
              <details key={g.titleKey} open={gi === 0} className="card-a overflow-hidden group">
                <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 font-sans text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                  <span>{groupLabel(g.titleKey)}</span>
                  <span aria-hidden="true" className="text-ink-40 transition-transform duration-150 group-open:rotate-180">▾</span>
                </summary>
                <div className="border-t border-line-soft px-4 py-1">
                  {g.rows.map((row) => (
                    <div key={row.labelKey} className="grid grid-cols-[1fr_56px_56px_56px] items-center border-b border-line-soft py-2 last:border-b-0">
                      <span className="pr-2 font-sans text-xs text-ink-60">{rowLabel(row.labelKey)}</span>
                      {memberPlans.map((p) => (
                        <span key={p.plan} className="text-center font-mono text-xs text-ink">
                          {row.getValue(p) || <span className="text-ink-40">—</span>}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>

        <p className="mt-3 font-sans text-xs text-ink-40">{t("compareLegend")}</p>
      </div>
    </section>
  );
}
