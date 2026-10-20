"use client";

// ===== Site Audit 专业分析子视图 =====
// Internal Linking / Structured Data / AI Search / Content / HTTP Status / Crawler Stats
// 全部来自 DashboardSnapshot，无额外请求。

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from "recharts";
import type { DashboardSnapshot, StructuredDataStatus, PageHealth, LocalizedText } from "@/lib/seo/audit-dashboard";
import { SectionCard, SegmentedBar, LegendRow, EmptyBlock, Hint, HealthBadge, fmtNum, type Segment } from "./ui";
import MetricCard from "@/components/viz/MetricCard";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import { CHART_TOOLTIP_STYLE, CHART_TOOLTIP_ITEM_STYLE, CHART_TICK_STYLE, COMMON_GRID_PROPS, COMMON_YAXIS_PROPS } from "@/components/dashboard/chart-theme";

// ===== Internal Linking =====
//
// 数据范围（必须如实告知用户）：
//   爬虫只持久化**页面级计数**（每页出链数 internalLinks / 入链数 inLinks / 深度），
//   以及规则级检出（zero-internal-links / broken-links / orphan-pages / links-to-redirects / deep-pages）。
//   **不保存逐条链接关系（来源页面 → 目标 URL）与锚文本**，因此本页展示的是聚合分布与页面级链接指标，
//   不是完整站点链接图谱；缺失的口径一律显示为 —，不推算、不编造。

const LINKING_RULE_IDS = [
  "zero-internal-links",
  "broken-links",
  "redirected-urls",
  "links-to-redirects",
  "orphan-pages",
  "deep-pages",
] as const;

type LinkSortKey = "inLinks" | "outLinks" | "depth";
type LinkRow = {
  url: string;
  inLinks: number | null;
  outLinks: number | null;
  externalLinks: number | null;
  depth: number;
  pageType: string | null;
  health: PageHealth;
  issues: Array<{ ruleId: string; severity: string; message: LocalizedText }>;
};

export function LinkingSection({
  snapshot,
  onOpenPages,
  onOpenIssue,
}: {
  snapshot: DashboardSnapshot;
  onOpenPages: (params: Record<string, string>) => void;
  onOpenIssue: (ruleId: string) => void;
}) {
  const t = useTranslations("dashboard.audit");
  const [bucket, setBucket] = useState<"all" | "noIn" | "noOut" | "deep" | "redirectLinks">("all");
  const [sortKey, setSortKey] = useState<LinkSortKey>("inLinks");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ---- 真实派生（全部来自本次审计快照的页面级计数与规则检出） ----
  const derived = useMemo(() => {
    const pages = snapshot.pages;
    const outVals = pages.map((p) => p.internalLinks ?? 0);
    const inVals = pages.map((p) => p.inLinks ?? 0);
    const extVals = pages.map((p) => p.externalLinks).filter((v): v is number => v !== null);
    const linkingFindings = snapshot.findings.filter((f) =>
      (LINKING_RULE_IDS as readonly string[]).includes(f.ruleId)
    );
    const findingsByUrl = new Map<string, LinkRow["issues"]>();
    for (const f of linkingFindings) {
      const arr = findingsByUrl.get(f.url) ?? [];
      arr.push({ ruleId: f.ruleId, severity: f.severity, message: f.message });
      findingsByUrl.set(f.url, arr);
    }
    const rows: LinkRow[] = pages.map((p) => ({
      url: p.finalUrl,
      inLinks: p.inLinks,
      outLinks: p.internalLinks,
      externalLinks: p.externalLinks,
      depth: p.depth,
      pageType: p.pageType,
      health: p.health,
      issues: findingsByUrl.get(p.url) ?? findingsByUrl.get(p.finalUrl) ?? [],
    }));
    return {
      rows,
      pages: pages.length,
      outSum: outVals.reduce((a, b) => a + b, 0),
      withOut: outVals.filter((v) => v > 0).length,
      noIn: inVals.filter((v) => v === 0).length,
      noOut: outVals.filter((v) => v === 0).length,
      deep: pages.filter((p) => p.depth > 3).length,
      avgExternal: extVals.length > 0 ? Math.round((extVals.reduce((a, b) => a + b, 0) / extVals.length) * 10) / 10 : null,
      broken: linkingFindings.filter((f) => f.ruleId === "broken-links").length,
      toRedirects: linkingFindings.filter((f) => f.ruleId === "links-to-redirects").length,
      buckets: [
        { key: "none", label: t("lkBucketNone"), value: inVals.filter((v) => v === 0).length, color: "#F59E0B" },
        { key: "low", label: t("lkBucketLow"), value: inVals.filter((v) => v >= 1 && v <= 2).length, color: "#9CA3AF" },
        { key: "mid", label: t("lkBucketMid"), value: inVals.filter((v) => v >= 3 && v <= 5).length, color: "#9CA3AF" },
        { key: "high", label: t("lkBucketHigh"), value: inVals.filter((v) => v >= 6).length, color: "#9CA3AF" },
      ],
    };
  }, [snapshot, t]);

  const depthSegments: Segment[] = [
    { label: "D0", value: snapshot.linking.depthDistribution["0"] ?? 0, color: "#22C55E" },
    { label: "D1", value: snapshot.linking.depthDistribution["1"] ?? 0, color: "#2563EB" },
    { label: "D2", value: snapshot.linking.depthDistribution["2"] ?? 0, color: "#F59E0B" },
    { label: "D3", value: snapshot.linking.depthDistribution["3"] ?? 0, color: "#8B5CF6" },
    { label: "D4+", value: snapshot.linking.depthDistribution["4+"] ?? 0, color: "#EF4444" },
  ];

  const filteredRows = useMemo(() => {
    const rows = derived.rows.filter((r) => {
      if (bucket === "noIn") return (r.inLinks ?? 0) === 0;
      if (bucket === "noOut") return (r.outLinks ?? 0) === 0;
      if (bucket === "deep") return r.depth > 3;
      if (bucket === "redirectLinks") return r.issues.some((i) => i.ruleId === "links-to-redirects");
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = sortKey === "depth" ? a.depth : sortKey === "inLinks" ? a.inLinks ?? -1 : a.outLinks ?? -1;
      const bv = sortKey === "depth" ? b.depth : sortKey === "inLinks" ? b.inLinks ?? -1 : b.outLinks ?? -1;      return (av - bv) * dir;
    });
    return rows;
  }, [derived, bucket, sortKey, sortDir]);

  const toggleSort = (key: LinkSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const sortMark = (key: LinkSortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  const filters: Array<{ key: typeof bucket; label: string; value: number }> = [
    { key: "all", label: t("lkFilterAll", { n: derived.pages }), value: derived.pages },
    { key: "noIn", label: t("lkFilterNoIn", { n: derived.noIn }), value: derived.noIn },
    { key: "noOut", label: t("lkFilterNoOut", { n: derived.noOut }), value: derived.noOut },
    { key: "deep", label: t("lkFilterDeep", { n: derived.deep }), value: derived.deep },
    { key: "redirectLinks", label: t("lkFilterRedirectLinks", { n: derived.toRedirects }), value: derived.toRedirects },
  ];

  const bucketsTotal = derived.buckets.reduce((a, b) => a + b.value, 0);

  return (
    <div className="space-y-4">
      {/* ===== 顶部摘要（真实可算的四项） ===== */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t("lkPages")}
          value={fmtNum(derived.pages)}
          caption={t("lkPagesCaption", { requests: fmtNum(snapshot.pagesCrawled) })}
          hint={t("lkPagesHint")}
          hintStyle="plain"
        />
        <MetricCard
          label={t("lkTotalLinks")}
          value={fmtNum(derived.outSum)}
          caption={t("lkTotalLinksCaption", { avg: snapshot.linking.avgInternalLinks })}
          hint={t("lkTotalLinksHint")}
          hintStyle="plain"
        />
        <MetricCard
          label={t("lkPagesWithLinks")}
          value={fmtNum(derived.withOut)}
          caption={t("lkPagesWithLinksCaption", { total: fmtNum(derived.pages), none: fmtNum(derived.noOut) })}
          hint={t("lkPagesWithLinksHint")}
          hintStyle="plain"
          tone={derived.withOut === derived.pages ? "pos" : undefined}
        />
        <MetricCard
          label={t("lkAbnormal")}
          value={fmtNum(derived.toRedirects + derived.broken)}
          caption={t("lkAbnormalCaption", { redirects: fmtNum(derived.toRedirects), broken: fmtNum(derived.broken) })}
          hint={t("lkAbnormalHint")}
          hintStyle="plain"
          tone={derived.toRedirects + derived.broken > 0 ? "warn" : undefined}
        />
      </div>

      {/* ===== 分布：入链数分布 + 抓取深度分布 ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-7"
          title={t("lkInLinksDist")}
          subtitle={t("lkInLinksDistSub", { pages: fmtNum(derived.pages) })}
        >
          {bucketsTotal === 0 ? (
            <EmptyBlock title={t("notEnoughData")} hint={t("lkScopeNote")} />
          ) : (
            <>
              <div className="space-y-2">
                {derived.buckets.map((b) => (
                  <button
                    key={b.key}
                    onClick={() => setBucket(b.key === "none" ? "noIn" : "all")}
                    className="flex w-full items-center gap-3 text-left"
                    aria-label={`${b.label}: ${b.value}`}
                  >
                    <span className="w-16 shrink-0 font-mono text-xs text-ink-40">{b.label}</span>
                    <span className="relative h-3 flex-1 overflow-hidden rounded-sm bg-line-soft">
                      <span
                        className="absolute inset-y-0 left-0"
                        style={{ width: `${bucketsTotal > 0 ? (b.value / bucketsTotal) * 100 : 0}%`, backgroundColor: b.color }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-xs text-ink">
                      {fmtNum(b.value)}
                      <span className="text-ink-40"> ({bucketsTotal > 0 ? Math.round((b.value / bucketsTotal) * 100) : 0}%)</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 border-t border-line-soft pt-2 font-sans text-xs text-ink-40">{t("lkLegendNote")}</p>
            </>
          )}
        </SectionCard>

        <SectionCard
          className="lg:col-span-5"
          title={t("depthDist")}
          subtitle={t("depthDistSub")}
        >
          <SegmentedBar segments={depthSegments} height={12} />
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {depthSegments.map((s) => (
              <button
                key={s.label}
                onClick={() => onOpenPages({ depth: s.label === "D4+" ? "4+" : s.label.replace("D", "") })}
                className="rounded-md border border-line bg-card px-1 py-1.5 text-center transition-colors hover:border-ink-25"
                aria-label={`${s.label}: ${s.value}`}
              >
                <div className="font-mono text-sm font-semibold" style={{ color: s.color }}>{fmtNum(s.value)}</div>
                <div className="font-mono text-[0.625rem] text-ink-40">{s.label}</div>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ===== 页面级内链数据表 ===== */}
      <SectionCard title={t("lkTableTitle")} subtitle={t("lkTableSub")} bodyClassName="mt-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-sans text-xs text-ink-40">{t("lkFilterLabel")}</span>
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setBucket(f.key)}
              className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                bucket === f.key ? "border-brand bg-brand/5 text-ink" : "border-line bg-card text-ink-60 hover:border-ink-25"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-xs text-ink-40">
            {t("pagesUnit", { n: filteredRows.length })}
          </span>
        </div>

        {derived.pages === 0 ? (
          <EmptyBlock title={t("notEnoughData")} hint={t("lkScopeNote")} />
        ) : filteredRows.length === 0 ? (
          <EmptyBlock title={t("lkNoMatch")} hint={t("clearFiltersHint")} />
        ) : (
          <DataTable minWidthRem={0} ariaLabel={t("lkTableTitle")}>
            <THead>
              <Th>{t("thUrl")}</Th>
              <Th align="right" width="6.5rem">
                <button onClick={() => toggleSort("outLinks")} className="whitespace-nowrap hover:text-ink">{t("thOutLinks")}{sortMark("outLinks")}</button>
              </Th>
              <Th align="right" width="6.5rem">
                <button onClick={() => toggleSort("inLinks")} className="whitespace-nowrap hover:text-ink">{t("thInLinks")}{sortMark("inLinks")}</button>
              </Th>
              <Th align="right" width="5.5rem">
                <button onClick={() => toggleSort("depth")} className="whitespace-nowrap hover:text-ink">{t("thDepth")}{sortMark("depth")}</button>
              </Th>
              <Th className="hidden lg:table-cell" width="8rem">{t("thPageType")}</Th>
              <Th className="hidden md:table-cell" width="9rem">{t("thHealth")}</Th>
              <Th className="hidden md:table-cell">{t("thLinkingIssues")}</Th>
              <Th align="right" width="11rem">{t("thDetail")}</Th>
            </THead>
            <TBody>
              {filteredRows.map((r) => {
                const healthLabel = t(`health${r.health === "healthy" ? "Healthy" : r.health === "needs-attention" ? "NeedsAttention" : r.health === "critical" ? "Critical" : r.health === "redirect" ? "Redirect" : "Blocked"}`);
                const searchKey = r.url.replace(/^https?:\/\//, "");
                return (
                  <TR key={r.url}>
                    <TD>
                      <span className="block max-w-[280px] truncate font-mono text-xs text-ink" title={r.url}>{searchKey}</span>
                    </TD>
                    <TD align="right" numeric>
                      <span className={`font-mono text-sm ${r.outLinks === 0 ? "text-warn" : "text-ink"}`}>{r.outLinks ?? "—"}</span>
                    </TD>
                    <TD align="right" numeric>
                      <span className={`font-mono text-sm ${r.inLinks === 0 ? "text-warn" : "text-ink"}`}>{r.inLinks ?? "—"}</span>
                    </TD>
                    <TD align="right" numeric>
                      <span className="text-ink-60">{r.depth}</span>
                    </TD>
                    <TD className="hidden lg:table-cell">
                      <span className="font-mono text-xs text-ink-60">{r.pageType ?? "—"}</span>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <HealthBadge health={r.health} label={healthLabel} />
                    </TD>
                    <TD className="hidden md:table-cell">
                      {r.issues.length === 0 ? (
                        <span className="font-sans text-xs text-ink-40">{t("lkNoIssues")}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          {Array.from(new Set(r.issues.map((i) => i.ruleId))).map((ruleId) => (
                            <button
                              key={ruleId}
                              onClick={() => onOpenIssue(ruleId)}
                              className="badge-info whitespace-nowrap font-mono text-xs transition-colors hover:border-ink-25"
                            >
                              {ruleId}
                            </button>
                          ))}
                        </span>
                      )}
                    </TD>
                    <TD align="right">
                      <button
                        onClick={() => onOpenPages({ search: searchKey })}
                        className="whitespace-nowrap font-mono text-xs text-brand hover:underline"
                      >
                        {t("lkOpenCrawl")} →
                      </button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </DataTable>
        )}

        {/* 数据范围声明：不把部分抓取结果包装成完整链接图谱 */}
        <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">
          {t("lkScopeNote")}
        </p>
        <p className="mt-1 font-mono text-xs text-ink-40">
          {t("lkExtraStats", {
            inSum: fmtNum(derived.rows.reduce((a, r) => a + (r.inLinks ?? 0), 0)),
            orphans: fmtNum(snapshot.linking.orphans),
            avgExternal: derived.avgExternal === null ? "—" : String(derived.avgExternal),
            externalHint: t("hintExternalLinks"),
          })}
        </p>
      </SectionCard>
    </div>
  );
}

// ===== Structured Data =====
//
// 数据范围（必须如实告知用户）：
//   爬虫按页面持久化 JSON-LD 检出状态（valid / potential-issue / invalid / malformed / none）
//   与检出的 Schema 类型名。**不保存单个 JSON-LD 对象的逐字段明细**，
//   因此本页展示页面级状态与类型分布；字段级校验细节通过规则检出（findings）深链查看。

const SD_COLORS: Record<StructuredDataStatus, string> = {
  valid: "#15803D",
  "potential-issue": "#B45309",
  invalid: "#B91C1C",
  malformed: "#B91C1C",
  none: "#9CA3AF",
};

/** 结构化数据类规则（真实存在的 4 条 page 级规则，见 audit-checks.ts） */
const SD_RULE_IDS = ["no-structured-data", "invalid-structured-data", "incomplete-structured-data", "duplicate-structured-data"] as const;

type SdSortKey = "url" | "types";

export function StructuredDataSection({
  snapshot,
  onOpenPages,
  onOpenIssue,
}: {
  snapshot: DashboardSnapshot;
  onOpenPages: (params: Record<string, string>) => void;
  onOpenIssue: (ruleId: string) => void;
}) {
  const t = useTranslations("dashboard.audit");
  const [statusFilter, setStatusFilter] = useState<StructuredDataStatus | "unrecorded" | "">("");
  const [sortKey, setSortKey] = useState<SdSortKey>("types");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const derived = useMemo(() => {
    const pages = snapshot.pages;
    const sd = snapshot.structuredData;
    const typeEntries = Object.entries(sd.schemaTypes).sort((a, b) => b[1] - a[1]);
    const findings = snapshot.findings.filter((f) => (SD_RULE_IDS as readonly string[]).includes(f.ruleId));
    const findingsByUrl = new Map<string, Array<{ ruleId: string; severity: string }>>();
    for (const f of findings) {
      const arr = findingsByUrl.get(f.url) ?? [];
      arr.push({ ruleId: f.ruleId, severity: f.severity });
      findingsByUrl.set(f.url, arr);
    }
    const ruleCounts: Record<string, number> = {};
    for (const f of findings) ruleCounts[f.ruleId] = (ruleCounts[f.ruleId] ?? 0) + 1;
    const rows = pages.map((p) => ({
      url: p.finalUrl,
      types: p.structuredDataTypes,
      status: p.structuredDataStatus,
      issues: findingsByUrl.get(p.url) ?? findingsByUrl.get(p.finalUrl) ?? [],
    }));
    return {
      rows,
      total: pages.length,
      withSD: sd.pagesWithSD,
      typeEntries,
      typeCount: typeEntries.length,
      valid: sd.statusCounts.valid ?? 0,
      potential: sd.statusCounts["potential-issue"] ?? 0,
      invalid: (sd.statusCounts.invalid ?? 0) + (sd.statusCounts.malformed ?? 0),
      none: sd.statusCounts.none ?? 0,
      unrecorded: rows.filter((r) => r.status === null).length,
      ruleCounts,
      findings,
    };
  }, [snapshot]);

  const statusCounts: Array<{ key: StructuredDataStatus | "unrecorded"; value: number }> = [
    { key: "valid", value: derived.valid },
    { key: "potential-issue", value: derived.potential },
    { key: "invalid", value: derived.invalid },
    { key: "none", value: derived.none },
    { key: "unrecorded", value: derived.unrecorded },
  ];
  const statusTotal = statusCounts.reduce((a, s) => a + s.value, 0);

  const filteredRows = useMemo(() => {
    const rows = derived.rows.filter((r) => {
      if (!statusFilter) return true;
      if (statusFilter === "unrecorded") return r.status === null;
      return r.status === statusFilter;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === "url") return a.url.localeCompare(b.url) * dir;
      return (a.types.length - b.types.length) * dir;
    });
    return rows;
  }, [derived, statusFilter, sortKey, sortDir]);

  const toggleSort = (key: SdSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "url" ? "asc" : "desc");
    }
  };
  const sortMark = (key: SdSortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  const statusLabel = (s: StructuredDataStatus | null): string =>
    s ? t(`sdStatus.${s}`) : t("sdUnrecorded");
  const statusBadgeClass = (s: StructuredDataStatus | null): string =>
    s === "valid" ? "badge-pos" : s === "potential-issue" ? "badge-warn" : s === "invalid" || s === "malformed" ? "badge-err" : "badge-info";

  const topType = derived.typeEntries[0];

  return (
    <div className="space-y-4">
      {/* ===== ① 指标卡 ===== */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t("sdPages")}
          value={fmtNum(derived.withSD)}
          caption={t("sdPagesCaption", { total: fmtNum(derived.total) })}
          hint={t("sdPagesHint")}
          hintStyle="plain"
          tone={derived.withSD > 0 ? "pos" : undefined}
        />
        <MetricCard
          label={t("sdTypesCount")}
          value={fmtNum(derived.typeCount)}
          caption={topType ? t("sdTypesCaption", { type: topType[0], n: fmtNum(topType[1]) }) : t("noSchemaTypes")}
          hint={t("sdTypesHint")}
          hintStyle="plain"
        />
        <MetricCard
          label={t("sdValid")}
          value={fmtNum(derived.valid)}
          caption={t("sdValidCaption", { potential: fmtNum(derived.potential) })}
          hint={t("sdValidHint")}
          hintStyle="plain"
          tone={derived.valid > 0 ? "pos" : undefined}
        />
        <MetricCard
          label={t("sdAbnormal")}
          value={fmtNum(derived.invalid)}
          caption={t("sdAbnormalCaption")}
          hint={t("sdAbnormalHint")}
          hintStyle="plain"
          tone={derived.invalid > 0 ? "neg" : undefined}
        />
      </div>

      {/* ===== ② 检出状态分布 + ③ 类型分布 ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-5"
          title={t("structuredDataTitle")}
          subtitle={t("sdStatusDistSub", { total: fmtNum(statusTotal) })}
        >
          {statusTotal === 0 ? (
            <EmptyBlock title={t("notEnoughData")} hint={t("sdScopeNote")} />
          ) : (
            <>
              <div className="space-y-2">
                {statusCounts.map((s) => {
                  const label = s.key === "unrecorded" ? t("sdUnrecorded") : t(`sdStatus.${s.key}`);
                  const color = s.key === "unrecorded" ? "#D1D5DB" : SD_COLORS[s.key as StructuredDataStatus];
                  const active = statusFilter === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setStatusFilter(active ? "" : (s.key as StructuredDataStatus | "unrecorded"))}
                      className="flex w-full items-center gap-3 text-left"
                      aria-label={`${label}: ${s.value}`}
                    >
                      <span className="w-20 shrink-0 truncate font-mono text-xs text-ink-40">{label}</span>
                      <span className="relative h-3 flex-1 overflow-hidden rounded-sm bg-line-soft">
                        <span
                          className="absolute inset-y-0 left-0"
                          style={{ width: `${statusTotal > 0 ? (s.value / statusTotal) * 100 : 0}%`, backgroundColor: color }}
                        />
                      </span>
                      <span className="w-16 shrink-0 text-right font-mono text-xs text-ink">
                        {fmtNum(s.value)}
                        <span className="text-ink-40"> ({statusTotal > 0 ? Math.round((s.value / statusTotal) * 100) : 0}%)</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-line-soft pt-2 font-sans text-xs text-ink-40">{t("sdStatusDistNote")}</p>
            </>
          )}
        </SectionCard>

        <SectionCard
          className="lg:col-span-7"
          title={t("schemaTypesTitle")}
          subtitle={t("schemaTypesSub")}
        >
          {derived.typeEntries.length === 0 ? (
            <EmptyBlock title={t("noSchemaTypes")} />
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={derived.typeEntries.map(([type, n]) => ({ name: type, pages: n }))}
                    layout="vertical"
                    margin={{ top: 0, right: 34, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid {...COMMON_GRID_PROPS} />
                    <XAxis type="number" allowDecimals={false} {...COMMON_YAXIS_PROPS} />
                    <YAxis type="category" dataKey="name" width={150} interval={0} tick={CHART_TICK_STYLE} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                    <Bar dataKey="pages" fill="#0F766E" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                      <LabelList dataKey="pages" position="right" style={{ fill: "var(--color-ink-60, #5B6470)", fontSize: 11, fontFamily: "var(--font-mono, monospace)" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 border-t border-line-soft pt-2 font-sans text-xs text-ink-40">{t("sdTypeDistNote")}</p>
            </>
          )}
        </SectionCard>
      </div>

      {/* ===== ④ 页面级结果表 + 异常定位 ===== */}
      <SectionCard title={t("sdTableTitle")} subtitle={t("sdTableSub")} bodyClassName="mt-0">
        {/* 规则检出 chips：真实 finding 计数 → 问题详情深链 */}
        {derived.findings.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-sans text-xs text-ink-40">{t("sdFindingsLabel")}</span>
            {Object.entries(derived.ruleCounts).sort((a, b) => b[1] - a[1]).map(([ruleId, n]) => (
              <button
                key={ruleId}
                onClick={() => onOpenIssue(ruleId)}
                className={`whitespace-nowrap font-mono text-xs transition-colors hover:border-ink-25 ${
                  ruleId === "invalid-structured-data" ? "badge-err" : ruleId === "incomplete-structured-data" ? "badge-warn" : "badge-info"
                }`}
              >
                {ruleId} · {n}
              </button>
            ))}
          </div>
        )}

        {/* 状态筛选 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-sans text-xs text-ink-40">{t("lkFilterLabel")}</span>
          <button
            onClick={() => setStatusFilter("")}
            className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
              statusFilter === "" ? "border-brand bg-brand/5 text-ink" : "border-line bg-card text-ink-60 hover:border-ink-25"
            }`}
          >
            {t("lkFilterAll", { n: derived.rows.length })}
          </button>
          {statusCounts.map((s) => {
            const label = s.key === "unrecorded" ? t("sdUnrecorded") : t(`sdStatus.${s.key}`);
            const active = statusFilter === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setStatusFilter(active ? "" : (s.key as StructuredDataStatus | "unrecorded"))}
                className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                  active ? "border-brand bg-brand/5 text-ink" : "border-line bg-card text-ink-60 hover:border-ink-25"
                }`}
              >
                {t("sdFilterCount", { label, n: s.value })}
              </button>
            );
          })}
          {derived.rows.length > 0 && filteredRows.length < derived.rows.length && (
            <button
              onClick={() => onOpenPages({ sdStatus: statusFilter === "unrecorded" ? "" : (statusFilter ?? "") })}
              className="ml-auto font-mono text-xs text-brand hover:underline"
            >
              {t("sdOpenCrawl")} →
            </button>
          )}
        </div>

        {derived.total === 0 ? (
          <EmptyBlock title={t("notEnoughData")} hint={t("sdScopeNote")} />
        ) : filteredRows.length === 0 ? (
          <EmptyBlock title={t("lkNoMatch")} hint={t("clearFiltersHint")} />
        ) : (
          <DataTable minWidthRem={0} ariaLabel={t("sdTableTitle")}>
            <THead>
              <Th>
                <button onClick={() => toggleSort("url")} className="whitespace-nowrap hover:text-ink">{t("thUrl")}{sortMark("url")}</button>
              </Th>
              <Th width="9rem">
                <button onClick={() => toggleSort("types")} className="whitespace-nowrap hover:text-ink">{t("thSdStatus")}{sortMark("types")}</button>
              </Th>
              <Th>{t("thSdTypes")}</Th>
              <Th className="hidden md:table-cell">{t("thSdIssues")}</Th>
              <Th align="right" width="9rem">{t("thDetail")}</Th>
            </THead>
            <TBody>
              {filteredRows.map((r) => (
                <TR key={r.url}>
                  <TD>
                    <span className="block max-w-[280px] truncate font-mono text-xs text-ink" title={r.url}>{r.url.replace(/^https?:\/\//, "")}</span>
                  </TD>
                  <TD>
                    <span className={`${statusBadgeClass(r.status)} whitespace-nowrap font-mono text-xs`}>{statusLabel(r.status)}</span>
                  </TD>
                  <TD>
                    {r.types.length === 0 ? (
                      <span className="font-sans text-xs text-ink-40">—</span>
                    ) : (
                      <span className="block max-w-[240px] truncate font-mono text-xs text-ink-60" title={r.types.join(", ")}>
                        {r.types.join(", ")}
                      </span>
                    )}
                  </TD>
                  <TD className="hidden md:table-cell">
                    {r.issues.length === 0 ? (
                      <span className="font-sans text-xs text-ink-40">{t("lkNoIssues")}</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {Array.from(new Set(r.issues.map((i) => i.ruleId))).map((ruleId) => (
                          <button
                            key={ruleId}
                            onClick={() => onOpenIssue(ruleId)}
                            className="badge-info whitespace-nowrap font-mono text-xs transition-colors hover:border-ink-25"
                          >
                            {ruleId}
                          </button>
                        ))}
                      </span>
                    )}
                  </TD>
                  <TD align="right">
                    <button
                      onClick={() => onOpenPages({ search: r.url.replace(/^https?:\/\//, "") })}
                      className="whitespace-nowrap font-mono text-xs text-brand hover:underline"
                    >
                      {t("lkOpenCrawl")} →
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </DataTable>
        )}

        {/* 数据范围声明：页面级粒度，不伪装对象级明细 */}
        <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">
          {t("sdScopeNote")}
        </p>
      </SectionCard>
    </div>
  );
}

// ===== AI Search =====

export function AiSearchSection({ snapshot }: { snapshot: DashboardSnapshot }) {
  const t = useTranslations("dashboard.audit");
  const crawlers = Object.entries(snapshot.aiSearch.crawlers);
  const accessLabel = (v: string) => (v === "allowed" ? t("aiAllowed") : v === "disallowed" ? t("aiDisallowed") : t("aiNotSpecified"));
  const accessClass = (v: string) => (v === "allowed" ? "badge-pos" : v === "disallowed" ? "badge-err" : "badge-info");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <SectionCard
        className="lg:col-span-5"
        title={
          <span className="flex items-center gap-1.5">
            {t("aiCrawlerAccess")}
            <Hint text={t("hintAiCrawler")} />
          </span>
        }
        subtitle={t("aiSearchSub")}
      >
        <div className="space-y-2">
          {crawlers.length === 0 ? (
            <EmptyBlock title={t("aiNoRobots")} />
          ) : (
            crawlers.map(([agent, access]) => (
              <div key={agent} className="flex items-center justify-between rounded-lg border border-line bg-card px-3 py-2">
                <span className="font-mono text-xs text-ink">{agent}</span>
                <span className={accessClass(access)}>{accessLabel(access)}</span>
              </div>
            ))
          )}
        </div>
      </SectionCard>
      <div className="grid grid-cols-1 gap-4 lg:col-span-7">
        <SectionCard
          title={t("llmsTxt")}
          subtitle={t("llmsTxtSub")}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className={`font-mono text-lg font-semibold ${snapshot.aiSearch.llmsTxt?.status === "found" ? "text-pos" : "text-warn"}`}>
                {t(`llmsStatus.${snapshot.aiSearch.llmsTxt?.status ?? "missing"}`)}
              </div>
              <div className="font-mono text-xs text-ink-40">
                {snapshot.aiSearch.llmsTxt?.httpStatus ? `HTTP ${snapshot.aiSearch.llmsTxt.httpStatus}` : ""}
              </div>
            </div>
            <div className="max-w-[60%] font-sans text-xs text-ink-40">{t("llmsHint")}</div>
          </div>
        </SectionCard>
        <SectionCard
          title={t("semanticHtml")}
          subtitle={t("semanticHtmlSub")}
        >
          <div className="flex items-center justify-between">
            <div className="font-mono text-lg font-semibold text-ink">{fmtNum(snapshot.aiSearch.semanticHtmlAffected)}</div>
            <div className="max-w-[60%] font-sans text-xs text-ink-40">{t("semanticHtmlHint")}</div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ===== Content Overview =====

export function ContentSection({ snapshot, onNavigate }: { snapshot: DashboardSnapshot; onNavigate: (p: Record<string, string>) => void }) {
  const t = useTranslations("dashboard.audit");
  const typeSegments = useMemo<Segment[]>(() => {
    const entries = Object.entries(snapshot.content.byType).sort((a, b) => b[1] - a[1]);
    const palette = ["#2563EB", "#22C55E", "#F59E0B", "#8B5CF6", "#06B6D4", "#EF4444", "#9CA3AF", "#111827"];
    return entries.map(([type, n], i) => ({ label: type, value: n, color: palette[i % palette.length] }));
  }, [snapshot]);
  const total = typeSegments.reduce((a, s) => a + s.value, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <SectionCard
        className="lg:col-span-5"
        title={t("contentTitle")}
        subtitle={t("contentSub")}
      >
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t("avgWordCount")} value={fmtNum(snapshot.content.avgWordCount)} />
          <Stat label={t("avgTextHtmlRatio")} value={`${Math.round(snapshot.content.avgTextHtmlRatio * 1000) / 10}%`} hint={t("hintTextHtml")} />
          <Stat label={t("lowContentPages")} value={fmtNum(snapshot.content.lowContent)} onClick={() => onNavigate({ view: "issues", category: "content" })} />
          <Stat label={t("veryLowContentPages")} value={fmtNum(snapshot.content.veryLowContent)} onClick={() => onNavigate({ view: "issues", category: "content" })} />
        </div>
      </SectionCard>
      <SectionCard
        className="lg:col-span-7"
        title={t("contentByType")}
        subtitle={t("contentByTypeSub")}
      >
        {typeSegments.length === 0 ? (
          <EmptyBlock title={t("noData")} />
        ) : (
          <>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeSegments.map((s) => ({ name: s.label, pages: s.value, color: s.color }))} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid {...COMMON_GRID_PROPS} />
                  <XAxis type="number" {...COMMON_YAXIS_PROPS} />
                  <YAxis type="category" dataKey="name" width={72} tick={CHART_TICK_STYLE} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                  <Bar dataKey="pages" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {typeSegments.map((s) => (
                      <Cell key={s.label} fill={s.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <LegendRow segments={typeSegments} total={total} />
          </>
        )}
      </SectionCard>
    </div>
  );
}

// ===== HTTP Status =====

export function HttpStatusSection({ snapshot, onNavigate }: { snapshot: DashboardSnapshot; onNavigate: (p: Record<string, string>) => void }) {
  const t = useTranslations("dashboard.audit");
  const httpSegments: Segment[] = [
    { label: "2xx", value: snapshot.crawler.httpStatus["2xx"], color: "#22C55E" },
    { label: "3xx", value: snapshot.crawler.httpStatus["3xx"], color: "#8B5CF6" },
    { label: "4xx", value: snapshot.crawler.httpStatus["4xx"], color: "#F59E0B" },
    { label: "5xx", value: snapshot.crawler.httpStatus["5xx"], color: "#EF4444" },
    { label: t("httpOther"), value: snapshot.crawler.httpStatus.other, color: "#9CA3AF" },
  ];

  return (
    <SectionCard
      title={t("httpStatusTitle")}
      subtitle={t("httpStatusSub", { total: fmtNum(snapshot.crawler.pagesCrawled) })}
    >
      <SegmentedBar segments={httpSegments} height={14} />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {httpSegments.map((s) => (
          <button
            key={s.label}
            onClick={() => onNavigate({ view: "pages", status: s.label })}
            className="rounded-lg border border-line bg-card px-3 py-2 text-left transition-colors hover:border-ink-25"
          >
            <div className="font-mono text-lg font-semibold" style={{ color: s.color }}>{fmtNum(s.value)}</div>
            <div className="font-mono text-xs text-ink-40">
              {s.label}
              {snapshot.crawler.pagesCrawled > 0 ? ` · ${Math.round((s.value / snapshot.crawler.pagesCrawled) * 100)}%` : ""}
            </div>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

// ===== Crawler Stats =====

export function CrawlerStatsSection({ snapshot }: { snapshot: DashboardSnapshot }) {
  const t = useTranslations("dashboard.audit");
  const c = snapshot.crawler;
  return (
    <SectionCard title={t("crawlerStatsTitle")} subtitle={t("crawlerStatsSub")}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("pagesCrawled")} value={fmtNum(c.pagesCrawled)} />
        <Stat label={t("htmlPages")} value={fmtNum(c.htmlPages)} />
        <Stat label={t("redirectsCrawled")} value={fmtNum(c.redirects)} />
        <Stat label={t("crawlErrors")} value={fmtNum(c.errors)} />
        <Stat label={t("avgResponse")} value={`${c.avgResponseMs}ms`} />
        <Stat label={t("fastestPage")} value={c.fastestMs !== null ? `${c.fastestMs}ms` : "—"} />
        <Stat label={t("slowestPage")} value={c.slowestMs !== null ? `${c.slowestMs}ms` : "—"} />
        <Stat label={t("redirectLoops")} value={fmtNum(c.loops)} />
      </div>
    </SectionCard>
  );
}

function Stat({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`rounded-lg border border-line bg-card px-3 py-2 text-left ${onClick ? "cursor-pointer transition-colors hover:border-ink-25" : ""}`}
    >
      <div className="flex items-center font-mono text-xs uppercase tracking-wide text-ink-40">
        {label}
        {hint ? <Hint text={hint} /> : null}
      </div>
      <div className="mt-0.5 font-mono text-xl font-semibold text-ink">{value}</div>
    </Comp>
  );
}
