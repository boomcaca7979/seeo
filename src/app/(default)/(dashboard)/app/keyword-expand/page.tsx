"use client";

// ===== Keyword Expansion（拓词建议 · 种子词 → 可追踪关键词）=====
//
// 与第一批 /app、/app/audit、关键词概览共用同一套可视化规则：
//   ① 头部 + 工具栏：市场 / 设备 / 目标项目 / 种子词（既有操作一个不少）
//   ② 指标卡：相关搜索 / 相关问题 / 拓词合计 / 本次已加入追踪（都是真实计数）
//   ③ 图表：**意图（估算）分布** —— 由 detectIntent 文本规则确定性计算，不硬编码
//   ④ 数据表：相关关键词（关键词 / 长度 / 意图（估算） / 操作）+ 意图筛选 + 排序
//   ⑤ 相关搜索与相关问题标签：一键加入位置追踪
//
// 单请求契约（第十一阶段）：「分析」只调 /api/keywords/expand——它的 related/paa
// 本就来自 SerpApi 的 related searches / related questions（与 /api/seo/serp 同一
// 缓存 key）。此前两请求并行会在缓存未命中时重复扣费 2 次并产生双份错误提示。
//
// 诚实边界：
//   - 搜索量与关键词难度在本工作区不可用 → 不显示、不估算、不用替代值（metricsNote 明示）。
//   - 意图是文本规则**估算**，表头标注「意图（估算）」。

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useToast } from "@/components/dashboard/Toast";
import DomainSelect from "@/components/dashboard/DomainSelect";
import { handleBillingError } from "@/lib/billing-error-client";
import {
  RK,
  RK_GRID_PROPS,
  RK_INTENT,
  RK_TOOLTIP_ITEM_STYLE,
  RK_TOOLTIP_LABEL_STYLE,
  RK_TOOLTIP_STYLE,
  RK_XAXIS_PROPS,
  RK_YAXIS_PROPS,
} from "@/components/viz/rank-theme";
import { formatNumber } from "@/lib/ui-locale";

import PageHeader from "@/components/viz/PageHeader";
import MetricCard from "@/components/viz/MetricCard";
import ChartFrame from "@/components/viz/ChartFrame";
import { StatusBadge } from "@/components/viz/StatusBadge";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";

interface UsageBadge {
  used: number;
  limit: number;
}

interface ExpandMetricsKeyword {
  keyword: string;
  searchVolume: number | null;
}
interface ExpandData {
  seed: string;
  related: string[];
  paa: string[];
  location: string;
  device: string;
  fromCache: boolean;
  /** P0-02-A 新增（可空）：DataForSEO 指标补全；不可用时为 null → UI 如实说明 */
  metrics?: { source: "dataforseo" | null; keywords?: ExpandMetricsKeyword[] } | null;
}

interface ExpandState {
  loading: boolean;
  data: ExpandData | null;
  error: string | null;
}

const KEYWORD_LOCATIONS = ["中国", "美国", "英国", "日本", "香港", "台湾"];
type Device = "PC" | "移动端";

// 地区/城市显示名（仅 UI 展示；API location 参数值保持中文原值不变）
const LOCALE_DISPLAY: Record<"en" | "zh", Record<string, string>> = {
  zh: {},
  en: {
    "中国": "China", "美国": "United States", "英国": "United Kingdom",
    "日本": "Japan", "香港": "Hong Kong", "台湾": "Taiwan",
  },
};

export function detectIntent(query: string): string {
  const q = query.toLowerCase();
  // 中文意图规则
  if (/什么|怎么|为什么|如何|是不是|哪些/.test(q)) return "信息型";
  if (/推荐|最好|对比|价格|费用|多少钱|哪个好/.test(q)) return "商业型";
  // 英文意图规则
  if (/\b(what|how|why|which|guide|tutorial|learn|is|are|does|do)\b/.test(q)) return "信息型";
  if (/\b(best|top|review|reviews|compare|comparison|vs|price|pricing|cheap|cheapest|alternative|alternatives|buy|cost)\b/.test(q)) return "商业型";
  return "导航型";
}

// 意图显示名（detectIntent 返回值保持中文原值，仅展示时翻译）
function intentText(t: ReturnType<typeof useTranslations>, value: string): string {
  if (value === "信息型") return t("intentInformational");
  if (value === "商业型") return t("intentCommercial");
  return t("intentNavigational");
}

const INTENTS = ["信息型", "商业型", "导航型"] as const;
type IntentKey = (typeof INTENTS)[number];

/** 意图类别色：有限、低饱和、可区分（信息=墨绿 / 商业=琥珀 / 导航=中性灰） */
const INTENT_COLOR: Record<IntentKey, string> = {
  "信息型": RK_INTENT.informational,
  "商业型": RK_INTENT.commercial,
  "导航型": RK_INTENT.navigational,
};

export default function KeywordExpandPage() {
  const t = useTranslations("dashboard.keywords.expand");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
  const [searchValue, setSearchValue] = useState("");
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<Device>("PC");
  const [trackDomain, setTrackDomain] = useState("");
  const [expand, setExpand] = useState<ExpandState>({ loading: false, data: null, error: null });
  const [usage, setUsage] = useState<UsageBadge | null>(null);
  const [trackingIds, setTrackingIds] = useState<Record<string, boolean>>({});
  const [intentFilter, setIntentFilter] = useState<"all" | IntentKey>("all");
  const [sortMode, setSortMode] = useState<"alpha" | "length">("alpha");
  const { show, Toast } = useToast();

  // 单请求：「分析」只调 /api/keywords/expand（related/paa/metrics/usage 一次带回）。
  // 此前并行还调 /api/seo/serp，同一缓存 key 未命中时会双倍扣费、双份错误提示。
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = searchValue.trim();
    if (!kw) {
      show(t("errKeyword"), "error");
      return;
    }
    setExpand({ loading: true, data: null, error: null });
    setIntentFilter("all");

    try {
      const res = await fetch("/api/keywords/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: kw, location, device }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("expandFailed"));
        setExpand({ loading: false, data: null, error: message });
        show(message, "error");
        return;
      }
      setExpand({ loading: false, data: json.data, error: null });
      if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
    } catch (err) {
      setExpand({ loading: false, data: null, error: `${t("expandNetworkError")}${(err as Error).message}` });
    }
  };

  const handleTrackFromExpand = async (keyword: string) => {
    if (trackingIds[keyword]) {
      show(t("alreadyTracking"), "info");
      return;
    }
    setTrackingIds((prev) => ({ ...prev, [keyword]: true }));
    try {
      const targetDomain = trackDomain.trim();
      if (!targetDomain) {
        show(t("selectProjectFirst"), "error");
        setTrackingIds((prev) => ({ ...prev, [keyword]: false }));
        return;
      }
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, location, device, domain: targetDomain }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("addFailed"));
        show(message, "error");
        setTrackingIds((prev) => ({ ...prev, [keyword]: false }));
        return;
      }
      show(t("trackAdded", { keyword }), "success");
      if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
      setTrackingIds((prev) => ({ ...prev, [keyword]: false }));
    }
  };

  const hasResult = !!expand.data;
  const expandTotal = (expand.data?.related.length ?? 0) + (expand.data?.paa.length ?? 0);
  const trackedThisSession = Object.values(trackingIds).filter(Boolean).length;

  /** 本次拓词的全部词（去重后统一估算意图） */
  const allIdeas = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const q of [...(expand.data?.related ?? []), ...(expand.data?.paa ?? [])]) {
      if (seen.has(q)) continue;
      seen.add(q);
      out.push(q);
    }
    return out;
  }, [expand.data]);

  const intentCounts = useMemo(() => {
    const counts: Record<IntentKey, number> = { "信息型": 0, "商业型": 0, "导航型": 0 };
    for (const q of allIdeas) counts[detectIntent(q) as IntentKey]++;
    return counts;
  }, [allIdeas]);

  const intentChartData = INTENTS.map((k) => ({
    key: k,
    label: intentText(t, k),
    value: intentCounts[k],
    color: INTENT_COLOR[k],
  }));

  // 相关词表格（关键词 = /api/keywords/expand 的 related，即 SerpApi 相关搜索；
  // 意图为 detectIntent 基于关键词文本的规则估算）
  const relatedRows = (expand.data?.related ?? []).map((q) => ({
    keyword: q,
    intent: detectIntent(q),
    length: q.length,
  }));

  const visibleRows = useMemo(() => {
    const rows = relatedRows.filter((r) => intentFilter === "all" || r.intent === intentFilter);
    rows.sort((a, b) =>
      sortMode === "length" ? b.length - a.length || a.keyword.localeCompare(b.keyword) : a.keyword.localeCompare(b.keyword)
    );
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expand.data, intentFilter, sortMode]);

  /** 指标卡与图表都基于同一份数据（避免卡片与内容口径不一致） */
  const metrics = expand.data
    ? {
        related: expand.data.related.length,
        paa: expand.data.paa.length,
        total: expandTotal,
      }
    : null;
  /** DataForSEO 指标是否可用：不可用时明确说明，不用替代值 */
  const metricsUnavailable = !!expand.data && expand.data.metrics?.source == null;

  return (
    <div className="dash-container p-6 lg:p-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        meta={
          <>
            <span>
              {display(location)} · {device === "PC" ? "PC" : locale === "zh" ? "移动端" : "Mobile"}
            </span>
            {trackDomain && (
              <>
                <span>·</span>
                <span>{trackDomain}</span>
              </>
            )}
            {expand.data?.seed && (
              <>
                <span>·</span>
                <span>{expand.data.seed}</span>
              </>
            )}
            {usage && (
              <>
                <span>·</span>
                <span>
                  {t("usage", { used: formatNumber(usage.used, locale), limit: formatNumber(usage.limit, locale) })}
                </span>
              </>
            )}
          </>
        }
      />

      {/* 工具栏：市场 / 设备 / 目标项目 / 种子词 / 分析（既有操作保持不变） */}
      <form onSubmit={handleAnalyze} className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            aria-label={t("marketLabel")}
            className="h-10 rounded-md border border-line bg-card px-3 text-sm text-ink focus:border-ink-25 focus:outline-none"
          >
            {KEYWORD_LOCATIONS.map((c) => (
              <option key={c} value={c}>{display(c)}</option>
            ))}
          </select>
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value as Device)}
            aria-label={t("deviceLabel")}
            className="h-10 rounded-md border border-line bg-card px-3 text-sm text-ink focus:border-ink-25 focus:outline-none"
          >
            <option value="PC">PC</option>
            <option value="移动端">{locale === "zh" ? "移动端" : "Mobile"}</option>
          </select>
          {/* 选项文案是「项目名（域名）」整串，min-w-[180px] 只兜住下限、拦不住
              390/360 屏下的固有宽度（实测 390px），改为可收缩 + 容器上限 */}
          <DomainSelect value={trackDomain} onChange={(d) => setTrackDomain(d)} className="h-10 min-w-0 max-w-full" />
        </div>
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-40">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-10 w-full rounded-md border border-line bg-card py-2 pl-11 pr-4 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
        </div>
        <button type="submit" disabled={expand.loading} className="btn-primary px-6 disabled:opacity-60">
          {expand.loading ? t("analyzing") : t("analyze")}
        </button>
      </form>

      {/* 未分析：诚实空态 + 入口 */}
      {!hasResult && !expand.loading && !expand.error && (
        <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-line py-14 text-center">
          <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("title")}</div>
          <div className="mt-2 font-sans text-sm font-medium text-ink">{t("emptyTitle")}</div>
          <p className="mt-1 max-w-md font-sans text-xs text-ink-40">{t("emptyHint")}</p>
        </div>
      )}

      {expand.error && !expand.loading && (
        <div className="mt-6 card-a p-5">
          <div className="flex flex-wrap items-start gap-2">
            <StatusBadge label={t("expandFailed")} tone="neg" dot={false} />
            <span className="font-sans text-sm text-neg">{expand.error}</span>
          </div>
        </div>
      )}

      {/* 指标卡 */}
      {hasResult && metrics && (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label={t("metricRelated")}
            value={formatNumber(metrics.related, locale)}
            caption={t("relatedTitle")}
          />
          <MetricCard
            label={t("metricPaa")}
            value={formatNumber(metrics.paa, locale)}
            caption={t("paaTitle")}
          />
          <MetricCard
            label={t("metricTotal")}
            value={formatNumber(metrics.total, locale)}
            caption={t("totalCount", { count: formatNumber(metrics.total, locale) })}
          />
          <MetricCard
            label={t("metricTracked")}
            value={formatNumber(trackedThisSession, locale)}
            caption={trackDomain ? trackDomain : t("selectProjectFirst")}
            hint={t("metricTrackedHint")}
            hintStyle="plain"
            tone={trackedThisSession > 0 ? "pos" : undefined}
          />
        </div>
      )}

      {/* 图表 + 标签区 */}
      {hasResult && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <ChartFrame
            className="lg:col-span-4"
            title={t("intentChartTitle")}
            subtitle={t("intentChartSub")}
            legend={INTENTS.map((k) => ({
              label: intentText(t, k),
              tone: "neutral" as const,
              value: intentCounts[k],
              color: INTENT_COLOR[k],
            }))}
            isEmpty={allIdeas.length === 0}
            emptyTitle={t("noRelated")}
            emptyHint={t("emptyHint")}
            showEmptyIcon={false}
            chartHeight={allIdeas.length === 0 ? undefined : 220}
            chart={
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={intentChartData} margin={{ top: 8, right: 8, bottom: 4, left: -20 }}>
                  <CartesianGrid {...RK_GRID_PROPS} />
                  <XAxis dataKey="label" {...RK_XAXIS_PROPS} />
                  <YAxis allowDecimals={false} {...RK_YAXIS_PROPS} />
                  <Tooltip
                    contentStyle={RK_TOOLTIP_STYLE}
                    labelStyle={RK_TOOLTIP_LABEL_STYLE}
                    itemStyle={RK_TOOLTIP_ITEM_STYLE}
                    formatter={(v) => [`${v}`, t("metricTotal")]}
                    cursor={{ fill: RK.cursor }}
                  />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                    {intentChartData.map((d) => (
                      <Cell key={d.key} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            }
          >
            <div className="mt-3 flex flex-wrap gap-2 border-t border-line-soft pt-3">
              {INTENTS.map((k) => (
                <button
                  key={k}
                  onClick={() => setIntentFilter(intentFilter === k ? "all" : k)}
                  className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                    intentFilter === k ? "border-ink-25 text-ink" : "border-line text-ink-60 hover:border-ink-25"
                  }`}
                >
                  {intentText(t, k)} {intentCounts[k]}
                </button>
              ))}
            </div>
            <p className="mt-2 font-sans text-xs text-ink-40">{t("intentNote")}</p>
          </ChartFrame>

          <ChartFrame
            className="lg:col-span-4"
            title={t("relatedTitle")}
            subtitle={t("countItems", { count: formatNumber(expand.data?.related.length ?? 0, locale) })}
            isEmpty={!expand.loading && (expand.data?.related.length ?? 0) === 0}
            emptyTitle={t("noRelated")}
            emptyHint={t("emptyHint")}
            showEmptyIcon={false}
          >
            {expand.loading ? (
              <ExpandSkeletonRows />
            ) : (
              <div className="flex max-h-[16rem] flex-wrap content-start gap-2 overflow-y-auto">
                {(expand.data?.related ?? []).map((q) => (
                  <ExpandTag key={q} query={q} tracked={!!trackingIds[q]} onTrack={() => handleTrackFromExpand(q)} />
                ))}
              </div>
            )}
          </ChartFrame>

          <ChartFrame
            className="lg:col-span-4"
            title={t("paaTitle")}
            subtitle={t("countItems", { count: formatNumber(expand.data?.paa.length ?? 0, locale) })}
            isEmpty={!expand.loading && (expand.data?.paa.length ?? 0) === 0}
            emptyTitle={t("noPaa")}
            emptyHint={t("emptyHint")}
            showEmptyIcon={false}
          >
            {expand.loading ? (
              <ExpandSkeletonRows />
            ) : (
              <div className="flex max-h-[16rem] flex-wrap content-start gap-2 overflow-y-auto">
                {(expand.data?.paa ?? []).map((q) => (
                  <ExpandTag key={q} query={q} tracked={!!trackingIds[q]} onTrack={() => handleTrackFromExpand(q)} />
                ))}
              </div>
            )}
          </ChartFrame>
        </div>
      )}

      {/* 相关关键词表（可筛选 + 可排序 + 可加入追踪 + 可进入 SERP 研究） */}
      {(expand.loading || (expand.data && expand.data.related.length > 0)) && (
        <section className="card-a mt-4 p-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-lg font-semibold text-ink">{t("relatedKeywordsTitle")}</h3>
              <p className="mt-0.5 font-sans text-xs text-ink-40">{t("relatedKeywordsSource")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40">
                {t("filterIntent")}
                <select
                  value={intentFilter}
                  onChange={(e) => setIntentFilter(e.target.value as "all" | IntentKey)}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
                >
                  <option value="all">{t("metricTotal")}</option>
                  {INTENTS.map((k) => (
                    <option key={k} value={k}>{intentText(t, k)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40">
                {t("sortLabel")}
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as "alpha" | "length")}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
                >
                  <option value="alpha">{t("sortAlpha")}</option>
                  <option value="length">{t("sortLength")}</option>
                </select>
              </label>
            </div>
          </header>

          <div className="mt-4">
            {expand.loading ? (
              <TableSkeletonRows rows={5} />
            ) : relatedRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center font-sans text-sm text-ink-40">
                {t("noRelatedKeywords")}
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center font-sans text-sm text-ink-40">
                {t("noIntentMatch")}
              </div>
            ) : (
              <>
                {/* 桌面端表格 */}
                <div className="hidden md:block">
                  <DataTable minWidthRem={44} ariaLabel={t("relatedKeywordsTitle")}>
                    <THead>
                      <Th>{t("colKeyword")}</Th>
                      <Th align="right" width="6rem">{t("colWords")}</Th>
                      <Th width="10rem">{t("colIntent")}</Th>
                      <Th align="right" width="12rem">{t("colAction")}</Th>
                    </THead>
                    <TBody>
                      {visibleRows.map((r) => (
                        <TR key={r.keyword}>
                          <TD>
                            <span className="font-sans text-sm font-medium text-ink">{r.keyword}</span>
                          </TD>
                          <TD align="right" numeric>
                            <span className="text-sm text-ink-60">{r.length}</span>
                          </TD>
                          <TD>
                            <StatusBadge
                              label={intentText(t, r.intent)}
                              tone="neutral"
                              dot={false}
                              color={INTENT_COLOR[r.intent as IntentKey] ?? RK.neutralDeep}
                            />
                          </TD>
                          <TD align="right">
                            <span className="flex items-center justify-end gap-3">
                              <a
                                href={`/app/keyword-overview?keyword=${encodeURIComponent(r.keyword)}`}
                                className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                title={t("researchTitle")}
                              >
                                {t("researchAction")}
                              </a>
                              <button
                                onClick={() => handleTrackFromExpand(r.keyword)}
                                disabled={!!trackingIds[r.keyword]}
                                className={`font-mono text-xs font-semibold ${
                                  trackingIds[r.keyword] ? "text-pos" : "text-brand hover:underline"
                                }`}
                                title={trackingIds[r.keyword] ? t("trackedTitle") : t("trackTitle")}
                              >
                                {trackingIds[r.keyword] ? `✓ ${t("trackedTitle")}` : t("trackAction")}
                              </button>
                            </span>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </DataTable>
                </div>

                {/* 移动端卡片 */}
                <div className="md:hidden">
                  {visibleRows.map((r) => (
                    <div key={r.keyword} className="border-b border-line-soft py-3 last:border-b-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-sans text-sm font-medium text-ink">{r.keyword}</span>
                        <StatusBadge
                          label={intentText(t, r.intent)}
                          tone="neutral"
                          dot={false}
                          color={INTENT_COLOR[r.intent as IntentKey] ?? RK.neutralDeep}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 font-mono text-xs text-ink-40">
                        <span>
                          {t("colWords")}: {r.length}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <a
                          href={`/app/keyword-overview?keyword=${encodeURIComponent(r.keyword)}`}
                          className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                        >
                          {t("researchAction")}
                        </a>
                        <button
                          onClick={() => handleTrackFromExpand(r.keyword)}
                          disabled={!!trackingIds[r.keyword]}
                          className={`font-mono text-xs font-semibold ${
                            trackingIds[r.keyword] ? "text-pos" : "text-brand hover:underline"
                          }`}
                        >
                          {trackingIds[r.keyword] ? `✓ ${t("trackedTitle")}` : t("trackAction")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 指标不可用时如实说明，不用替代值 */}
          {metricsUnavailable && (
            <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("metricsNote")}</p>
          )}
          <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("intentNote")}</p>
        </section>
      )}

      <Toast />
    </div>
  );
}

function ExpandTag({ query, tracked, onTrack }: { query: string; tracked: boolean; onTrack: () => void }) {
  const t = useTranslations("dashboard.keywords.expand");
  const intent = detectIntent(query);
  return (
    <div className="group inline-flex items-center gap-2 rounded-sm border border-line bg-card py-1 pl-2 pr-1">
      <span className="font-sans text-xs text-ink">{query}</span>
      <span className="font-sans text-xs text-ink-40">{intentText(t, intent)}</span>
      <button
        onClick={onTrack}
        disabled={tracked}
        className={`rounded-sm px-2 py-0.5 font-mono text-xs transition-colors ${
          tracked ? "bg-pos/15 text-pos" : "bg-line-soft text-ink-60 hover:bg-ink hover:text-card"
        }`}
        title={tracked ? t("trackedTitle") : t("trackTitle")}
      >
        {tracked ? "✓" : "+"}
      </button>
    </div>
  );
}

function TableSkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-line-soft bg-card px-4 py-3">
          <div className="h-3.5 w-1/3 rounded bg-line-soft" />
          <div className="h-3.5 w-10 rounded bg-line-soft" />
          <div className="ml-auto h-3.5 w-16 rounded bg-line-soft" />
        </div>
      ))}
    </div>
  );
}

function ExpandSkeletonRows() {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-7 rounded-sm bg-line-soft" style={{ width: `${60 + (i * 13) % 80}px` }} />
      ))}
    </div>
  );
}
