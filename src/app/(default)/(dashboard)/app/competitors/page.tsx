"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import {
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
} from "@/components/dashboard/chart-theme";
import ChartCard from "@/components/dashboard/charts/ChartCard";
import SOVGroupBars from "@/components/dashboard/charts/SOVGroupBars";
import CompetitorRankBars, { CompetitorRankRow } from "@/components/dashboard/charts/CompetitorRankBars";
import { SELECTED_PROJECT_KEY, PROJECT_CHANGED_EVENT } from "@/lib/project-selector";
import { formatNumber, intlLocale } from "@/lib/ui-locale";

interface Competitor {
  id: number;
  /** SQLite 竞品记录内部整数 id（非前端项目 UUID） */
  project_id: number;
  domain: string;
  name: string | null;
  created_at: string;
}

interface TrackedKeyword {
  id: number;
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  domain: string;
}

interface RankResult {
  competitor_id: number;
  domain: string;
  rank: number | null;
  target_url: string | null;
  checked_at: string;
  is_self: boolean;
}

interface RanksData {
  keyword: string;
  keyword_id: number;
  domain: string;
  results: RankResult[];
  fromCache: boolean;
}

interface UsageInfo {
  used: number;
  limit: number;
  month: string;
}

interface SOVItem {
  domain: string;
  score: number;
  percentage: number;
  avgRank: number | null;
  top10Count: number;
  keywordCount: number;
}

interface SOVData {
  projectDomain: string;
  totalKeywords: number;
  analyzedKeywords: number;
  competitorCount: number;
  sov: SOVItem[];
}

// 排名颜色：1-3 绿 / 4-10 琥珀 / >10 或 未上榜 灰
function rankColor(rank: number | null): string {
  if (rank === null) return "text-ink-40";
  if (rank <= 3) return "text-pos";
  if (rank <= 10) return "text-warn";
  return "text-neg";
}

function rankText(rank: number | null): string {
  if (rank === null) return "—";
  return `#${rank}`;
}

// SOV 百分比颜色：≥50% 绿 / 30-49% 琥珀 / <30% 红
function sovColor(pct: number): string {
  if (pct >= 50) return "text-pos";
  if (pct >= 30) return "text-warn";
  return "text-neg";
}

function sovBarColor(pct: number): string {
  if (pct >= 50) return "bg-pos";
  if (pct >= 30) return "bg-warn";
  return "bg-neg";
}

// 地区/城市显示名（仅 UI 展示；API location 参数值保持中文原值不变）
const LOCALE_DISPLAY: Record<"en" | "zh", Record<string, string>> = {
  zh: {},
  en: {
    "中国": "China", "美国": "United States", "英国": "United Kingdom",
    "日本": "Japan", "香港": "Hong Kong", "台湾": "Taiwan",
    "北京": "Beijing", "上海": "Shanghai", "广州": "Guangzhou", "深圳": "Shenzhen",
    "纽约": "New York", "洛杉矶": "Los Angeles", "芝加哥": "Chicago",
    "伦敦": "London", "曼彻斯特": "Manchester", "东京": "Tokyo", "大阪": "Osaka", "台北": "Taipei",
  },
};

export default function CompetitorsPage() {
  const t = useTranslations("dashboard.competitors");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
  const { show, Toast } = useToast();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectDomain, setProjectDomain] = useState<string>("");

  // 竞品列表
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [compLoading, setCompLoading] = useState(true);
  const [addDomain, setAddDomain] = useState("");
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // 关键词列表（项目下）
  const [keywords, setKeywords] = useState<TrackedKeyword[]>([]);
  const [selectedKeywordId, setSelectedKeywordId] = useState<number | null>(null);

  // 排名数据
  const [ranks, setRanks] = useState<RanksData | null>(null);
  const [ranksLoading, setRanksLoading] = useState(false);

  // SOV
  const [sov, setSov] = useState<SOVData | null>(null);
  const [sovLoading, setSovLoading] = useState(false);

  // 用量
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  // 读取 localStorage 选中的项目 + 监听 Topbar 项目切换事件
  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyStored = () => {
      // 项目 id 统一 string（鉴权模式 UUID / 演示模式整数），不做 Number() 转换
      const stored = window.localStorage.getItem(SELECTED_PROJECT_KEY);
      if (stored) {
        setProjectId((prev) => (prev === stored ? prev : stored));
      }
    };

    // 首次挂载：读取 localStorage（推迟到下一帧避免 effect 同步路径 setState）
    const tid = window.setTimeout(applyStored, 0);

    // 监听 Topbar 切换项目的自定义事件（同 tab 通知，payload id 为 string）
    const onProjectChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail && typeof detail.id === "string" && detail.id) {
        setProjectId((prev) => (prev === detail.id ? prev : detail.id));
      }
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);

    // 跨 tab 切换时 storage 事件也能触发
    window.addEventListener("storage", applyStored);

    return () => {
      window.clearTimeout(tid);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
      window.removeEventListener("storage", applyStored);
    };
  }, []);

  // 拉取竞品列表（pid 为前端项目 id string：UUID 或演示模式整数）
  const loadCompetitors = useCallback(async (pid: string) => {
    setCompLoading(true);
    try {
      const res = await fetch(`/api/competitors?project_id=${pid}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setCompetitors(json.data ?? []);
        if (json.usage) setUsage(json.usage);
      }
    } catch {
      // ignore
    } finally {
      setCompLoading(false);
    }
  }, []);

  // 拉取项目追踪关键词
  const loadKeywords = useCallback(async () => {
    try {
      const res = await fetch("/api/tracking", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        const all: TrackedKeyword[] = json.data ?? [];
        // 只取当前项目域名下的关键词
        const filtered = projectDomain
          ? all.filter((k) => k.domain === projectDomain)
          : all;
        setKeywords(filtered);
        if (filtered.length > 0 && selectedKeywordId === null) {
          setSelectedKeywordId(filtered[0].id);
        }
        if (json.usage) setUsage(json.usage);
      }
    } catch {
      // ignore
    }
  }, [projectDomain, selectedKeywordId]);

  // 拉取 SOV（pid 为前端项目 id string）
  const loadSov = useCallback(async (pid: string) => {
    setSovLoading(true);
    try {
      const res = await fetch(`/api/competitors/sov?project_id=${pid}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setSov(json.data);
        if (json.usage) setUsage(json.usage);
      }
    } catch {
      // ignore
    } finally {
      setSovLoading(false);
    }
  }, []);

  // 项目变化时拉取竞品 + SOV（推迟到下一帧避免 effect 同步路径 setState）
  useEffect(() => {
    if (projectId === null) return;
    const tid = window.setTimeout(() => {
      // 切换项目时重置关联状态，避免旧项目数据残留
      setProjectDomain("");
      setCompetitors([]);
      setKeywords([]);
      setSelectedKeywordId(null);
      setRanks(null);
      setSov(null);
      void loadCompetitors(projectId);
      void loadSov(projectId);
    }, 0);
    return () => window.clearTimeout(tid);
  }, [projectId, loadCompetitors, loadSov]);

  // 项目变化时直接拉取项目域名（不再依赖竞品列表推断）
  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) {
          const proj = (json.data ?? []).find(
            (p: { id: string; domain: string }) => p.id === projectId
          );
          if (proj) setProjectDomain(proj.domain);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // projectDomain 变化时拉取关键词
  useEffect(() => {
    if (!projectDomain) return;
    const tid = window.setTimeout(() => {
      void loadKeywords();
    }, 0);
    return () => window.clearTimeout(tid);
  }, [projectDomain, loadKeywords]);

  // 添加竞品
  const handleAddCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    const dm = addDomain.trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
    if (!dm) {
      show(t("errDomain"), "error");
      return;
    }
    if (!projectId) {
      show(t("errNoProject"), "error");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          domain: dm,
          name: addName.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("addFailed"));
        show(message, "error");
        return;
      }
      show(t("added", { domain: dm }), "success");
      setAddDomain("");
      setAddName("");
      if (json.usage) setUsage(json.usage);
      await loadCompetitors(projectId);
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    } finally {
      setAdding(false);
    }
  };

  // 删除竞品
  const handleDeleteCompetitor = async (id: number) => {
    try {
      const res = await fetch(`/api/competitors?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("deleteFailed"));
        show(message, "error");
        return;
      }
      show(t("deleted"), "success");
      if (json.usage) setUsage(json.usage);
      if (projectId) {
        await loadCompetitors(projectId);
        await loadSov(projectId);
      }
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    }
  };

  // 刷新排名
  const handleRefreshRanks = async () => {
    if (selectedKeywordId === null) {
      show(t("errNoKeyword"), "info");
      return;
    }
    if (competitors.length === 0) {
      show(t("errNoCompetitors"), "info");
      return;
    }
    setRanksLoading(true);
    try {
      const res = await fetch("/api/competitors/ranks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: selectedKeywordId }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("refreshFailed"));
        show(message, "error");
        setRanks({ ...ranks, results: [] } as RanksData | null);
        return;
      }
      setRanks(json.data);
      if (json.usage) setUsage(json.usage);
      if (json.data?.fromCache) {
        show(t("cacheHit"), "info");
      } else {
        show(t("refreshed"), "success");
      }
      // 刷新 SOV
      if (projectId) await loadSov(projectId);
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    } finally {
      setRanksLoading(false);
    }
  };

  // 选择关键词时自动加载排名
  const ranksFetchRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedKeywordId === null) {
      const tid = window.setTimeout(() => setRanks(null), 0);
      return () => window.clearTimeout(tid);
    }
    if (ranksFetchRef.current === selectedKeywordId) return;
    ranksFetchRef.current = selectedKeywordId;
    const tid = window.setTimeout(() => {
      (async () => {
        setRanksLoading(true);
        try {
          const res = await fetch(`/api/competitors/ranks?keyword_id=${selectedKeywordId}`, { cache: "no-store" });
          const json = await res.json();
          if (res.ok) {
            setRanks(json.data);
            if (json.usage) setUsage(json.usage);
          } else {
            setRanks(null);
          }
        } catch {
          setRanks(null);
        } finally {
          setRanksLoading(false);
        }
      })();
    }, 0);
    return () => window.clearTimeout(tid);
  }, [selectedKeywordId]);

  const usagePercent = usage ? (usage.used / usage.limit) * 100 : 0;
  const quotaExceeded = usage ? usage.used >= usage.limit : false;

  // SOV 趋势图数据（基于当前 sov 结果，单点占位；历史数据需多次刷新积累）
  const sovTrendData = sov && sov.sov.length > 0
    ? [{
        day: new Date().toLocaleDateString(intlLocale(locale), { month: "2-digit", day: "2-digit" }),
        ...Object.fromEntries(sov.sov.map((s) => [s.domain, s.percentage])),
      }]
    : [];

  // SOV 柱状图数据（自己 vs 竞品）
  const sovBarData = sov
    ? sov.sov.map((s) => ({
        domain: s.domain,
        isSelf: s.domain === sov.projectDomain,
        sov: s.percentage,
      }))
    : [];

  // 排名对比柱状图数据（基于当前 ranks.results）
  const rankBarData: CompetitorRankRow[] = ranks && ranks.results.length > 0
    ? [{
        keyword: ranks.keyword,
        ranks: ranks.results.map((r) => ({
          domain: r.domain,
          isSelf: r.is_self,
          rank: r.rank,
        })),
      }]
    : [];

  return (
    <div className="dash-container p-6 lg:p-8">
      {/* 页头：编号 + 标题 + 发丝线 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">06</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {t("title")}
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60">
        {t("subtitle")}
      </p>

      {/* 项目未选择提示 */}
      {projectId === null && (
        <div className="card-a mt-6 p-6 text-center">
          <div className="font-sans text-sm text-ink-40">
            {t("selectProjectFirst")}
          </div>
        </div>
      )}

      {/* SerpApi 额度用尽 banner */}
      {quotaExceeded && (
        <div className="mt-4 rounded-lg border border-neg/30 bg-neg/5 px-4 py-3 font-sans text-sm text-neg">
          {t("quotaExceeded", { used: formatNumber(usage?.used ?? 0, locale), limit: formatNumber(usage?.limit ?? 0, locale) })}
        </div>
      )}

      {projectId !== null && (
        <>
          {/* API 用量条 */}
          {usage && (
            <div className="card-a mt-4 flex items-center gap-3 px-4 py-2.5">
              <span className="font-mono text-xs font-semibold text-ink">
                {t("usageBar", { used: formatNumber(usage.used, locale), limit: formatNumber(usage.limit, locale) })}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
                <div
                  className={`h-full rounded-full transition-all ${usagePercent > 80 ? "bg-neg" : usagePercent > 70 ? "bg-warn" : "bg-pos"}`}
                  style={{ width: `${Math.min(100, usagePercent)}%` }}
                />
              </div>
              {usagePercent > 70 && (
                <span className="font-mono text-[0.625rem] text-neg">{t("quotaTight")}</span>
              )}
              <span className="font-mono text-[0.625rem] text-ink-40">
                {t("countsSummary", { competitors: formatNumber(competitors.length, locale), keywords: formatNumber(keywords.length, locale) })}
              </span>
            </div>
          )}

          {/* 竞品域名管理区 */}
          <div className="card-a mt-6 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-ink">
                {t("manageTitle")}
              </h2>
              <span className="font-mono text-xs text-ink-40">
                {t("competitorCount", { n: formatNumber(competitors.length, locale) })}
              </span>
            </div>

            <form onSubmit={handleAddCompetitor} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={addDomain}
                onChange={(e) => setAddDomain(e.target.value)}
                placeholder={t("domainPlaceholder")}
                className="flex-1 rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
              />
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className="sm:w-40 rounded-lg border border-line bg-card px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
              />
              <button
                type="submit"
                disabled={adding || quotaExceeded}
                className="btn-primary disabled:opacity-60"
              >
                {adding ? t("adding") : t("addBtn")}
              </button>
            </form>

            {/* 已添加竞品列表 */}
            <div className="mt-4">
              {compLoading ? (
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 w-32 rounded-full bg-line-soft" />
                  ))}
                </div>
              ) : competitors.length === 0 ? (
                <div className="py-6 text-center font-mono text-xs text-ink-40">
                  {t("noCompetitors")}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {competitors.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-line-soft px-3 py-1 font-mono text-xs text-ink-60"
                    >
                      {c.domain}
                      {c.name && (
                        <span className="text-ink-40">· {c.name}</span>
                      )}
                      <button
                        onClick={() => setDeleteId(c.id)}
                        className="ml-0.5 text-ink-40 transition-colors hover:text-neg"
                        aria-label={t("deleteAria", { domain: c.domain })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 关键词对比区 */}
          <div className="card-a mt-6 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <label className="font-mono text-xs text-ink-40">{t("keywordLabel")}</label>
                <select
                  value={selectedKeywordId ?? ""}
                  onChange={(e) => setSelectedKeywordId(Number(e.target.value))}
                  className="rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
                >
                  {keywords.length === 0 ? (
                    <option value="">{t("noKeywords")}</option>
                  ) : (
                    keywords.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.keyword} · {display(k.location)} · {k.device === "PC" ? "PC" : locale === "zh" ? "移动端" : "Mobile"}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <button
                onClick={handleRefreshRanks}
                disabled={ranksLoading || selectedKeywordId === null || competitors.length === 0 || quotaExceeded}
                className="btn-secondary disabled:opacity-60"
              >
                {ranksLoading ? t("refreshing") : t("refreshBtn")}
              </button>
            </div>

            {/* SERP 交叉对比表格 */}
            <div className="mt-4 overflow-hidden rounded-lg border border-line-soft">
              {ranksLoading ? (
                <div className="space-y-2 p-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <div className="h-3.5 w-1/4 rounded bg-line-soft" />
                      <div className="h-3.5 w-12 rounded bg-line-soft" />
                      <div className="h-3.5 w-12 rounded bg-line-soft" />
                    </div>
                  ))}
                </div>
              ) : ranks && ranks.results.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line-soft bg-line-soft/40">
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thDomain")}</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thRank")}</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thUrl")}</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranks.results.map((r) => {
                        const selfRank = ranks.results.find((x) => x.is_self)?.rank ?? null;
                        const isCompBetter = r.is_self
                          ? false
                          : (r.rank !== null && (selfRank === null || r.rank < selfRank));
                        const isSelfBetter = r.is_self
                          ? false
                          : (selfRank !== null && (r.rank === null || selfRank < r.rank));
                        return (
                          <tr
                            key={`${r.competitor_id}-${r.domain}`}
                            className={`border-b border-line-soft/60 transition-colors hover:bg-[#FBFAF4] ${
                              r.is_self ? "bg-brand/5" : ""
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`font-mono text-sm ${r.is_self ? "font-semibold text-brand" : "text-ink"}`}>
                                  {r.domain}
                                </span>
                                {r.is_self && (
                                  <span className="badge-warn">{t("selfBadge")}</span>
                                )}
                              </div>
                            </td>
                            <td className={`px-4 py-3 ${isCompBetter ? "bg-warn/5" : ""} ${isSelfBetter ? "bg-pos/5" : ""}`}>
                              <span className={`font-mono text-base font-bold ${rankColor(r.rank)}`}>
                                {rankText(r.rank)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {r.target_url ? (
                                <a
                                  href={r.target_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block max-w-xs truncate font-mono text-xs text-brand hover:text-brand-deep hover:underline"
                                  title={r.target_url}
                                >
                                  {r.target_url}
                                </a>
                              ) : (
                                <span className="font-mono text-xs text-ink-40">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {r.is_self ? (
                                <span className="font-mono text-[0.625rem] text-ink-40">{t("statusBaseline")}</span>
                              ) : isCompBetter ? (
                                <span className="font-mono text-[0.625rem] text-neg">{t("statusAhead")}</span>
                              ) : isSelfBetter ? (
                                <span className="font-mono text-[0.625rem] text-pos">{t("statusBehind")}</span>
                              ) : (
                                <span className="font-mono text-[0.625rem] text-ink-40">{t("statusTied")}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-10 text-center">
                  <div className="font-mono text-xs text-ink-40">
                    {competitors.length === 0
                      ? t("emptyAddFirst")
                      : t("emptyRefreshHint")}
                  </div>
                </div>
              )}
            </div>

            {/* 表格底部统计 */}
            {ranks && (
              <div className="mt-3 flex items-center justify-between font-mono text-[0.625rem] text-ink-40">
                <span>
                  {t("tableKeyword", { keyword: ranks.keyword })} · {ranks.fromCache ? t("cachedHint") : t("liveHint")}
                </span>
                <span>
                  {t("domainsCompared", { n: formatNumber(ranks.results.length, locale) })}
                </span>
              </div>
            )}
          </div>

          {/* SOV 概览卡 */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sovLoading ? (
              [1, 2, 3, 4].map((i) => (
                <div key={i} className="card-a p-5">
                  <div className="h-3 w-20 rounded bg-line-soft" />
                  <div className="mt-2 h-8 w-24 rounded bg-line-soft" />
                </div>
              ))
            ) : sov && sov.sov.length > 0 ? (
              <>
                {/* 我的 SOV */}
                {(() => {
                  const mySov = sov.sov.find((s) => s.domain === sov.projectDomain) ?? sov.sov[0];
                  return (
                    <div className="card-a p-5">
                      <div className="font-mono text-xs text-ink-40">{t("mySov")}</div>
                      <div className={`mt-1 font-mono text-2xl font-bold ${sovColor(mySov.percentage)}`}>
                        {mySov.percentage}%
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-soft">
                        <div
                          className={`h-full rounded-full transition-all ${sovBarColor(mySov.percentage)}`}
                          style={{ width: `${Math.min(100, mySov.percentage)}%` }}
                        />
                      </div>
                      <div className="mt-1.5 font-mono text-[0.625rem] text-ink-40">
                        {t("mySovDetail", { score: formatNumber(mySov.score, locale), keywords: formatNumber(mySov.keywordCount, locale) })}
                      </div>
                    </div>
                  );
                })()}
                {/* Top 1 关键词数 */}
                <div className="card-a p-5">
                  <div className="font-mono text-xs text-ink-40">{t("top3Keywords")}</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-pos">
                    {(() => {
                      const my = sov.sov.find((s) => s.domain === sov.projectDomain);
                      return my?.top10Count ?? 0;
                    })()}
                  </div>
                  <div className="mt-1.5 font-mono text-[0.625rem] text-ink-40">
                    {t("top10Hint")}
                  </div>
                </div>
                {/* 平均排名 */}
                <div className="card-a p-5">
                  <div className="font-mono text-xs text-ink-40">{t("myAvgRank")}</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-ink">
                    {(() => {
                      const my = sov.sov.find((s) => s.domain === sov.projectDomain);
                      return my?.avgRank !== null && my?.avgRank !== undefined ? `#${my.avgRank}` : "—";
                    })()}
                  </div>
                  <div className="mt-1.5 font-mono text-[0.625rem] text-ink-40">
                    {t("avgRankHint")}
                  </div>
                </div>
                {/* 竞品数量 */}
                <div className="card-a p-5">
                  <div className="font-mono text-xs text-ink-40">{t("competitorCountLabel")}</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-ink">
                    {sov.competitorCount}
                  </div>
                  <div className="mt-1.5 font-mono text-[0.625rem] text-ink-40">
                    {t("analyzedKeywords", { analyzed: formatNumber(sov.analyzedKeywords, locale), total: formatNumber(sov.totalKeywords, locale) })}
                  </div>
                </div>
              </>
            ) : (
              <div className="card-a col-span-full p-6 text-center">
                <div className="font-mono text-xs text-ink-40">
                  {t("noSov")}
                </div>
              </div>
            )}
          </div>

          {/* 图表区：SOV 柱状图 + 排名对比柱状图 */}
          {sov && sov.sov.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
              <ChartCard
                title={t("sovChartTitle")}
                subtitle={t("sovChartSubtitle")}
                height={Math.max(220, sovBarData.length * 32 + 80)}
                className="lg:col-span-6"
              >
                <SOVGroupBars data={sovBarData} />
              </ChartCard>
              <ChartCard
                title={t("rankChartTitle")}
                subtitle={ranks ? t("rankChartSubtitle", { keyword: ranks.keyword }) : t("rankChartSubtitleEmpty")}
                height={Math.max(220, rankBarData.length * 40 + 80)}
                className="lg:col-span-6"
              >
                <CompetitorRankBars data={rankBarData} />
              </ChartCard>
            </div>
          )}

          {/* SOV 排名对比表 */}
          {sov && sov.sov.length > 0 && (
            <div className="card-a mt-6 overflow-hidden">
              <div className="border-b border-line-soft px-5 py-3">
                <h2 className="font-display text-sm font-bold text-ink">
                  {t("sovDetailTitle")}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line-soft bg-line-soft/40">
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thDomain")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thSov")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thScore")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thAvgRank")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thTop10")}</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">{t("thKeywords")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sov.sov.map((s) => {
                      const isSelf = s.domain === sov.projectDomain;
                      return (
                        <tr
                          key={s.domain}
                          className={`border-b border-line-soft/60 transition-colors hover:bg-[#FBFAF4] ${
                            isSelf ? "bg-brand/5" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`font-mono text-sm ${isSelf ? "font-semibold text-brand" : "text-ink"}`}>
                                {s.domain}
                              </span>
                              {isSelf && <span className="badge-warn">{t("selfBadge")}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`font-mono text-sm font-bold ${sovColor(s.percentage)}`}>
                                {s.percentage}%
                              </span>
                              <div className="h-1 w-16 overflow-hidden rounded-full bg-line-soft">
                                <div
                                  className={`h-full rounded-full ${sovBarColor(s.percentage)}`}
                                  style={{ width: `${Math.min(100, s.percentage)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-sm text-ink-60">{s.score}</td>
                          <td className="px-4 py-3">
                            <span className={`font-mono text-sm font-semibold ${rankColor(s.avgRank)}`}>
                              {s.avgRank !== null ? `#${s.avgRank}` : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-sm text-ink-60">{s.top10Count}</td>
                          <td className="px-4 py-3 font-mono text-sm text-ink-60">{s.keywordCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SOV 趋势图 */}
          {sov && sov.sov.length > 0 && (
            <div className="card-a mt-6 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-base font-bold text-ink">
                    {t("sovTrendTitle")}
                  </h2>
                  <p className="mt-0.5 font-mono text-xs text-ink-40">
                    {t("sovTrendSubtitle")}
                  </p>
                </div>
              </div>
              <div className="mt-4 h-64">
                {sovTrendData.length > 0 && sov.sov.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sovTrendData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                      <CartesianGrid {...COMMON_GRID_PROPS} />
                      <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", fill: "#7A766E" }}
                        axisLine={{ stroke: "#E8E4D7" }}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                        itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                        formatter={(v) => [`${v}%`, "SOV"]}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", paddingTop: 8 }}
                      />
                      {sov.sov.map((s) => (
                        <Line
                          key={s.domain}
                          type="monotone"
                          dataKey={s.domain}
                          stroke={s.domain === sov.projectDomain ? "#C98A0A" : "#7A766E"}
                          strokeWidth={s.domain === sov.projectDomain ? 2.5 : 1.5}
                          dot={{ r: 3 }}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center font-mono text-xs text-ink-40">
                    {sov.sov.length <= 1
                      ? t("trendNeedCompetitor")
                      : t("trendNoHistory")}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* 删除二次确认 */}
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteId(null)} aria-hidden />
          <div className="relative w-full max-w-sm rounded-xl border border-line bg-card">
            <div className="border-b border-line-soft px-5 py-4">
              <h3 className="font-display text-base font-bold text-ink">{t("deleteConfirmTitle")}</h3>
            </div>
            <div className="px-5 py-4">
              <p className="font-sans text-sm text-ink-60">
                {t("deleteConfirmBody")}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-4">
              <button
                onClick={() => setDeleteId(null)}
                className="btn-secondary"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={() => {
                  if (deleteId) handleDeleteCompetitor(deleteId);
                  setDeleteId(null);
                }}
                className="rounded-lg bg-neg px-4 py-2 font-sans text-sm font-semibold text-paper transition-opacity hover:opacity-90"
              >
                {t("deleteConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
