"use client";

// ===== Keyword Magic Tool（关键词魔法工具 · 关键词发现工作台）=====
//
// 能力全部来自既有 API：
//   - /api/keywords/expand（相关词/PAA/扩词库/指标，单请求）
//   - /api/keywords/suggestions（Autocomplete，用户显式触发，1 次配额）
//   - 多方向扩词 DirectionExpansion（用户显式触发，每方向 ≤4 次 Autocomplete）
//   - 主题聚类/问题词/意图为纯函数（clusterKeywords / isQuestionKeyword / detectIntent）
// 批量操作全部走本地 DB（/api/tracking、/api/keywords/groups*），零供应商成本。
//
// 诚实边界：搜索量/KD/CPC 来自 DataForSEO，未配置或缺失显示「—」；绝不编造。

import { useState, useMemo, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { detectIntent, type KeywordIntent } from "@/lib/seo/keyword-intent";
import { isQuestionKeyword, clusterKeywords } from "@/lib/seo/keyword-cluster";
import { formatKeywordDisplay } from "@/lib/seo/keyword-display";
import type { KeywordOrigin } from "@/lib/seo/keyword-merge";
import { normalizeKeywordForDedup } from "@/lib/seo/keyword-merge";
import { useActiveProjectOptional } from "@/components/dashboard/ActiveProjectContext";
import { formatNumber } from "@/lib/ui-locale";
import { RK_LINK_CLASS } from "@/components/viz/rank-theme";
import {
  OriginBadge,
  intentText,
  exportCsvRows,
} from "@/components/keywords/shared";
import { buildKeywordCsv, buildKeywordCsvContext } from "@/lib/seo/keyword-csv";
import { DirectionExpansion } from "../keyword-expand/DirectionExpansion";

interface ExpandMetricsKeyword {
  keyword: string;
  origin: KeywordOrigin;
  origins: KeywordOrigin[];
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
  currency: string | null;
  intent: string | null;
  intentSource: "provider" | null;
}

interface ExpandData {
  seed: string;
  related: string[];
  paa: string[];
  location: string;
  device: string;
  fromCache: boolean;
  marketFallback?: boolean;
  /** expand 响应同样带第一页 SERP 快照：CSV 的 language / collected_at 口径取自这里 */
  serpSnapshot?: {
    fetchedAt: string;
    language: string | null;
  } | null;
  metrics?: {
    source: "dataforseo" | null;
    fromCache: boolean;
    discovery?: { source: "dataforseo" | null; fromCache: boolean; state: "unconfigured" | "error" | "ok" };
    keywords?: ExpandMetricsKeyword[];
  } | null;
}

interface MagicRow {
  keyword: string;
  origins: KeywordOrigin[];
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  currency: string | null;
  providerIntent: string | null;
}

/** Semrush 式意图字母章（I=信息 C=商业 T=交易 N=导航）——未知意图由调用方渲染「—」 */
function IntentChip({ intent }: { intent: KeywordIntent }) {
  const map: Record<KeywordIntent, { ch: string; cls: string; title: string }> = {
    "信息型": { ch: "I", cls: "border-accent/40 bg-accent/10 text-accent", title: "信息型" },
    "商业型": { ch: "C", cls: "border-warn/40 bg-warn/10 text-warn", title: "商业型" },
    "交易型": { ch: "T", cls: "border-pos/40 bg-pos/10 text-pos", title: "交易型" },
    "导航型": { ch: "N", cls: "border-line bg-line-soft text-ink-60", title: "导航型" },
    "未知": { ch: "—", cls: "border-line bg-line-soft text-ink-25", title: "未知" },
  };
  const m = map[intent];
  return (
    <span
      title={m.title}
      className={`inline-flex h-[20px] w-[20px] items-center justify-center rounded border font-sans text-ui-caption font-semibold leading-none ${m.cls}`}
    >
      {m.ch}
    </span>
  );
}

/** 市场 → 旗帜 */
const MARKET_FLAG: Record<string, string> = {
  "中国": "🇨🇳", "美国": "🇺🇸", "英国": "🇬🇧", "日本": "🇯🇵", "香港": "🇭🇰", "台湾": "🇹🇼",
};

function ChevronDownSm() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-ink-40" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightSm({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`h-3.5 w-3.5 text-ink-40 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIconSm() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M12 4v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m7 11 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 灰色下拉钮（Semrush 筛选行样式；包裹原生 select/输入）——统一 32px 高 / 13px 文字 */
function FilterButton({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2 font-sans text-ui-compact text-ink-60">
      {children}
    </div>
  );
}

const PROVIDER_INTENT_MAP: Record<string, KeywordIntent> = {
  informational: "信息型",
  commercial: "商业型",
  transactional: "交易型",
  navigational: "导航型",
};

const PAGE_SIZE = 50;

export default function KeywordMagicPage() {
  return (
    <Suspense fallback={null}>
      <KeywordMagicInner />
    </Suspense>
  );
}

function KeywordMagicInner() {
  const t = useTranslations("dashboard.keywords.magic");
  const ts = useTranslations("dashboard.keywords.shared");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const zh = locale === "zh";
  const searchParams = useSearchParams();
  const { show, Toast } = useToast();
  const activeProject = useActiveProjectOptional();

  const [searchValue, setSearchValue] = useState((searchParams.get("seed") ?? "").trim());
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<"PC" | "移动端">("PC");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expand, setExpand] = useState<ExpandData | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  // 自动补全（显式触发）与方向扩词合并结果
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestPhase, setSuggestPhase] = useState<"idle" | "loading" | "done" | "empty" | "error">("idle");
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  // 筛选 / 排序 / 视图
  const [sourceFilter, setSourceFilter] = useState<KeywordOrigin | "all">("all");
  const [intentFilter, setIntentFilter] = useState<"all" | KeywordIntent>("all");
  const [questionOnly, setQuestionOnly] = useState(false);
  const [queryFilter, setQueryFilter] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "az" | "za" | "length" | "volume">("default");
  // Semrush 左栏分组面板：选中的主题分组（null=全部）、分组排序方式、展开的分组
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [groupSort, setGroupSort] = useState<"count" | "volume">("count");
  // 主题全部展开（不再 slice(0,8) 截断）：默认折叠集合为空 = 全部展开
  const [groupCollapsed, setGroupCollapsed] = useState<Set<string>>(new Set());
  const [excludeFilter, setExcludeFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 批量选择（键 = 关键词原文；跨筛选保留）
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [groupList, setGroupList] = useState<{ id: number; name: string; keywordCount?: number }[]>([]);
  const [groupChoice, setGroupChoice] = useState("");
  const [newGroupName, setNewGroupName] = useState("");

  // ===== 统一行 =====
  const rows = useMemo<MagicRow[]>(() => {
    if (!expand) return [];
    const map = new Map<string, MagicRow>();
    const add = (keyword: string, origin: KeywordOrigin, m?: Partial<ExpandMetricsKeyword>) => {
      const norm = normalizeKeywordForDedup(keyword);
      if (!norm) return;
      const existing = map.get(norm);
      if (existing) {
        if (!existing.origins.includes(origin)) existing.origins.push(origin);
        return;
      }
      map.set(norm, {
        keyword,
        origins: [origin],
        searchVolume: m?.searchVolume ?? null,
        difficulty: m?.difficulty ?? null,
        cpc: m?.cpc ?? null,
        currency: m?.currency ?? null,
        providerIntent: m?.intent ?? null,
      });
    };
    for (const k of expand.metrics?.keywords ?? []) {
      for (const o of k.origins.length > 0 ? k.origins : [k.origin]) add(k.keyword, o, k);
    }
    for (const r of expand.related) add(r, "related");
    for (const p of expand.paa) add(p, "paa");
    for (const s of suggestions) add(s, "autocomplete");
    return Array.from(map.values());
  }, [expand, suggestions]);

  const intentOf = (r: MagicRow): KeywordIntent =>
    r.providerIntent ? (PROVIDER_INTENT_MAP[r.providerIntent] ?? "未知") : detectIntent(r.keyword);

  // 主题聚类（Semrush 左栏分组面板；常驻计算）
  const clusters = useMemo(() => clusterKeywords(rows.map((r) => r.keyword)), [rows]);
  const clusterRows = useMemo(() => {
    const byId = new Map<string, { count: number; volume: number }>();
    const rowById = new Map<string, string[]>();
    for (const c of clusters) rowById.set(c.id, c.keywords);
    for (const r of rows) {
      for (const c of clusters) {
        if (c.keywords.includes(r.keyword)) {
          const cur = byId.get(c.id) ?? { count: 0, volume: 0 };
          byId.set(c.id, { count: cur.count + 1, volume: cur.volume + (r.searchVolume ?? 0) });
        }
      }
    }
    return clusters.map((c) => ({ ...c, count: byId.get(c.id)?.count ?? 0, volume: byId.get(c.id)?.volume ?? 0 }));
  }, [clusters, rows]);
  const sortedClusterRows = useMemo(() => {
    const list = [...clusterRows];
    if (groupSort === "volume") list.sort((a, b) => b.volume - a.volume || b.count - a.count);
    else list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, zh ? "zh-Hans-CN" : "en"));
    return list;
  }, [clusterRows, groupSort, zh]);

  // 指标可用性（DEF-08）：搜索量是否存在，决定「按搜索量」能否真正生效
  const volumeAvailable = useMemo(() => rows.some((r) => r.searchVolume !== null), [rows]);
  const effectiveSortMode = sortMode === "volume" && !volumeAvailable ? "default" : sortMode;

  const filteredRows = useMemo(() => {
    const q = queryFilter.trim().toLowerCase();
    const ex = excludeFilter.trim().toLowerCase();
    const groupKeywords = activeGroup
      ? new Set(clusterRows.find((c) => c.id === activeGroup)?.keywords ?? [])
      : null;
    let list = rows.filter((r) => {
      if (sourceFilter !== "all" && !r.origins.includes(sourceFilter)) return false;
      if (intentFilter !== "all" && intentOf(r) !== intentFilter) return false;
      if (questionOnly && !(r.origins.includes("paa") || isQuestionKeyword(r.keyword))) return false;
      // 过滤同时匹配原文与显示文本：屏幕上显示的是格式化后的中文，按看到的字搜必须能命中
      const rawKw = r.keyword.toLowerCase();
      const shownKw = formatKeywordDisplay(r.keyword).toLowerCase();
      if (q && !rawKw.includes(q) && !shownKw.includes(q)) return false;
      if (ex && (rawKw.includes(ex) || shownKw.includes(ex))) return false;
      if (groupKeywords && !groupKeywords.has(r.keyword)) return false;
      return true;
    });
    if (effectiveSortMode === "az") list = [...list].sort((a, b) => a.keyword.localeCompare(b.keyword, zh ? "zh-Hans-CN" : "en"));
    else if (effectiveSortMode === "za") list = [...list].sort((a, b) => b.keyword.localeCompare(a.keyword, zh ? "zh-Hans-CN" : "en"));
    else if (effectiveSortMode === "length") list = [...list].sort((a, b) => a.keyword.length - b.keyword.length);
    else if (effectiveSortMode === "volume")
      list = [...list].sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1));
    return list;
  }, [rows, sourceFilter, intentFilter, questionOnly, queryFilter, excludeFilter, activeGroup, clusterRows, effectiveSortMode, zh]);

  // ===== 指标可用性（DEF-08）=====
  // 搜索量缺失时排序不能"看起来执行了但顺序没变"：选项禁用 + 给出原因。
  // 用派生值而不是 effect 重置状态，避免级联渲染。
  const sortNotice = rows.length > 0 && !volumeAvailable ? t("sortVolumeUnavailable") : null;

  /** 清除全部筛选（含左栏主题）：工具栏按钮与空态共用同一实现 */
  const clearAllFilters = () => {
    setSourceFilter("all");
    setIntentFilter("all");
    setQuestionOnly(false);
    setQueryFilter("");
    setExcludeFilter("");
    setActiveGroup(null);
    setSortMode("default");
    setVisibleCount(PAGE_SIZE);
  };

  // ===== 分析 =====
  const runAnalysis = async (kw: string, loc: string, dev: "PC" | "移动端") => {    if (!kw.trim()) {
      show(t("errKeyword"), "error");
      return;
    }
    setPhase("loading");
    setErrorMsg(null);
    setExpand(null);
    setSuggestions([]);
    setSuggestPhase("idle");
    setSuggestNote(null);
    setSourceFilter("all");
    setIntentFilter("all");
    setQuestionOnly(false);
    setQueryFilter("");
    setSortMode("default");
    setVisibleCount(PAGE_SIZE);
    setSelected(new Set());
    setGroupChoice("");
    setNewGroupName("");
    try {
      const res = await fetch("/api/keywords/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: kw, location: loc, device: dev }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("expandFailed"));
        setPhase("error");
        setErrorMsg(message);
        show(message, "error");
        return;
      }
      setExpand(json.data as ExpandData);
      setPhase("done");
      if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
      show(json.data.fromCache ? t("cacheHit", { keyword: kw }) : t("loaded", { keyword: kw }), "success");
    } catch (err) {
      const msg = `${tc("networkError")}${(err as Error).message}`;
      setPhase("error");
      setErrorMsg(msg);
      show(msg, "error");
    }
  };

  const handleHeroSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runAnalysis(searchValue.trim(), location, device);
  };

  // ?seed=<词>：直接执行该关键词的真实研究（命中缓存则零配额）
  const seedParam = searchParams.get("seed");
  const seedRan = useRef(false);
  useEffect(() => {
    if (seedRan.current || !seedParam) return;
    seedRan.current = true;
    const id = window.setTimeout(() => {
      setSearchValue(seedParam);
      void runAnalysis(seedParam, location, device);
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedParam]);

  // ===== 自动补全建议（显式触发，1 次配额）=====
  const handleSuggest = async () => {
    if (!expand || suggestPhase === "loading") return;
    setSuggestPhase("loading");
    setSuggestNote(null);
    try {
      const res = await fetch("/api/keywords/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: expand.seed, location: expand.location }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("suggestFailed"));
        setSuggestPhase("error");
        setSuggestNote(message);
        return;
      }
      const list: string[] = Array.isArray(json.data?.suggestions) ? json.data.suggestions : [];
      setSuggestions((prev) => Array.from(new Set([...prev, ...list])));
      const existing = new Set(rows.map((r) => normalizeKeywordForDedup(r.keyword)));
      const fresh = list.filter((s) => !existing.has(normalizeKeywordForDedup(s)));
      setSuggestPhase(list.length === 0 ? "empty" : "done");
      setSuggestNote(list.length === 0 ? t("suggestEmpty") : t("suggestDone", { added: fresh.length, fetched: list.length }));
    } catch (err) {
      setSuggestPhase("error");
      setSuggestNote(`${tc("networkError")}${(err as Error).message}`);
    }
  };

  // ===== 批量选择 =====
  const toggleSelected = (keyword: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  };
  const selectAllFiltered = () => setSelected(new Set(filteredRows.map((r) => r.keyword)));

  useEffect(() => {
    if (selected.size === 0) return;
    let alive = true;
    fetch("/api/keywords/groups")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (alive) setGroupList(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selected.size]);

  // ===== 批量加入追踪（本地 DB；套餐上限触顶即停并如实报告）=====
  const handleBatchTrack = async () => {
    if (batchBusy || selected.size === 0) return;
    const targetDomain = activeProject?.activeDomain?.trim();
    if (!targetDomain) {
      show(t("selectProjectFirst"), "error");
      return;
    }
    setBatchBusy(true);
    const existing = new Set<string>();
    try {
      const res = await fetch(`/api/tracking?domain=${encodeURIComponent(targetDomain)}`);
      if (res.ok) {
        const json = await res.json();
        for (const row of (Array.isArray(json?.data) ? json.data : []) as { keyword: string }[]) {
          existing.add(row.keyword);
        }
      }
    } catch {
      // 索引失败不阻塞
    }
    let added = 0;
    let skipped = 0;
    let failed = 0;
    for (const keyword of selected) {
      if (existing.has(keyword)) {
        skipped += 1;
        continue;
      }
      try {
        const res = await fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword, location, device, domain: targetDomain }),
        });
        if (res.ok) {
          added += 1;
          existing.add(keyword);
        } else {
          const json = await res.json().catch(() => null);
          if (json?.code === "KEYWORD_LIMIT_REACHED" || json?.code === "PLAN_LIMIT_EXCEEDED" || json?.code === "PLAN_LIMIT_REACHED") {
            show(t("batchTrackPlanLimit", { added }), "error");
            setBatchBusy(false);
            return;
          }
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    setBatchBusy(false);
    show(t("batchTrackDone", { added, skipped, failed }), added > 0 ? "success" : "info");
  };

  // ===== 批量加入分组（成员必须是已追踪关键词：先确保追踪，再关联）=====
  const handleBatchGroup = async () => {
    if (batchBusy || selected.size === 0) return;
    const targetDomain = activeProject?.activeDomain?.trim();
    if (!targetDomain) {
      show(t("selectProjectFirst"), "error");
      return;
    }
    const groupName = groupChoice === "__new__" ? newGroupName.trim() : groupChoice;
    if (!groupName) {
      show(t("groupChooseFirst"), "error");
      return;
    }
    setBatchBusy(true);
    try {
      // 1) 确保每个选中词已追踪（已追踪的跳过）
      let tracked: { id: number; keyword: string }[] = [];
      const trackRes = await fetch(`/api/tracking?domain=${encodeURIComponent(targetDomain)}`);
      if (trackRes.ok) {
        const json = await trackRes.json();
        tracked = (Array.isArray(json?.data) ? json.data : []) as { id: number; keyword: string }[];
      }
      const trackedMap = new Map(tracked.map((r) => [r.keyword, r.id]));
      for (const keyword of selected) {
        if (trackedMap.has(keyword)) continue;
        const res = await fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword, location, device, domain: targetDomain }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.code === "KEYWORD_LIMIT_REACHED" || json?.code === "PLAN_LIMIT_EXCEEDED" || json?.code === "PLAN_LIMIT_REACHED") {
            show(t("batchTrackPlanLimit", { added: trackedMap.size }), "error");
            setBatchBusy(false);
            return;
          }
          continue;
        }
        // 重新拉取 id（POST /api/tracking 返回体可能不含 id）
        const listRes = await fetch(`/api/tracking?domain=${encodeURIComponent(targetDomain)}`);
        if (listRes.ok) {
          const listJson = await listRes.json();
          const newList = (Array.isArray(listJson?.data) ? listJson.data : []) as { id: number; keyword: string }[];
          const hit = newList.find((r) => r.keyword === keyword);
          if (hit) {
            trackedMap.set(keyword, hit.id);
            tracked = newList;
          }
        }
      }
      // 2) 分组：新建或复用
      let groupId: number;
      if (groupChoice === "__new__") {
        const createRes = await fetch("/api/keywords/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: groupName }),
        });
        const createJson = await createRes.json();
        if (!createRes.ok) {
          const { message } = handleBillingError(createJson, t("groupCreateFailed"));
          show(message, "error");
          setBatchBusy(false);
          return;
        }
        groupId = createJson.data.id;
      } else {
        groupId = Number(groupChoice);
      }
      // 3) 逐词加入分组
      let joined = 0;
      let missing = 0;
      for (const keyword of selected) {
        const keywordId = trackedMap.get(keyword);
        if (!keywordId) {
          missing += 1;
          continue;
        }
        const res = await fetch(`/api/keywords/groups/${groupId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword_id: keywordId }),
        });
        if (res.ok) joined += 1;
        else missing += 1;
      }
      setBatchBusy(false);
      show(t("batchGroupDone", { joined, missing }), joined > 0 ? "success" : "error");
    } catch (err) {
      setBatchBusy(false);
      show(`${tc("networkError")}${(err as Error).message}`, "error");
    }
  };

  // 统计条数据：总体积 = 非空搜索量求和；平均KD = 非空难度均值（缺失整体显示 —）
  const totalVolume = useMemo(() => {
    const vals = rows.map((r) => r.searchVolume).filter((v): v is number => v !== null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
  }, [rows]);
  const avgKd = useMemo(() => {
    const vals = rows.map((r) => r.difficulty).filter((v): v is number => v !== null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [rows]);

  /** 表头全选/取消全选（口径 = 当前筛选结果） */
  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const allSelected = filteredRows.length > 0 && filteredRows.every((r) => prev.has(r.keyword));
      return allSelected ? new Set() : new Set(filteredRows.map((r) => r.keyword));
    });
  };

  // ===== 导出 CSV（筛选结果口径 + 五项数据口径，与概览同一函数）=====
  const handleExport = () => {
    if (filteredRows.length === 0) return;
    const ctx = buildKeywordCsvContext({
      location: expand?.location ?? location,
      device: expand?.device ?? device,
      language: expand?.serpSnapshot?.language ?? null,
      // 只认真实快照采集时间，绝不拿导出时刻冒充
      fetchedAt: expand?.serpSnapshot?.fetchedAt ?? null,
      metricsSource: expand?.metrics?.source ?? null,
    });
    const { headers, dataRows } = buildKeywordCsv(
      filteredRows.map((r) => ({
        keyword: r.keyword,
        origins: r.origins,
        intentLabel: intentText(intentOf(r), zh),
        searchVolume: r.searchVolume,
        cpc: r.cpc,
      })),
      ctx
    );
    exportCsvRows(`seeo-keyword-magic-${expand?.seed ?? "export"}.csv`, headers, dataRows);
  };

  // ===== 渲染 =====
  return (
    <div className="dash-container p-6 lg:p-8">
      <Toast />

      {/* 面包屑 */}
      <nav className="flex items-center gap-1.5 font-sans text-ui-caption leading-[16px] text-ink-40" aria-label="breadcrumb">
        <span>{t("crumbWorkspace")}</span>
        <span aria-hidden="true">/</span>
        <span>{t("crumbKeywordResearch")}</span>
        <span aria-hidden="true">/</span>
        <span className="text-ink-60">{t("title")}</span>
      </nav>

      {/* 标题 → 选择器 → 搜索栏（Semrush 顺序，紧凑排列） */}
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
        {/* 种子词只格式化显示，expand.seed 原文继续用于请求/复制 */}
        {expand ? `${t("resultTitle")}${formatKeywordDisplay(expand.seed)}` : t("heroTitle")}
      </h1>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className="font-sans text-ui-compact text-ink-40">{t("dbLabel")}</span>
          <span className="text-base leading-none" aria-hidden="true">{MARKET_FLAG[location] ?? "🌐"}</span>
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            aria-label={ts("marketLabel")}
            className="cursor-pointer appearance-none bg-transparent font-sans text-ui-compact font-medium text-accent focus:outline-none"
          >
            {["中国", "美国", "英国", "日本", "香港", "台湾"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <ChevronDownSm />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-sans text-ui-compact text-ink-40">{t("devicePrefix")}</span>
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value as "PC" | "移动端")}
            aria-label={ts("deviceLabel")}
            className="cursor-pointer appearance-none bg-transparent font-sans text-ui-compact font-medium text-accent focus:outline-none"
          >
            <option value="PC">PC</option>
            <option value="移动端">{zh ? "移动端" : "Mobile"}</option>
          </select>
          <ChevronDownSm />
        </span>
        {usage && (
          <span className="font-sans text-ui-caption leading-[16px] text-ink-40">{t("usage", { used: usage.used, limit: usage.limit })}</span>
        )}
      </div>
      <form onSubmit={handleHeroSubmit} className="mt-3 flex items-stretch gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-10 w-full rounded-md border border-line bg-card px-3 pr-8 font-sans text-ui-body leading-[20px] text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => setSearchValue("")}
              aria-label={tc("close")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 font-sans text-base leading-none text-ink-40 hover:text-ink"
            >
              ×
            </button>
          )}
        </div>
        <button type="submit" disabled={phase === "loading"} className="btn-primary h-10 px-6 leading-[20px] disabled:opacity-60">
          {phase === "loading" ? t("analyzing") : t("analyze")}
        </button>
      </form>

      {phase === "error" && errorMsg && (
        <div className="mt-3 rounded-md border border-neg/40 bg-neg/5 px-4 py-2 font-sans text-ui-body leading-[20px] text-neg">{errorMsg}</div>
      )}

      {/* 来源 pills */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {(
          [
            { value: "all", label: t("pillAll"), active: sourceFilter === "all" && !questionOnly, apply: () => { setSourceFilter("all"); setQuestionOnly(false); } },
            { value: "questions", label: t("pillQuestions"), active: questionOnly, apply: () => { setQuestionOnly(true); } },
            { value: "related", label: t("pillRelated"), active: sourceFilter === "related" && !questionOnly, apply: () => { setSourceFilter("related"); setQuestionOnly(false); } },
            { value: "autocomplete", label: t("pillAutocomplete"), active: sourceFilter === "autocomplete" && !questionOnly, apply: () => { setSourceFilter("autocomplete"); setQuestionOnly(false); } },
            { value: "labs", label: t("pillIdeas"), active: (sourceFilter === "labs_suggestions" || sourceFilter === "labs_ideas") && !questionOnly, apply: () => { setSourceFilter("labs_suggestions"); setQuestionOnly(false); } },
            { value: "serp", label: t("pillSerp"), active: sourceFilter === "serp_content" && !questionOnly, apply: () => { setSourceFilter("serp_content"); setQuestionOnly(false); } },
          ] as { value: string; label: string; active: boolean; apply: () => void }[]
        ).map((pill) => (
          <button
            key={pill.value}
            type="button"
            onClick={() => { pill.apply(); setVisibleCount(PAGE_SIZE); }}
            aria-pressed={pill.active}
            className={`h-8 rounded-md border px-3 font-sans text-ui-compact font-medium transition-colors ${
              pill.active
                ? "border-accent bg-accent/5 text-accent"
                : "border-line bg-card text-ink-60 hover:border-ink-25 hover:text-ink"
            }`}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* 筛选下拉行 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <FilterButton>
          <select
            value={intentFilter}
            onChange={(e) => { setIntentFilter(e.target.value as "all" | KeywordIntent); setVisibleCount(PAGE_SIZE); }}
            aria-label={t("filterIntent")}
            className="cursor-pointer appearance-none bg-transparent pr-1 font-sans text-ui-compact text-ink-60 focus:outline-none"
          >
            <option value="all">{t("filterIntentAll")}</option>
            {(["信息型", "商业型", "交易型", "导航型"] as KeywordIntent[]).map((i) => (
              <option key={i} value={i}>{intentText(i, zh)}</option>
            ))}
          </select>
          <ChevronDownSm />
        </FilterButton>
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2">
          <span className="whitespace-nowrap font-sans text-ui-compact text-ink-40">{t("includeLabel")}</span>
          <input
            type="text"
            value={queryFilter}
            onChange={(e) => { setQueryFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
            aria-label={t("filterInResults")}
            className="w-24 bg-transparent font-sans text-ui-compact text-ink placeholder:text-ink-40 focus:outline-none"
            placeholder="…"
          />
        </div>
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2">
          <span className="whitespace-nowrap font-sans text-ui-compact text-ink-40">{t("excludeLabel")}</span>
          <input
            type="text"
            value={excludeFilter}
            onChange={(e) => { setExcludeFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
            aria-label={t("excludeLabel")}
            className="w-24 bg-transparent font-sans text-ui-compact text-ink placeholder:text-ink-40 focus:outline-none"
            placeholder="…"
          />
        </div>
        <FilterButton>
          <select
            value={effectiveSortMode}
            onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
            aria-label={t("sortBy")}
            className="cursor-pointer appearance-none bg-transparent pr-1 font-sans text-ui-compact text-ink-60 focus:outline-none"
          >
            <option value="default">{t("sortDefault")}</option>
            <option value="az">{t("sortAz")}</option>
            <option value="za">{t("sortZa")}</option>
            <option value="length">{t("sortLength")}</option>
            {/* 指标缺失时禁用而不是"点了没反应"（DEF-08） */}
            <option value="volume" disabled={!volumeAvailable}>
              {volumeAvailable ? t("sortVolume") : `${t("sortVolume")}（${t("sortVolumeUnavailable")}）`}
            </option>
          </select>
          <ChevronDownSm />
        </FilterButton>
        {(sourceFilter !== "all" || intentFilter !== "all" || questionOnly || queryFilter || excludeFilter || activeGroup) && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="h-8 rounded-md px-2 font-sans text-ui-compact font-medium text-accent hover:bg-line-soft"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>

      {/* 排序不可用说明（指标缺失时给出原因，不静默） */}
      {sortNotice && (
        <p role="status" className="mt-2 font-sans text-ui-caption leading-[16px] text-ink-40">
          {sortNotice}
        </p>
      )}

      {/* 当前左栏/文本筛选的可读回显（DEF-05：让"点击左栏=筛选"这件事可见） */}
      {(activeGroup || queryFilter) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-sans text-ui-caption leading-[16px] text-ink-40">{t("filterChipLabel")}</span>
          {activeGroup && (
            <span className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-2 py-1 font-sans text-ui-caption leading-[16px] text-ink-60">
              {t("filterByGroup", {
                group: formatKeywordDisplay(
                  activeGroup === "__other__" ? t("otherCluster") : sortedClusterRows.find((c) => c.id === activeGroup)?.label ?? activeGroup
                ),
              })}
              <button
                type="button"
                onClick={() => setActiveGroup(null)}
                aria-label={t("clearFilters")}
                className="text-ink-40 hover:text-ink"
              >
                ×
              </button>
            </span>
          )}
          {queryFilter && (
            <span className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-2 py-1 font-sans text-ui-caption leading-[16px] text-ink-60">
              {t("filterByKeyword", { keyword: formatKeywordDisplay(queryFilter) })}
              <button
                type="button"
                onClick={() => setQueryFilter("")}
                aria-label={t("clearFilters")}
                className="text-ink-40 hover:text-ink"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}

      {/* ===== 工作区（严格两栏）：左=全部关键词 / 右=扩词 → 统计 → 批量 → 表格 → 加载更多 ===== */}
      <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[250px_minmax(0,1fr)]">
        {/* 移动端主题 chips（<lg 左栏隐藏时的替代导航） */}
        {rows.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
            <button
              type="button"
              onClick={() => setActiveGroup(null)}
              className={`flex-shrink-0 rounded-full border px-3 py-1.5 font-sans text-ui-caption leading-[16px] ${activeGroup === null ? "border-accent bg-accent/5 font-medium text-accent" : "border-line bg-card text-ink-60"}`}
            >
              {t("allKeywordsRow")} {formatNumber(rows.length, locale)}
            </button>
            {sortedClusterRows.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveGroup(activeGroup === c.id ? null : c.id)}
                className={`flex-shrink-0 rounded-full border px-3 py-1.5 font-sans text-ui-caption leading-[16px] ${activeGroup === c.id ? "border-accent bg-accent/5 font-medium text-accent" : "border-line bg-card text-ink-60"}`}
              >
                {c.id === "__other__" ? t("otherCluster") : formatKeywordDisplay(c.label)} {formatNumber(c.count, locale)}
              </button>
            ))}
          </div>
        )}

        {/* 左栏：全部关键词（外层 stretch 与右栏等高；面板 sticky + 内部滚动） */}
        <div className="relative hidden min-w-0 lg:block">
          <aside className="card-a flex h-full max-h-[calc(100dvh-5rem)] flex-col overflow-hidden lg:sticky lg:top-0">
            {/* 面板标题：全部关键词 · 总数
                排版口径（本轮统一）：标题 / 主题名 / 数量 / 成员一律 13px · 400 · 20px 行高，
                层级只靠缩进、颜色与分隔线表达，不靠字号/字重跳变 */}
            <div className="flex h-[44px] flex-none items-center justify-between gap-2 border-b border-line px-3">
              <button
                type="button"
                onClick={() => setActiveGroup(null)}
                aria-pressed={activeGroup === null}
                className={`min-w-0 truncate text-left font-sans text-ui-compact font-normal leading-[20px] transition-colors ${
                  activeGroup === null ? "text-ink" : "text-ink hover:text-accent"
                }`}
              >
                {t("allKeywordsRow")}
              </button>
              <span className="flex-none font-sans text-ui-compact font-normal leading-[20px] tabular-nums text-ink-60">{formatNumber(rows.length, locale)}</span>
            </div>

            {/* 分组排序：功能保留，移到面板底部——不再插在「标题 → 分组 → 成员」之间打断层级 */}

            {rows.length === 0 ? (
              <p className="px-3 py-10 text-center font-sans text-ui-caption leading-relaxed text-ink-40">{t("panelEmpty")}</p>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {sortedClusterRows.map((c) => {
                    const open = !groupCollapsed.has(c.id);
                    const active = activeGroup === c.id;
                    // 主题名与成员同一个显示格式化函数；原始串只留在 title 里可回查
                    const rawLabel = c.id === "__other__" ? t("otherCluster") : c.label;
                    const label = formatKeywordDisplay(rawLabel);
                    // 主题分组之间的结构分隔线用 line 而非 line-soft：多主题时 line-soft 在白底上
                    // 几乎不可见，58/22/3/1 四组会糊成一片连续列表
                    return (
                      <div key={c.id} className="border-b border-line last:border-b-0">
                        <div className={`flex h-[36px] items-center gap-1 pl-1.5 pr-3 ${active ? "bg-accent/5" : ""}`}>
                          <button
                            type="button"
                            onClick={() => setGroupCollapsed((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            })}
                            aria-expanded={open}
                            aria-label={label}
                            className="flex h-6 w-5 flex-none items-center justify-center rounded text-ink-40 hover:bg-line-soft hover:text-ink"
                          >
                            <ChevronRightSm open={open} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveGroup(active ? null : c.id)}
                            aria-pressed={active}
                            title={t("filterGroupHint", { group: rawLabel })}
                            className={`min-w-0 flex-1 truncate text-left font-sans text-ui-compact font-normal leading-[20px] transition-colors ${
                              active ? "text-accent" : "text-ink hover:text-accent"
                            }`}
                          >
                            {label}
                          </button>
                          <span className="flex-none pl-1 font-sans text-ui-compact font-normal leading-[20px] tabular-nums text-ink-40">{formatNumber(c.count, locale)}</span>
                        </div>
                        {open && (
                          <ul className="pb-1">
                            {c.keywords.map((kw) => {
                              const kwActive = queryFilter === kw;
                              return (
                                <li key={kw}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // 产品规则（DEF-05 正式确定）：左栏成员点击 = 在当前工具内筛选右侧结果，
                                      // 不跳转概览；跳转只发生在右侧关键词链接上。
                                      // 过滤值仍用原文（与数据口径一致），只是屏幕上显示格式化文本
                                      setQueryFilter(kwActive ? "" : kw);
                                      setVisibleCount(PAGE_SIZE);
                                    }}
                                    aria-pressed={kwActive}
                                    title={`${t("filterMemberHint")} · ${kw}`}
                                    data-raw-keyword={kw}
                                    className={`flex h-[28px] w-full items-center pl-12 pr-3 text-left font-sans text-ui-compact font-normal leading-[20px] transition-colors ${
                                      kwActive
                                        ? "bg-accent/5 text-accent"
                                        : "text-ink-60 hover:bg-paper hover:text-ink"
                                    }`}
                                  >
                                    <span className="min-w-0 truncate">{formatKeywordDisplay(kw)}</span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* 主题全部展开：不再有 slice(0,8) + 「显示更多分组」 */}
                {/* 分组排序（原顶部控件下移，保留功能、不再打断标题与列表的层级） */}
                <div className="flex flex-none items-center gap-1 border-t border-line bg-paper/40 px-2 py-1.5">
                  <span className="px-1 font-sans text-ui-compact leading-[20px] font-normal text-ink-40">{t("sortBy")}</span>
                  {(["count", "volume"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setGroupSort(m)}
                      aria-pressed={groupSort === m}
                      className={`rounded px-2 py-1 font-sans text-ui-compact leading-[20px] transition-colors ${
                        groupSort === m ? "bg-line-soft font-medium text-ink" : "font-normal text-ink-40 hover:text-ink"
                      }`}
                    >
                      {m === "count" ? t("groupByCount") : t("groupByVolume")}
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>

        {/* 右栏：扩词 → 统计摘要 → 批量操作 → 结果表格 → 加载更多 */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* 1. 多方向扩词（右侧工作区最上方，统计摘要之上） */}
          {expand && (
            <section className="card-a min-w-0 px-4 py-3">
              <h2 className="font-display text-ui-heading font-semibold tracking-tight text-ink">{t("directionTitle")}</h2>
              <p className="mt-0.5 font-sans text-ui-caption font-normal leading-[18px] text-ink-40">{t("directionSubtitle")}</p>
              <div className="mt-2" key={expand.seed}>
                <DirectionExpansion
                  variant="embedded"
                  seed={expand.seed}
                  location={expand.location}
                  existingKeywords={rows.map((r) => r.keyword)}
                  onNewSuggestions={(words) => setSuggestions((prev) => Array.from(new Set([...prev, ...words])))}
                />
              </div>
            </section>
          )}

          {/* 2. 统计摘要 */}
          <section className="card-a flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
            <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-ui-caption font-normal leading-4 text-ink-40">{t("statAllKeywords")}</dt>
                <dd className={`font-display text-ui-metric font-semibold leading-[28px] tracking-tight ${rows.length === 0 ? "text-ink-40" : "text-ink"}`}>
                  {formatNumber(rows.length, locale)}
                </dd>
              </div>
              {/* 当前筛选结果数：与「所有关键词」并列，避免过滤后统计仍显示全量（DEF-04） */}
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-ui-caption font-normal leading-4 text-ink-40">{t("statFiltered")}</dt>
                <dd className={`font-display text-ui-metric font-semibold leading-[28px] tracking-tight ${filteredRows.length === 0 ? "text-ink-40" : "text-ink"}`}>
                  {formatNumber(filteredRows.length, locale)}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-ui-caption font-normal leading-4 text-ink-40">{t("statTotalVolume")}</dt>
                {/* 缺失指标的灰色破折号必须是独立文本节点：ink-25 只承载「—」这一装饰符号，
                    不承载任何真实数值（契约：ink-25 不作正文色） */}
                {totalVolume === null ? (
                  <dd title={t("metricNaTip")} className="font-sans text-ui-metric font-normal leading-[28px] tracking-tight text-ink-25">—</dd>
                ) : (
                  <dd className="font-display text-ui-metric font-semibold leading-[28px] tracking-tight text-ink">{formatNumber(totalVolume, locale)}</dd>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-ui-caption font-normal leading-4 text-ink-40">{t("statAvgKd")}</dt>
                {avgKd === null ? (
                  <dd title={t("metricNaTip")} className="font-sans text-ui-metric font-normal leading-[28px] tracking-tight text-ink-25">—</dd>
                ) : (
                  <dd className="font-display text-ui-metric font-semibold leading-[28px] tracking-tight text-ink">{Math.round(avgKd)}%</dd>
                )}
              </div>
            </dl>
            <div className="flex flex-none items-center gap-2">
              <button
                type="button"
                onClick={handleSuggest}
                disabled={!expand || suggestPhase === "loading"}
                className="btn-secondary btn-sm disabled:opacity-60"
              >
                {suggestPhase === "loading" ? tc("loading") : t("suggestButton")}
              </button>
              <button type="button" onClick={handleExport} disabled={filteredRows.length === 0} className="btn-secondary btn-sm disabled:opacity-60">
                <DownloadIconSm />
                {t("exportCsv")}
              </button>
            </div>
          </section>
          {suggestNote && <p className="font-sans text-ui-caption leading-[16px] text-ink-40">{suggestNote}</p>}

          {/* 3. 批量操作栏（选中即出现；滚动表格时固定可见） */}
          {selected.size > 0 && (
            <div className="sticky top-0 z-30 rounded-md border border-line bg-card px-3 py-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-sans text-ui-compact font-semibold text-ink">{t("selectedCount", { count: formatNumber(selected.size, locale) })}</span>
                <button type="button" onClick={selectAllFiltered} className="h-8 rounded-md border border-line px-2 font-sans text-ui-compact font-medium text-ink-60 hover:bg-line-soft">
                  {t("selectAllFiltered")}
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="h-8 rounded-md border border-line px-2 font-sans text-ui-compact font-medium text-ink-60 hover:bg-line-soft">
                  {t("clearSelected")}
                </button>
                <div className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />
                <button type="button" onClick={handleBatchTrack} disabled={batchBusy} className="btn-primary btn-sm disabled:opacity-60">
                  {t("batchTrack")}
                </button>
                <select
                  value={groupChoice}
                  onChange={(e) => setGroupChoice(e.target.value)}
                  aria-label={t("groupChoose")}
                  className="h-8 rounded-md border border-line bg-card px-2 font-sans text-ui-compact text-ink focus:border-ink-25 focus:outline-none"
                >
                  <option value="">{t("groupChoose")}</option>
                  {groupList.map((g) => (
                    <option key={g.id} value={String(g.id)}>{g.name}</option>
                  ))}
                  <option value="__new__">{t("groupNew")}</option>
                </select>
                {groupChoice === "__new__" && (
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder={t("groupNamePlaceholder")}
                    aria-label={t("groupNamePlaceholder")}
                    className="h-8 w-36 rounded-md border border-line bg-card px-2 font-sans text-ui-compact text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
                  />
                )}
                <button type="button" onClick={handleBatchGroup} disabled={batchBusy || !groupChoice} className="btn-secondary btn-sm disabled:opacity-60">
                  {t("batchGroup")}
                </button>
                <span className="font-sans text-ui-caption font-normal leading-4 text-ink-40">{t("batchNote", { domain: activeProject?.activeDomain ?? "" })}</span>
              </div>
            </div>
          )}

          {/* 4. 关键词结果表格（loading / 空态 / 表格 + 加载更多） */}
          <section className="card-a min-w-0 overflow-hidden">
            {phase === "loading" ? (
              <div className="flex items-center justify-center gap-3 py-20">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" aria-hidden="true" />
                <span className="font-sans text-ui-body leading-[20px] text-ink-60">{t("analyzingHint")}</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-20 text-center">
                <div className="font-sans text-ui-title leading-[24px] font-semibold text-ink">{t("emptyTitle")}</div>
                <p className="mx-auto mt-1.5 max-w-md font-sans text-ui-caption leading-relaxed text-ink-40">{t("emptyHint")}</p>
              </div>
            ) : filteredRows.length === 0 ? (
              /* 筛选到 0 行：明确空态 + 一键清除（不虚构占位行） */
              <div className="px-6 py-16 text-center">
                <div className="font-sans text-ui-title leading-[24px] font-semibold text-ink">{t("emptyFilteredTitle")}</div>
                <p className="mx-auto mt-1.5 max-w-md font-sans text-ui-caption leading-relaxed text-ink-40">
                  {t("emptyFilteredHint", { total: formatNumber(rows.length, locale) })}
                </p>
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="btn-secondary btn-sm mt-4"
                >
                  {t("emptyFilteredAction")}
                </button>
              </div>
            ) : (
              <>
                <MagicTable
                  rows={filteredRows.slice(0, visibleCount)}
                  selected={selected}
                  onToggle={toggleSelected}
                  onToggleAll={toggleAllFiltered}
                  allSelected={filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.keyword))}
                  filteredCount={filteredRows.length}
                  sortMode={effectiveSortMode}
                  linkClass={RK_LINK_CLASS}
                />
                {visibleCount < filteredRows.length && (
                  <div className="border-t border-line px-4 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                      className="h-8 rounded-md border border-line px-3 font-sans text-ui-compact font-medium text-ink-60 hover:bg-line-soft"
                    >
                      {t("loadMore", { shown: formatNumber(Math.min(visibleCount, filteredRows.length), locale), total: formatNumber(filteredRows.length, locale) })}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <p className="mt-4 font-sans text-ui-caption leading-[16px] text-ink-40">{t("honestyNote")}</p>
    </div>
  );
}

function MagicTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  allSelected,
  filteredCount,
  sortMode,
  linkClass,
}: {
  rows: MagicRow[];
  selected: Set<string>;
  onToggle: (kw: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  filteredCount: number;
  sortMode: "default" | "az" | "za" | "length" | "volume";
  linkClass: string;
}) {
  const ts = useTranslations("dashboard.keywords.shared");
  const tm = useTranslations("dashboard.keywords.magic");
  const locale = useLocale() as "en" | "zh";
  const naTip = tm("metricNaTip");
  const intentOf = (r: MagicRow): KeywordIntent =>
    r.providerIntent ? (PROVIDER_INTENT_MAP[r.providerIntent] ?? "未知") : detectIntent(r.keyword);
  const fmtVol = (v: number | null) => (v === null ? "—" : new Intl.NumberFormat(locale).format(v));
  const fmtCpcV = (r: MagicRow) =>
    r.cpc === null ? "—" : r.currency === "USD" ? `$${r.cpc.toFixed(2)}` : r.currency ? `${r.cpc.toFixed(2)} ${r.currency}` : r.cpc.toFixed(2);
  // 表头：12px / Medium / 统一灰色；数字列右对齐，意图列居中，关键词列左对齐
  const th = "h-[40px] px-0 align-middle font-sans text-ui-caption leading-4 font-medium text-ink-40";
  const num = "align-middle pr-3 text-right font-mono text-ui-compact font-medium tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse">
        {/* 列宽按占比分配：关键词列不再无限吞掉剩余宽度（1920 下曾达 71%），
            指标列按比例分摊，避免「关键词后面一大片空白 + 指标全部贴右边」 */}
        <colgroup>
          <col className="w-[40px]" />
          <col />
          <col className="w-[10%]" />
          <col className="w-[15%]" />
          <col className="w-[12.5%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-paper/60">
            <th className="h-[40px] pl-3 text-left align-middle font-sans text-ui-caption leading-4 font-medium text-ink-40">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label={tm("selectAllAria", { count: filteredCount })}
                className="h-4 w-4 rounded-sm accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
              />
            </th>
            <th className={`${th} pl-2 pr-3 text-left`}>{ts("colKeyword")}</th>
            <th className={`${th} text-center`}>{ts("colIntent")}</th>
            <th className={`${th} pr-3 text-right ${sortMode === "volume" ? "bg-line-soft/70" : ""}`}>
              <span className="inline-flex items-center gap-1">
                {ts("colVolume")}
                {sortMode === "volume" && (
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-accent" aria-hidden="true">
                    <path d="M8 9l4-4 4 4M8 15l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            </th>
            <th className={`${th} pr-3 text-right`}>{tm("colKD")}</th>
            <th className={`${th} pr-3 text-right`}>{ts("colCpc")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const intent = intentOf(r);
            return (
              <tr key={r.keyword} className="h-[44px] border-b border-line last:border-b-0 hover:bg-paper/60">
                <td className="pl-3 align-middle">
                  <input
                    type="checkbox"
                    checked={selected.has(r.keyword)}
                    onChange={() => onToggle(r.keyword)}
                    aria-label={tm("selectKeywordAria", { keyword: r.keyword })}
                    className="h-4 w-4 accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
                  />
                </td>
                <td className="pl-2 pr-3 align-middle">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {/* 显示格式化文本；href / title / data-raw 全部仍用原文：
                        跳转、复制、快照、导出都拿得到未修改的关键词 */}
                    <a
                      href={`/app/keyword-overview?keyword=${encodeURIComponent(r.keyword)}`}
                      title={r.keyword}
                      data-raw-keyword={r.keyword}
                      className={`min-w-0 truncate whitespace-nowrap font-sans text-ui-body font-medium leading-[20px] text-accent hover:underline ${linkClass}`}
                    >
                      {formatKeywordDisplay(r.keyword)}
                    </a>
                    <span className="flex shrink-0 items-center gap-1">
                      {r.origins.map((o) => (
                        <OriginBadge key={o} origin={o} compact />
                      ))}
                    </span>
                  </div>
                </td>
                <td className="text-center align-middle">
                  {intent === "未知" ? (
                    <span className="font-sans text-ui-caption leading-[16px] text-ink-25">—</span>
                  ) : (
                    <IntentChip intent={intent} />
                  )}
                </td>
                <td className={`${num} ${sortMode === "volume" ? "bg-line-soft/70" : ""}`}>
                  {r.searchVolume === null ? (
                    <span className="text-ink-25">—</span>
                  ) : (
                    <span className="text-ink">{fmtVol(r.searchVolume)}</span>
                  )}
                </td>
                <td className={num} title={r.difficulty === null ? naTip : undefined}>
                  {r.difficulty === null ? (
                    <span className="text-ink-25">—</span>
                  ) : (
                    <span className="text-ink">{r.difficulty}</span>
                  )}
                </td>
                <td className={num} title={r.cpc === null ? naTip : undefined}>
                  {r.cpc === null ? (
                    <span className="text-ink-25">—</span>
                  ) : (
                    <span className="text-ink">{fmtCpcV(r)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
