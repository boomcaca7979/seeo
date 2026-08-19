"use client";

import { useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import type { SerpResult } from "@/lib/seo/types";
import ChartCard from "@/components/dashboard/charts/ChartCard";
import RelatedKeywordBars from "@/components/dashboard/charts/RelatedKeywordBars";
import { formatNumber } from "@/lib/ui-locale";

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
  if (/什么|怎么|为什么|如何|是不是|哪些/.test(query)) return "信息型";
  if (/推荐|最好|对比|价格|费用|多少钱|哪个好/.test(query)) return "商业型";
  return "导航型";
}

// 意图显示名（detectIntent 返回值保持中文原值，仅展示时翻译）
function intentText(t: ReturnType<typeof useTranslations>, value: string): string {
  if (value === "信息型") return t("intentInformational");
  if (value === "商业型") return t("intentCommercial");
  return t("intentNavigational");
}

export default function KeywordOverviewPage() {
  const t = useTranslations("dashboard.keywords.overview");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
  const [searchValue, setSearchValue] = useState("");
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<Device>("PC");
  const [serp, setSerp] = useState<SerpState>({ loading: false, data: null, error: null, keyword: null });
  const [usage, setUsage] = useState<UsageBadge | null>(null);
  const { show, Toast } = useToast();

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = searchValue.trim();
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
  };

  const hasResult = !!serp.data && serp.data.organic.length > 0;

  // SERP 域名分布：统计前 10 结果中各域名出现次数（作为量级对比的替代）
  const organic = serp.data?.organic;
  const domainDistribution = useMemo(() => {
    if (!organic) return [];
    const counts = new Map<string, number>();
    organic.forEach((r) => {
      counts.set(r.domain, (counts.get(r.domain) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([domain, count]) => ({ keyword: domain, volume: count }))
      .sort((a, b) => b.volume - a.volume);
  }, [organic]);

  return (
    <div className="dash-container p-6 lg:p-8">
      {/* 页头 */}
      <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">
        {t("title")}
      </h1>
      <p className="mt-1 text-sm text-ink-60">
        {t("subtitle")}
      </p>

      {/* 搜索框 */}
      <form onSubmit={handleAnalyze} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="rounded-md border border-line bg-card h-10 px-3 text-sm text-ink focus:border-ink-25 focus:outline-none"
          >
            {KEYWORD_LOCATIONS.map((c) => (
              <option key={c} value={c}>{display(c)}</option>
            ))}
          </select>
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value as Device)}
            className="rounded-md border border-line bg-card h-10 px-3 text-sm text-ink focus:border-ink-25 focus:outline-none"
          >
            <option value="PC">PC</option>
            <option value="移动端">{locale === "zh" ? "移动端" : "Mobile"}</option>
          </select>
        </div>
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-40">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-md border border-line bg-card py-3 pl-11 pr-4 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
        </div>
        <button type="submit" disabled={serp.loading} className="btn-primary px-6 py-3">
          {serp.loading ? t("analyzing") : t("analyze")}
        </button>
      </form>

      {usage && (
        <div className="mt-4 text-xs text-ink-40">
          {t("usage", { used: formatNumber(usage.used, locale), limit: formatNumber(usage.limit, locale) })}
        </div>
      )}

      {/* 概览区：未分析时纯空态 */}
      {!hasResult && !serp.loading && !serp.error && (
        <div className="mt-8 card-a flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-ink-40">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-3 text-sm font-medium text-ink">{t("emptyTitle")}</div>
          <p className="mt-1 text-xs text-ink-40">{t("emptyHint")}</p>
        </div>
      )}

      {/* 错误态 */}
      {serp.error && !serp.loading && (
        <div className="mt-8 card-a p-6 text-center text-sm text-neg">{serp.error}</div>
      )}

      {/* 分析结果 */}
      {hasResult && serp.keyword && (
        <>
          {/* 四张概览卡（真实派生指标） */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <OverviewCard label={t("cardKeyword")} value={serp.keyword} sub={t("subIntent", { intent: intentText(t, detectIntent(serp.keyword)) })} />
            <OverviewCard label={t("cardResults")} value={formatNumber(serp.data!.organic.length, locale)} sub={t("subTop100")} />
            <OverviewCard label={t("cardRelated")} value={formatNumber(serp.data!.relatedSearches.length, locale)} sub={t("subExpandable")} />
            <OverviewCard label={t("cardPaa")} value={formatNumber(serp.data!.relatedQuestions.length, locale)} sub={t("subQuestions")} />
          </div>

          {/* SERP Top 10 */}
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-[1.0625rem] font-semibold text-ink">SERP Top 10</h2>
              <span className="text-xs text-ink-40">
                {t("serpSource")}{serp.data?.fromCache && ` · ${t("cachedTag")}`}
              </span>
            </div>
            <div className="card-a mt-3 overflow-hidden">
              {serp.loading ? (
                <SerpSkeleton />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line-soft bg-line-soft/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colRank")}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colTitle")}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colDomain")}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colSnippet")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serp.data!.organic.map((r) => (
                        <tr key={r.position} className="border-b border-line-soft/60 transition-colors hover:bg-line-soft/40">
                          <td className="px-4 py-3">
                            <span className="text-sm font-semibold text-ink">#{r.position}</span>
                          </td>
                          <td className="px-4 py-3">
                            <a
                              href={r.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-accent hover:underline"
                            >
                              {r.title}
                            </a>
                            {r.date && <span className="ml-2 text-xs text-ink-40">{r.date}</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded bg-line-soft px-2 py-0.5 font-mono text-xs text-ink-60">{r.domain}</span>
                          </td>
                          <td className="px-4 py-3 text-sm text-ink-60 line-clamp-2 max-w-md">{r.snippet || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* 图表区：SERP 域名分布 + 相关搜索 */}
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* SERP 域名分布横向条形图 */}
            <ChartCard
              title={t("chartDomainTitle")}
              subtitle={t("chartDomainSubtitle")}
              height={Math.max(240, domainDistribution.length * 28 + 80)}
              className="lg:col-span-7"
            >
              <RelatedKeywordBars data={domainDistribution} topN={15} />
            </ChartCard>

            {/* 相关搜索词 */}
            <ChartCard
              title={t("chartRelatedTitle")}
              subtitle={t("relatedCount", { count: formatNumber(serp.data?.relatedSearches.length ?? 0, locale) })}
              height={320}
              className="lg:col-span-5"
            >
              {serp.data && serp.data.relatedSearches.length > 0 ? (
                <div className="flex h-full flex-wrap content-start gap-2 overflow-y-auto">
                  {serp.data.relatedSearches.map((r, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-full border border-line bg-card px-3 py-1 text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink"
                    >
                      {r.query}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-ink-40">
                  {t("noRelated")}
                </div>
              )}
            </ChartCard>
          </div>
        </>
      )}

      <Toast />
    </div>
  );
}

function OverviewCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card-a p-5">
      <div className="text-xs text-ink-40">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink break-all">{value}</div>
      <div className="mt-1 text-xs text-ink-40">{sub}</div>
    </div>
  );
}

function SerpSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-line-soft bg-card px-4 py-3">
          <div className="h-3.5 w-8 rounded bg-line-soft" />
          <div className="h-3.5 w-1/3 rounded bg-line-soft" />
          <div className="h-3.5 w-20 rounded bg-line-soft" />
          <div className="h-3.5 flex-1 rounded bg-line-soft" />
        </div>
      ))}
    </div>
  );
}
