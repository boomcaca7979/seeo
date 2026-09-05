"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import DomainSelect from "@/components/dashboard/DomainSelect";
import { handleBillingError } from "@/lib/billing-error-client";
import type { SerpResult } from "@/lib/seo/types";
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

interface ExpandData {
  seed: string;
  related: string[];
  paa: string[];
  location: string;
  device: string;
  fromCache: boolean;
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

export default function KeywordExpandPage() {
  const t = useTranslations("dashboard.keywords.expand");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
  const [searchValue, setSearchValue] = useState("");
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<Device>("PC");
  const [trackDomain, setTrackDomain] = useState("");
  const [serp, setSerp] = useState<SerpState>({ loading: false, data: null, error: null, keyword: null });
  const [expand, setExpand] = useState<ExpandState>({ loading: false, data: null, error: null });
  const [usage, setUsage] = useState<UsageBadge | null>(null);
  const [trackingIds, setTrackingIds] = useState<Record<string, boolean>>({});
  const { show, Toast } = useToast();

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = searchValue.trim();
    if (!kw) {
      show(t("errKeyword"), "error");
      return;
    }
    setSerp({ loading: true, data: null, error: null, keyword: kw });
    setExpand({ loading: true, data: null, error: null });

    const serpPromise = (async () => {
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
      } catch (err) {
        const msg = `${tc("networkError")} ${(err as Error).message}`;
        setSerp({ loading: false, data: null, error: msg, keyword: kw });
        show(msg, "error");
      }
    })();

    const expandPromise = (async () => {
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
          return;
        }
        setExpand({ loading: false, data: json.data, error: null });
        if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
      } catch (err) {
        setExpand({ loading: false, data: null, error: `${t("expandNetworkError")}${(err as Error).message}` });
      }
    })();

    await Promise.all([serpPromise, expandPromise]);
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

  const hasResult = !!serp.data || !!expand.data;
  const expandTotal = (expand.data?.related.length ?? 0) + (expand.data?.paa.length ?? 0);

  // 相关词表格（关键词来自 SERP；意图为 detectIntent 基于关键词文本的规则估算）
  const relatedRows = (serp.data?.relatedSearches ?? []).map((r) => ({
    keyword: r.query,
    intent: detectIntent(r.query),
  }));

  return (
    <div className="dash-container p-6 lg:p-8">
      <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">{t("title")}</h1>
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
          <DomainSelect
            value={trackDomain}
            onChange={(d) => setTrackDomain(d)}
            className="h-10 min-w-[180px]"
          />
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

      {/* 未分析时纯空态 */}
      {!hasResult && !serp.loading && !expand.loading && !serp.error && !expand.error && (
        <div className="mt-8 card-a flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-ink-40">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-3 text-sm font-medium text-ink">{t("emptyTitle")}</div>
          <p className="mt-1 text-xs text-ink-40">{t("emptyHint")}</p>
        </div>
      )}

      {/* 拓词建议区 */}
      {(expand.loading || expand.data || expand.error) && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[1.0625rem] font-semibold text-ink">{t("title")}</h2>
            <span className="text-xs text-ink-40">
              {expand.data ? t("totalCount", { count: formatNumber(expandTotal, locale) }) : expand.loading ? t("fetching") : ""}
            </span>
          </div>

          {expand.loading ? (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ExpandSkeleton />
              <ExpandSkeleton />
            </div>
          ) : expand.error ? (
            <div className="card-a mt-4 p-6 text-center text-sm text-neg">{expand.error}</div>
          ) : expand.data ? (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card-a p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">{t("relatedTitle")}</h3>
                  <span className="text-xs text-ink-40">{t("countItems", { count: formatNumber(expand.data.related.length, locale) })}</span>
                </div>
                {expand.data.related.length === 0 ? (
                  <div className="mt-4 py-6 text-center text-xs text-ink-40">{t("noRelated")}</div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {expand.data.related.map((q) => (
                      <ExpandTag key={q} query={q} tracked={!!trackingIds[q]} onTrack={() => handleTrackFromExpand(q)} />
                    ))}
                  </div>
                )}
              </div>
              <div className="card-a p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">{t("paaTitle")}</h3>
                  <span className="text-xs text-ink-40">{t("countItems", { count: formatNumber(expand.data.paa.length, locale) })}</span>
                </div>
                {expand.data.paa.length === 0 ? (
                  <div className="mt-4 py-6 text-center text-xs text-ink-40">{t("noPaa")}</div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {expand.data.paa.map((q) => (
                      <ExpandTag key={q} query={q} tracked={!!trackingIds[q]} onTrack={() => handleTrackFromExpand(q)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* 相关关键词表格 */}
      {(serp.loading || (serp.data && serp.data.relatedSearches.length > 0) || serp.error) && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[1.0625rem] font-semibold text-ink">{t("relatedKeywordsTitle")}</h2>
            <span className="text-xs text-ink-40">{t("relatedKeywordsSource")}</span>
          </div>
          <div className="card-a mt-3 overflow-hidden">
            {serp.loading ? (
              <SerpSkeleton rows={5} />
            ) : serp.error ? (
              <div className="p-6 text-center text-sm text-neg">{serp.error}</div>
            ) : relatedRows.length === 0 ? (
              <div className="p-6 text-center text-sm text-ink-40">{t("noRelatedKeywords")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line-soft bg-line-soft/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colKeyword")}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colIntent")}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-ink-40">{t("colAction")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatedRows.map((r) => (
                      <tr key={r.keyword} className="border-b border-line-soft/60 transition-colors hover:bg-line-soft/40">
                        <td className="px-4 py-3 text-sm font-medium text-ink">{r.keyword}</td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-line-soft px-2 py-0.5 text-xs text-ink-60">{intentText(t, r.intent)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleTrackFromExpand(r.keyword)}
                            className="text-xs font-medium text-accent hover:underline"
                          >
                            {t("trackAction")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}

function ExpandTag({ query, tracked, onTrack }: { query: string; tracked: boolean; onTrack: () => void }) {
  const t = useTranslations("dashboard.keywords.expand");
  const intent = detectIntent(query);
  return (
    <div className="group inline-flex items-center gap-2 rounded-full border border-line bg-card pl-3 pr-2 py-1">
      <span className="text-xs text-ink">{query}</span>
      <span className="text-xs text-ink-40">{intentText(t, intent)}</span>
      <button
        onClick={onTrack}
        disabled={tracked}
        className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
          tracked ? "bg-pos/15 text-pos" : "bg-line-soft text-ink-60 hover:bg-ink hover:text-card"
        }`}
        title={tracked ? t("trackedTitle") : t("trackTitle")}
      >
        {tracked ? "✓" : "+"}
      </button>
    </div>
  );
}

function SerpSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-line-soft bg-card px-4 py-3">
          <div className="h-3.5 w-1/3 rounded bg-line-soft" />
          <div className="h-3.5 w-20 rounded bg-line-soft" />
          <div className="ml-auto h-3.5 w-10 rounded bg-line-soft" />
        </div>
      ))}
    </div>
  );
}

function ExpandSkeleton() {
  return (
    <div className="card-a p-5">
      <div className="h-4 w-24 rounded bg-line-soft" />
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-7 rounded-full bg-line-soft" style={{ width: `${60 + (i * 13) % 80}px` }} />
        ))}
      </div>
    </div>
  );
}
