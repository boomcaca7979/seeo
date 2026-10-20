"use client";

// ===== Keyword Overview（关键词概览 · 单关键词 SERP 研究）=====
//
// 与第一批 /app、/app/audit 共用同一套可视化规则：
//   ① 头部 + 工具栏：市场 / 设备 / 关键词输入（既有操作一个不少）
//   ② 指标卡：本次 SERP 快照里**真实存在**的量（结果数 / 相关搜索 / 相关问题 / 意图估算）
//   ③ 图表：结果域名分布（横条，标注"出现次数"）+ 相关搜索
//   ④ 数据表：SERP Top N（位置 / 标题 / 域名 / 摘要），移动端转紧凑卡片
//
// 诚实边界：
//   - 本页没有搜索量 / 难度 / CPC 数据 → 不展示、不估算、不用替代值；
//     意图是**基于关键词文本的规则估算**，UI 明确标注「估算」。
//   - 未查询、无结果、数据源不可用分别有各自的空状态，绝不画假图表。

import { useState, useMemo, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import type { SerpResult } from "@/lib/seo/types";
import {
  RK,
  RK_GRID_PROPS,
  RK_LINK_CLASS,
  RK_TICK_STYLE,
  RK_TOOLTIP_ITEM_STYLE,
  RK_TOOLTIP_LABEL_STYLE,
  RK_TOOLTIP_STYLE,
  RK_YAXIS_PROPS,
  categoryColorMap,
  intTicks,
} from "@/components/viz/rank-theme";
import OpportunityContextBanner from "@/components/dashboard/OpportunityContextBanner";
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

interface SerpState {
  loading: boolean;
  data: SerpResult | null;
  error: string | null;
  keyword: string | null;
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

function detectIntent(query: string): string {
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

// ===== 深链入口（Action Center → 关键词机会）=====
// 支持 /app/keyword-overview?keyword=xxx：直接预填并执行该关键词的研究，
// 使"任务 → 真实执行功能"是一条可用路径，而不是空按钮。
// 使用 useSearchParams 需要 Suspense 边界（Next CSR bailout）。
export default function KeywordOverviewPage() {
  return (
    <Suspense fallback={null}>
      <KeywordOverviewInner />
    </Suspense>
  );
}

function KeywordOverviewInner() {
  const t = useTranslations("dashboard.keywords.overview");
  const tc = useTranslations("dashboard.common");
  const tv = useTranslations("dashboard.viz");
  const locale = useLocale() as "en" | "zh";
  const searchParams = useSearchParams();
  const deepLinkKeyword = (searchParams.get("keyword") ?? "").trim();
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
  const [searchValue, setSearchValue] = useState("");
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<Device>("PC");
  const [serp, setSerp] = useState<SerpState>({ loading: false, data: null, error: null, keyword: null });
  const [usage, setUsage] = useState<UsageBadge | null>(null);
  const { show, Toast } = useToast();

  const runAnalyze = useCallback(
    async (kw: string) => {
      if (!kw) {
        show(t("errKeyword"), "error");
        return;
      }
      setSerp({ loading: true, data: null, error: null, keyword: kw });
      try {
        const res = await fetch(
          `/api/seo/serp?keyword=${encodeURIComponent(kw)}&location=${encodeURIComponent(location)}&device=${encodeURIComponent(device)}`
        );
        const json = await res.json();
        if (!res.ok) {
          const { message } = handleBillingError(json, t("queryFailed"));
          setSerp({ loading: false, data: null, error: message, keyword: kw });
          show(message, "error");
          return;
        }
        setSerp({ loading: false, data: json.data, error: null, keyword: kw });
        if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
        if (json.data?.fromCache) {
          show(t("cacheHit", { keyword: kw }), "info");
        } else {
          show(t("loaded", { keyword: kw }), "success");
        }
      } catch (err) {
        const msg = `${tc("networkError")} ${(err as Error).message}`;
        setSerp({ loading: false, data: null, error: msg, keyword: kw });
        show(msg, "error");
      }
    },
    [location, device, show, t, tc]
  );

  // 深链只自动执行一次；延后一拍避免在 effect 体内同步 setState
  const deepLinkRan = useRef(false);
  useEffect(() => {
    if (deepLinkRan.current || !deepLinkKeyword) return;
    deepLinkRan.current = true;
    const id = window.setTimeout(() => {
      setSearchValue(deepLinkKeyword);
      void runAnalyze(deepLinkKeyword);
    }, 0);
    return () => window.clearTimeout(id);
  }, [deepLinkKeyword, runAnalyze]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    await runAnalyze(searchValue.trim());
  };

  const hasResult = !!serp.data && serp.data.organic.length > 0;

  // SERP 域名分布：统计结果中各域名出现次数（真实计数，不是搜索量）
  const organic = serp.data?.organic;
  const domainDistribution = useMemo(() => {
    if (!organic) return [];
    const counts = new Map<string, number>();
    organic.forEach((r) => {
      counts.set(r.domain, (counts.get(r.domain) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
  }, [organic]);

  const intentValue = serp.keyword ? detectIntent(serp.keyword) : null;

  /**
   * 域名标签：过长则截短（**不旋转、不拼接**），完整域名仍可在 tooltip 中查看。
   * YAxis 宽度按截短后的最大长度给定，保证标签与数值轴互不挤压。
   */
  const DOMAIN_LABEL_MAX = 20;
  const truncateDomain = (d: string) =>
    d.length > DOMAIN_LABEL_MAX ? `${d.slice(0, DOMAIN_LABEL_MAX - 1)}…` : d;
  /** 稳定分类配色：同一域名在同一数据集内颜色恒定（排序/筛选变化不会改色） */
  const domainColors = useMemo(
    () => categoryColorMap(domainDistribution.map((d) => d.domain)),
    [domainDistribution]
  );
  /** 出现次数轴的整数刻度（0 起，不含小数；量级变化时布局仍稳定） */
  const countAxis = useMemo(
    () => intTicks(domainDistribution.reduce((m, d) => Math.max(m, d.count), 0)),
    [domainDistribution]
  );

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
            {serp.keyword && (
              <>
                <span>·</span>
                <span>{serp.keyword}</span>
              </>
            )}
            {serp.data && (
              <>
                <span>·</span>
                <span>{serp.data.fromCache ? `${t("serpSource")} · ${t("cachedTag")}` : t("serpSource")}</span>
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

      {/* 作用域说明：本页是关键词研究（按关键词查 SERP），不是项目维度页面。
          顶部切换项目不会过滤本页数据；写明这一点，避免用户以为切换失效。 */}
      <p className="mt-2 font-sans text-xs text-ink-40">{t("scopeNote")}</p>

      {/* 机会上下文：从机会卡深链进入时显示"你为什么来到这里"（无参数时不渲染） */}
      <OpportunityContextBanner />

      {/* 工具栏：市场 / 设备 / 关键词 / 分析（既有操作保持不变） */}
      <form onSubmit={handleAnalyze} className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
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
        <button type="submit" disabled={serp.loading} className="btn-primary px-6 disabled:opacity-60">
          {serp.loading ? t("analyzing") : t("analyze")}
        </button>
      </form>

      {/* 未分析：诚实空态 + 可直接开始的操作（无图表、无装饰性圆形） */}
      {!hasResult && !serp.loading && !serp.error && (
        <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-line py-14 text-center">
          <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("title")}</div>
          <div className="mt-2 font-sans text-sm font-medium text-ink">{t("emptyTitle")}</div>
          <p className="mt-1 max-w-md font-sans text-xs text-ink-40">{t("emptyHint")}</p>
        </div>
      )}

      {/* 错误态（含数据源不可用 / 额度）：如实显示，不给替代数据 */}
      {serp.error && !serp.loading && (
        <div className="mt-6 card-a p-5">
          <div className="flex items-start gap-2">
            <StatusBadge label={t("queryFailed")} tone="neg" dot={false} />
            <span className="font-sans text-sm text-neg">{serp.error}</span>
          </div>
        </div>
      )}

      {/* 查询成功但没有自然结果：独立空态（不是"没查询"，也不是假图表） */}
      {serp.data && !serp.loading && !serp.error && serp.data.organic.length === 0 && (
        <ChartFrame
          className="mt-6"
          title={t("serpTableTitle")}
          subtitle={serp.keyword ?? undefined}
          isEmpty
          emptyTitle={t("noResults")}
          emptyHint={t("emptyHint")}
        />
      )}

      {/* 分析结果 */}
      {hasResult && serp.keyword && (
        <>
          {/* 指标卡：本次 SERP 快照里真实存在的量 */}
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label={t("metricIntent")}
              value={intentValue ? intentText(t, intentValue) : null}
              caption={serp.keyword}
              hint={t("intentNote")}
              hintStyle="plain"
            />
            <MetricCard
              label={t("cardResults")}
              value={formatNumber(serp.data!.organic.length, locale)}
              caption={t("subTop100")}
              hint={t("metricResultsHint")}
              hintStyle="plain"
            />
            <MetricCard
              label={t("cardRelated")}
              value={formatNumber(serp.data!.relatedSearches.length, locale)}
              caption={t("subExpandable")}
              hint={t("metricRelatedHint")}
              hintStyle="plain"
            />
            <MetricCard
              label={t("cardPaa")}
              value={formatNumber(serp.data!.relatedQuestions.length, locale)}
              caption={t("subQuestions")}
              hint={t("metricPaaHint")}
              hintStyle="plain"
            />
          </div>

          {/* 图表：域名分布 + 相关搜索 */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <ChartFrame
              className="lg:col-span-7"
              title={t("chartDomainTitle")}
              subtitle={t("chartDomainSubtitle")}
              legend={[
                { label: t("domainValueLabel"), tone: "neutral", color: RK.accent },
                { label: t("colDomain"), tone: "neutral", value: domainDistribution.length, color: RK.neutral },
              ]}
              isEmpty={domainDistribution.length === 0}
              emptyTitle={t("noResults")}
              emptyHint={t("domainValueHint")}
              showEmptyIcon={false}
              chartHeight={domainDistribution.length === 0 ? undefined : Math.max(200, domainDistribution.length * 28 + 56)}
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={domainDistribution}
                    layout="vertical"
                    margin={{ top: 4, right: 30, bottom: 4, left: 0 }}
                    barCategoryGap="22%"
                  >
                    <CartesianGrid {...RK_GRID_PROPS} horizontal={false} />
                    <XAxis
                      type="number"
                      domain={countAxis.domain}
                      ticks={countAxis.ticks}
                      allowDecimals={false}
                      {...RK_YAXIS_PROPS}
                      tickMargin={6}
                    />
                    <YAxis
                      type="category"
                      dataKey="domain"
                      width={138}
                      interval={0}
                      tickFormatter={truncateDomain}
                      tick={RK_TICK_STYLE}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={6}
                    />
                    <Tooltip
                      contentStyle={RK_TOOLTIP_STYLE}
                      labelStyle={RK_TOOLTIP_LABEL_STYLE}
                      itemStyle={RK_TOOLTIP_ITEM_STYLE}
                      cursor={{ fill: RK.cursor }}
                      formatter={(v) => [`${formatNumber(Number(v), locale)}`, t("domainValueLabel")]}
                    />
                    <Bar dataKey="count" radius={[0, 3, 3, 0]} maxBarSize={16} isAnimationActive={false}>
                      {domainDistribution.map((d) => (
                        <Cell key={d.domain} fill={domainColors.get(d.domain) ?? RK.neutral} />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="right"
                        offset={6}
                        formatter={(v) => `${v}`}
                        style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", fill: RK.ink60 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              }
            >
              <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("domainValueHint")}</p>
            </ChartFrame>

            <ChartFrame
              className="lg:col-span-5 self-start"
              title={t("chartRelatedTitle")}
              subtitle={t("relatedCount", { count: formatNumber(serp.data!.relatedSearches.length, locale) })}
              isEmpty={serp.data!.relatedSearches.length === 0}
              emptyTitle={t("noRelated")}
              emptyHint={t("metricRelatedHint")}
              showEmptyIcon={false}
            >
              <div className="flex max-h-[19rem] flex-wrap content-start gap-2 overflow-y-auto">
                {serp.data!.relatedSearches.map((r, i) => (
                  <span
                    key={`${r.query}-${i}`}
                    className="inline-flex items-center rounded-sm border border-line bg-card px-2 py-1 font-sans text-xs text-ink-60"
                  >
                    {r.query}
                  </span>
                ))}
              </div>
            </ChartFrame>
          </div>

          {/* SERP 结果表 */}
          <section className="card-a mt-4 p-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold text-ink">{t("serpTableTitle")}</h3>
                <p className="mt-0.5 font-sans text-xs text-ink-40">{t("topNNote")}</p>
              </div>
              <StatusBadge
                label={serp.data!.fromCache ? `${t("serpSource")} · ${t("cachedTag")}` : t("serpSource")}
                tone={serp.data!.fromCache ? "info" : "pos"}
                dot={false}
              />
            </header>

            <div className="mt-4">
              {/* 桌面端：真表格（外层 overflow-x-auto 兜底，小屏横向滚动而非撑破页面） */}
              <div className="hidden overflow-x-auto md:block">
                <DataTable minWidthRem={50} ariaLabel={t("serpTableTitle")}>
                  <THead>
                    <Th align="right" width="5rem">{t("colRank")}</Th>
                    <Th>{t("colTitle")}</Th>
                    <Th width="10rem">{t("colDomain")}</Th>
                    <Th width="28%">{t("colSnippet")}</Th>
                  </THead>
                  <TBody>
                    {serp.data!.organic.map((r) => (
                      <TR key={`${r.position}-${r.link}`}>
                        <TD align="right" numeric>
                          <span
                            className="font-mono text-base font-semibold"
                            style={{ color: r.position <= 3 ? RK.up : r.position <= 10 ? RK.warn : RK.ink60 }}
                          >
                            #{r.position}
                          </span>
                        </TD>
                        <TD>
                          <a
                            href={r.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`font-sans text-sm font-medium ${RK_LINK_CLASS}`}
                          >
                            {r.title || r.link}
                          </a>
                          {r.date && <span className="ml-2 font-mono text-xs text-ink-40">{r.date}</span>}
                        </TD>
                        <TD>
                          <span className="font-mono text-xs text-ink-60">{r.domain}</span>
                        </TD>
                        <TD>
                          {r.snippet ? (
                            <span className="line-clamp-2 font-sans text-xs text-ink-60">{r.snippet}</span>
                          ) : (
                            <span className="font-sans text-xs text-ink-40">{tv("notApplicable")}</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </DataTable>
              </div>

              {/* 移动端：紧凑卡片 */}
              <div className="md:hidden">
                {serp.data!.organic.map((r) => (
                  <div key={`${r.position}-${r.link}`} className="border-b border-line-soft py-3 last:border-b-0">
                    <div className="flex items-start gap-2">
                      <span
                        className="font-mono text-sm font-semibold"
                        style={{ color: r.position <= 3 ? RK.up : r.position <= 10 ? RK.warn : RK.ink60 }}
                      >
                        #{r.position}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={r.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`font-sans text-sm font-medium ${RK_LINK_CLASS}`}
                        >
                          {r.title || r.link}
                        </a>
                        <div className="mt-0.5 truncate font-mono text-xs text-ink-40">{r.domain}</div>
                        {r.snippet && (
                          <p className="mt-1 line-clamp-2 font-sans text-xs text-ink-60">{r.snippet}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 意图为文本规则估算，必须标注清楚 */}
            <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("intentNote")}</p>
          </section>
        </>
      )}

      <Toast />
    </div>
  );
}
