"use client";

// ===== Site Audit 专业分析子视图 =====
// Internal Linking / Structured Data / AI Search / Content / HTTP Status / Crawler Stats
// 全部来自 DashboardSnapshot，无额外请求。

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import type { DashboardSnapshot, StructuredDataStatus } from "@/lib/seo/audit-dashboard";
import { SectionCard, SegmentedBar, LegendRow, EmptyBlock, Hint, fmtNum, type Segment } from "./ui";
import { CHART_TOOLTIP_STYLE, CHART_TOOLTIP_ITEM_STYLE, CHART_TICK_STYLE, COMMON_GRID_PROPS, COMMON_YAXIS_PROPS } from "@/components/dashboard/chart-theme";

// ===== Internal Linking =====

export function LinkingSection({ snapshot, onOpenPages }: { snapshot: DashboardSnapshot; onOpenPages: (params: Record<string, string>) => void }) {
  const t = useTranslations("dashboard.audit");
  const depthSegments: Segment[] = [
    { label: "D0", value: snapshot.linking.depthDistribution["0"] ?? 0, color: "#22C55E" },
    { label: "D1", value: snapshot.linking.depthDistribution["1"] ?? 0, color: "#2563EB" },
    { label: "D2", value: snapshot.linking.depthDistribution["2"] ?? 0, color: "#F59E0B" },
    { label: "D3", value: snapshot.linking.depthDistribution["3"] ?? 0, color: "#8B5CF6" },
    { label: "D4+", value: snapshot.linking.depthDistribution["4+"] ?? 0, color: "#EF4444" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <SectionCard
        className="lg:col-span-7"
        title={t("linkingTitle")}
        subtitle={t("linkingSub")}
      >
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t("avgInternalLinks")} value={snapshot.linking.avgInternalLinks.toString()} hint={t("hintAvgInternalLinks")} />
          <Stat label={t("zeroInternalLinks")} value={fmtNum(snapshot.linking.zeroInternalLinks)} onClick={() => onOpenPages({})} />
          <Stat label={t("deepPages")} value={fmtNum(snapshot.linking.deepPages)} hint={t("hintDeepPages")} onClick={() => onOpenPages({})} />
          <Stat label={t("possibleOrphans")} value={fmtNum(snapshot.linking.orphans)} hint={t("hintOrphans")} />
          <Stat label={t("linksToRedirects")} value={fmtNum(snapshot.linking.linksToRedirects)} />
          <Stat label={t("externalLinksAvg")} value="—" hint={t("hintExternalLinks")} />
        </div>
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
  );
}

// ===== Structured Data =====

const SD_ORDER: StructuredDataStatus[] = ["valid", "potential-issue", "invalid", "malformed", "none"];
const SD_COLORS: Record<StructuredDataStatus, string> = {
  valid: "#22C55E",
  "potential-issue": "#F59E0B",
  invalid: "#EF4444",
  malformed: "#8B5CF6",
  none: "#9CA3AF",
};

export function StructuredDataSection({ snapshot, onNavigate }: { snapshot: DashboardSnapshot; onNavigate: (p: Record<string, string>) => void }) {
  const t = useTranslations("dashboard.audit");
  const segments: Segment[] = SD_ORDER.map((s) => ({ label: t(`sdStatus.${s}`), value: snapshot.structuredData.statusCounts[s] ?? 0, color: SD_COLORS[s] }));
  const schemaTypes = useMemo(() => Object.entries(snapshot.structuredData.schemaTypes).sort((a, b) => b[1] - a[1]), [snapshot]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <SectionCard
        className="lg:col-span-6"
        title={t("structuredDataTitle")}
        subtitle={t("structuredDataSub", { withSD: snapshot.structuredData.pagesWithSD })}
      >
        <SegmentedBar segments={segments} height={12} />
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {segments.map((s) => (
            <button
              key={s.label}
              onClick={() => onNavigate({ view: "pages", sdStatus: s.label === t("sdStatus.valid") ? "valid" : s.label === t("sdStatus.potential-issue") ? "potential-issue" : s.label === t("sdStatus.invalid") ? "invalid" : s.label === t("sdStatus.malformed") ? "malformed" : "none" })}
              className="rounded-md border border-line bg-card px-1 py-1.5 text-center transition-colors hover:border-ink-25"
              aria-label={`${s.label}: ${s.value}`}
            >
              <div className="font-mono text-sm font-semibold" style={{ color: s.color }}>{fmtNum(s.value)}</div>
              <div className="truncate font-mono text-[0.625rem] text-ink-40">{s.label}</div>
            </button>
          ))}
        </div>
      </SectionCard>
      <SectionCard
        className="lg:col-span-6"
        title={t("schemaTypesTitle")}
        subtitle={t("schemaTypesSub")}
      >
        {schemaTypes.length === 0 ? (
          <EmptyBlock title={t("noSchemaTypes")} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {schemaTypes.map(([type, n]) => (
              <button key={type} onClick={() => onNavigate({ view: "issues", category: "structured-data" })} className="badge-info font-mono text-xs transition-colors hover:border-ink-25">
                {type} <b className="text-ink">{n}</b>
              </button>
            ))}
          </div>
        )}
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
            <div className="font-mono text-[0.6875rem] text-ink-40">
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
      <div className="flex items-center font-mono text-[0.6875rem] uppercase tracking-wide text-ink-40">
        {label}
        {hint ? <Hint text={hint} /> : null}
      </div>
      <div className="mt-0.5 font-mono text-xl font-semibold text-ink">{value}</div>
    </Comp>
  );
}
