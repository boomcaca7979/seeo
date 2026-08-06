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
import { useToast } from "@/components/dashboard/Toast";
import {
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
} from "@/components/dashboard/chart-theme";

const SELECTED_PROJECT_KEY = "seeo:selected-project-id";

interface Competitor {
  id: number;
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

export default function CompetitorsPage() {
  const { show, Toast } = useToast();

  const [projectId, setProjectId] = useState<number | null>(null);
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

  // 读取 localStorage 选中的项目（推迟到下一帧避免 effect 同步路径 setState）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SELECTED_PROJECT_KEY);
    const id = stored ? Number(stored) : NaN;
    if (Number.isInteger(id) && id > 0) {
      const tid = window.setTimeout(() => setProjectId(id), 0);
      return () => window.clearTimeout(tid);
    }
  }, []);

  // 拉取竞品列表
  const loadCompetitors = useCallback(async (pid: number) => {
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

  // 拉取 SOV
  const loadSov = useCallback(async (pid: number) => {
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
      void loadCompetitors(projectId);
      void loadSov(projectId);
    }, 0);
    return () => window.clearTimeout(tid);
  }, [projectId, loadCompetitors, loadSov]);

  // projectDomain 变化时拉取关键词
  useEffect(() => {
    if (!projectDomain) return;
    const tid = window.setTimeout(() => {
      void loadKeywords();
    }, 0);
    return () => window.clearTimeout(tid);
  }, [projectDomain, loadKeywords]);

  // 从竞品列表推断项目域名（第一次加载时）
  useEffect(() => {
    if (projectDomain || competitors.length === 0 || keywords.length > 0) return;
    // 通过 /api/projects 拿到当前项目域名
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = await res.json();
        if (res.ok) {
          const proj = (json.data ?? []).find((p: { id: number; domain: string }) => p.id === projectId);
          if (proj) setProjectDomain(proj.domain);
        }
      } catch {
        // ignore
      }
    })();
  }, [competitors, keywords, projectDomain, projectId]);

  // 添加竞品
  const handleAddCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    const dm = addDomain.trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
    if (!dm) {
      show("请输入竞品域名", "error");
      return;
    }
    if (!projectId) {
      show("请先在顶栏选择项目", "error");
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
        show(json?.error ?? "添加失败", "error");
        return;
      }
      show(`已添加竞品：${dm}`, "success");
      setAddDomain("");
      setAddName("");
      if (json.usage) setUsage(json.usage);
      await loadCompetitors(projectId);
    } catch (err) {
      show(`网络错误：${(err as Error).message}`, "error");
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
        show(json?.error ?? "删除失败", "error");
        return;
      }
      show("已删除竞品", "success");
      if (json.usage) setUsage(json.usage);
      if (projectId) {
        await loadCompetitors(projectId);
        await loadSov(projectId);
      }
    } catch (err) {
      show(`网络错误：${(err as Error).message}`, "error");
    }
  };

  // 刷新排名
  const handleRefreshRanks = async () => {
    if (selectedKeywordId === null) {
      show("请先选择关键词", "info");
      return;
    }
    if (competitors.length === 0) {
      show("请先添加竞品域名", "info");
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
        const msg = json?.error ?? "刷新失败";
        show(msg, "error");
        setRanks({ ...ranks, results: [] } as RanksData | null);
        return;
      }
      setRanks(json.data);
      if (json.usage) setUsage(json.usage);
      if (json.data?.fromCache) {
        show("命中缓存，未消耗额度", "info");
      } else {
        show("已刷新竞品排名（消耗 1 次额度）", "success");
      }
      // 刷新 SOV
      if (projectId) await loadSov(projectId);
    } catch (err) {
      show(`网络错误：${(err as Error).message}`, "error");
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
  const quotaExceeded = usage ? usage.used >= 80 : false;

  // SOV 趋势图数据（基于当前 sov 结果，单点占位；历史数据需多次刷新积累）
  const sovTrendData = sov && sov.sov.length > 0
    ? [{
        day: new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }),
        ...Object.fromEntries(sov.sov.map((s) => [s.domain, s.percentage])),
      }]
    : [];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 页头：编号 + 标题 + 发丝线 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">06</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          竞品分析
        </h1>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60">
        监控竞品在同一关键词下的排名表现，计算 SOV 份额。
      </p>

      {/* 项目未选择提示 */}
      {projectId === null && (
        <div className="card-a mt-6 p-6 text-center">
          <div className="font-sans text-sm text-ink-40">
            请先在顶栏选择一个项目
          </div>
        </div>
      )}

      {/* SerpApi 额度用尽 banner */}
      {quotaExceeded && (
        <div className="mt-4 rounded-lg border border-neg/30 bg-neg/5 px-4 py-3 font-sans text-sm text-neg">
          本月 SerpApi 额度已用尽，无法刷新竞品排名（{usage?.used}/{usage?.limit}）
        </div>
      )}

      {projectId !== null && (
        <>
          {/* API 用量条 */}
          {usage && (
            <div className="card-a mt-4 flex items-center gap-3 px-4 py-2.5">
              <span className="font-mono text-xs font-semibold text-ink">
                本月 API 用量 {usage.used}/{usage.limit}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
                <div
                  className={`h-full rounded-full transition-all ${usagePercent > 80 ? "bg-neg" : usagePercent > 70 ? "bg-warn" : "bg-pos"}`}
                  style={{ width: `${Math.min(100, usagePercent)}%` }}
                />
              </div>
              {usagePercent > 70 && (
                <span className="font-mono text-[10px] text-neg">额度紧张</span>
              )}
              <span className="font-mono text-[10px] text-ink-40">
                竞品 {competitors.length} 个 · 关键词 {keywords.length} 个
              </span>
            </div>
          )}

          {/* 竞品域名管理区 */}
          <div className="card-a mt-6 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-ink">
                竞品域名管理
              </h2>
              <span className="font-mono text-xs text-ink-40">
                {competitors.length} 个竞品
              </span>
            </div>

            <form onSubmit={handleAddCompetitor} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={addDomain}
                onChange={(e) => setAddDomain(e.target.value)}
                placeholder="输入竞品域名，如 example.com"
                className="flex-1 rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
              />
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="名称（可选）"
                className="sm:w-40 rounded-lg border border-line bg-card px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
              />
              <button
                type="submit"
                disabled={adding || quotaExceeded}
                className="btn-primary disabled:opacity-60"
              >
                {adding ? "添加中…" : "+ 添加竞品"}
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
                  暂无竞品，添加后开始对比
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
                        aria-label={`删除 ${c.domain}`}
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
                <label className="font-mono text-xs text-ink-40">关键词</label>
                <select
                  value={selectedKeywordId ?? ""}
                  onChange={(e) => setSelectedKeywordId(Number(e.target.value))}
                  className="rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
                >
                  {keywords.length === 0 ? (
                    <option value="">暂无追踪关键词</option>
                  ) : (
                    keywords.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.keyword} · {k.location} · {k.device}
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
                {ranksLoading ? "刷新中…" : "刷新排名"}
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
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">域名</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">排名</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">命中页面</th>
                        <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">状态</th>
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
                                  <span className="badge-warn">本站</span>
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
                                <span className="font-mono text-[10px] text-ink-40">基准</span>
                              ) : isCompBetter ? (
                                <span className="font-mono text-[10px] text-neg">领先于我</span>
                              ) : isSelfBetter ? (
                                <span className="font-mono text-[10px] text-pos">落后于我</span>
                              ) : (
                                <span className="font-mono text-[10px] text-ink-40">持平</span>
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
                      ? "请先添加竞品域名"
                      : "点击「刷新排名」拉取 SERP 对比数据"}
                  </div>
                </div>
              )}
            </div>

            {/* 表格底部统计 */}
            {ranks && (
              <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-ink-40">
                <span>
                  关键词「{ranks.keyword}」· {ranks.fromCache ? "缓存数据 · 24h 内不重复计费" : "实时数据 · 已消耗 1 次额度"}
                </span>
                <span>
                  共 {ranks.results.length} 个域名对比
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
                      <div className="font-mono text-xs text-ink-40">我的 SOV</div>
                      <div className={`mt-1 font-mono text-2xl font-bold ${sovColor(mySov.percentage)}`}>
                        {mySov.percentage}%
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-soft">
                        <div
                          className={`h-full rounded-full transition-all ${sovBarColor(mySov.percentage)}`}
                          style={{ width: `${Math.min(100, mySov.percentage)}%` }}
                        />
                      </div>
                      <div className="mt-1.5 font-mono text-[10px] text-ink-40">
                        得分 {mySov.score} · 关键词 {mySov.keywordCount} 个
                      </div>
                    </div>
                  );
                })()}
                {/* Top 1 关键词数 */}
                <div className="card-a p-5">
                  <div className="font-mono text-xs text-ink-40">Top 3 关键词数</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-pos">
                    {(() => {
                      const my = sov.sov.find((s) => s.domain === sov.projectDomain);
                      return my?.top10Count ?? 0;
                    })()}
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] text-ink-40">
                    进入前 10 的关键词数
                  </div>
                </div>
                {/* 平均排名 */}
                <div className="card-a p-5">
                  <div className="font-mono text-xs text-ink-40">我的平均排名</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-ink">
                    {(() => {
                      const my = sov.sov.find((s) => s.domain === sov.projectDomain);
                      return my?.avgRank !== null && my?.avgRank !== undefined ? `#${my.avgRank}` : "—";
                    })()}
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] text-ink-40">
                    所有已分析关键词均值
                  </div>
                </div>
                {/* 竞品数量 */}
                <div className="card-a p-5">
                  <div className="font-mono text-xs text-ink-40">竞品数量</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-ink">
                    {sov.competitorCount}
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] text-ink-40">
                    已分析 {sov.analyzedKeywords}/{sov.totalKeywords} 个关键词
                  </div>
                </div>
              </>
            ) : (
              <div className="card-a col-span-full p-6 text-center">
                <div className="font-mono text-xs text-ink-40">
                  暂无 SOV 数据，请先添加竞品并刷新排名
                </div>
              </div>
            )}
          </div>

          {/* SOV 排名对比表 */}
          {sov && sov.sov.length > 0 && (
            <div className="card-a mt-6 overflow-hidden">
              <div className="border-b border-line-soft px-5 py-3">
                <h2 className="font-display text-sm font-bold text-ink">
                  SOV 份额明细
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line-soft bg-line-soft/40">
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">域名</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">SOV 份额</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">得分</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">平均排名</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">Top 10 数</th>
                      <th className="px-4 py-3 text-left font-mono text-xs font-semibold text-ink-40">关键词数</th>
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
                              {isSelf && <span className="badge-warn">本站</span>}
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
                    SOV 趋势
                  </h2>
                  <p className="mt-0.5 font-mono text-xs text-ink-40">
                    各域名 SOV 百分比变化 · 多次刷新积累历史数据
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
                      ? "至少需要 1 个竞品才能对比 SOV 趋势"
                      : "暂无历史数据，多次刷新排名后显示趋势"}
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
              <h3 className="font-display text-base font-bold text-ink">确认删除</h3>
            </div>
            <div className="px-5 py-4">
              <p className="font-sans text-sm text-ink-60">
                删除后将同时清除该竞品的所有排名记录，无法恢复。确定继续？
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-4">
              <button
                onClick={() => setDeleteId(null)}
                className="btn-secondary"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (deleteId) handleDeleteCompetitor(deleteId);
                  setDeleteId(null);
                }}
                className="rounded-lg bg-neg px-4 py-2 font-sans text-sm font-semibold text-paper transition-opacity hover:opacity-90"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
