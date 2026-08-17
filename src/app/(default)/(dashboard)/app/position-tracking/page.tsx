"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { formatNumber } from "@/lib/ui-locale";
import { formatRelativeTime } from "@/lib/relative-time";
import Modal from "@/components/dashboard/Modal";
import DomainSelect from "@/components/dashboard/DomainSelect";
import { ChangeBadge, RankBadge } from "@/components/dashboard/Badges";
import { rankCompetitors } from "@/lib/mock-data";
import {
  COMMON_GRID_PROPS,
  COMMON_XAXIS_PROPS,
  RANK_YAXIS_PROPS,
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
} from "@/components/dashboard/chart-theme";
import ChartCard from "@/components/dashboard/charts/ChartCard";
import RankDistributionDonut from "@/components/dashboard/charts/RankDistributionDonut";
import MultiRankTrend, { MultiRankSeries } from "@/components/dashboard/charts/MultiRankTrend";
import RankChangeBars from "@/components/dashboard/charts/RankChangeBars";

const REGION_CITIES: Record<string, string[]> = {
  "中国": ["北京", "上海", "广州", "深圳"],
  "美国": ["纽约", "洛杉矶", "芝加哥"],
  "英国": ["伦敦", "曼彻斯特"],
  "日本": ["东京", "大阪"],
  "香港": ["香港"],
  "台湾": ["台北"],
};
const RANK_LOCATIONS = Object.keys(REGION_CITIES);
type Device = "PC" | "移动端";

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

interface KeywordGroup {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}
interface TrackedKeyword {
  id: number;
  keyword: string;
  location: string;
  device: "PC" | "移动端";
  domain: string;
  created_at: string;
  last_refreshed_at: string | null;
  todayPosition: number | null;
  yesterdayPosition: number | null;
  change: number | null;
  matchedUrl: string | null;
  groups: KeywordGroup[];
}
interface UsageInfo { used: number; limit: number; month: string; }
interface RankHistoryPoint { date: string; position: number | null; url: string | null; }

export default function PositionTrackingPage() {
  const t = useTranslations("dashboard.positionTracking");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
  const deviceLabel = (d: Device) => (d === "PC" ? "PC" : t("deviceMobile"));
  const { show, Toast } = useToast();
  const [device, setDevice] = useState<Device>("PC");
  const [country, setCountry] = useState(RANK_LOCATIONS[0]);
  const [cities, setCities] = useState<string[]>(REGION_CITIES[RANK_LOCATIONS[0]]);
  const [city, setCity] = useState(REGION_CITIES[RANK_LOCATIONS[0]][0]);
  const [tracked, setTracked] = useState<TrackedKeyword[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [trackingLimit, setTrackingLimit] = useState(5);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<RankHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addKeyword, setAddKeyword] = useState("");
  const [addDomain, setAddDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [groups, setGroups] = useState<KeywordGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupMenuId, setGroupMenuId] = useState<number | null>(null);

  const handleRegionChange = (region: string) => {
    setCountry(region);
    const next = REGION_CITIES[region] ?? [];
    setCities(next);
    setCity(next[0] ?? "");
  };

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetch("/api/tracking");
      const json = await res.json();
      if (res.ok) {
        setTracked(json.data);
        if (json.usage) setUsage(json.usage);
        if (json.limit) setTrackingLimit(json.limit);
      }
    } catch { /* ignore */ } finally {
      setListLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/keywords/groups", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setGroups(json.data);
    } catch { /* ignore */ }
  }, []);

  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    void loadList();
    void loadGroups();
  }, [loadList, loadGroups]);

  useEffect(() => {
    if (groupMenuId === null) return;
    const handler = () => setGroupMenuId(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [groupMenuId]);

  const filteredTracked = tracked.filter((t) => {
    if (t.location !== country) return false;
    if (t.device !== device) return false;
    if (groupFilter === "all") return true;
    if (groupFilter === "ungrouped") return t.groups.length === 0;
    const gid = Number(groupFilter.replace("group-", ""));
    return t.groups.some((g) => g.id === gid);
  });

  const lastRegionKeyRef = useRef<string>(`${country}|${device}`);
  useEffect(() => {
    const key = `${country}|${device}`;
    if (key === lastRegionKeyRef.current) return;
    lastRegionKeyRef.current = key;
    setSelectedId(null);
    void loadList();
  }, [country, device, loadList]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) { show(t("errGroupName"), "error"); return; }
    setCreatingGroup(true);
    try {
      const res = await fetch("/api/keywords/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: newGroupDesc.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { const { message } = handleBillingError(json, t("createGroupFailed")); show(message, "error"); return; }
      show(t("groupCreated", { name }), "success");
      setCreateGroupModalOpen(false);
      setNewGroupName("");
      setNewGroupDesc("");
      await loadGroups();
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleAddToGroup = async (groupId: number, keywordId: number) => {
    try {
      const res = await fetch(`/api/keywords/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: keywordId }),
      });
      const json = await res.json();
      if (!res.ok) { const { message } = handleBillingError(json, t("addToGroupFailed")); show(message, "error"); return; }
      show(t("addedToGroup"), "success");
      setGroupMenuId(null);
      await loadList();
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    }
  };

  const handleRemoveFromGroup = async (groupId: number, keywordId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/keywords/groups/${groupId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: keywordId }),
      });
      const json = await res.json();
      if (!res.ok) { const { message } = handleBillingError(json, t("removeFromGroupFailed")); show(message, "error"); return; }
      show(t("removedFromGroup"), "success");
      await loadList();
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    }
  };

  const loadHistory = useCallback(async (keywordId: number) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/tracking/history?id=${keywordId}&days=30`);
      const json = await res.json();
      if (res.ok) setHistory(json.data ?? []);
    } catch { /* ignore */ } finally {
      setHistoryLoading(false);
    }
  }, []);

  const historyFetchRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedId === null) {
      const id = window.setTimeout(() => setHistory([]), 0);
      return () => window.clearTimeout(id);
    }
    if (historyFetchRef.current === selectedId) return;
    historyFetchRef.current = selectedId;
    void loadHistory(selectedId);
  }, [selectedId, loadHistory]);

  const selectedKeyword = tracked.find((t) => t.id === selectedId) ?? null;
  useEffect(() => {
    const needFallback =
      (selectedId !== null && !tracked.find((t) => t.id === selectedId)) ||
      (selectedId === null && tracked.length > 0);
    if (needFallback) {
      const id = window.setTimeout(() => setSelectedId(tracked[0]?.id ?? null), 0);
      return () => window.clearTimeout(id);
    }
  }, [tracked, selectedId]);

  const stats = {
    total: tracked.length,
    top3: tracked.filter((t) => t.todayPosition !== null && t.todayPosition <= 3).length,
    top10: tracked.filter((t) => t.todayPosition !== null && t.todayPosition <= 10).length,
    top100: tracked.filter((t) => t.todayPosition !== null).length,
    up: tracked.filter((t) => t.change !== null && t.change > 0).length,
    down: tracked.filter((t) => t.change !== null && t.change < 0).length,
  };
  const usagePercent = usage ? (usage.used / usage.limit) * 100 : 0;

  // 多关键词排名趋势：取当前筛选下前 5 个词的 30 天历史
  const [multiSeries, setMultiSeries] = useState<MultiRankSeries[]>([]);
  const [multiLoading, setMultiLoading] = useState(false);
  useEffect(() => {
    const top5 = filteredTracked.slice(0, 5);
    const tid = window.setTimeout(() => {
      if (top5.length === 0) {
        setMultiSeries([]);
        return;
      }
      let cancelled = false;
      setMultiLoading(true);
      (async () => {
        const results = await Promise.all(
          top5.map(async (t) => {
            try {
              const res = await fetch(`/api/tracking/history?id=${t.id}&days=30`, { cache: "no-store" });
              const json = await res.json();
              const points: { date: string; rank: number | null }[] = (json.data ?? []).map(
                (p: RankHistoryPoint) => ({ date: p.date, rank: p.position })
              );
              return { keyword: t.keyword, points };
            } catch {
              return { keyword: t.keyword, points: [] };
            }
          })
        );
        if (!cancelled) {
          setMultiSeries(results);
          setMultiLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, 0);
    return () => window.clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked, groupFilter, country, device]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = addKeyword.trim();
    const dm = addDomain.trim();
    if (!kw) { show(t("errKeyword"), "error"); return; }
    if (!dm) { show(t("errDomain"), "error"); return; }
    setAdding(true);
    try {
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw, location: country, device, domain: dm }),
      });
      const json = await res.json();
      if (!res.ok) { const { message } = handleBillingError(json, t("addFailed")); show(message, "error"); return; }
      show(t("addedToast", { keyword: kw }), "success");
      setAddModalOpen(false);
      setAddKeyword("");
      if (json.usage) setUsage(json.usage);
      await loadList();
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/tracking?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) { const { message } = handleBillingError(json, t("deleteFailed")); show(message, "error"); return; }
      show(t("deletedToast"), "success");
      if (json.usage) setUsage(json.usage);
      await loadList();
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    }
  };

  const handleRefresh = async () => {
    if (tracked.length === 0) { show(t("noKeywordsRefresh"), "info"); return; }
    // 防重复触发：refreshing 期间按钮已 disabled，这里二次兜底
    if (refreshing) return;
    setRefreshing(true);
    try {
      // P0：分批续请求，单次 HTTP 最多 20 个词，前端循环直到 hasMore=false
      let offset = 0;
      let totalSuccess = 0;
      let totalProcessed = 0;
      let hasMore = true;
      let lastUsage: UsageInfo | null = null;
      while (hasMore) {
        const res = await fetch(`/api/tracking/refresh?offset=${offset}`, { method: "POST" });
        const json = await res.json();
        if (!res.ok) { const { message } = handleBillingError(json, t("refreshFailed")); show(message, "error"); return; }
        const items: Array<{ error?: string }> = json.data?.items ?? [];
        totalSuccess += items.filter((i) => !i.error).length;
        totalProcessed += items.length;
        if (json.usage) { setUsage(json.usage); lastUsage = json.usage; }
        hasMore = json.data?.hasMore ?? false;
        offset = json.data?.nextOffset ?? offset + items.length;
      }
      show(
        lastUsage
          ? t("refreshDoneWithUsage", { success: totalSuccess, total: totalProcessed, used: lastUsage.used, limit: lastUsage.limit })
          : t("refreshDone", { success: totalSuccess, total: totalProcessed }),
        "success"
      );
      await loadList();
      if (selectedId) await loadHistory(selectedId);
    } catch (err) {
      show(`${tc("networkError")} ${(err as Error).message}`, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const trendData = history.map((h) => ({ day: h.date.slice(5), rank: h.position }));
  const volatilityPoints = trendData
    .map((p, i) => ({ ...p, i, prev: i > 0 ? trendData[i - 1].rank : p.rank }))
    .filter((p) => p.prev !== null && p.rank !== null && Math.abs((p.rank as number) - (p.prev as number)) >= 4 && p.i > 0);
  const remaining = trackingLimit - tracked.length;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <h1 className="text-[28px] font-semibold leading-tight text-ink">{t("title")}</h1>
      <p className="mt-1 text-sm text-ink-60">
        {t("subtitle")}
      </p>

      {/* 工具栏 */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button onClick={handleRefresh} disabled={refreshing || tracked.length === 0} className="btn-secondary disabled:opacity-60">
          <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 ${refreshing ? "loading-spin" : ""}`}>
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {refreshing ? t("refreshing") : t("refreshBtn")}
        </button>
        <button onClick={() => setCreateGroupModalOpen(true)} className="btn-secondary">
          <span className="text-base leading-none">+</span> {t("createGroupBtn")}
        </button>
        <button onClick={() => setAddModalOpen(true)} disabled={remaining <= 0} className="btn-primary disabled:opacity-60">
          <span className="text-base leading-none">+</span> {t("addKeywordBtn")}
        </button>
      </div>

      {/* API 用量条 */}
      {usage && (
        <div className="card-a mt-4 flex items-center gap-3 px-4 py-2.5">
          <span className="text-xs font-semibold text-ink">{t("apiUsage", { used: usage.used, limit: usage.limit })}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
            <div className={`h-full rounded-full transition-all ${usagePercent > 80 ? "bg-neg" : "bg-pos"}`} style={{ width: `${Math.min(100, usagePercent)}%` }} />
          </div>
          {usagePercent > 70 && <span className="text-[10px] text-neg">{t("quotaTight")}</span>}
          <span className="text-[10px] text-ink-40">{t("trackingCount", { tracked: tracked.length, limit: trackingLimit })}</span>
        </div>
      )}

      {/* 筛选条 */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-40">{t("region")}</label>
          <select value={country} onChange={(e) => handleRegionChange(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
            {RANK_LOCATIONS.map((c) => (<option key={c} value={c}>{display(c)}</option>))}
          </select>
          <select value={city} onChange={(e) => setCity(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
            {cities.map((c) => (<option key={c} value={c}>{display(c)}</option>))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-40">{t("device")}</label>
          <div className="flex gap-2">
            {(["PC", "移动端"] as Device[]).map((d) => (
              <button key={d} onClick={() => setDevice(d)} className={device === d ? "btn-primary" : "btn-secondary"}>{deviceLabel(d)}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-40">{t("group")}</label>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
            <option value="all">{t("allGroups")}</option>
            <option value="ungrouped">{t("ungrouped")}</option>
            {groups.map((g) => (<option key={g.id} value={`group-${g.id}`}>{g.name}</option>))}
          </select>
        </div>
        <span className="ml-auto text-xs text-ink-40">{t("current", { scope: `${display(country)} · ${display(city)} · ${deviceLabel(device)}` })}</span>
      </div>

      {/* 概览统计 */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: t("statTotal"), value: formatNumber(stats.total, locale), color: "text-ink" },
          { label: t("statTop3"), value: formatNumber(stats.top3, locale), color: "text-pos" },
          { label: t("statTop10"), value: formatNumber(stats.top10, locale), color: "text-warn" },
          { label: t("statTop100"), value: formatNumber(stats.top100, locale), color: "text-ink" },
          { label: t("statUp"), value: `▲ ${formatNumber(stats.up, locale)}`, color: "text-pos" },
          { label: t("statDown"), value: `▼ ${formatNumber(stats.down, locale)}`, color: "text-neg" },
        ].map((m) => (
          <div key={m.label} className="card-a p-4">
            <div className="text-[10px] text-ink-40">{m.label}</div>
            <div className={`mt-1 text-lg font-bold ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* 图表区：3 张图 */}
      {tracked.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 排名分布 donut */}
          <ChartCard
            title={t("chartDistribution")}
            subtitle={t("chartDistributionSub", { count: formatNumber(stats.total, locale) })}
            height={260}
            className="lg:col-span-4"
          >
            <RankDistributionDonut
              top3={stats.top3}
              top10={stats.top10 - stats.top3}
              top100={stats.top100 - stats.top10}
              unranked={stats.total - stats.top100}
            />
          </ChartCard>

          {/* 多关键词排名趋势 */}
          <ChartCard
            title={t("chartTrend")}
            subtitle={t("chartTrendSub")}
            height={260}
            className="lg:col-span-5"
          >
            {multiLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-ink-40">{tc("loading")}</div>
            ) : (
              <MultiRankTrend series={multiSeries} max={5} />
            )}
          </ChartCard>

          {/* 今日上升/下降 正负柱状 */}
          <ChartCard
            title={t("chartChanges")}
            subtitle={t("chartChangesSub", { up: formatNumber(stats.up, locale), down: formatNumber(stats.down, locale) })}
            height={260}
            className="lg:col-span-3"
          >
            <RankChangeBars up={stats.up} down={stats.down} />
          </ChartCard>
        </div>
      )}

      {/* 排名趋势大图 */}
      {selectedKeyword && (
        <div className="card-a mt-6 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">{t("trendTitle")}</h2>
              <p className="mt-0.5 text-xs text-ink-40">{selectedKeyword.keyword} · {selectedKeyword.domain} · {t("trendHint")}</p>
            </div>
            <div className="text-right">
              {selectedKeyword.todayPosition !== null ? (
                <>
                  <div className="text-xl font-bold text-ink">#{selectedKeyword.todayPosition}</div>
                  <ChangeBadge value={selectedKeyword.change ?? 0} />
                </>
              ) : (
                <div className="text-sm text-ink-40">{t("notInTop100")}</div>
              )}
            </div>
          </div>
          <div className="mt-4 h-64">
            {historyLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-ink-40">{t("loadingHistory")}</div>
            ) : trendData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-ink-40">{t("noHistory")}</div>
            ) : trendData.length === 1 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <div className="text-2xl font-bold text-ink">#{trendData[0].rank}</div>
                <div className="text-xs text-ink-40">{t("needTwoDays")}</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid {...COMMON_GRID_PROPS} />
                  <XAxis dataKey="day" {...COMMON_XAXIS_PROPS} />
                  <YAxis {...RANK_YAXIS_PROPS} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} formatter={(v) => [`#${v}`, t("rank")]} />
                  <Line type="monotone" dataKey="rank" stroke="#d97706" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls />
                  {volatilityPoints.map((p) => (
                    <ReferenceDot key={p.i} x={p.day} y={p.rank as number} r={5} fill={(p.rank as number) < (p.prev as number) ? "#16a34a" : "#dc2626"} stroke="#FFFFFF" strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* 追踪关键词表格 */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-ink">{t("tableTitle")}</h2>
          <span className="text-xs text-ink-40">
            {groupFilter === "all"
              ? t("tableCountAll", { tracked: tracked.length, limit: trackingLimit, remaining: Math.max(0, remaining) })
              : t("tableCountFiltered", { shown: filteredTracked.length, total: tracked.length })}
          </span>
        </div>
        <div className="card-a mt-3 overflow-hidden">
          {listLoading ? (
            <TableSkeleton rows={4} />
          ) : tracked.length === 0 ? (
            <EmptyState onAdd={() => setAddModalOpen(true)} />
          ) : filteredTracked.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-ink-40">{t("noKeywordsInGroup")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft bg-line-soft/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("keyword")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("domain")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colTodayRank")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colChange")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("colLastRefresh")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-ink-40">{t("colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTracked.map((r) => (
                    <tr key={r.id} onClick={() => setSelectedId(r.id)} className={`group cursor-pointer border-b border-line-soft/60 transition-colors hover:bg-line-soft/40 ${selectedId === r.id ? "bg-line-soft/40" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-ink">{r.keyword}</div>
                        {r.groups.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {r.groups.map((g) => (
                              <span key={g.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-line-soft px-2 py-0.5 text-[10px] text-ink-60">
                                {g.name}
                                <button onClick={(e) => handleRemoveFromGroup(g.id, r.id, e)} className="text-ink-40 hover:text-neg" title={t("removeFromGroup")}>×</button>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-60">{r.domain}</td>
                      <td className="px-4 py-3">
                        {r.todayPosition !== null ? (
                          <span className="text-base font-bold text-ink">{r.todayPosition}</span>
                        ) : (
                          <span className="text-xs text-ink-40">{t("notInTop100")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.change !== null ? <ChangeBadge value={r.change} /> : <span className="text-[10px] text-ink-40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-40">{r.last_refreshed_at ? formatRelativeTime(r.last_refreshed_at, locale, tc) : t("neverRefreshed")}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="relative">
                            <button onClick={(e) => { e.stopPropagation(); setGroupMenuId(groupMenuId === r.id ? null : r.id); }} className="text-xs font-medium text-ink-40 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100">{t("addToGroupAction")}</button>
                            {groupMenuId === r.id && (
                              <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-line bg-card py-1">
                                <div className="px-3 py-1.5 text-[10px] text-ink-40">{groups.length === 0 ? t("noGroupsYet") : t("addToGroup")}</div>
                                {groups.map((g) => {
                                  const inGroup = r.groups.some((rg) => rg.id === g.id);
                                  return (
                                    <button key={g.id} onClick={() => handleAddToGroup(g.id, r.id)} disabled={inGroup} className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-line-soft ${inGroup ? "cursor-default text-ink-40" : "text-ink"}`}>
                                      <span>{g.name}</span>
                                      {inGroup && <span className="text-[10px] text-pos">✓</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-xs font-medium text-ink-40 opacity-0 transition-opacity hover:text-neg group-hover:opacity-100">{tc("delete")}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 竞品对比区（mock，标注示意数据） */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-ink">{t("competitorTitle")}</h2>
          <span className="badge-warn">{t("demoData")}</span>
        </div>
        <div className="card-a mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-soft bg-line-soft/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("domain")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("rank")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("change")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-40">{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {rankCompetitors.map((c) => (
                  <tr key={c.domain} className={`border-b border-line-soft/60 ${c.isSelf ? "bg-line-soft/40" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded bg-ink/10 font-mono text-xs font-bold text-ink">{c.favicon}</span>
                        <span className={`font-mono text-sm ${c.isSelf ? "font-semibold text-ink" : "text-ink"}`}>{c.domain}</span>
                        {c.isSelf && <span className="badge-info">{t("selfSite")}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3"><RankBadge rank={c.rank} /></td>
                    <td className="px-4 py-3"><ChangeBadge value={c.change} /></td>
                    <td className="px-4 py-3">
                      {c.rank <= 3 ? <span className="badge-pos">{t("statusLeading")}</span> : c.rank <= 10 ? <span className="badge-warn">{t("statusCatchingUp")}</span> : <span className="badge-info">{t("statusBehind")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 添加追踪关键词模态框 */}
      <Modal
        open={addModalOpen}
        onClose={() => { setAddModalOpen(false); setAddKeyword(""); }}
        title={t("addModalTitle", { count: Math.max(0, remaining) })}
        footer={
          <>
            <button onClick={() => { setAddModalOpen(false); setAddKeyword(""); }} className="btn-secondary">{tc("cancel")}</button>
            <button type="submit" form="add-keyword-form" disabled={adding || remaining <= 0} className="btn-primary disabled:opacity-60">{adding ? t("adding") : t("addSubmit")}</button>
          </>
        }
      >
        <form id="add-keyword-form" onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="text-xs text-ink-40">{t("keyword")}</label>
            <input type="text" value={addKeyword} onChange={(e) => setAddKeyword(e.target.value)} required placeholder={t("keywordPlaceholder")} className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-ink-40">{t("targetDomain")}</label>
            <DomainSelect value={addDomain} onChange={setAddDomain} placeholder={t("domainPlaceholder")} className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-ink-40">{t("region")}</label>
              <select value={country} onChange={(e) => handleRegionChange(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
                {RANK_LOCATIONS.map((c) => (<option key={c} value={c}>{display(c)}</option>))}
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-40">{t("device")}</label>
              <select value={device} onChange={(e) => setDevice(e.target.value as Device)} className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
                <option value="PC">PC</option>
                <option value="移动端">{t("deviceMobile")}</option>
              </select>
            </div>
          </div>
          <p className="text-[10px] text-ink-40">{t("addModalHint", { limit: trackingLimit })}</p>
        </form>
      </Modal>

      <Modal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title={t("confirmDelete")}
        footer={
          <>
            <button onClick={() => setDeleteId(null)} className="btn-secondary">{tc("cancel")}</button>
            <button onClick={() => { if (deleteId) handleDelete(deleteId); setDeleteId(null); }} className="rounded-lg bg-neg px-4 py-2 text-sm font-semibold text-card transition-opacity hover:opacity-90">{t("confirmDelete")}</button>
          </>
        }
      >
        <p className="text-sm text-ink-60">{t("deleteModalBody")}</p>
      </Modal>

      <Modal
        open={createGroupModalOpen}
        onClose={() => { setCreateGroupModalOpen(false); setNewGroupName(""); setNewGroupDesc(""); }}
        title={t("createGroupModalTitle")}
        footer={
          <>
            <button onClick={() => { setCreateGroupModalOpen(false); setNewGroupName(""); setNewGroupDesc(""); }} className="btn-secondary">{tc("cancel")}</button>
            <button type="submit" form="create-group-form" disabled={creatingGroup} className="btn-primary disabled:opacity-60">{creatingGroup ? t("creatingGroup") : t("createGroupBtn")}</button>
          </>
        }
      >
        <form id="create-group-form" onSubmit={handleCreateGroup} className="space-y-4">
          <div>
            <label className="text-xs text-ink-40">{t("groupName")}</label>
            <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} required maxLength={50} placeholder={t("groupNamePlaceholder")} className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-ink-40">{t("groupDesc")}</label>
            <textarea value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)} rows={3} maxLength={200} placeholder={t("groupDescPlaceholder")} className="mt-1.5 w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none" />
          </div>
        </form>
      </Modal>

      <Toast />
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-line-soft bg-card px-4 py-3">
          <div className="h-3.5 w-1/4 rounded bg-line-soft" />
          <div className="h-3.5 w-16 rounded bg-line-soft" />
          <div className="h-3.5 w-12 rounded bg-line-soft" />
          <div className="h-3.5 w-20 rounded bg-line-soft" />
          <div className="ml-auto h-3.5 w-10 rounded bg-line-soft" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations("dashboard.positionTracking");
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-2xl text-ink-40">∅</div>
      <div className="mt-3 text-sm font-medium text-ink">{t("emptyTitle")}</div>
      <div className="mt-1 text-xs text-ink-60">{t("emptyHint")}</div>
      <button onClick={onAdd} className="btn-primary mt-4">{t("emptyAddBtn")}</button>
    </div>
  );
}
