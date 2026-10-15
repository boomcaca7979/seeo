"use client";

// ===== Site Audit Issue Center + Issue Detail =====
// 数据：DashboardSnapshot（rules + findings）。
// 视图：
//  - 列表：搜索 / Severity / Category 筛选，Priority / Affected Pages / Findings /
//    Score Impact 排序，Group by（Issue / Severity / Category），Clear filters。
//  - Issue Detail：Severity / Category / Priority + Affected Pages / Ratio / Findings /
//    Metric + Why this matters / What SeeO found / How to fix + Affected URLs。
//  - Pattern 检测：同一规则多条 finding 消息归一化后完全一致 → 站点级/模板级问题。

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import type { DashboardSnapshot, RuleSnapshot, RuleSeverity, RuleCategory } from "@/lib/seo/audit-dashboard";
import { selectTopIssue, explainTechnicalPriority, type TopIssueSelection } from "@/lib/seo/issue-priority";
import { getFixGuidance } from "@/lib/seo/fix-guidance";
import { SectionCard, SeverityBadge, EmptyBlock, Hint, fmtNum, SEVERITY_COLORS } from "./ui";

/** 处理状态（来自 /api/audit/issues/status；与检测结果分离） */
interface IssueResolution {
  rule_id: string;
  status: "open" | "in_progress" | "fixed_claimed" | "verified_resolved" | "dismissed";
  verified_at: string | null;
  verified_audit_id: number | null;
  verify_status: "pass" | "fail" | "inconclusive" | null;
  /** 服务端写入的验证明细 JSON（{auditId, depth, findings, affectedPages}），用于展示真实检出数字 */
  verify_detail?: string | null;
}

/** 从 verify_detail JSON 解析再审计的真实检出数字；解析失败返回 null（不伪造 0） */
function parseVerifyDetail(resolution: IssueResolution | null): { findings: number; pages: number } | null {
  if (!resolution?.verify_detail) return null;
  try {
    const d = JSON.parse(resolution.verify_detail) as { findings?: unknown; affectedPages?: unknown };
    if (typeof d.findings === "number" && typeof d.affectedPages === "number") {
      return { findings: d.findings, pages: d.affectedPages };
    }
    return null;
  } catch {
    return null;
  }
}

type LocalizedText = string | { en: string; zh: string };

function textOf(v: LocalizedText | null | undefined, locale: "en" | "zh"): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : v[locale];
}

/** 优先级：severity 主导，warning 覆盖面 ≥50% 提升为 high */
function priorityOf(r: RuleSnapshot): "high" | "medium" | "low" {
  if (r.severity === "error") return "high";
  if (r.severity === "warning") return r.affectedRatio >= 0.5 ? "high" : "medium";
  return "low";
}

function prioritySortKey(r: RuleSnapshot): number {
  const rank = r.severity === "error" ? 3 : r.severity === "warning" ? 2 : 1;
  return rank * 10000 + Math.round(r.affectedRatio * 1000) * 10 + Math.round(r.scoreImpact * 10);
}

interface IssuesCenterProps {
  snapshot: DashboardSnapshot;
  issue: string | null;
  filters: { severity?: string; category?: string; search?: string; sort?: string; group?: string; rule?: string; pageType?: string };
  /** P1-4：上次审计对比产生的新增问题规则 ID（无对比数据时不传 → 不显示 New badge） */
  newRuleIds?: Set<string>;
  /** 审计域名：用于读取/写入该问题的处理状态（Action Center 闭环） */
  domain?: string;
  onNavigate: (params: Record<string, string>) => void;
}

const SEVERITIES: RuleSeverity[] = ["error", "warning", "notice"];
const CATEGORIES: RuleCategory[] = ["crawlability", "indexability", "onpage", "content", "links", "structured-data", "performance", "sitemap", "ai-search"];
const SORTS = ["priority", "affected", "findings", "impact"] as const;
const GROUPS = ["issue", "severity", "category"] as const;

export default function IssuesCenter({ snapshot, issue, filters, newRuleIds, domain, onNavigate }: IssuesCenterProps) {
  const t = useTranslations("dashboard.audit");
  const ta = useTranslations("dashboard.actions");
  const locale = useLocale() as "en" | "zh";
  // P1-7：Rule / PageType / Sort / Group 收进 Advanced filters（URL 状态不受影响；
  // 已有 advanced 筛选活动时默认展开，保证用户始终看得见当前生效条件）
  const [advancedOpen, setAdvancedOpen] = useState(!!(filters.rule || filters.pageType));

  // 待办清单：一次拉取该域名全部处理状态（复用现有 API），列表行直接显示状态徽标
  const [resolutions, setResolutions] = useState<Map<string, IssueResolution>>(new Map());
  useEffect(() => {
    if (!domain) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/audit/issues/status?domain=${encodeURIComponent(domain)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled || !res.ok) return;
        const rows = Array.isArray(json?.data?.resolutions) ? json.data.resolutions : [];
        const map = new Map<string, IssueResolution>();
        for (const r of rows) {
          if (r && typeof r.rule_id === "string") map.set(r.rule_id as string, r as IssueResolution);
        }
        setResolutions(map);
      } catch {
        // 状态读取失败不阻塞审计报告展示
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const failedRules = useMemo(
    () => snapshot.rules.filter((r) => r.status === "fail"),
    [snapshot]
  );

  // 「先做这一件事」：来自本次真实审计快照 + 既有优先级规则（唯一来源 issue-priority.ts），
  // 完整清单仍然全部保留在下方。无失败规则 → null，不伪造。
  const topSelection = useMemo(() => selectTopIssue(snapshot.rules), [snapshot]);

  const pageTypes = useMemo(() => {
    const set = new Set<string>();
    for (const p of snapshot.pages) if (p.pageType) set.add(p.pageType);
    return [...set].sort();
  }, [snapshot]);

  const selected = issue ? snapshot.rules.find((r) => r.ruleId === issue) ?? null : null;

  // ---- Issue Detail ----
  if (selected) {
    return (
      <IssueDetail
        snapshot={snapshot}
        rule={selected}
        domain={domain}
        isNew={newRuleIds?.has(selected.ruleId) ?? false}
        onBack={() => onNavigate({ view: "issues" })}
        onOpenPages={() => onNavigate({ view: "pages", issue: selected.ruleId })}
      />
    );
  }

  // ---- Filtered / sorted / grouped list ----
  const q = (filters.search ?? "").toLowerCase();

  const filtered = failedRules.filter((r) => {
    if (filters.severity && r.severity !== filters.severity) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.rule && r.ruleId !== filters.rule) return false;
    if (filters.pageType) {
      const urls = new Set(snapshot.findings.filter((f) => f.ruleId === r.ruleId).map((f) => f.url));
      const hasType = [...urls].some((u) => {
        const p = snapshot.pages.find((x) => x.url === u || x.finalUrl === u);
        return p?.pageType === filters.pageType;
      });
      if (!hasType) return false;
    }
    if (q && !textOf(r.name, locale).toLowerCase().includes(q) && !r.ruleId.toLowerCase().includes(q)) return false;
    return true;
  });

  // 实时结果计数：filtered findings / affected pages / rules（与筛选同步）
  const filteredRuleIds = new Set(filtered.map((r) => r.ruleId));
  const filteredFindings = snapshot.findings.filter((f) => filteredRuleIds.has(f.ruleId));
  const filteredPages = new Set(filteredFindings.map((f) => f.url)).size;
  const resultSummary = {
    findings: filteredFindings.length,
    pages: filteredPages,
    rules: filteredRuleIds.size,
  };

  const sorted = [...filtered].sort((a, b) => {
    switch (filters.sort ?? "priority") {
      case "affected":
        return b.affectedPages - a.affectedPages;
      case "findings":
        return b.findings - a.findings;
      case "impact":
        return b.scoreImpact - a.scoreImpact;
      default:
        return prioritySortKey(b) - prioritySortKey(a);
    }
  });

  const groupBy = (filters.group ?? "issue") as (typeof GROUPS)[number];

  const ruleRow = (r: RuleSnapshot) => {
    // P 级：与「先做这一件事」同一优先级唯一来源（不新造第二套排序）
    const pLevel = explainTechnicalPriority({
      severity: r.severity,
      affectedRatio: r.affectedRatio,
      scoreImpact: r.scoreImpact,
      pattern: r.pattern,
      pageLevel: r.pageLevel,
    }).priority.level;
    const resStatus = resolutions.get(r.ruleId)?.status;
    const evidence = textOf(r.sampleMessage, locale) || (r.sampleUrl ? r.sampleUrl.replace(/^https?:\/\//, "") : "");
    return (
    <button
      key={r.ruleId}
      onClick={() => onNavigate({ view: "issues", issue: r.ruleId })}
      className="flex w-full items-center gap-3 border-b border-line-soft px-3 py-2 text-left transition-colors hover:bg-line-soft/40"
    >
      <SeverityBadge severity={r.severity} label="" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`flex-none font-mono text-[0.625rem] font-semibold ${(LEVEL_BADGE[pLevel] ?? "badge-info")}`}>
            {pLevel}
          </span>
          <span className="truncate font-sans text-sm font-medium text-ink">
            {textOf(r.name, locale)}
          </span>
          {/* P1-4：仅状态提示，不改变 severity / score / priority */}
          {newRuleIds?.has(r.ruleId) ? <span className="badge-warn flex-none font-mono text-[0.625rem]">{t("newIssueBadge")}</span> : null}
        </div>
        {evidence ? (
          <div className="mt-0.5 truncate font-mono text-[0.6875rem] text-ink-40">
            {evidence}
          </div>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] text-ink-40">
          <span>{r.category}</span>
          <span>·</span>
          <span>{r.pageLevel === "site" ? t("levelSite") : t("levelPage")}</span>
          {r.pattern === "site-wide" ? (
            <span className="badge-warn">{t("patternSiteWide")}</span>
          ) : r.pattern === "repeated" ? (
            <span className="badge-info">{t("patternRepeated")}</span>
          ) : null}
          {r.scoreImpact > 0 ? (
            <>
              <span>·</span>
              <span className="text-neg">-{r.scoreImpact.toFixed(1)} {t("pointsUnit")}</span>
            </>
          ) : null}
          {/* 处理状态徽标：待办清单语义（检测结果 ≠ 处理状态） */}
          <span
            className={
              resStatus === "verified_resolved"
                ? "badge-pos"
                : resStatus === "fixed_claimed" || resStatus === "in_progress" || resStatus === "dismissed"
                  ? "badge-info"
                  : "badge-warn"
            }
          >
            {ta(`status.${resStatus ?? "open"}` as "status.open")}
          </span>
        </div>
      </div>
      <div className="hidden w-24 text-right sm:block">
        <div className="font-mono text-sm font-semibold text-ink">{fmtNum(r.affectedPages)}</div>
        <div className="font-mono text-[0.625rem] text-ink-40">{Math.round(r.affectedRatio * 100)}%</div>
      </div>
      <div className="hidden w-16 text-right md:block">
        <div className="font-mono text-sm font-semibold text-ink">{fmtNum(r.findings)}</div>
        <div className="font-mono text-[0.625rem] text-ink-40">{t("findingsTitle")}</div>
      </div>
      <span className="w-14 text-right font-mono text-xs text-ink-40">→</span>
    </button>
    );
  };

  const groups: Array<{ key: string; label: string; rules: RuleSnapshot[]; findings: number; pages: number }> = [];
  const groupCounts = (rs: RuleSnapshot[]) => {
    const ids = new Set(rs.map((r) => r.ruleId));
    const fs = snapshot.findings.filter((f) => ids.has(f.ruleId));
    return { findings: fs.length, pages: new Set(fs.map((f) => f.url)).size };
  };
  if (groupBy === "severity") {
    for (const s of SEVERITIES) {
      const g = sorted.filter((r) => r.severity === s);
      if (g.length) groups.push({ key: s, label: t(`sev${s === "error" ? "Error" : s === "warning" ? "Warning" : "Notice"}`), rules: g, ...groupCounts(g) });
    }
  } else if (groupBy === "category") {
    for (const c of CATEGORIES) {
      const g = sorted.filter((r) => r.category === c);
      if (g.length) groups.push({ key: c, label: c, rules: g, ...groupCounts(g) });
    }
  } else {
    groups.push({ key: "all", label: t("allIssues"), rules: sorted, ...groupCounts(sorted) });
  }

  const hasFilters = !!(filters.severity || filters.category || filters.search || filters.sort || filters.group || filters.rule || filters.pageType);

  return (
    <div className="space-y-4">
      {/* ===== 先做这一件事（来自本次真实审计 + 既有优先级规则；完整清单在下方保留） ===== */}
      {topSelection && !issue && (
        <TopActionCard
          selection={topSelection}
          onOpen={() => onNavigate({ view: "issues", issue: topSelection.rule.ruleId })}
        />
      )}

      <SectionCard
        title={t("issuesTitle")}
        subtitle={
          <span className="flex items-center gap-2">
            <span>
              {fmtNum(resultSummary.findings)} {t("findingsTitle")}
            </span>
            <span>·</span>
            <span>
              {fmtNum(resultSummary.pages)} {t("affectedPagesLabel")}
            </span>
            <span>·</span>
            <span>
              {fmtNum(resultSummary.rules)} {t("affectedRulesLabel")}
            </span>
            <Hint text={t("hintFindings")} />
          </span>
        }
        bodyClassName="mt-0"
      >
        {/* Filters — P1-7 分层：Primary（Severity/Category/Search）常驻，Rule/PageType/Sort/Group 收进 Advanced */}
        <div className="mb-4 border-b border-line-soft pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
              {t("filterSeverity")}
              <select
                value={filters.severity ?? ""}
                onChange={(e) => onNavigate({ view: "issues", severity: e.target.value })}
                className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
              >
                <option value="">{t("filterAll")}</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{t(`sev${s === "error" ? "Error" : s === "warning" ? "Warning" : "Notice"}`)}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
              {t("filterCategory")}
              <select
                value={filters.category ?? ""}
                onChange={(e) => onNavigate({ view: "issues", category: e.target.value })}
                className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
              >
                <option value="">{t("filterAll")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <input
              value={filters.search ?? ""}
              onChange={(e) => onNavigate({ view: "issues", search: e.target.value })}
              placeholder={t("searchIssues")}
              aria-label={t("searchIssues")}
              className="w-44 rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
            <button
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              className={`rounded-md border px-2 py-1.5 font-mono text-xs transition-colors ${advancedOpen || filters.rule || filters.pageType ? "border-brand/40 text-brand" : "border-line text-ink-60"} hover:border-ink-25 hover:text-ink`}
            >
              {advancedOpen ? "▾" : "▸"} {t("advancedFilters")}
              {filters.rule || filters.pageType ? <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 text-[0.625rem]">1+</span> : null}
            </button>
            {hasFilters ? (
              <button onClick={() => onNavigate({ view: "issues", severity: "", category: "", search: "", sort: "", group: "", rule: "", pageType: "", issue: "" })} className="rounded-md border border-line px-2 py-1.5 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink">
                ✕ {t("clearFilters")}
              </button>
            ) : null}
          </div>
          {advancedOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line-soft bg-line-soft/30 px-3 py-2">
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {t("filterRule")}
                <select
                  value={filters.rule ?? ""}
                  onChange={(e) => onNavigate({ view: "issues", rule: e.target.value })}
                  className="max-w-44 rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
                >
                  <option value="">{t("filterAll")}</option>
                  {failedRules.map((r) => (
                    <option key={r.ruleId} value={r.ruleId}>{r.ruleId}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {t("filterPageType")}
                <select
                  value={filters.pageType ?? ""}
                  onChange={(e) => onNavigate({ view: "issues", pageType: e.target.value })}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
                >
                  <option value="">{t("filterAll")}</option>
                  {pageTypes.map((pt) => (
                    <option key={pt} value={pt}>{pt}</option>
                  ))}
                </select>
              </label>
              <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {t("sortBy")}
                <select
                  value={filters.sort ?? "priority"}
                  onChange={(e) => onNavigate({ view: "issues", sort: e.target.value })}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
                >
                  {SORTS.map((s) => (
                    <option key={s} value={s}>{t(`sort.${s}`)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 font-mono text-xs text-ink-40">
                {t("groupBy")}
                <select
                  value={groupBy}
                  onChange={(e) => onNavigate({ view: "issues", group: e.target.value })}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink"
                >
                  {GROUPS.map((g) => (
                    <option key={g} value={g}>{t(`group.${g}`)}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {sorted.length === 0 ? (
          <EmptyBlock title={t("issuesEmptyTitle")} hint={t("issuesEmptyRun")} />
        ) : (
          <div className="overflow-x-auto">
            {/* 表头 */}
            <div className="flex items-center gap-3 border-b border-line px-3 pb-2 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">
              <span className="flex-1">{t("thCheck")}</span>
              <span className="hidden w-24 text-right sm:block">{t("thAffected")}</span>
              <span className="hidden w-16 text-right md:block">{t("thFindings")}</span>
              <span className="w-14 text-right">{t("thDetail")}</span>
            </div>
            {groups.map((g) => (
              <div key={g.key}>
                {groups.length > 1 && (
                  <div className="flex items-center gap-2 bg-line-soft/40 px-3 py-1.5 font-mono text-xs font-semibold text-ink-60">
                    {g.label}
                    <span className="text-ink-40">({g.rules.length})</span>
                    <span className="ml-auto font-mono text-[0.6875rem] font-normal text-ink-40">
                      {fmtNum(g.findings)} {t("findingsTitle")} · {fmtNum(g.pages)} {t("affectedPagesLabel")}
                    </span>
                  </div>
                )}
                {g.rules.map(ruleRow)}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ===== TopActionCard：「先做这一件事」 =====
// WHAT（发现了什么）/ WHY（为什么优先）/ EVIDENCE（真实爬取证据）/ ACTION（现在做什么）/ VERIFY（如何验证）。
// 只使用本次审计快照的真实数据与既有优先级规则；数据不足以区分时如实说明并列，不伪造。

const LEVEL_BADGE: Record<string, string> = {
  P0: "badge-err",
  P1: "badge-warn",
  P2: "badge-info",
};

function TopActionCard({
  selection,
  onOpen,
}: {
  selection: TopIssueSelection;
  onOpen: () => void;
}) {
  const t = useTranslations("dashboard.audit");
  const ta = useTranslations("dashboard.actions");
  const locale = useLocale() as "en" | "zh";
  const { rule, priority, tieCount, totalFailing } = selection;

  const whatLine =
    (rule.sampleMessage ? textOf(rule.sampleMessage, locale) : "") ||
    textOf(rule.description, locale);

  return (
    <section
      className="rounded-xl border border-line bg-card p-4 sm:p-5"
      aria-label={t("doFirstTitle")}
      data-testid="audit-top-action"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-err">{t("doFirstTitle")}</span>
        <span className={LEVEL_BADGE[priority.level] ?? "badge-info"}>{priority.level}</span>
        <span className="font-mono text-[0.6875rem] text-ink-40">
          {t("doFirstSub", { n: totalFailing })}
        </span>
      </div>

      {/* WHAT：具体发现了什么（规则名 + 本次爬取的真实发现） */}
      <div className="mt-2 font-display text-base font-semibold text-ink">
        {textOf(rule.name, locale)}
      </div>
      {whatLine && (
        <p className="mt-1 font-sans text-sm leading-relaxed text-ink-60">{whatLine}</p>
      )}

      {/* WHY：可解释的优先级理由（与 Action Center 同一套词表，来自真实检测数据） */}
      <div className="mt-3 font-mono text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-40">
        {t("whyNowTitle")}
      </div>
      <ul className="mt-1 list-disc pl-4">
        {priority.reasons.map((r, i) => (
          <li key={`${r.code}-${i}`} className="font-sans text-xs text-ink-60">
            {r.value !== undefined
              ? ta(`reason.${r.code}` as "reason.effort_low", { value: r.value })
              : ta(`reason.${r.code}` as "reason.effort_low")}
          </li>
        ))}
      </ul>
      {/* 数据不足以唯一区分时如实说明（不冒充精确答案） */}
      {tieCount > 1 && (
        <p className="mt-1.5 font-sans text-xs text-ink-40">{t("tieHint", { n: tieCount })}</p>
      )}

      {/* EVIDENCE：本次爬取的真实证据（数量/范围/位置），缺失侧如实显示 — */}
      <div className="mt-3 font-mono text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-40">
        {t("evidenceTitle")}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-60">
        <span>
          {fmtNum(rule.findings)} {t("findingsTitle")}
        </span>
        <span>·</span>
        <span>
          {fmtNum(rule.affectedPages)} {t("affectedPagesLabel")} ({Math.round(rule.affectedRatio * 100)}%)
        </span>
        {rule.scoreImpact > 0 ? (
          <>
            <span>·</span>
            <span className="text-neg">
              -{rule.scoreImpact.toFixed(1)} {t("pointsUnit")}
            </span>
          </>
        ) : null}
        {rule.pattern === "site-wide" ? <span className="badge-warn">{t("patternSiteWide")}</span> : null}
        {rule.pattern === "repeated" ? <span className="badge-info">{t("patternRepeated")}</span> : null}
        {rule.sampleUrl ? (
          <>
            <span>·</span>
            <a
              href={rule.sampleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-brand hover:underline"
            >
              {rule.sampleUrl.replace(/^https?:\/\//, "")}
            </a>
          </>
        ) : null}
      </div>

      {/* ACTION + VERIFY：现在能做什么，以及修完后 SeeO 如何用再审计验证 */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button onClick={onOpen} className="btn-primary px-3 py-1.5 text-xs">
          {t("topActionOpenCta")} →
        </button>
        <p className="min-w-0 font-sans text-xs text-ink-40 sm:max-w-[60%] sm:text-right">
          {t("verifyBodyTop")}
        </p>
      </div>
    </section>
  );
}

// ===== Issue Detail =====

/** 行动结构编号标题：①发现 ②为什么 ③如何修复 ④如何验证 */
function StepTitle({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-ink font-mono text-[0.6875rem] font-semibold text-white">
        {n}
      </span>
      <span>{label}</span>
    </span>
  );
}

function IssueDetail({
  snapshot,
  rule,
  domain,
  isNew,
  onBack,
  onOpenPages,
}: {
  snapshot: DashboardSnapshot;
  rule: RuleSnapshot;
  domain?: string;
  isNew: boolean;
  onBack: () => void;
  onOpenPages: () => void;
}) {
  const t = useTranslations("dashboard.audit");
  const ta = useTranslations("dashboard.actions");
  const locale = useLocale() as "en" | "zh";
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  // ---- 处理状态：检测结果 ≠ 处理状态；标记修复 ≠ 已验证解决 ----
  const [resolution, setResolution] = useState<IssueResolution | null>(null);
  const [resBusy, setResBusy] = useState(false);
  const [resError, setResError] = useState<string | null>(null);

  useEffect(() => {
    // 无域名（如未传入 domain）时保持初始 null —— 不在 effect 体内同步 setState
    if (!domain) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/audit/issues/status?domain=${encodeURIComponent(domain)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled || !res.ok) return;
        const rows = Array.isArray(json?.data?.resolutions) ? json.data.resolutions : [];
        const found = rows.find((r: { rule_id?: string }) => r.rule_id === rule.ruleId) ?? null;
        setResolution(found as IssueResolution | null);
      } catch {
        // 状态读取失败不阻塞审计报告展示
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, rule.ruleId]);

  async function setResolutionStatus(to: IssueResolution["status"]) {
    if (!domain) return;
    setResBusy(true);
    setResError(null);
    try {
      const res = await fetch("/api/audit/issues/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, rule_id: rule.ruleId, status: to }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setResError(typeof json?.error === "string" ? json.error : ta("act.saveFailed"));
        return;
      }
      setResolution((prev) => ({
        rule_id: rule.ruleId,
        status: to,
        verified_at: prev?.verified_at ?? null,
        verified_audit_id: prev?.verified_audit_id ?? null,
        verify_status: prev?.verify_status ?? null,
        verify_detail: prev?.verify_detail ?? null,
      }));
    } catch {
      setResError(ta("act.saveFailed"));
    } finally {
      setResBusy(false);
    }
  }

  const affected = useMemo(() => snapshot.findings.filter((f) => f.ruleId === rule.ruleId), [snapshot, rule]);
  const priority = priorityOf(rule);
  // WHY：与「先做这一件事」/ Action Center 同一份优先级算法的可解释理由（不新造第二套）
  const whyNow = useMemo(
    () =>
      explainTechnicalPriority({
        severity: rule.severity,
        affectedRatio: rule.affectedRatio,
        scoreImpact: rule.scoreImpact,
        pattern: rule.pattern,
        pageLevel: rule.pageLevel,
      }).priority,
    [rule]
  );

  // Pattern：由后端多信号判定（site-wide / repeated / null=scattered）
  const isSiteWide = rule.pattern === "site-wide";
  const isRepeated = rule.pattern === "repeated";
  const patternLabel = isSiteWide ? t("patternSiteWide") : isRepeated ? t("patternRepeated") : t("patternScattered");
  const patternHint = isSiteWide
    ? t("patternSiteWideHint", { n: rule.findings })
    : isRepeated
      ? t("patternRepeatedHint", { n: rule.findings })
      : t("patternScatteredHint");

  // 规则级修复指导：仅对有把握的规则提供分步步骤；无指导时回退规则建议并如实说明
  const guidance = useMemo(() => getFixGuidance(rule.ruleId), [rule.ruleId]);

  // URL → 页面快照（Affected URLs 展示 status/type/depth/response）
  const pageByUrl = useMemo(() => {
    const m = new Map<string, (typeof snapshot.pages)[number]>();
    for (const p of snapshot.pages) {
      m.set(p.url, p);
      m.set(p.finalUrl, p);
    }
    return m;
  }, [snapshot]);

  const sampleMetrics = rule.sampleMetrics;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline">
        ← {t("backToIssues")}
      </button>

      {/* Issue Header */}
      <SectionCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            {textOf(rule.name, locale)}
            <SeverityBadge severity={rule.severity} label={t(`sev${rule.severity === "error" ? "Error" : rule.severity === "warning" ? "Warning" : "Notice"}`)} />
            {isNew ? <span className="badge-warn font-mono text-[0.625rem]">{t("newIssueBadge")}</span> : null}
            <span className="badge-info">{rule.category}</span>
            <span className="badge-info">{t(`priority.${priority}`)}</span>
          </span>
        }
        subtitle={
          <span className="font-mono text-xs text-ink-40">
            {rule.ruleId} · {rule.pageLevel === "site" ? t("levelSite") : t("levelPage")}
            {rule.scoreImpact > 0 ? ` · ${t("scoreImpactLabel")}: -${rule.scoreImpact.toFixed(1)}` : ""}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("thAffected")}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-ink">{fmtNum(rule.affectedPages)}</div>
            <div className="font-mono text-[0.6875rem] text-ink-40">{Math.round(rule.affectedRatio * 100)}% · {t("ofIndexable", { n: snapshot.indexablePages })}</div>
          </div>
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("thFindings")}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-ink">{fmtNum(rule.findings)}</div>
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("findingsTitle")}</div>
          </div>
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("scoreImpactLabel")}</div>
            <div className={`mt-1 font-mono text-2xl font-semibold ${rule.scoreImpact > 0 ? "text-neg" : "text-ink"}`}>
              {rule.scoreImpact > 0 ? `-${rule.scoreImpact.toFixed(1)}` : "0"}
            </div>
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("pointsUnit")}</div>
          </div>
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="font-mono text-[0.6875rem] text-ink-40">{t("patternTitle")}</div>
            <div className={`mt-1 font-mono text-2xl font-semibold ${isSiteWide ? "text-warn" : "text-ink"}`}>{patternLabel}</div>
            <div className="font-mono text-[0.6875rem] text-ink-40">{patternHint}</div>
          </div>
        </div>
      </SectionCard>

      {/* 处理状态（检测结果 ≠ 处理状态；verified_resolved 只能由再审计产出） */}
      {domain && (
        <SectionCard
          title={ta("title")}
          subtitle={ta(`status.${resolution?.status ?? "open"}_hint` as "status.open_hint")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                resolution?.status === "verified_resolved"
                  ? "badge-pos"
                  : resolution?.status === "fixed_claimed"
                    ? "badge-info"
                    : resolution?.status === "in_progress"
                      ? "badge-info"
                      : resolution?.status === "dismissed"
                        ? "badge-info"
                        : "badge-warn"
              }
            >
              {ta(`status.${resolution?.status ?? "open"}` as "status.open")}
            </span>
            {resolution?.verify_status === "pass" && resolution.verified_audit_id !== null && (
              <span className="badge-pos">{ta("verification.pass", { auditId: resolution.verified_audit_id })}</span>
            )}
            {resolution?.verify_status === "fail" && resolution.verified_audit_id !== null && (() => {
              const v = parseVerifyDetail(resolution);
              return (
                <span className="badge-err">{ta("verification.fail", { auditId: resolution.verified_audit_id, findings: v?.findings ?? 0, pages: v?.pages ?? 0 })}</span>
              );
            })()}
            {resolution?.verify_status === "inconclusive" && resolution.verified_audit_id !== null && (
              <span className="badge-info">{ta("verification.inconclusive", { auditId: resolution.verified_audit_id })}</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={resBusy || (resolution?.status ?? "open") === "in_progress"}
              onClick={() => void setResolutionStatus("in_progress")}
              className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {ta("act.markInProgress")}
            </button>
            <button
              disabled={resBusy || (resolution?.status ?? "open") === "fixed_claimed"}
              onClick={() => void setResolutionStatus("fixed_claimed")}
              className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {ta("act.markFixed")}
            </button>
            <button
              disabled={resBusy || (resolution?.status ?? "open") === "dismissed"}
              onClick={() => void setResolutionStatus("dismissed")}
              className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {ta("act.dismiss")}
            </button>
            {(resolution?.status ?? "open") !== "open" && (
              <button
                disabled={resBusy}
                onClick={() => void setResolutionStatus("open")}
                className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {ta("act.reopen")}
              </button>
            )}
          </div>

          {(resolution?.status === "fixed_claimed" || !resolution) && (
            <p className="mt-2 font-sans text-xs text-ink-40">{ta("verification.pending")}</p>
          )}
          <div className="mt-2">
            <Link href="/app/actions" className="font-mono text-xs text-brand hover:underline">
              {ta("panel.cta")} →
            </Link>
          </div>
          {resError && <p className="mt-2 font-sans text-xs text-neg">{resError}</p>}
        </SectionCard>
      )}

      {/* WHY（优先级理由）：来自本次真实检测数据（范围/分数影响/修复杠杆），不含虚构流量损失 */}
      <SectionCard title={t("whyNowTitle")} subtitle={t("whyNowSub")}>
        <ul className="list-disc pl-4">
          {whyNow.reasons.map((r, i) => (
            <li key={`${r.code}-${i}`} className="font-sans text-sm text-ink-60">
              {r.value !== undefined
                ? ta(`reason.${r.code}` as "reason.effort_low", { value: r.value })
                : ta(`reason.${r.code}` as "reason.effort_low")}
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* 行动结构 ①发现 ②为什么 ③如何修复 ④如何验证：新手按序执行 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title={<StepTitle n={1} label={t("whatFound")} />}
          subtitle={t("whatFoundSub")}
        >
          <p className="font-sans text-sm leading-relaxed text-ink-60">
            {affected.length > 0 ? textOf(affected[0].message, locale) : "—"}
          </p>
          {sampleMetrics && Object.keys(sampleMetrics).length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(sampleMetrics).map(([k, v]) => (
                <span key={k} className="badge-info font-mono">
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          ) : null}
          {rule.sampleUrl ? (
            <a
              href={rule.sampleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block truncate font-mono text-xs text-brand hover:underline"
            >
              {rule.sampleUrl.replace(/^https?:\/\//, "")}
            </a>
          ) : null}
        </SectionCard>
        <SectionCard
          title={<StepTitle n={2} label={t("whyMatters")} />}
          subtitle={t("whyMattersSub")}
        >
          <p className="font-sans text-sm leading-relaxed text-ink-60">{textOf(rule.description, locale)}</p>
          {/* 影响范围：多少页 / 全站还是特定页，来自真实检测数据 */}
          <p className="mt-3 font-sans text-sm leading-relaxed text-ink-60">
            {t("affectedScopeLine", {
              pages: fmtNum(rule.affectedPages),
              percent: Math.round(rule.affectedRatio * 100),
              scope: rule.pageLevel === "site" ? t("levelSite") : t("levelPage"),
            })}
          </p>
        </SectionCard>
      </div>

      {/* ③ 如何修复：规则建议（唯一来源）+ 规则级分步指导（有把握才给）+ 诚实边界 */}
      <SectionCard
        title={<StepTitle n={3} label={t("howToFix")} />}
        subtitle={t("howToFixSub")}
      >
        <p className="font-sans text-sm font-medium leading-relaxed text-ink">
          {textOf(rule.recommendation, locale)}
        </p>

        {guidance ? (
          <>
            <div className="mt-4">
              <div className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-40">
                {t("howFixWhere")}
              </div>
              <p className="mt-1 font-sans text-sm leading-relaxed text-ink-60">
                {textOf(guidance.where, locale)}
              </p>
            </div>

            <div className="mt-4">
              <div className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-40">
                {t("howFixSteps")}
              </div>
              <ol className="mt-2 space-y-3">
                {guidance.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-ink font-mono text-[0.6875rem] font-semibold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-sans text-sm font-medium text-ink">
                        {textOf(step.title, locale)}
                      </div>
                      <div className="mt-0.5 font-sans text-sm leading-relaxed text-ink-60">
                        {textOf(step.detail, locale)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-4">
              <div className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-40">
                {t("howFixCheckAfter")}
              </div>
              <p className="mt-1 flex items-start gap-2 font-sans text-sm leading-relaxed text-ink-60">
                <span aria-hidden className="mt-0.5 text-pos">✓</span>
                {textOf(guidance.checkAfter, locale)}
              </p>
            </div>

            {guidance.notKnown ? (
              <div className="mt-4 rounded-lg border border-line-soft bg-line-soft/30 px-3 py-2">
                <div className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-40">
                  {t("howFixNotKnown")}
                </div>
                <p className="mt-1 font-sans text-sm leading-relaxed text-ink-40">
                  {textOf(guidance.notKnown, locale)}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-3 font-sans text-sm leading-relaxed text-ink-40">
            {t("howFixGeneric")}
          </p>
        )}
      </SectionCard>

      {/* ④ 如何验证：现有再审计机制的真实语义；有规则级说明时追加（SeeO 检查什么、依据什么判定） */}
      <SectionCard
        title={<StepTitle n={4} label={t("verifyTitle")} />}
        subtitle={t("verifySub")}
      >
        <p className="font-sans text-sm leading-relaxed text-ink-60">{t("verifyBody")}</p>
        {guidance ? (
          <p className="mt-2 flex items-start gap-2 font-sans text-sm leading-relaxed text-ink-60">
            <span aria-hidden className="mt-0.5 text-brand">◉</span>
            <span>
              <span className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-40">
                {t("howFixVerifyNote")}：
              </span>
              {textOf(guidance.verifyNote, locale)}
            </span>
          </p>
        ) : null}
        {resolution?.verify_status === "pass" && (
          <p className="mt-2 font-sans text-xs text-pos">{t("verifyStatePass")}</p>
        )}
        {resolution?.verify_status === "fail" && (
          <p className="mt-2 font-sans text-xs text-neg">{t("verifyStateFail")}</p>
        )}
        {resolution?.verify_status === "inconclusive" && (
          <p className="mt-2 font-sans text-xs text-ink-60">{t("verifyStateInconclusive")}</p>
        )}
      </SectionCard>

      {/* Affected URLs */}
      <SectionCard
        title={t("affectedUrlsTitle", { n: affected.length })}
        subtitle={t("affectedUrlsSub")}
        right={
          <button onClick={onOpenPages} className="font-mono text-xs text-brand hover:underline">
            {t("viewCrawledPages")} →
          </button>
        }
        bodyClassName="mt-0"
      >
        {affected.length === 0 ? (
          <EmptyBlock title={t("issuesEmptyTitle")} />
        ) : (
          <div className="max-h-96 overflow-auto">
            {affected.map((f, i) => {
              const pg = pageByUrl.get(f.url);
              return (
                <div key={`${f.url}-${i}`}>
                  <button
                    onClick={() => setExpandedUrl(expandedUrl === f.url ? null : f.url)}
                    className="flex w-full items-center gap-3 border-b border-line-soft px-3 py-2 text-left transition-colors hover:bg-line-soft/40"
                  >
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[f.severity] }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.url.replace(/^https?:\/\//, "")}</span>
                    <span className="hidden shrink-0 font-mono text-[0.6875rem] text-ink-40 lg:block">
                      {pg ? `${pg.status} · ${pg.pageType ?? "—"} · D${pg.depth} · ${pg.responseTimeMs}ms` : ""}
                    </span>
                    <span className="hidden max-w-[35%] truncate font-sans text-xs text-ink-40 xl:block">{textOf(f.message, locale)}</span>
                    <span className="font-mono text-xs text-ink-40">{expandedUrl === f.url ? "▾" : "▸"}</span>
                  </button>
                  {expandedUrl === f.url && (
                    <div className="border-b border-line-soft bg-[#FBFAF4] px-4 py-3">
                      <div className="space-y-1 font-mono text-xs">
                        <div className="break-all text-ink">{f.url}</div>
                        <div className="font-sans text-sm text-ink-60">{textOf(f.message, locale)}</div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {pg ? (
                            <>
                              <span className="badge-info">{t("thStatus")}: {pg.status}</span>
                              <span className="badge-info">{t("thPageType")}: {pg.pageType ?? "—"}</span>
                              <span className="badge-info">{t("thDepth")}: {pg.depth}</span>
                              <span className="badge-info">{t("thResponse")}: {pg.responseTimeMs}ms</span>
                              {pg.title ? <span className="badge-info truncate max-w-56" title={pg.title}>{t("titleLabel")}: {pg.title}</span> : null}
                            </>
                          ) : null}
                          {f.metrics && Object.keys(f.metrics).length > 0
                            ? Object.entries(f.metrics).map(([k, v]) => (
                                <span key={k} className="badge-info">{k}: {String(v)}</span>
                              ))
                            : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
