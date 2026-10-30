"use client";

// ===== SERP 分析区（P4-D：实际排名结果 + SERP Features + 按需分页）=====
// 第一页快照来自「分析」的同一个 SerpApi 调用（零额外成本）；更深的页是独立引擎调用
// （SerpApi start 偏移，每页独立缓存 key + 1 个配额单位），只能由用户显式触发。
// 口径硬约束：只统计真实返回的 organic 条数；Google 自报总数（totalResults）单独标注
// 为估计值，绝不与实际获得条数混同；分页返回不足/0 条时如实显示，不用占位数据补齐。

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { StatusBadge } from "@/components/viz/StatusBadge";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import { RK, RK_LINK_CLASS } from "@/components/viz/rank-theme";
import { formatNumber } from "@/lib/ui-locale";
import type { OrganicResultRow, SerpFeatureRow, SerpSnapshot } from "./types";

// 与 keyword-overview 页同一份映射（provider 真实返回的 featureType；未收录类型原样展示）
const SERP_FEATURE_LABEL_KEYS: Record<string, string> = {
  featured_snippet: "featureFeaturedSnippet",
  ai_overview: "featureAiOverview",
  local_pack: "featureLocalPack",
  knowledge_graph: "featureKnowledgeGraph",
  top_stories: "featureTopStories",
  video_results: "featureVideoResults",
  images_results: "featureImagesResults",
  shopping_results: "featureShoppingResults",
  twitter_results: "featureTwitter",
  events_results: "featureEvents",
};

/** 每页请求的 start 步长（SerpApi 默认 num=10） */
const PAGE_STEP = 10;

export function SerpSection({
  seed,
  location,
  device,
  snapshot,
}: {
  seed: string;
  location: string;
  device: "PC" | "移动端";
  snapshot: SerpSnapshot;
}) {
  const t = useTranslations("dashboard.keywords.expand");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const { show, Toast } = useToast();

  // 已加载的真实结果（第一页 = 快照；后续页按 start 偏移追加，跨页按 link 去重）
  const [rows, setRows] = useState<OrganicResultRow[]>(snapshot.organic);
  const [pagesRequested, setPagesRequested] = useState(1);
  const [more, setMore] = useState<"idle" | "loading" | "error" | "exhausted">("idle");
  const [moreError, setMoreError] = useState<string | null>(null);

  const features: SerpFeatureRow[] = snapshot.features ?? [];

  /** 域名分布（真实计数）：出现次数 ≥2 才单列，其余合并为「其他域名」避免长尾刷屏 */
  const domainDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.domain, (counts.get(row.domain) ?? 0) + 1);
    return [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
  }, [rows]);

  const handleLoadMore = async () => {
    if (more === "loading") return;
    setMore("loading");
    setMoreError(null);
    const start = pagesRequested * PAGE_STEP;
    try {
      const res = await fetch(
        `/api/seo/serp?keyword=${encodeURIComponent(seed)}&location=${encodeURIComponent(location)}&device=${encodeURIComponent(device)}&start=${start}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("serpLoadMoreFailed"));
        setMore("error");
        setMoreError(message);
        show(message, "error");
        return;
      }
      const data = json.data as { organic?: OrganicResultRow[]; usage?: unknown };
      const existingLinks = new Set(rows.map((r) => r.link));
      const fresh = (data.organic ?? []).filter((r) => !existingLinks.has(r.link));
      setRows((prev) => [...prev, ...fresh]);
      setPagesRequested((pages) => pages + 1);
      // 返回 0 条 = 已到真实末尾（不是错误态）；下次不再发请求
      setMore((data.organic ?? []).length === 0 ? "exhausted" : "idle");
      if (json.usage && typeof json.usage.used === "number") {
        show(t("serpPageLoaded", { count: formatNumber(fresh.length, locale) }), "success");
      }
    } catch (err) {
      const msg = `${tc("networkError")} ${(err as Error).message}`;
      setMore("error");
      setMoreError(msg);
      show(msg, "error");
    }
  };

  return (
    <section className="card-a mt-4 p-5" aria-label={t("serpSectionTitle")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-ink">{t("serpSectionTitle")}</h3>
          <p className="mt-0.5 font-sans text-xs text-ink-40">{t("serpSectionSub")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={snapshot.fromCache ? `${t("serpSourceTag")} · ${t("cachedTag")}` : t("serpSourceTag")}
            tone={snapshot.fromCache ? "info" : "pos"}
            dot={false}
          />
        </div>
      </header>

      {/* 口径标注：真实分析条数 vs Google 自报总数 vs 广告状态（三者含义不同） */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-xs text-ink-40">
        <span>{t("serpAnalyzedCount", { count: formatNumber(rows.length, locale) })}</span>
        {/* 已查看范围与已请求页数：跨页去重后实际展示条数，绝不拿 Google 自报总数冒充已查看 */}
        <span title={t("serpViewedRangeTitle")}>
          {t("serpViewedRange", {
            count: formatNumber(rows.length, locale),
            pages: formatNumber(pagesRequested, locale),
          })}
        </span>
        {snapshot.totalResults !== null && snapshot.totalResults !== undefined && (
          <span title={t("serpTotalResultsTitle")}>
            {t("serpTotalResultsNote", { count: formatNumber(snapshot.totalResults, locale) })}
          </span>
        )}
        {snapshot.adsCount !== null && snapshot.adsCount !== undefined && (
          <span>
            {snapshot.adsCount > 0
              ? t("serpAdsCount", { count: formatNumber(snapshot.adsCount, locale) })
              : t("serpAdsZero")}
          </span>
        )}
        <span>{snapshot.fetchedAt.slice(0, 19).replace("T", " ")} UTC</span>
      </div>

      {/* SERP Features（provider 真实返回的块；空 = 本次快照未捕获） */}
      {features.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("serpFeaturesLabel")}</span>
          {features.map((feature, i) => {
            const labelKey = SERP_FEATURE_LABEL_KEYS[feature.featureType];
            return (
              <span
                key={`${feature.featureType}-${i}`}
                title={feature.title ?? undefined}
                className="inline-flex items-center rounded-sm border border-line bg-card px-2 py-1 font-sans text-xs text-ink-60"
              >
                {labelKey ? t(labelKey) : feature.featureType}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 font-sans text-xs text-ink-40">{t("serpFeaturesEmpty")}</p>
      )}

      {/* 域名分布（出现次数 ≥1 的真实计数；与搜索量无关） */}
      {domainDistribution.length > 0 && (
        <p className="mt-3 font-sans text-xs text-ink-40">
          {t("serpDomainSummary", {
            domains: formatNumber(domainDistribution.length, locale),
            count: formatNumber(rows.length, locale),
          })}
        </p>
      )}

      {/* 结果表：与 keyword-overview 同一套列（位置/标题/域名/摘要） */}
      {rows.length > 0 ? (
        <div className="mt-4">
          <div className="hidden overflow-x-auto md:block">
            <DataTable minWidthRem={50} ariaLabel={t("serpSectionTitle")}>
              <THead>
                <Th align="right" width="5rem">{t("colRank")}</Th>
                <Th>{t("colTitle")}</Th>
                <Th width="10rem">{t("colDomain")}</Th>
                <Th width="28%">{t("colSnippet")}</Th>
              </THead>
              <TBody>
                {rows.map((r, i) => (
                  <TR key={`${r.link}-${i}`}>
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
                        <span className="font-sans text-xs text-ink-40">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </DataTable>
          </div>

          {/* 移动端：紧凑卡片 */}
          <div className="md:hidden">
            {rows.map((r, i) => (
              <div key={`${r.link}-${i}`} className="border-b border-line-soft py-3 last:border-b-0">
                <div className="flex items-start gap-2">
                  <span
                    className="font-mono text-sm font-semibold"
                    style={{ color: r.position <= 3 ? RK.up : RK.ink60 }}
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
                    {r.snippet && <p className="mt-1 line-clamp-2 font-sans text-xs text-ink-60">{r.snippet}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-center font-sans text-sm text-ink-40">
          {t("serpNoOrganic")}
        </div>
      )}

      {/* 按需分页：加载更多 = 独立引擎调用（每页 1 个配额单位，缓存 24h） */}
      {more !== "exhausted" ? (
        <div className="mt-4 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={more === "loading"}
            className="rounded-md border border-line bg-card px-4 py-2 font-sans text-sm text-ink hover:border-ink-25 disabled:opacity-60"
            title={t("serpLoadMoreCost")}
          >
            {more === "loading" ? t("serpLoadingMore") : t("serpLoadMore")}
          </button>
          <span className="font-mono text-xs text-ink-40">{t("serpLoadMoreCost")}</span>
          {more === "error" && moreError && (
            <span className="font-sans text-xs text-neg">{moreError}</span>
          )}
        </div>
      ) : (
        <p className="mt-4 text-center font-sans text-xs text-ink-40">{t("serpNoMoreResults")}</p>
      )}

      <Toast />
    </section>
  );
}
