"use client";

// ===== Keyword Expansion（拓词建议 · 种子词 → 可追踪关键词）=====
//
// 与第一批 /app、/app/audit、关键词概览共用同一套可视化规则：
//   ① 头部 + 工具栏：市场 / 设备 / 目标项目 / 种子词（既有操作一个不少）
//   ② 种子词指标卡：种子词自身的量 / KD / CPC / 付费竞争度 / 趋势（真实获取才显示）
//   ③ 指标卡：相关搜索 / 相关问题 / 拓词合计（去重后真实总数）/ 本次已加入追踪
//   ④ 图表：意图分布（供应商意图优先，其余为文本规则估算）
//   ⑤ 数据表：关键词发现列表（关键词 / 来源 / 意图 / 搜索量 / KD / CPC / 付费竞争度 /
//      趋势 / 操作）+ 意图与来源筛选 + 排序 + 加载更多 + CSV 导出
//   ⑥ 相关搜索与相关问题标签：一键加入位置追踪
//
// 单请求契约（第十一阶段）：「分析」只调 /api/keywords/expand——related/paa 来自
// SerpApi，数据库扩词来自 DataForSEO Labs（suggestions 长尾 + ideas 语义相关），
// 全部一次带回。来源在 origins 中合并，同一关键词不按来源重复计数。
//
// 诚实边界：
//   - 指标均为供应商真实数据：可用即展示原值，缺失显示「—」；不估算、不用替代值。
//   - 意图列区分来源：Labs search_intent_info（供应商）优先，其余为文本规则估算（悬停可见）。
//   - DataForSEO 未配置凭据时：数据库扩词不可用，页面如实说明，只展示 SerpApi 来源词。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { useActiveProject } from "@/components/dashboard/ActiveProjectContext";
import { handleBillingError } from "@/lib/billing-error-client";
// 意图判定单一来源：共用 @/lib/seo/keyword-intent（无规则命中返回「未知」，不默认导航型）。
// export detectIntent 是既有对外契约（MCP/测试可能从本页导入），以 re-export 保留。
export { detectIntent } from "@/lib/seo/keyword-intent";
import { detectIntent, type KeywordIntent } from "@/lib/seo/keyword-intent";
// 合并去重口径：与 /api/keywords/suggestions 共用同一份纯实现（keyword-merge）
import { normalizeKeywordForDedup, type KeywordOrigin } from "@/lib/seo/keyword-merge";
import { extractSerpContentKeywords } from "@/lib/seo/serp-keywords";
// 主题分组与问题词识别：SeeO 规则型分组（非语义聚类），零外部 API 成本
import { clusterKeywords, isQuestionKeyword, CLUSTER_OTHER_ID } from "@/lib/seo/keyword-cluster";
// CTR 基线（SeeO 启发式规则，与机会引擎共用同一份纯模块）
import { expectedCtrForPosition } from "@/lib/seo/ctr-baseline";
// GSC 交叉匹配：归一化后仅精确匹配（无模糊），多落地页关系全保留（同一份纯实现可单测）
import {
  buildGscQueryIndex,
  matchKeywordsToGsc,
  normalizeQueryForMatch,
  type GscQueryMatch,
} from "@/lib/seo/gsc-match";
// P4 工作台：SeeO 自有竞争信号（纯函数，客户端可用）+ Trends/SERP 子组件与共享类型
import { computeSerpCompetitionSignal } from "@/lib/seo/serp-signal";
import { TrendsPanel, type TrendsQueryInput } from "./TrendsPanel";
import { SerpSection } from "./SerpSection";
import { DirectionExpansion } from "./DirectionExpansion";
import type { SerpSnapshot } from "./types";
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

/** 关键词来源类型：单一实现在 @/lib/seo/keyword-merge（含 autocomplete） */
type KeywordOriginKey = KeywordOrigin;

/** DataForSEO 指标行（与 /api/keywords/expand 的 metrics.keywords 字段一致） */
interface ExpandMetricsKeyword {
  keyword: string;
  origin: KeywordOriginKey;
  origins: KeywordOriginKey[];
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
  currency: string | null;
  /** Labs 行为 provider 原始 main_intent（如 "informational"）；其余为 null */
  intent: string | null;
  intentSource: "provider" | null;
  trend: { year: number; month: number; searchVolume: number }[] | null;
}
interface ExpandData {
  seed: string;
  related: string[];
  paa: string[];
  location: string;
  device: string;
  fromCache: boolean;
  /** 所选市场无精确映射时 true——UI 明示定位可能与预期不符 */
  marketFallback?: boolean;
  /** P4-B：同一次 searchSerp 调用的第一页快照（零额外 API 成本）；无则为 null */
  serpSnapshot?: SerpSnapshot | null;
  /** P0-02-A 新增（可空）：DataForSEO 指标补全；不可用时为 null → UI 如实说明 */
  metrics?: {
    source: "dataforseo" | null;
    fromCache: boolean;
    discovery?: {
      source: "dataforseo" | null;
      fromCache: boolean;
      /** unconfigured=未配置凭据/未请求；error=供应商失败；ok=成功（可能 0 结果） */
      state: "unconfigured" | "error" | "ok";
    };
    keywords?: ExpandMetricsKeyword[];
  } | null;
}

interface ExpandState {
  loading: boolean;
  data: ExpandData | null;
  error: string | null;
}

/** 表格行：关键词 + 展示口径（意图/指标/来源） */
interface KeywordRow {
  keyword: string;
  origins: KeywordOriginKey[];
  length: number;
  /** 展示用意图类别（供应商意图映射优先，否则文本规则估算） */
  displayIntent: IntentKey;
  /** 展示徽标文本（供应商意图为映射名，未知枚举显示原始值） */
  intentBadge: string;
  intentIsProvider: boolean;
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
  currency: string | null;
  trend: { year: number; month: number; searchVolume: number }[] | null;
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

// 表格可筛选的关键词来源（seed 有独立指标卡，不进表格；trends_queries=Google Trends 相关查询；
// serp_content=SERP 标题/摘要内容提取——真实 SERP 文本候选，绝非 Google 推荐词，UI 明示）
const TABLE_ORIGINS: KeywordOriginKey[] = ["related", "paa", "autocomplete", "labs_suggestions", "labs_ideas", "trends_queries", "serp_content"];

// 意图显示名（估算结果保持中文原值，仅展示时翻译）
function intentText(t: ReturnType<typeof useTranslations>, value: KeywordIntent): string {
  if (value === "信息型") return t("intentInformational");
  if (value === "商业型") return t("intentCommercial");
  if (value === "交易型") return t("intentTransactional");
  if (value === "导航型") return t("intentNavigational");
  return t("intentUnknown");
}

const INTENTS = ["信息型", "商业型", "交易型", "导航型", "未知"] as const;
type IntentKey = (typeof INTENTS)[number];

/** 意图类别色：有限、低饱和、可区分（信息=强调 / 商业=琥珀 / 交易=正向绿 / 导航=灰 / 未知=深灰） */
const INTENT_COLOR: Record<IntentKey, string> = {
  "信息型": RK_INTENT.informational,
  "商业型": RK_INTENT.commercial,
  "交易型": RK.up,
  "导航型": RK_INTENT.navigational,
  "未知": RK.neutralDeep,
};

/** DataForSEO search_intent_info.main_intent → 展示类别（供应商真实意图；查表避免逐例 return） */
const PROVIDER_INTENT_MAP: Record<string, IntentKey> = {
  informational: "信息型",
  commercial: "商业型",
  transactional: "交易型",
  navigational: "导航型",
};

function providerIntentKey(raw: string): IntentKey | null {
  return PROVIDER_INTENT_MAP[raw.trim().toLowerCase()] ?? null;
}

const PAGE_SIZE = 25;

// ===== GSC 搜索机会（独立数据域：自有网站的真实搜索表现）=====
// 数据来自项目绑定的 Google Search Console（第一方免费数据），与上方通用关键词发现
// （Google 相关搜索 / PAA / DataForSEO 数据库）含义不同，绝不合并展示。
// GSC 未配置/失败/空数据/正常四种状态分别渲染；不伪造任何字段。

interface GscConnectionInfo {
  connected: boolean;
  propertyUrl: string | null;
  propertyType: string | null;
  googleEmail: string | null;
  connectedAt: string | null;
}

interface GscPerfRow {
  keys: string[];
  clicks: number;
  impressions: number;
  /** 0-1 小数（GSC 原生口径），展示层转百分比 */
  ctr: number;
  position: number;
}

interface GscPerfData {
  propertyUrl: string;
  dateRange: { start: string; end: string };
  dimensions: string[];
  rows: GscPerfRow[];
  summary: { clicks: number; impressions: number; ctr: number | null; position: number | null };
  fromCache: boolean;
}

type GscSectionState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "needs-login"; message?: string }
  | { phase: "not-connected" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: GscPerfData };

interface GscOpportunityRow {
  query: string;
  page: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

type GscSortMode = "impressions" | "ctr" | "position" | "clicks";
type GscPositionFilter = "all" | "top5" | "top10" | "p11_20" | "p21_50";
type GscQuickFilter = "none" | "low_ctr" | "page2";

/** CSV 组装 + 下载（UTF-8 BOM + CRLF，Excel 中文兼容）；调用方决定列与取值，缺失值传 null/空串 */
function downloadCsvFile(filename: string, header: string[], rows: Array<Array<string | number | null>>) {
  const esc = (value: string | number | null) => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header, ...rows].map((cells) => cells.map(esc).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function KeywordExpandPage() {
  const t = useTranslations("dashboard.keywords.expand");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;

  // 指标格式化：null 一律显示「—」（不把缺失当 0）。
  // CPC 带 provider 返回的货币（USD 显示 $，其他货币追加货币码）；付费竞争度为 0–1 原值。
  const fmtVolume = (v: number | null) => (v === null ? "—" : formatNumber(v, locale));
  const fmtDifficulty = (v: number | null) => (v === null ? "—" : formatNumber(v, locale));
  const fmtCpc = (v: number | null, currency: string | null) => {
    if (v === null) return "—";
    const amount = v.toFixed(2);
    if (currency === "USD") return `$${amount}`;
    return currency ? `${amount} ${currency}` : amount;
  };
  const fmtCompetition = (v: number | null) => (v === null ? "—" : v.toFixed(2));
  const fmtCtrPct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const fmtPosition = (v: number) => v.toFixed(1);
  const [searchValue, setSearchValue] = useState("");
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<Device>("PC");
  const [trackDomain, setTrackDomain] = useState("");
  const [expand, setExpand] = useState<ExpandState>({ loading: false, data: null, error: null });
  const [usage, setUsage] = useState<UsageBadge | null>(null);
  const [trackingIds, setTrackingIds] = useState<Record<string, boolean>>({});
  const [intentFilter, setIntentFilter] = useState<"all" | IntentKey>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | KeywordOriginKey>("all");
  const [sortMode, setSortMode] = useState<"alpha" | "length" | "volume" | "kd">("volume");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Google 自动补全建议词（用户主动点击获取，不随「分析」自动调用）
  type SuggestPhase =
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "done"; count: number; added: number; fromCache: boolean }
    | { phase: "empty"; fromCache: boolean }
    | { phase: "error"; message: string };
  const [suggest, setSuggest] = useState<SuggestPhase>({ phase: "idle" });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // 多方向扩词返回的真实建议词（来源 autocomplete；面板状态与请求逻辑在 DirectionExpansion 子组件，
  // 以 seed 为 key 重新挂载重置——旧种子的方向状态绝不带入新种子）
  const [directionSuggestions, setDirectionSuggestions] = useState<string[]>([]);
  // Google Trends 相关查询（用户主动触发后并入统一发现表；来源 trends_queries）
  const [trendsQueries, setTrendsQueries] = useState<TrendsQueryInput[]>([]);
  // PAA 深度展开（P7）：仅对分析快照中真实带 next_page_token 的问题提供「继续展开」入口；
  // 展开的问题以 paa 来源并入统一发现表，父子关系只在 PAA 区块展示（表格行不伪造层级）。
  type PaaDeepPhase =
    | { phase: "loading" }
    | { phase: "done"; fetched: number; added: number; fromCache: boolean }
    | { phase: "empty" }
    | { phase: "error"; message: string };
  const [paaDeep, setPaaDeep] = useState<Record<string, PaaDeepPhase>>({});
  const [paaExpanded, setPaaExpanded] = useState<{ parent: string; question: string }[]>([]);
  // 主题分组筛选（SeeO 规则型分组）与问题词过滤
  const [topicFilter, setTopicFilter] = useState<"all" | string>("all");
  const [questionOnly, setQuestionOnly] = useState(false);
  // P8 研究成果持久化：保存/重开/删除只走本地 DB（/api/keywords/researches），零供应商 API 成本。
  // 重开 = 用保存的 payload 原样恢复各区块状态，不重新请求任何供应商。
  interface SavedResearchSummary {
    id: number;
    seed: string;
    location: string;
    device: string;
    keywordCount: number;
    savedAt: string;
  }
  type SaveState =
    | { phase: "idle" }
    | { phase: "saving" }
    | { phase: "done" }
    | { phase: "error"; message: string };
  const [savedList, setSavedList] = useState<SavedResearchSummary[]>([]);
  const [savedListLoaded, setSavedListLoaded] = useState(false);
  const [savedPanelOpen, setSavedPanelOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ phase: "idle" });
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [restoredInfo, setRestoredInfo] = useState<{ savedAt: string; count: number } | null>(null);
  // P8-T4 批量选择：键为关键词原文；跨筛选保留选择（筛选切换不悄悄丢选择）。
  // 批量操作全部走既有本地 DB 接口（/api/tracking、/api/keywords/groups*），无供应商请求。
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [groupList, setGroupList] = useState<{ id: number; name: string }[]>([]);
  const [groupChoice, setGroupChoice] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const { show, Toast } = useToast();

  // 顶部当前项目：进入本页即为「目标项目」，顶部切换后本页跟着换（不跳转）。
  // 关键词扩展是按关键词展开的，但"要追踪到哪"由项目决定，所以这里必须跟随全局项目。
  const { activeId, activeDomain, loading: projectsLoading } = useActiveProject();
  const appliedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (projectsLoading) return;
    if (appliedProjectRef.current === activeId) return;
    appliedProjectRef.current = activeId;
    if (!activeDomain) return;
    // 延迟一拍写入，避免 effect 同步体内 setState（lint: react-hooks/set-state-in-effect）
    const id = window.setTimeout(() => setTrackDomain(activeDomain), 0);
    return () => window.clearTimeout(id);
  }, [activeDomain, activeId, projectsLoading]);

  // P8 持久化：进入页面即拉取已保存研究列表（只读本地 DB，不涉及供应商 API）
  useEffect(() => {
    let alive = true;
    fetch("/api/keywords/researches")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (alive) setSavedList(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setSavedListLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 单请求：「分析」只调 /api/keywords/expand（related/paa/数据库扩词/指标/usage 一次带回）。
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
    setSourceFilter("all");
    setVisibleCount(PAGE_SIZE);
    // 新种子词的一切附属状态重置：旧建议词/方向扩词/分组/问题词筛选不再适用
    setSuggestions([]);
    setSuggest({ phase: "idle" });
    setDirectionSuggestions([]);
    setTrendsQueries([]);
    setPaaDeep({});
    setPaaExpanded([]);
    setTopicFilter("all");
    setQuestionOnly(false);
    // 新分析取代重开状态：保存态与「已重开」横幅一并清除
    setSaveState({ phase: "idle" });
    setRestoredInfo(null);
    // 新种子词的批量选择不再适用
    setSelected(new Set());
    setGroupChoice("");
    setNewGroupName("");

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

  // P8-T3：保存当前研究成果（完整工作台状态快照，重开时零 API 成本恢复）
  const handleSaveResearch = async () => {
    if (!expand.data || saveState.phase === "saving") return;
    setSaveState({ phase: "saving" });
    try {
      const res = await fetch("/api/keywords/researches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: expand.data.seed,
          location: expand.data.location,
          device: expand.data.device,
          payload: {
            expandData: expand.data,
            suggestions,
            directionSuggestions,
            trendsQueries,
            paaExpanded,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("savedFailGeneric"));
        setSaveState({ phase: "error", message });
        show(message, "error");
        return;
      }
      const record = json.data as SavedResearchSummary;
      setSaveState({ phase: "done" });
      setSavedList((prev) => [record, ...prev]);
      setSavedPanelOpen(true);
      show(t("savedSavedToast"), "success");
    } catch (err) {
      const message = `${t("savedFailGeneric")}${(err as Error).message}`;
      setSaveState({ phase: "error", message });
      show(message, "error");
    }
  };

  // P8-T3：重开已保存研究——payload 原样恢复各区块，不发起任何供应商请求
  const handleOpenSaved = async (id: number) => {
    if (openingId !== null) return;
    setOpeningId(id);
    try {
      const res = await fetch(`/api/keywords/researches/${id}`);
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("savedOpenFailGeneric"));
        show(message, "error");
        return;
      }
      const record = json.data as {
        seed: string;
        location: string;
        device: string;
        savedAt: string;
        payload: {
          expandData: ExpandData | null;
          suggestions?: string[];
          directionSuggestions?: string[];
          trendsQueries?: TrendsQueryInput[];
          paaExpanded?: { parent: string; question: string }[];
        };
      };
      if (!record.payload?.expandData) {
        show(t("savedOpenFailGeneric"), "error");
        return;
      }
      setSearchValue(record.seed);
      setLocation(record.location);
      setDevice(record.device === "移动端" ? "移动端" : "PC");
      setIntentFilter("all");
      setSourceFilter("all");
      setVisibleCount(PAGE_SIZE);
      setTopicFilter("all");
      setQuestionOnly(false);
      setSuggest({ phase: "idle" });
      setPaaDeep({});
      setSelected(new Set());
      setGroupChoice("");
      setNewGroupName("");
      setSaveState({ phase: "idle" });
      setExpand({ loading: false, data: record.payload.expandData, error: null });
      setSuggestions(record.payload.suggestions ?? []);
      setDirectionSuggestions(record.payload.directionSuggestions ?? []);
      setTrendsQueries(record.payload.trendsQueries ?? []);
      setPaaExpanded(record.payload.paaExpanded ?? []);
      const count = record.payload.expandData.related.length + (record.payload.expandData.paa?.length ?? 0);
      setRestoredInfo({ savedAt: record.savedAt, count });
      show(t("savedRestoredToast"), "success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      show(`${t("savedOpenFailGeneric")}${(err as Error).message}`, "error");
    } finally {
      setOpeningId(null);
    }
  };

  // P8-T3：删除已保存研究（本地 DB 记录，不涉及供应商）
  const handleDeleteSaved = async (id: number) => {
    if (!window.confirm(t("savedDeleteConfirm"))) return;
    try {
      const res = await fetch(`/api/keywords/researches/${id}`, { method: "DELETE" });
      if (!res.ok) {
        show(t("savedDeleteFail"), "error");
        return;
      }
      setSavedList((prev) => prev.filter((r) => r.id !== id));
      show(t("savedDeletedToast"), "success");
    } catch {
      show(t("savedDeleteFail"), "error");
    }
  };

  // P8-T4 批量操作：进入选择状态后拉取既有分组（本地 DB，一次只读请求）
  const hasSelection = selected.size > 0;
  useEffect(() => {
    if (!hasSelection) return;
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
  }, [hasSelection]);

  /** P8-T4 单行勾选切换（Set 重建以触发重渲染） */
  const toggleSelected = (keyword: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  };

  /** 全选当前筛选行（含「加载更多」未渲染部分——批量操作的口径是筛选结果，不是当前页） */
  const selectAllFiltered = () => setSelected(new Set(filteredRows.map((r) => r.keyword)));
  const clearSelected = () => setSelected(new Set());

  /** P8-T4 批量加入追踪：逐词走既有 POST /api/tracking；套餐上限触顶即停，已加入的原样保留。
   *  先按域名取一次既有追踪索引：已追踪的计入「跳过」，不把 UNIQUE 重复误报为失败。 */
  const handleBatchTrack = async () => {
    if (batchBusy || selected.size === 0) return;
    const targetDomain = trackDomain.trim();
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
      // 索引失败不阻塞：仍逐词尝试，重复会以 UNIQUE 错误如实计为失败
    }
    let added = 0;
    let skipped = 0;
    let failed = 0;
    let lastError = "";
    for (const kw of selected) {
      if (trackingIds[kw] || existing.has(kw)) {
        skipped++;
        setTrackingIds((prev) => ({ ...prev, [kw]: true }));
        continue;
      }
      try {
        const res = await fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: kw, location, device, domain: targetDomain }),
        });
        const json = await res.json();
        if (!res.ok) {
          const { message } = handleBillingError(json, t("addFailed"));
          failed++;
          lastError = message;
          // 套餐上限/计费类错误继续逐词重试必然同样失败——停止并保留已加入部分
          if (json?.code === "KEYWORD_LIMIT_REACHED" || json?.code === "QUOTA_EXCEEDED") break;
          continue;
        }
        added++;
        setTrackingIds((prev) => ({ ...prev, [kw]: true }));
        if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
      } catch {
        failed++;
        lastError = tc("networkError");
      }
    }
    setBatchBusy(false);
    if (added > 0) show(t("batchTrackDone", { added: formatNumber(added, locale), skipped: formatNumber(skipped, locale) }), "success");
    else if (failed > 0) show(lastError || t("addFailed"), "error");
    else if (skipped > 0) show(t("batchTrackAllSkipped", { count: formatNumber(skipped, locale) }), "info");
  };

  /**
   * P8-T4 批量加入分组：先确保所选词都已追踪（新建追踪拿 id），再按域名取回追踪行索引，
   * 逐词 POST members。全部是本地 DB 操作；分组可选用既有分组或就地新建。
   */
  const handleBatchGroup = async () => {
    if (batchBusy || selected.size === 0) return;
    const targetDomain = trackDomain.trim();
    if (!targetDomain) {
      show(t("selectProjectFirst"), "error");
      return;
    }
    let groupId = 0;
    let groupName = "";
    if (groupChoice === "new") {
      const name = newGroupName.trim();
      if (!name) {
        show(t("batchGroupNameRequired"), "error");
        return;
      }
      try {
        const res = await fetch("/api/keywords/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const json = await res.json();
        if (!res.ok) {
          const { message } = handleBillingError(json, t("batchGroupCreateFailed"));
          show(message, "error");
          return;
        }
        groupId = json.data.id as number;
        groupName = name;
        setGroupList((prev) => [...prev, { id: groupId, name }]);
        setGroupChoice(String(groupId));
        setNewGroupName("");
      } catch (err) {
        show(`${t("batchGroupCreateFailed")}${(err as Error).message}`, "error");
        return;
      }
    } else {
      const chosen = groupList.find((g) => String(g.id) === groupChoice);
      if (!chosen) {
        show(t("batchGroupPickRequired"), "error");
        return;
      }
      groupId = chosen.id;
      groupName = chosen.name;
    }

    setBatchBusy(true);
    let failed = 0;
    let lastError = "";
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
      // 索引失败不阻塞：仍逐词尝试，重复以 UNIQUE 错误如实计为失败
    }
    for (const kw of selected) {
      if (trackingIds[kw] || existing.has(kw)) {
        setTrackingIds((prev) => ({ ...prev, [kw]: true }));
        continue;
      }
      try {
        const res = await fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: kw, location, device, domain: targetDomain }),
        });
        const json = await res.json();
        if (!res.ok) {
          const { message } = handleBillingError(json, t("addFailed"));
          failed++;
          lastError = message;
          if (json?.code === "KEYWORD_LIMIT_REACHED" || json?.code === "QUOTA_EXCEEDED") break;
        } else {
          setTrackingIds((prev) => ({ ...prev, [kw]: true }));
          if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
        }
      } catch {
        failed++;
        lastError = tc("networkError");
      }
    }

    let addedMembers = 0;
    let missing = 0;
    try {
      const res = await fetch(`/api/tracking?domain=${encodeURIComponent(targetDomain)}`);
      const json = await res.json();
      const rows = (Array.isArray(json?.data) ? json.data : []) as { id: number; keyword: string }[];
      const idByKeyword = new Map<string, number>();
      for (const row of rows) {
        if (!idByKeyword.has(row.keyword)) idByKeyword.set(row.keyword, row.id);
      }
      for (const kw of selected) {
        const id = idByKeyword.get(kw);
        if (!id) {
          missing++;
          continue;
        }
        const mRes = await fetch(`/api/keywords/groups/${groupId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword_id: id }),
        });
        if (mRes.ok) addedMembers++;
        else missing++;
      }
    } catch {
      missing += selected.size;
    }
    setBatchBusy(false);
    if (addedMembers > 0) {
      show(t("batchGroupDone", { count: formatNumber(addedMembers, locale), name: groupName }), "success");
    }
    if (failed > 0) show(lastError || t("addFailed"), "error");
    else if (missing > 0 && addedMembers === 0) show(t("batchGroupMissing"), "error");
  };

  /**
   * 用户主动获取 Google 自动补全建议（独立引擎调用，受 SerpApi 配额与 24h 缓存保护）。
   * 失败时只更新本区块状态——此前的研究结果（related/paa/表格）原样保留。
   */
  const handleFetchSuggestions = async () => {
    const seed = expand.data?.seed;
    if (!seed || suggest.phase === "loading") return;
    setSuggest({ phase: "loading" });
    try {
      const res = await fetch("/api/keywords/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed, location }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("suggestFailed"));
        setSuggest({ phase: "error", message });
        return;
      }
      const data = json.data as { suggestions: string[]; fromCache: boolean };
      const existingKeys = new Set(keywordRows.map((r) => normalizeKeywordForDedup(r.keyword)));
      const added = data.suggestions.filter((s) => {
        const key = normalizeKeywordForDedup(s);
        return key !== seedNorm && !existingKeys.has(key);
      }).length;
      setSuggestions(data.suggestions);
      setSuggest(data.suggestions.length === 0
        ? { phase: "empty", fromCache: data.fromCache }
        : { phase: "done", count: data.suggestions.length, added, fromCache: data.fromCache });
      setVisibleCount(PAGE_SIZE);
    } catch (err) {
      setSuggest({ phase: "error", message: `${tc("networkError")} ${(err as Error).message}` });
    }
  };

  /**
   * Trends 相关查询并入统一发现表（top + rising；去重；调用幂等——缓存命中重复回调安全）。
   * 与建议词同一套归一口径：已有词只合并来源，新词为 null 指标行（不编造指标）。
   */
  const handleTrendsQueriesLoaded = (queries: TrendsQueryInput[]) => {
    setTrendsQueries((prev) => {
      const seen = new Set(prev.map((q) => normalizeKeywordForDedup(q.label)));
      const fresh: TrendsQueryInput[] = [];
      for (const q of queries) {
        const key = normalizeKeywordForDedup(q.label);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        fresh.push(q);
      }
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  };

  /** 方向扩词返回的真实建议词并入统一发现表（幂等；来源 autocomplete，与建议词同口径） */
  const handleDirectionSuggestions = (words: string[]) => {
    setDirectionSuggestions((prev) => {
      const seen = new Set(prev.map((s) => normalizeKeywordForDedup(s)));
      const fresh = words.filter((s) => !seen.has(normalizeKeywordForDedup(s)));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
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

  /** PAA 深度展开 token 表：只来自分析快照中 provider 真实返回的 next_page_token（P7） */
  const paaTokenByQuestion = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of expand.data?.serpSnapshot?.relatedQuestions ?? []) {
      if (q.question && q.nextPageToken) map.set(normalizeKeywordForDedup(q.question), q.nextPageToken);
    }
    return map;
  }, [expand.data]);

  /**
   * PAA 深度展开：用户对带 token 的问题主动点击后调用 /api/keywords/paa
   * （缓存与配额在服务端单点完成；同 token 24h 缓存命中零消耗）。
   * 新问题以 paa 来源并入统一发现表；失败只更新本问题状态，已得结果原样保留。
   */
  const handleExpandPaa = async (parent: string) => {
    const key = normalizeKeywordForDedup(parent);
    const token = paaTokenByQuestion.get(key);
    if (!token || paaDeep[key]?.phase === "loading") return;
    setPaaDeep((prev) => ({ ...prev, [key]: { phase: "loading" } }));
    try {
      const res = await fetch("/api/keywords/paa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("paaExpandFailed"));
        setPaaDeep((prev) => ({ ...prev, [key]: { phase: "error", message } }));
        return;
      }
      const data = json.data as { questions: { question: string }[]; fromCache: boolean };
      const existingKeys = new Set([
        ...keywordRows.map((r) => normalizeKeywordForDedup(r.keyword)),
        ...paaExpanded.map((item) => normalizeKeywordForDedup(item.question)),
      ]);
      const fresh = data.questions.filter((q) => {
        const k = normalizeKeywordForDedup(q.question);
        return k && k !== seedNorm && !existingKeys.has(k);
      });
      setPaaExpanded((prev) => [...prev, ...fresh.map((q) => ({ parent, question: q.question }))]);
      setPaaDeep((prev) => ({
        ...prev,
        [key]: data.questions.length === 0
          ? { phase: "empty" }
          : { phase: "done", fetched: data.questions.length, added: fresh.length, fromCache: data.fromCache },
      }));
    } catch (err) {
      setPaaDeep((prev) => ({ ...prev, [key]: { phase: "error", message: `${tc("networkError")} ${(err as Error).message}` } }));
    }
  };
  const trackedThisSession = Object.values(trackingIds).filter(Boolean).length;
  const discoveryAvailable = expand.data?.metrics?.discovery?.source === "dataforseo";

  /** 数据库发现是否成功拿到过行（用于区分「未配置」与「配置了但 0 结果」） */
  const discoveryHasRows = (expand.data?.metrics?.keywords ?? []).some(
    (k) => k.origin === "labs_suggestions" || k.origin === "labs_ideas"
  );

  const seedNorm = (expand.data?.seed ?? "").trim().toLowerCase();

  // SERP 标题/摘要内容提取候选（纯本地计算，零 API 成本；来源标记 serp_content，绝不伪装成
  // Google 推荐词）。只使用「分析」已获得的真实快照文本；新种子词随 expand.data 重置。
  const serpExtracted = useMemo<string[]>(() => {
    const snapshot = expand.data?.serpSnapshot;
    const seed = expand.data?.seed;
    if (!snapshot || !seed || snapshot.organic.length === 0) return [];
    return extractSerpContentKeywords(
      snapshot.organic.map((row) => ({ title: row.title, snippet: row.snippet })),
      seed
    );
  }, [expand.data]);

  /**
   * 关键词发现列表：metrics.keywords 去掉种子词（种子词有独立指标卡）后的全部行
   * + 用户主动获取的 Google 自动补全建议词（keyword-merge 同一套归一口径合并：
   *   已有词只追加 autocomplete 来源标记，新词追加为 autocomplete 来源行）。
   * 意图展示：provider 意图（Labs search_intent_info）优先映射，否则文本规则估算。
   * 指标层完全缺失时退回 related/paa 纯列表（不伪造指标）。
   */
  const keywordRows = useMemo<KeywordRow[]>(() => {
    const data = expand.data;
    if (!data) return [];
    const mk = data.metrics?.keywords ?? [];
    const buildRow = (k: {
      keyword: string;
      origins: KeywordOriginKey[];
      intent?: string | null;
      intentSource?: "provider" | null;
      searchVolume: number | null;
      difficulty: number | null;
      cpc: number | null;
      competition: number | null;
      competitionLevel: string | null;
      currency: string | null;
      trend: { year: number; month: number; searchVolume: number }[] | null;
    }): KeywordRow => {
      const providerKey = k.intentSource === "provider" && k.intent ? providerIntentKey(k.intent) : null;
      const estimate = detectIntent(k.keyword);
      const displayIntent: IntentKey = providerKey ?? estimate;
      const intentBadge = providerKey
        ? intentText(t, providerKey)
        : k.intent && k.intentSource === "provider"
          ? k.intent // provider 返回了未知枚举：原样展示，不猜测映射
          : intentText(t, estimate);
      return {
        keyword: k.keyword,
        origins: k.origins,
        length: k.keyword.length,
        displayIntent,
        intentBadge,
        intentIsProvider: k.intentSource === "provider",
        searchVolume: k.searchVolume,
        difficulty: k.difficulty,
        cpc: k.cpc,
        competition: k.competition,
        competitionLevel: k.competitionLevel,
        currency: k.currency,
        trend: k.trend,
      };
    };

    // 统一按归一 key 收敛（插入序保留，保证与旧实现同序）
    const byKey = new Map<string, KeywordRow>();
    const put = (row: KeywordRow) => {
      byKey.set(normalizeKeywordForDedup(row.keyword), row);
    };
    const mergeOrigin = (key: string, origin: KeywordOriginKey) => {
      const existing = byKey.get(key);
      if (existing && !existing.origins.includes(origin)) existing.origins.push(origin);
    };

    if (mk.length > 0) {
      for (const k of mk) {
        const key = normalizeKeywordForDedup(k.keyword);
        if (key === seedNorm || k.origin === "seed") continue;
        put(buildRow({
          keyword: k.keyword,
          origins: k.origins ?? [k.origin as KeywordOriginKey],
          intent: k.intent,
          intentSource: k.intentSource,
          searchVolume: k.searchVolume,
          difficulty: k.difficulty,
          cpc: k.cpc,
          competition: k.competition,
          competitionLevel: k.competitionLevel,
          currency: k.currency,
          trend: k.trend,
        }));
      }
    } else {
      // 指标层缺失（enrichMetrics 关闭等）：退回 related/paa 纯列表
      const pushList = (list: string[], origin: KeywordOriginKey) => {
        for (const q of list) {
          const key = normalizeKeywordForDedup(q);
          if (!key || key === seedNorm) continue;
          if (byKey.has(key)) {
            mergeOrigin(key, origin);
            continue;
          }
          byKey.set(key, buildRow({ keyword: q, origins: [origin], searchVolume: null, difficulty: null, cpc: null, competition: null, competitionLevel: null, currency: null, trend: null }));
        }
      };
      pushList(data.related, "related");
      pushList(data.paa, "paa");
    }

    // Google 自动补全建议词并入：已有词合并 origins；新词为 null 指标行（不编造指标）。
    // 来源含「获取更多建议」与多方向扩词（方向返回的也是同一引擎的真实建议词）。
    for (const suggestion of [...suggestions, ...directionSuggestions]) {
      const key = normalizeKeywordForDedup(suggestion);
      if (!key || key === seedNorm) continue;
      if (byKey.has(key)) {
        mergeOrigin(key, "autocomplete");
        continue;
      }
      byKey.set(key, buildRow({
        keyword: suggestion,
        origins: ["autocomplete"],
        searchVolume: null, difficulty: null, cpc: null, competition: null, competitionLevel: null, currency: null, trend: null,
      }));
    }

    // Google Trends 相关查询并入：与建议词同一套归一合并（新词为 null 指标行，不编造指标）
    for (const q of trendsQueries) {
      const key = normalizeKeywordForDedup(q.label);
      if (!key || key === seedNorm) continue;
      if (byKey.has(key)) {
        mergeOrigin(key, "trends_queries");
        continue;
      }
      byKey.set(key, buildRow({
        keyword: q.label,
        origins: ["trends_queries"],
        searchVolume: null, difficulty: null, cpc: null, competition: null, competitionLevel: null, currency: null, trend: null,
      }));
    }

    // PAA 深度展开并入（P7）：与 related/paa 同一套归一合并；新词为 null 指标行，来源 paa
    for (const item of paaExpanded) {
      const key = normalizeKeywordForDedup(item.question);
      if (!key || key === seedNorm) continue;
      if (byKey.has(key)) {
        mergeOrigin(key, "paa");
        continue;
      }
      byKey.set(key, buildRow({
        keyword: item.question,
        origins: ["paa"],
        searchVolume: null, difficulty: null, cpc: null, competition: null, competitionLevel: null, currency: null, trend: null,
      }));
    }

    // SERP 内容提取候选并入：与建议词/Trends 同一套归一合并（新词为 null 指标行，不编造指标）
    for (const phrase of serpExtracted) {
      const key = normalizeKeywordForDedup(phrase);
      if (!key || key === seedNorm) continue;
      if (byKey.has(key)) {
        mergeOrigin(key, "serp_content");
        continue;
      }
      byKey.set(key, buildRow({
        keyword: phrase,
        origins: ["serp_content"],
        searchVolume: null, difficulty: null, cpc: null, competition: null, competitionLevel: null, currency: null, trend: null,
      }));
    }

    return [...byKey.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expand.data, suggestions, directionSuggestions, trendsQueries, paaExpanded, serpExtracted, t, locale]);

  /** 种子词自身指标（真实获取才显示；来自 Labs include_seed_keyword 或批量补全） */
  const seedRow = useMemo<ExpandMetricsKeyword | null>(() => {
    const mk = expand.data?.metrics?.keywords ?? [];
    return mk.find((k) => k.origin === "seed" || k.keyword.trim().toLowerCase() === seedNorm) ?? null;
  }, [expand.data, seedNorm]);
  const seedHasMetrics = !!seedRow && (seedRow.searchVolume !== null || seedRow.difficulty !== null || seedRow.cpc !== null);

  /** 各来源真实数量（同一关键词多来源时在每个来源都计数一次，但不重复生成行） */
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const origin of TABLE_ORIGINS) counts[origin] = 0;
    for (const row of keywordRows) {
      for (const origin of row.origins) {
        if (origin in counts) counts[origin] += 1;
      }
    }
    return counts;
  }, [keywordRows]);

  const intentCounts = useMemo(() => {
    const counts: Record<IntentKey, number> = { "信息型": 0, "商业型": 0, "交易型": 0, "导航型": 0, "未知": 0 };
    for (const row of keywordRows) counts[row.displayIntent]++;
    return counts;
  }, [keywordRows]);

  const intentChartData = INTENTS.map((k) => ({
    key: k,
    label: intentText(t, k),
    value: intentCounts[k],
    color: INTENT_COLOR[k],
  }));

  // ===== 主题分组（SeeO 规则型分组：真实结果中的高频核心词，非语义聚类） =====
  const clusters = useMemo(
    () => clusterKeywords(keywordRows.map((r) => r.keyword)),
    [keywordRows]
  );
  /** 关键词（归一）→ 主分组 id；主题筛选与来源/意图筛选是 AND 关系 */
  const clusterIdByKeyword = useMemo(() => {
    const map = new Map<string, string>();
    for (const cluster of clusters) {
      for (const keyword of cluster.keywords) {
        map.set(normalizeKeywordForDedup(keyword), cluster.id);
      }
    }
    return map;
  }, [clusters]);

  // ===== 问题词（PAA 真实问题 + 规则识别的疑问词；非 Google 官方问题分类） =====
  const rowIsQuestion = (row: KeywordRow): boolean =>
    row.origins.includes("paa") || isQuestionKeyword(row.keyword);
  const questionCount = useMemo(
    () => keywordRows.filter(rowIsQuestion).length,
    [keywordRows]
  );

  const filteredRows = useMemo(
    () =>
      keywordRows.filter(
        (r) =>
          (intentFilter === "all" || r.displayIntent === intentFilter) &&
          (sourceFilter === "all" || r.origins.includes(sourceFilter)) &&
          (topicFilter === "all" || clusterIdByKeyword.get(normalizeKeywordForDedup(r.keyword)) === topicFilter) &&
          (!questionOnly || rowIsQuestion(r))
      ),
    [keywordRows, intentFilter, sourceFilter, topicFilter, questionOnly, clusterIdByKeyword]
  );

  // 指标可用性：任一行有真实指标才展示指标列与启用按量/难度排序。
  // 无指标时隐藏整排「—」列、禁用相应排序——缺失不代表 0，也不让空列占据界面。
  const hasVolumeData = useMemo(() => keywordRows.some((r) => r.searchVolume !== null), [keywordRows]);
  const hasKdData = useMemo(() => keywordRows.some((r) => r.difficulty !== null), [keywordRows]);
  const hasAnyMetrics = useMemo(
    () => keywordRows.some((r) => r.searchVolume !== null || r.difficulty !== null || r.cpc !== null || r.competition !== null),
    [keywordRows]
  );

  /** 排序回退：所选排序依赖的指标当前无数据时，回退字母序（不冒充有效排序） */
  const effectiveSort: "alpha" | "length" | "volume" | "kd" =
    (sortMode === "volume" && !hasVolumeData) || (sortMode === "kd" && !hasKdData) ? "alpha" : sortMode;

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      if (effectiveSort === "length") return b.length - a.length || a.keyword.localeCompare(b.keyword);
      if (effectiveSort === "volume") return (b.searchVolume ?? -1) - (a.searchVolume ?? -1) || a.keyword.localeCompare(b.keyword);
      if (effectiveSort === "kd") return (a.difficulty ?? 1001) - (b.difficulty ?? 1001) || a.keyword.localeCompare(b.keyword);
      return a.keyword.localeCompare(b.keyword);
    });
    return rows;
  }, [filteredRows, effectiveSort]);

  const visibleRows = useMemo(() => sortedRows.slice(0, visibleCount), [sortedRows, visibleCount]);

  /** 指标卡：related/paa 为原始列表计数；total 为去重后的真实总数（含数据库扩词） */
  const metrics = expand.data
    ? {
        related: expand.data.related.length,
        paa: expand.data.paa.length,
        total: keywordRows.length,
      }
    : null;

  // ===== GSC 搜索机会状态（独立数据域；挂载后按项目加载一次） =====
  const [gscState, setGscState] = useState<GscSectionState>({ phase: "idle" });
  const [gscSort, setGscSort] = useState<GscSortMode>("impressions");
  const [gscPositionFilter, setGscPositionFilter] = useState<GscPositionFilter>("all");
  const [gscQuickFilter, setGscQuickFilter] = useState<GscQuickFilter>("none");

  // ===== 研究结果 ↔ GSC 匹配视图切换 =====
  const [resultView, setResultView] = useState<"research" | "gsc-match">("research");
  const [matchFilter, setMatchFilter] = useState<"matched" | "all">("matched");
  const [matchVisibleCount, setMatchVisibleCount] = useState(PAGE_SIZE);

  // 已有机会（只读懒加载：首次切到匹配视图时取一次；本页绝不创建机会——创建只发生在机会页的既有扫描入口）
  interface OppItem {
    type: string;
    targetType: string;
    targetValue: string;
    priority: string;
    status: string;
  }
  type OppListState =
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; items: OppItem[] }
    | { phase: "error"; message: string };
  const [oppState, setOppState] = useState<OppListState>({ phase: "idle" });
  // 取一次守卫：StrictMode 双调 effect 时，第一次加载被 cleanup 取消后必须允许第二次重跑
  const oppFetchRef = useRef<string | null>(null);

  useEffect(() => {
    if (resultView !== "gsc-match" || !activeId) return;
    if (oppFetchRef.current === activeId) return;
    oppFetchRef.current = activeId;
    let cancelled = false;
    const loadOpp = async () => {
      setOppState({ phase: "loading" });
      try {
        const res = await fetch(`/api/opportunities?project_id=${encodeURIComponent(activeId)}&limit=200`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setOppState({ phase: "error", message: typeof json.error === "string" ? json.error : `HTTP ${res.status}` });
          return;
        }
        const items = Array.isArray(json.data?.opportunities) ? (json.data.opportunities as OppItem[]) : [];
        setOppState({ phase: "ready", items });
      } catch (err) {
        if (!cancelled) setOppState({ phase: "error", message: `${tc("networkError")} ${(err as Error).message}` });
      }
    };
    void loadOpp();
    return () => {
      cancelled = true;
      oppFetchRef.current = null;
    };
  }, [resultView, activeId, tc]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const loadGsc = async () => {
      setGscState({ phase: "loading" });
      try {
        const connRes = await fetch(`/api/gsc/connection?project_id=${encodeURIComponent(activeId)}`, { cache: "no-store" });
        const connJson = await connRes.json().catch(() => ({}));
        if (!connRes.ok) {
          if (cancelled) return;
          if (connRes.status === 403) {
            setGscState({ phase: "needs-login", message: typeof connJson.error === "string" ? connJson.error : undefined });
          } else {
            setGscState({ phase: "error", message: typeof connJson.error === "string" ? connJson.error : `HTTP ${connRes.status}` });
          }
          return;
        }
        const status = connJson.data as GscConnectionInfo | undefined;
        if (!status?.connected) {
          if (!cancelled) setGscState({ phase: "not-connected" });
          return;
        }
        const perfRes = await fetch(
          `/api/gsc/performance?project_id=${encodeURIComponent(activeId)}&dimensions=query,page&date_range=last_28_days&row_limit=200`,
          { cache: "no-store" }
        );
        const perfJson = await perfRes.json().catch(() => ({}));
        if (!perfRes.ok) {
          if (cancelled) return;
          // 连接被移除等竞态：按未连接处理，其余按错误
          if (perfJson.code === "GSC_NOT_CONNECTED") {
            setGscState({ phase: "not-connected" });
          } else {
            setGscState({ phase: "error", message: typeof perfJson.error === "string" ? perfJson.error : `HTTP ${perfRes.status}` });
          }
          return;
        }
        if (!cancelled) setGscState({ phase: "ready", data: perfJson.data as GscPerfData });
      } catch (err) {
        if (!cancelled) setGscState({ phase: "error", message: `${tc("networkError")} ${(err as Error).message}` });
      }
    };
    void loadGsc();
    return () => {
      cancelled = true;
    };
  }, [activeId, tc]);

  /** GSC 行 → 机会行（query+page 双维度；单维度数据时落地页如实为 null） */
  const gscOpportunityRows = useMemo<GscOpportunityRow[]>(() => {
    if (gscState.phase !== "ready") return [];
    return gscState.data.rows.map((row) => ({
      query: row.keys[0] ?? "",
      page: row.keys.length > 1 ? row.keys[1] : null,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }));
  }, [gscState]);

  /** SeeO 快捷筛选规则（非 Google 官方标准，界面已标注）：高曝光低 CTR 与第二页 */
  const isSeeoLowCtr = (row: GscOpportunityRow): boolean => {
    if (row.impressions < 100 || row.position > 10) return false;
    const baseline = expectedCtrForPosition(row.position);
    return baseline !== null && row.ctr < baseline * 0.5;
  };
  const isSeeoPage2 = (row: GscOpportunityRow): boolean => row.position > 10 && row.position <= 20;

  const gscFilteredRows = useMemo(() => {
    const byPosition = (row: GscOpportunityRow): boolean => {
      if (gscPositionFilter === "top5") return row.position <= 5;
      if (gscPositionFilter === "top10") return row.position <= 10;
      if (gscPositionFilter === "p11_20") return row.position > 10 && row.position <= 20;
      if (gscPositionFilter === "p21_50") return row.position > 20 && row.position <= 50;
      return true;
    };
    const byQuick = (row: GscOpportunityRow): boolean => {
      if (gscQuickFilter === "low_ctr") return isSeeoLowCtr(row);
      if (gscQuickFilter === "page2") return isSeeoPage2(row);
      return true;
    };
    return gscOpportunityRows.filter((row) => byPosition(row) && byQuick(row));
  }, [gscOpportunityRows, gscPositionFilter, gscQuickFilter]);

  const gscSortedRows = useMemo(() => {
    const rows = [...gscFilteredRows];
    rows.sort((a, b) => {
      if (gscSort === "ctr") return b.ctr - a.ctr || b.impressions - a.impressions;
      if (gscSort === "position") return a.position - b.position || b.impressions - a.impressions;
      if (gscSort === "clicks") return b.clicks - a.clicks || b.impressions - a.impressions;
      return b.impressions - a.impressions || a.position - b.position;
    });
    return rows;
  }, [gscFilteredRows, gscSort]);

  // ===== GSC 交叉匹配（研究结果 × 自有网站 GSC 查询数据；纯客户端计算，零额外请求） =====
  const gscMatchIndex = useMemo(
    () => buildGscQueryIndex(gscState.phase === "ready" ? gscState.data.rows : []),
    [gscState]
  );
  const matchByKeyword = useMemo(
    () => matchKeywordsToGsc(keywordRows.map((r) => r.keyword), gscMatchIndex),
    [keywordRows, gscMatchIndex]
  );

  /** SeeO 低 CTR 判断规则（与机会引擎 evaluateCtrOpportunity 同一基线；非 Google 官方标准） */
  const isSeeoLowCtrMatch = (m: GscQueryMatch): boolean => {
    if (m.impressions < 100 || m.position === null || m.position > 10 || m.ctr === null) return false;
    const baseline = expectedCtrForPosition(Math.ceil(m.position));
    return baseline !== null && m.ctr < baseline * 0.5;
  };

  /** 匹配视图行：只看已匹配 / 含未匹配；未匹配行的 GSC 字段如实留空（不写 0） */
  const matchRows = useMemo(() => {
    const rows = keywordRows.map((r) => ({
      keyword: r.keyword,
      match: matchByKeyword.get(r.keyword) ?? null,
    }));
    return matchFilter === "matched" ? rows.filter((r) => r.match !== null) : rows;
  }, [keywordRows, matchByKeyword, matchFilter]);

  const visibleMatchRows = useMemo(
    () => matchRows.slice(0, matchVisibleCount),
    [matchRows, matchVisibleCount]
  );

  /** 已有机会索引（keyword 目标，归一化匹配；同词多条取第一条） */
  const oppByKeyword = useMemo(() => {
    const map = new Map<string, OppItem>();
    if (oppState.phase === "ready") {
      for (const item of oppState.items) {
        if (item.targetType !== "keyword") continue;
        const key = normalizeQueryForMatch(item.targetValue);
        if (key && !map.has(key)) map.set(key, item);
      }
    }
    return map;
  }, [oppState]);

  /** 匹配视图 CSV：与当前筛选一致；无数据的 CTR/位置/落地页导出空串（缺失不冒充 0） */
  const handleExportMatchCsv = () => {
    const header = [
      t("colKeyword"), t("matchColStatus"), t("gscColPage"), t("gscColClicks"),
      t("gscColImpressions"), t("gscColCtr"), t("gscColPosition"), t("matchColOpp"),
    ];
    const rows = matchRows.map((r) => {
      const m = r.match;
      const opp = r.match ? oppByKeyword.get(normalizeQueryForMatch(r.keyword)) : undefined;
      return [
        r.keyword,
        m ? (m.clicks > 0 ? t("matchStatusClicked") : t("matchStatusExposed")) : t("matchStatusUnmatched"),
        m ? m.pages.map((p) => p.page ?? "").filter(Boolean).join(" ; ") : "",
        m ? m.clicks : "",
        m ? m.impressions : "",
        m && m.ctr !== null ? (m.ctr * 100).toFixed(2) : "",
        m && m.position !== null ? m.position.toFixed(1) : "",
        opp ? `${opp.type} · ${opp.status}` : "",
      ];
    });
    downloadCsvFile("seeo-keywords-gsc-match.csv", header, rows);
    show(t("csvExported", { count: matchRows.length }), "success");
  };

  /** CSV 导出：与当前筛选+排序结果一致（导出全部筛选行，而非当前页）；UTF-8 BOM 兼容 Excel。
   *  P8：追加数据口径列（市场/设备/语言/采集时间/指标来源），缺失指标导出空串不冒充 0。 */
  const handleExportCsv = () => {
    const header = [
      "market", "device", "language", "collected_at", "metrics_source",
      t("colKeyword"), t("colSource"), t("colIntent"), "intent_source",
      t("colVolume"), t("colDifficulty"), t("colCpc"), "currency", t("colCompetition"), "competition_level",
    ];
    const market = expand.data?.location ?? "";
    const deviceCol = device;
    const language = expand.data?.serpSnapshot?.language ?? "";
    const collectedAt = expand.data?.serpSnapshot?.fetchedAt ?? "";
    const metricsSource = expand.data?.metrics?.source ?? "";
    const rows = sortedRows.map((r) => [
      market,
      deviceCol,
      language,
      collectedAt,
      metricsSource,
      r.keyword,
      r.origins.join("+"),
      r.intentBadge,
      r.intentIsProvider ? "provider" : "estimate",
      r.searchVolume ?? "",
      r.difficulty ?? "",
      r.cpc ?? "",
      r.currency ?? "",
      r.competition ?? "",
      r.competitionLevel ?? "",
    ]);
    const safeSeed = (expand.data?.seed ?? "keywords").replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 40);
    downloadCsvFile(`seeo-keywords-${safeSeed}.csv`, header, rows);
    show(t("csvExported", { count: sortedRows.length }), "success");
  };

  /** GSC 搜索机会导出：与当前筛选+排序一致；CTR 导出百分比（与界面口径一致） */
  const handleExportGscCsv = () => {
    const header = [
      t("gscColQuery"), t("gscColPage"), t("gscColClicks"), t("gscColImpressions"), t("gscColCtr"), t("gscColPosition"),
    ];
    const rows = gscSortedRows.map((r) => [
      r.query,
      r.page ?? "",
      r.clicks,
      r.impressions,
      r.ctr !== null ? (r.ctr * 100).toFixed(2) : "",
      r.position !== null ? r.position.toFixed(1) : "",
    ]);
    downloadCsvFile("seeo-gsc-opportunities.csv", header, rows);
    show(t("csvExported", { count: gscSortedRows.length }), "success");
  };

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
        <div className="flex items-center gap-2">
          <button type="submit" disabled={expand.loading} className="btn-primary px-6 disabled:opacity-60">
            {expand.loading ? t("analyzing") : t("analyze")}
          </button>
          {hasResult && (
            <button
              type="button"
              onClick={handleSaveResearch}
              disabled={saveState.phase === "saving"}
              className="h-10 rounded-md border border-line bg-card px-4 text-sm text-ink transition-colors hover:border-ink-25 disabled:opacity-60"
            >
              {saveState.phase === "saving" ? t("savedSaving") : t("savedSaveBtn")}
            </button>
          )}
        </div>
      </form>

      {/* P8 已保存研究面板：列表来自本地 DB，打开=零 API 成本重开，删除不可恢复（有确认） */}
      <section aria-label={t("savedPanelTitle")} className="mt-3 rounded-lg border border-line-soft">
        <button
          type="button"
          onClick={() => setSavedPanelOpen((v) => !v)}
          aria-expanded={savedPanelOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="font-sans text-sm font-medium text-ink">
            {t("savedPanelTitle")}
            {savedList.length > 0 && (
              <span className="ml-2 font-mono text-xs text-ink-40">{t("savedCount", { count: savedList.length })}</span>
            )}
          </span>
          <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 text-ink-40 transition-transform ${savedPanelOpen ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {savedPanelOpen && (
          <div className="border-t border-line-soft px-4 pb-3 pt-1">
            {savedList.length === 0 ? (
              <p className="py-2 font-sans text-xs text-ink-40">
                {savedListLoaded ? t("savedEmpty") : t("savedLoading")}
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {savedList.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-sans text-sm text-ink">{r.seed}</p>
                      <p className="font-mono text-xs text-ink-40">
                        {display(r.location)} · {r.device === "移动端" ? (locale === "zh" ? "移动端" : "Mobile") : "PC"} ·{" "}
                        {t("savedKeywords", { count: r.keywordCount })} · {r.savedAt}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenSaved(r.id)}
                        disabled={openingId !== null}
                        className="rounded-md border border-line px-3 py-1.5 font-sans text-xs text-ink transition-colors hover:border-ink-25 disabled:opacity-60"
                      >
                        {openingId === r.id ? t("savedOpenLoading") : t("savedOpen")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSaved(r.id)}
                        disabled={openingId !== null}
                        className="rounded-md border border-line px-3 py-1.5 font-sans text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink disabled:opacity-60"
                      >
                        {t("savedDelete")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* 工作台流程导航：锚点直达各分区（分区未渲染的入口不显示，避免点了没反应） */}
      {hasResult && (
        <nav aria-label={t("flowNavLabel")} className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { href: "#kw-overview", label: t("flowNavOverview") },
            { href: "#kw-signal", label: t("flowNavSignal") },
            ...(resultView === "research" ? [{ href: "#kw-trends", label: t("flowNavTrends") }] : []),
            { href: "#kw-discovery", label: t("flowNavDiscovery") },
            ...(expand.data?.serpSnapshot ? [{ href: "#kw-serp", label: t("flowNavSerp") }] : []),
            { href: "#kw-gsc", label: t("flowNavGsc") },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={(e) => {
                // 实测（390px）：hash 原生跳转在嵌套滚动容器里落点偏差约 500px；
                // scrollIntoView 落点精准（scroll-mt-4 对其同样生效），故手动接管
                e.preventDefault();
                document.getElementById(item.href.slice(1))?.scrollIntoView({ block: "start" });
                window.history.replaceState(null, "", item.href);
              }}
              className="rounded-md border border-line px-2 py-1 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}

      {/* 市场回退明示：所选市场无精确映射时不静默伪装定位 */}
      {expand.data?.marketFallback && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-sans text-xs text-ink-60">
          {t("marketNotice", { location: display(expand.data.location) })}
        </p>
      )}

      {/* P8 重开明示：当前结果是历史保存快照（含采集时间），不是新请求 */}
      {restoredInfo && expand.data && (
        <p className="mt-3 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 font-sans text-xs text-ink-60">
          {t("savedRestoredBanner", { time: restoredInfo.savedAt, count: restoredInfo.count })}
        </p>
      )}

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

      {/* 种子词指标卡：真实获取才显示数值，缺失显示不可用（不把付费竞争度称为自然难度） */}
      {hasResult && expand.data?.seed && (
        <section id="kw-overview" className="card-a mt-5 scroll-mt-4 p-5">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-semibold text-ink">{t("seedMetricsTitle")}</h3>
            <span className="font-mono text-xs uppercase tracking-wide text-ink-40">{expand.data.seed}</span>
          </header>
          {seedHasMetrics && seedRow ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricCard label={t("colVolume")} value={fmtVolume(seedRow.searchVolume)} />
              <MetricCard label={t("colDifficulty")} value={fmtDifficulty(seedRow.difficulty)} hint={t("kdHint")} hintStyle="plain" />
              <MetricCard label={t("colCpc")} value={fmtCpc(seedRow.cpc, seedRow.currency)} />
              <MetricCard label={t("colCompetition")} value={fmtCompetition(seedRow.competition)} hint={t("competitionHint")} hintStyle="plain" />
              <div className="col-span-2 sm:col-span-1">
                <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("colTrend")}</div>
                <div className="mt-1 flex h-10 items-center">
                  {seedRow.trend && seedRow.trend.length > 1 ? (
                    <TrendSparkline points={seedRow.trend} ariaLabel={t("trendAria")} />
                  ) : (
                    <span className="text-sm text-ink-40">—</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 font-sans text-xs text-ink-40">{t("seedMetricsUnavailable")}</p>
          )}
          {/* Semrush 对标指标缺口：逐项诚实披露（有无真实数据/能否推导/需要什么证据），默认收起、永远可核对 */}
          <details className="mt-4 border-t border-line-soft pt-3">
            <summary className="cursor-pointer select-none font-sans text-xs font-medium text-ink-60 transition-colors hover:text-ink">
              {t("metricsGapTitle")}
            </summary>
            <p className="mt-2 font-sans text-xs text-ink-40">{t("metricsGapSummary")}</p>
            <ul className="mt-2 space-y-1.5">
              {[
                { tag: t("metricsGapMissingTag"), tone: "neg" as const, text: t("metricsGapVolume") },
                { tag: t("metricsGapMissingTag"), tone: "neg" as const, text: t("metricsGapVolumeByCountry") },
                { tag: t("metricsGapPartialTag"), tone: "info" as const, text: t("metricsGapKd") },
                { tag: t("metricsGapMissingTag"), tone: "neg" as const, text: t("metricsGapCpc") },
                { tag: t("metricsGapMissingTag"), tone: "neg" as const, text: t("metricsGapCompetition") },
              ].map((item) => (
                <li key={item.text} className="flex items-start gap-2">
                  <StatusBadge label={item.tag} tone={item.tone} dot={false} />
                  <span className="font-sans text-xs text-ink-60">{item.text}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* P4-B：种子词 SERP 快照 + SeeO SERP Competition Signal（与扩词同一次调用，零额外成本）。
          意图为文本规则估算；totalResults 是 Google 自报估计值；广告为快照真实计数；
          竞争信号只基于本次第一页证据，绝不标注为 Google KD/搜索量。 */}
      {hasResult && expand.data?.seed && expand.data.serpSnapshot && (() => {
        const snapshot = expand.data.serpSnapshot;
        const signal = computeSerpCompetitionSignal(
          { organic: snapshot.organic, features: snapshot.features },
          expand.data.seed
        );
        const seedIntent = detectIntent(expand.data.seed);
        return (
          <section id="kw-signal" className="card-a mt-4 scroll-mt-4 p-5">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-ink">{t("seedSerpTitle")}</h3>
              <span className="font-mono text-xs uppercase tracking-wide text-ink-40">
                {snapshot.fromCache ? `${t("serpSourceTag")} · ${t("cachedTag")}` : t("serpSourceTag")}
              </span>
            </header>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricCard
                label={t("seedIntentLabel")}
                value={seedIntent !== "未知" ? intentText(t, seedIntent) : null}
                hint={t("intentNote")}
                hintStyle="plain"
                unavailableLabel={t("intentUnknown")}
                unavailableReason={t("intentUnknownReason")}
              />
              <MetricCard
                label={t("cardFirstPage")}
                value={formatNumber(snapshot.organic.length, locale)}
                hint={t("cardFirstPageHint")}
                hintStyle="plain"
              />
              <MetricCard
                label={t("cardTotalResults")}
                value={snapshot.totalResults !== null ? formatNumber(snapshot.totalResults, locale) : null}
                hint={t("cardTotalResultsHint")}
                hintStyle="plain"
                unavailableLabel="—"
              />
              <MetricCard
                label={t("cardAds")}
                value={snapshot.adsCount !== null ? formatNumber(snapshot.adsCount, locale) : null}
                hint={snapshot.adsCount === 0 ? t("cardAdsZeroHint") : t("cardAdsHint")}
                hintStyle="plain"
                unavailableLabel="—"
                unavailableReason={t("cardAdsUnavailable")}
              />
              <MetricCard
                label={t("signalLabel")}
                value={signal ? `${formatNumber(signal.score, locale)}/100` : null}
                hint={t("signalShortHint")}
                hintStyle="plain"
                unavailableLabel="—"
                unavailableReason={t("signalUnavailable")}
              />
            </div>
            {signal ? (
              <div className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">
                <p>
                  {t("signalBasis", {
                    sample: formatNumber(signal.sampleSize, locale),
                    domains: formatNumber(signal.inputs.distinctDomains, locale),
                    count: formatNumber(signal.inputs.organicCount, locale),
                    features: formatNumber(signal.inputs.featureCount, locale),
                    titleHits: formatNumber(signal.inputs.titleMatchCount, locale),
                  })}
                </p>
                <p className="mt-1">{t("signalFormula")}</p>
                <p className="mt-1">{t("signalLimit")}</p>
              </div>
            ) : (
              <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("signalUnavailable")}</p>
            )}
          </section>
        );
      })()}

      {/* 指标卡 */}
      {hasResult && metrics && (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            isEmpty={keywordRows.length === 0}
            emptyTitle={t("noRelated")}
            emptyHint={t("emptyHint")}
            showEmptyIcon={false}
            chartHeight={keywordRows.length === 0 ? undefined : 220}
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
                  onClick={() => {
                    setIntentFilter(intentFilter === k ? "all" : k);
                    setVisibleCount(PAGE_SIZE);
                  }}
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
            subtitle={t("countItems", { count: formatNumber((expand.data?.paa.length ?? 0) + paaExpanded.length, locale) })}
            isEmpty={!expand.loading && (expand.data?.paa.length ?? 0) === 0}
            emptyTitle={t("noPaa")}
            emptyHint={t("emptyHint")}
            showEmptyIcon={false}
          >
            {expand.loading ? (
              <ExpandSkeletonRows />
            ) : (
              <div>
                <div className="flex max-h-[16rem] flex-wrap content-start gap-2 overflow-y-auto">
                  {(expand.data?.paa ?? []).map((q) => (
                    <ExpandTag key={q} query={q} tracked={!!trackingIds[q]} onTrack={() => handleTrackFromExpand(q)} />
                  ))}
                  {paaExpanded.map((item, i) => (
                    <ExpandTag
                      key={`paa-deep-${i}`}
                      query={item.question}
                      tracked={!!trackingIds[item.question]}
                      onTrack={() => handleTrackFromExpand(item.question)}
                    />
                  ))}
                </div>
                {/* PAA 深度展开（P7）：只对 provider 真实返回 next_page_token 的问题提供入口；
                    无 token 时如实说明无法继续，绝不发起猜测性请求 */}
                {paaTokenByQuestion.size > 0 ? (
                  <div className="mt-3 border-t border-line-soft pt-2">
                    <p className="font-sans text-xs text-ink-40">{t("paaDeepNote")}</p>
                    <ul className="mt-2 space-y-1.5">
                      {(expand.data?.paa ?? [])
                        .filter((q) => paaTokenByQuestion.has(normalizeKeywordForDedup(q)))
                        .map((q) => {
                          const st = paaDeep[normalizeKeywordForDedup(q)];
                          return (
                            <li key={q} className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleExpandPaa(q)}
                                disabled={st?.phase === "loading"}
                                className="rounded-md border border-line bg-card px-2 py-1 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink disabled:opacity-60"
                              >
                                {st?.phase === "loading" ? t("paaDeepLoading") : t("paaDeepButton")}
                              </button>
                              <span className="min-w-0 flex-1 truncate font-sans text-xs text-ink-60" title={q}>{q}</span>
                              {st?.phase === "done" && (
                                <span className="font-mono text-xs text-ink-40">
                                  {t("paaDeepDone", {
                                    fetched: formatNumber(st.fetched, locale),
                                    added: formatNumber(st.added, locale),
                                  })}
                                  {st.fromCache ? ` ${t("paaDeepCacheHit")}` : ""}
                                </span>
                              )}
                              {st?.phase === "empty" && (
                                <span className="font-mono text-xs text-ink-40">{t("paaDeepEmpty")}</span>
                              )}
                              {st?.phase === "error" && (
                                <span className="font-mono text-xs text-neg">{t("paaDeepError")} {st.message}</span>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-3 font-sans text-xs text-ink-40">{t("paaDeepUnavailable")}</p>
                )}
              </div>
            )}
          </ChartFrame>
        </div>
      )}

      {/* P4-C：Google Trends（趋势与相关需求维度）。
          四个 data_type 全部由用户主动点击触发，绝不随分析自动调用；
          相对指数不是月搜索量；相关查询并入上方发现表（来源 trends_queries）。 */}
      {hasResult && expand.data?.seed && resultView === "research" && (
        <section id="kw-trends" className="card-a mt-4 scroll-mt-4 p-5" aria-label={t("trendsTitle")}>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-lg font-semibold text-ink">{t("trendsTitle")}</h3>
              <p className="mt-0.5 font-sans text-xs text-ink-40">{t("trendsSubtitle")}</p>
            </div>
          </header>
          <TrendsPanel
            key={`${expand.data.seed}-${location}`}
            seed={expand.data.seed}
            location={location}
            onQueriesLoaded={handleTrendsQueriesLoaded}
          />
          <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("trendsScaleNote")}</p>
        </section>
      )}

      {/* 关键词发现列表（可筛选 + 可排序 + 分页加载 + CSV 导出 + 追踪 + SERP/内容入口；
          hasResult 即渲染——0 行时也提供「获取更多 Google 建议」入口） */}
      {(expand.loading || hasResult) && (
        <section id="kw-discovery" className="card-a mt-4 scroll-mt-4 p-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-lg font-semibold text-ink">{t("relatedKeywordsTitle")}</h3>
              <p className="mt-0.5 font-sans text-xs text-ink-40">{t("relatedKeywordsSource")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* 研究结果 ↔ GSC 匹配视图切换（两视图数据口径不同：通用发现 vs 第一方 GSC） */}
              <div
                className="flex rounded-md border border-line"
                role="group"
                aria-label={t("matchViewToggleLabel")}
              >
                <button
                  type="button"
                  aria-pressed={resultView === "research"}
                  onClick={() => setResultView("research")}
                  className={`rounded-l-md px-3 py-1.5 font-mono text-xs transition-colors ${
                    resultView === "research" ? "bg-ink text-card" : "bg-card text-ink-60 hover:text-ink"
                  }`}
                >
                  {t("viewToggleResearch")}
                </button>
                <button
                  type="button"
                  aria-pressed={resultView === "gsc-match"}
                  onClick={() => setResultView("gsc-match")}
                  className={`rounded-r-md border-l border-line px-3 py-1.5 font-mono text-xs transition-colors ${
                    resultView === "gsc-match" ? "bg-ink text-card" : "bg-card text-ink-60 hover:text-ink"
                  }`}
                >
                  {t("viewToggleGscMatch")}
                  {gscState.phase === "ready" && gscState.data.rows.length > 0
                    ? ` (${formatNumber(matchByKeyword.size, locale)})`
                    : ""}
                </button>
              </div>
              {resultView === "research" && (
              <>
              {/* Google 自动补全：用户主动触发（独立引擎调用，配额+缓存受控），失败不影响已有结果 */}
              <button
                type="button"
                onClick={handleFetchSuggestions}
                disabled={suggest.phase === "loading"}
                className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink hover:border-ink-25 disabled:opacity-60"
                title={t("suggestButtonTitle")}
              >
                {suggest.phase === "loading" ? t("suggestLoading") : t("suggestButton")}
              </button>
              <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40">
                {t("filterSource")}
                <select
                  value={sourceFilter}
                  onChange={(e) => {
                    setSourceFilter(e.target.value as "all" | KeywordOriginKey);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
                >
                  <option value="all">{t("sourceAll")}</option>
                  {TABLE_ORIGINS.map((origin) => (
                    <option key={origin} value={origin}>
                      {t(`source_${origin}`)} ({sourceCounts[origin] ?? 0})
                    </option>
                  ))}
                </select>
              </label>
              {/* 主题分组筛选：SeeO 规则型分组（真实结果高频核心词），与其他筛选 AND 组合 */}
              <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40" title={t("topicNote")}>
                {t("topicFilter")}
                <select
                  value={topicFilter}
                  onChange={(e) => {
                    setTopicFilter(e.target.value);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
                >
                  <option value="all">{t("topicAll")}</option>
                  {clusters.map((cluster) => (
                    <option key={cluster.id} value={cluster.id}>
                      {cluster.id === CLUSTER_OTHER_ID ? t("topicOther") : cluster.label} ({cluster.keywords.length})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40">
                {t("filterIntent")}
                <select
                  value={intentFilter}
                  onChange={(e) => {
                    setIntentFilter(e.target.value as "all" | IntentKey);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
                >
                  <option value="all">{t("metricTotal")}</option>
                  {INTENTS.map((k) => (
                    <option key={k} value={k}>{intentText(t, k)}</option>
                  ))}
                </select>
              </label>
              {/* 问题词视图：PAA 真实问题 + 规则识别的疑问词（非 Google 官方问题分类） */}
              <button
                type="button"
                onClick={() => {
                  setQuestionOnly(!questionOnly);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={`rounded-md border px-2 py-1.5 font-mono text-xs transition-colors ${
                  questionOnly ? "border-ink-25 text-ink" : "border-line text-ink-60 hover:border-ink-25"
                }`}
                title={t("questionOnlyRule")}
              >
                {t("questionOnly")} ({questionCount})
              </button>
              <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40">
                {t("sortLabel")}
                <select
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value as "alpha" | "length" | "volume" | "kd");
                    setVisibleCount(PAGE_SIZE);
                  }}
                  title={!hasVolumeData || !hasKdData ? t("sortUnavailableHint") : undefined}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
                >
                  <option value="volume" disabled={!hasVolumeData}>
                    {t("sortVolume")}
                    {hasVolumeData ? "" : t("sortUnavailableSuffix")}
                  </option>
                  <option value="kd" disabled={!hasKdData}>
                    {t("sortKd")}
                    {hasKdData ? "" : t("sortUnavailableSuffix")}
                  </option>
                  <option value="alpha">{t("sortAlpha")}</option>
                  <option value="length">{t("sortLength")}</option>
                </select>
              </label>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={sortedRows.length === 0}
                className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink hover:border-ink-25 disabled:opacity-60"
                title={t("exportCsvTitle")}
              >
                {t("exportCsv")}
              </button>
              </>
              )}
              {resultView === "gsc-match" && (
                <>
                  {/* 匹配范围筛选：只看已匹配（默认） / 含未匹配（未匹配 GSC 字段如实留空） */}
                  <div className="flex rounded-md border border-line" role="group" aria-label={t("matchFilterLabel")}>
                    <button
                      type="button"
                      aria-pressed={matchFilter === "matched"}
                      onClick={() => {
                        setMatchFilter("matched");
                        setMatchVisibleCount(PAGE_SIZE);
                      }}
                      className={`rounded-l-md px-2 py-1.5 font-mono text-xs transition-colors ${
                        matchFilter === "matched" ? "bg-ink text-card" : "bg-card text-ink-60 hover:text-ink"
                      }`}
                    >
                      {t("matchFilterMatchedOnly")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={matchFilter === "all"}
                      onClick={() => {
                        setMatchFilter("all");
                        setMatchVisibleCount(PAGE_SIZE);
                      }}
                      className={`rounded-r-md border-l border-line px-2 py-1.5 font-mono text-xs transition-colors ${
                        matchFilter === "all" ? "bg-ink text-card" : "bg-card text-ink-60 hover:text-ink"
                      }`}
                    >
                      {t("matchFilterAll")}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportMatchCsv}
                    disabled={matchRows.length === 0}
                    className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink hover:border-ink-25 disabled:opacity-60"
                    title={t("exportCsvTitle")}
                  >
                    {t("exportCsv")}
                  </button>
                </>
              )}
            </div>
          </header>

          {/* P8-T4 批量整理条：仅在研究视图且已选择时出现；操作全部走本地 DB 接口 */}
          {resultView === "research" && selected.size > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-card px-3 py-2">
              <span className="font-sans text-xs font-medium text-ink">
                {t("batchSelected", { count: formatNumber(selected.size, locale) })}
              </span>
              <button
                type="button"
                onClick={selectAllFiltered}
                className="rounded-md border border-line px-2 py-1 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink"
              >
                {t("batchSelectAllFiltered", { count: formatNumber(filteredRows.length, locale) })}
              </button>
              <button
                type="button"
                onClick={clearSelected}
                className="rounded-md border border-line px-2 py-1 font-mono text-xs text-ink-60 transition-colors hover:border-ink-25 hover:text-ink"
              >
                {t("batchClear")}
              </button>
              <span className="h-4 w-px bg-line" aria-hidden="true" />
              <button
                type="button"
                onClick={handleBatchTrack}
                disabled={batchBusy}
                className="rounded-md border border-line bg-card px-2 py-1 font-mono text-xs text-ink transition-colors hover:border-ink-25 disabled:opacity-60"
              >
                {t("batchTrackBtn")}
              </button>
              <select
                value={groupChoice}
                onChange={(e) => setGroupChoice(e.target.value)}
                aria-label={t("batchGroupPick")}
                className="h-8 rounded-md border border-line bg-card px-2 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
              >
                <option value="">{t("batchGroupPick")}</option>
                {groupList.map((g) => (
                  <option key={g.id} value={String(g.id)}>{g.name}</option>
                ))}
                <option value="new">{t("batchGroupNew")}</option>
              </select>
              {groupChoice === "new" && (
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t("batchGroupNamePlaceholder")}
                  aria-label={t("batchGroupNamePlaceholder")}
                  maxLength={50}
                  className="h-8 w-40 rounded-md border border-line bg-card px-2 font-sans text-xs text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
                />
              )}
              <button
                type="button"
                onClick={handleBatchGroup}
                disabled={batchBusy || !groupChoice}
                className="rounded-md border border-line bg-card px-2 py-1 font-mono text-xs text-ink transition-colors hover:border-ink-25 disabled:opacity-60"
              >
                {t("batchGroupBtn")}
              </button>
            </div>
          )}

          {resultView === "research" ? (
          <>
          {/* 建议词获取状态（独立区块：成功/空/失败；失败时已有研究结果原样保留） */}
          {suggest.phase === "done" && (
            <p className="mt-3 font-sans text-xs text-ink-60">
              {t("suggestDone", {
                count: formatNumber(suggest.count, locale),
                added: formatNumber(suggest.added, locale),
              })}
              {suggest.fromCache ? ` · ${t("suggestFromCache")}` : ""}
            </p>
          )}
          {suggest.phase === "empty" && (
            <p className="mt-3 font-sans text-xs text-ink-40">
              {t("suggestEmpty")}
              {suggest.fromCache ? ` · ${t("suggestFromCache")}` : ""}
            </p>
          )}
          {suggest.phase === "error" && (
            <div className="mt-3 rounded-md border border-neg/25 bg-neg/5 px-3 py-2">
              <StatusBadge label={t("suggestFailed")} tone="neg" dot={false} />
              <span className="ml-2 font-sans text-xs text-neg">{suggest.message}</span>
              <p className="mt-1 font-sans text-xs text-ink-40">{t("suggestErrorHint")}</p>
            </div>
          )}

          {/* 多方向扩词：用户主动点击才发请求；面板随 seed 重新挂载重置 */}
          {hasResult && expand.data?.seed && (
            <DirectionExpansion
              key={expand.data.seed}
              seed={expand.data.seed}
              location={location}
              existingKeywords={keywordRows.map((r) => r.keyword)}
              onNewSuggestions={handleDirectionSuggestions}
            />
          )}

          <div className="mt-4">
            {expand.loading ? (
              <TableSkeletonRows rows={5} />
            ) : keywordRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center font-sans text-sm text-ink-40">
                {t("noRelatedKeywords")}
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center font-sans text-sm text-ink-40">
                {t("noIntentMatch")}
              </div>
            ) : (
              <>
                {/* 桌面端表格（指标列仅在存在真实指标时展示；无指标时隐藏整排「—」） */}
                <div className="hidden md:block">
                  <DataTable minWidthRem={hasAnyMetrics ? 70 : 42} ariaLabel={t("relatedKeywordsTitle")}>
                    <THead>
                      <Th width="2rem">
                        <input
                          type="checkbox"
                          aria-label={t("batchSelectAllFiltered", { count: formatNumber(filteredRows.length, locale) })}
                          checked={filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.keyword))}
                          onChange={(e) => (e.target.checked ? selectAllFiltered() : clearSelected())}
                        />
                      </Th>
                      <Th>{t("colKeyword")}</Th>
                      <Th width="7rem">{t("colSource")}</Th>
                      <Th width="7rem">{t("colIntent")}</Th>
                      {hasAnyMetrics && (
                        <>
                          <Th align="right" width="6rem">{t("colVolume")}</Th>
                          <Th align="right" width="6rem">{t("colDifficulty")}</Th>
                          <Th align="right" width="6rem">{t("colCpc")}</Th>
                          <Th align="right" width="6rem">{t("colCompetition")}</Th>
                          <Th width="6rem">{t("colTrend")}</Th>
                        </>
                      )}
                      <Th align="right" width="14rem">{t("colAction")}</Th>
                    </THead>
                    <TBody>
                      {visibleRows.map((r) => (
                        <TR key={r.keyword}>
                          <TD>
                            <input
                              type="checkbox"
                              aria-label={t("batchSelectRow", { keyword: r.keyword })}
                              checked={selected.has(r.keyword)}
                              onChange={() => toggleSelected(r.keyword)}
                            />
                          </TD>
                          <TD>
                            <span className="font-sans text-sm font-medium text-ink">{r.keyword}</span>
                          </TD>
                          <TD>
                            <span
                              className="font-mono text-xs text-ink-60"
                              title={r.origins.map((o) => t(`source_${o}`)).join(" + ")}
                            >
                              {t(`source_${r.origins[0]}`)}
                              {r.origins.length > 1 ? ` +${r.origins.length - 1}` : ""}
                            </span>
                          </TD>
                          <TD>
                            <StatusBadge
                              label={r.intentBadge}
                              tone="neutral"
                              dot={false}
                              color={INTENT_COLOR[r.displayIntent] ?? RK.neutralDeep}
                              title={r.intentIsProvider ? t("intentProviderTitle") : t("intentEstimateTitle")}
                            />
                          </TD>
                          {hasAnyMetrics && (
                            <>
                              <TD align="right" numeric>
                                <span className="text-sm text-ink-60">{fmtVolume(r.searchVolume)}</span>
                              </TD>
                              <TD align="right" numeric>
                                <span className="text-sm text-ink-60" title={t("kdHint")}>{fmtDifficulty(r.difficulty)}</span>
                              </TD>
                              <TD align="right" numeric>
                                <span className="text-sm text-ink-60">{fmtCpc(r.cpc, r.currency)}</span>
                              </TD>
                              <TD align="right" numeric>
                                <span
                                  className="text-sm text-ink-60"
                                  title={r.competitionLevel ?? t("competitionHint")}
                                >
                                  {fmtCompetition(r.competition)}
                                </span>
                              </TD>
                              <TD>
                                {r.trend && r.trend.length > 1 ? (
                                  <TrendSparkline points={r.trend} ariaLabel={t("trendAria")} />
                                ) : (
                                  <span className="text-sm text-ink-40">—</span>
                                )}
                              </TD>
                            </>
                          )}
                          <TD align="right">
                            <span className="flex items-center justify-end gap-3">
                              <a
                                href={`/app/keyword-overview?keyword=${encodeURIComponent(r.keyword)}`}
                                className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                title={t("researchTitle")}
                              >
                                {t("researchAction")}
                              </a>
                              <a
                                href={`/app/content?keyword=${encodeURIComponent(r.keyword)}`}
                                className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                title={t("contentTitle")}
                              >
                                {t("contentAction")}
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
                        <div className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            aria-label={t("batchSelectRow", { keyword: r.keyword })}
                            checked={selected.has(r.keyword)}
                            onChange={() => toggleSelected(r.keyword)}
                            className="mt-1 shrink-0"
                          />
                          <div className="min-w-0">
                            <span className="font-sans text-sm font-medium text-ink">{r.keyword}</span>
                            <span className="ml-2 font-mono text-xs text-ink-40">{t(`source_${r.origins[0]}`)}</span>
                          </div>
                        </div>
                        <StatusBadge
                          label={r.intentBadge}
                          tone="neutral"
                          dot={false}
                          color={INTENT_COLOR[r.displayIntent] ?? RK.neutralDeep}
                        />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-40">
                        <span>
                          {t("colWords")}: {r.length}
                        </span>
                        {hasAnyMetrics && (
                          <>
                            <span>
                              {t("colVolume")}: {fmtVolume(r.searchVolume)}
                            </span>
                            <span>
                              {t("colDifficulty")}: {fmtDifficulty(r.difficulty)}
                            </span>
                            <span>
                              {t("colCpc")}: {fmtCpc(r.cpc, r.currency)}
                            </span>
                            <span>
                              {t("colCompetition")}: {fmtCompetition(r.competition)}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <a
                          href={`/app/keyword-overview?keyword=${encodeURIComponent(r.keyword)}`}
                          className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                        >
                          {t("researchAction")}
                        </a>
                        <a
                          href={`/app/content?keyword=${encodeURIComponent(r.keyword)}`}
                          className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                        >
                          {t("contentAction")}
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

                {/* 加载更多（大数据量分页渲染，避免一次渲染数百行） */}
                {sortedRows.length > visibleRows.length && (
                  <div className="mt-4 flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                      className="rounded-md border border-line bg-card px-4 py-2 font-sans text-sm text-ink hover:border-ink-25"
                    >
                      {t("loadMore")}
                    </button>
                    <span className="font-mono text-xs text-ink-40">
                      {t("shownCount", { shown: visibleRows.length, total: sortedRows.length })}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 指标口径说明：三态不混为一谈——未配置 / 请求失败 / 正常返回（可能 0 结果）。
              无指标时明确「不是 0、是没有数据来源」，已取得的真实数据（相关搜索/PAA）照常展示。 */}
          <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">
            {discoveryAvailable || discoveryHasRows
              ? t("metricsSourceNote")
              : expand.data?.metrics?.discovery?.state === "error"
                ? t("metricsNoteError")
                : t("metricsNoteUnconfigured")}
          </p>
          <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("intentNote")}</p>
          {serpExtracted.length > 0 && (
            <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">
              {t("serpContentNote", { count: serpExtracted.length })}
            </p>
          )}
          </>
          ) : (
          <div className="mt-4">
            {/* GSC 数据域五态沿用：加载中/需登录/未连接/错误/空数据——不伪造任何字段 */}
            {(gscState.phase === "idle" || gscState.phase === "loading") && (
              <p className="font-sans text-sm text-ink-40">{t("gscLoading")}</p>
            )}

            {gscState.phase === "needs-login" && (
              <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                <p className="font-sans text-sm font-medium text-ink">{t("gscStateNeedsLogin")}</p>
                {gscState.message && <p className="mt-1 font-sans text-xs text-ink-40">{gscState.message}</p>}
                <p className="mt-2 font-sans text-xs text-ink-40">{t("gscStateNeedsLoginHint")}</p>
              </div>
            )}

            {gscState.phase === "not-connected" && (
              <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                <p className="font-sans text-sm font-medium text-ink">{t("gscStateNotConnected")}</p>
                <p className="mt-2 font-sans text-xs text-ink-40">{t("gscStateNotConnectedHint")}</p>
              </div>
            )}

            {gscState.phase === "error" && (
              <div className="rounded-lg border border-neg/25 bg-neg/5 px-4 py-3">
                <StatusBadge label={t("gscStateError")} tone="neg" dot={false} />
                {gscState.message && <p className="mt-1 font-sans text-xs text-neg">{gscState.message}</p>}
              </div>
            )}

            {gscState.phase === "ready" && gscState.data.rows.length === 0 && (
              <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                <p className="font-sans text-sm font-medium text-ink">{t("gscStateEmpty")}</p>
                <p className="mt-2 font-sans text-xs text-ink-40">
                  {t("gscStateEmptyHint", {
                    start: gscState.data.dateRange.start,
                    end: gscState.data.dateRange.end,
                  })}
                </p>
              </div>
            )}

            {gscState.phase === "ready" && gscState.data.rows.length > 0 && (
              <>
                <p className="font-sans text-xs text-ink-40">
                  {t("matchSummaryLine", {
                    start: gscState.data.dateRange.start,
                    end: gscState.data.dateRange.end,
                    matched: formatNumber(matchByKeyword.size, locale),
                    total: formatNumber(keywordRows.length, locale),
                  })}
                </p>
                <p className="mt-1 font-sans text-xs text-ink-40">{t("matchCoverageNote")}</p>
                <p className="mt-1 font-sans text-xs text-ink-40">{t("matchScopeNote")}</p>

                {/* 已有机会列表为只读懒加载（首次进入本视图取一次）；失败不阻塞匹配展示 */}
                {oppState.phase === "loading" && (
                  <p className="mt-1 font-sans text-xs text-ink-40">{t("matchOppLoading")}</p>
                )}
                {oppState.phase === "error" && (
                  <p className="mt-1 font-sans text-xs text-neg">{t("matchOppError")} {oppState.message}</p>
                )}

                <div className="mt-4">
                  {matchRows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                      <p className="font-sans text-sm font-medium text-ink">{t("matchNoMatches")}</p>
                      <p className="mt-2 font-sans text-xs text-ink-40">{t("matchNoMatchesHint")}</p>
                    </div>
                  ) : (
                    <>
                      {/* 桌面端表格：落地页保留全部 (关键词, 页面) 关系；CTR/位置为曝光加权口径 */}
                      <div className="hidden md:block">
                        <DataTable minWidthRem={72} ariaLabel={t("viewToggleGscMatch")}>
                          <THead>
                            <Th>{t("colKeyword")}</Th>
                            <Th width="8rem">{t("matchColStatus")}</Th>
                            <Th>{t("gscColPage")}</Th>
                            <Th align="right" width="5rem">{t("gscColClicks")}</Th>
                            <Th align="right" width="6rem">{t("gscColImpressions")}</Th>
                            <Th align="right" width="7rem">{t("gscColCtr")}</Th>
                            <Th align="right" width="6rem">{t("gscColPosition")}</Th>
                            <Th width="10rem">{t("matchColOpp")}</Th>
                            <Th align="right" width="14rem">{t("colAction")}</Th>
                          </THead>
                          <TBody>
                            {visibleMatchRows.map((r) => {
                              const m = r.match;
                              const opp = oppByKeyword.get(normalizeQueryForMatch(r.keyword));
                              const distinctPages = m
                                ? [...new Set(m.pages.map((p) => p.page).filter((p): p is string => Boolean(p)))]
                                : [];
                              // 多页面时不挑一个代表页：内容优化深链仅在唯一落地页时带 url
                              const contentUrl = distinctPages.length === 1 ? distinctPages[0] : null;
                              return (
                                <TR key={r.keyword}>
                                  <TD>
                                    <span className="font-sans text-sm font-medium text-ink">{r.keyword}</span>
                                  </TD>
                                  <TD>
                                    {m ? (
                                      <StatusBadge
                                        label={m.clicks > 0 ? t("matchStatusClicked") : t("matchStatusExposed")}
                                        tone={m.clicks > 0 ? "pos" : "neutral"}
                                        dot={false}
                                      />
                                    ) : (
                                      <span className="font-mono text-xs text-ink-40">{t("matchStatusUnmatched")}</span>
                                    )}
                                  </TD>
                                  <TD>
                                    {m && distinctPages.length > 0 ? (
                                      <span className="flex max-w-xs flex-col gap-0.5">
                                        {distinctPages.map((page) => (
                                          <a
                                            key={page}
                                            href={page}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                            title={page}
                                          >
                                            {page.length > 42 ? `${page.slice(0, 41)}…` : page}
                                          </a>
                                        ))}
                                      </span>
                                    ) : (
                                      <span className="text-sm text-ink-40" title={m ? t("gscPageUnavailable") : undefined}>—</span>
                                    )}
                                  </TD>
                                  <TD align="right" numeric>
                                    <span className="text-sm text-ink-60">{m ? formatNumber(m.clicks, locale) : "—"}</span>
                                  </TD>
                                  <TD align="right" numeric>
                                    <span className="text-sm text-ink-60">{m ? formatNumber(m.impressions, locale) : "—"}</span>
                                  </TD>
                                  <TD align="right" numeric>
                                    <span className="flex items-center justify-end gap-1.5">
                                      <span className="text-sm text-ink-60">{m && m.ctr !== null ? fmtCtrPct(m.ctr) : "—"}</span>
                                      {m && isSeeoLowCtrMatch(m) && (
                                        <StatusBadge
                                          label={t("matchSeeoLowCtr")}
                                          tone="neutral"
                                          dot={false}
                                          title={t("matchSeeoLowCtrRule")}
                                        />
                                      )}
                                    </span>
                                  </TD>
                                  <TD align="right" numeric>
                                    <span className="text-sm text-ink-60">{m && m.position !== null ? fmtPosition(m.position) : "—"}</span>
                                  </TD>
                                  <TD>
                                    {opp ? (
                                      <Link
                                        href="/app/opportunities"
                                        className="inline-block"
                                        title={t("matchOppDetailTitle", { type: opp.type, status: opp.status })}
                                      >
                                        <StatusBadge
                                          label={t("matchOppBadge", { type: opp.type, status: opp.status })}
                                          tone="neutral"
                                          dot={false}
                                        />
                                      </Link>
                                    ) : (
                                      <span className="text-sm text-ink-40" title={t("matchOppNoneHint")}>—</span>
                                    )}
                                  </TD>
                                  <TD align="right">
                                    <span className="flex items-center justify-end gap-3">
                                      <a
                                        href={`/app/content?keyword=${encodeURIComponent(r.keyword)}${contentUrl ? `&url=${encodeURIComponent(contentUrl)}` : ""}`}
                                        className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                        title={t("contentTitle")}
                                      >
                                        {t("contentAction")}
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
                                      <Link
                                        href="/app/opportunities"
                                        className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                        title={t("matchOppActionTitle")}
                                      >
                                        {t("matchOppAction")}
                                      </Link>
                                    </span>
                                  </TD>
                                </TR>
                              );
                            })}
                          </TBody>
                        </DataTable>
                      </div>

                      {/* 移动端卡片 */}
                      <div className="md:hidden">
                        {visibleMatchRows.map((r) => {
                          const m = r.match;
                          const opp = oppByKeyword.get(normalizeQueryForMatch(r.keyword));
                          const distinctPages = m
                            ? [...new Set(m.pages.map((p) => p.page).filter((p): p is string => Boolean(p)))]
                            : [];
                          const contentUrl = distinctPages.length === 1 ? distinctPages[0] : null;
                          return (
                            <div key={r.keyword} className="border-b border-line-soft py-3 last:border-b-0">
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-sans text-sm font-medium text-ink">{r.keyword}</span>
                                {m ? (
                                  <StatusBadge
                                    label={m.clicks > 0 ? t("matchStatusClicked") : t("matchStatusExposed")}
                                    tone={m.clicks > 0 ? "pos" : "neutral"}
                                    dot={false}
                                  />
                                ) : (
                                  <span className="font-mono text-xs text-ink-40">{t("matchStatusUnmatched")}</span>
                                )}
                              </div>
                              {m && distinctPages.length > 0 && (
                                <div className="mt-1 flex flex-col gap-0.5">
                                  {distinctPages.map((page) => (
                                    <a
                                      key={page}
                                      href={page}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="break-all font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                    >
                                      {page}
                                    </a>
                                  ))}
                                </div>
                              )}
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-40">
                                <span>{t("gscColClicks")}: {m ? formatNumber(m.clicks, locale) : "—"}</span>
                                <span>{t("gscColImpressions")}: {m ? formatNumber(m.impressions, locale) : "—"}</span>
                                <span>{t("gscColCtr")}: {m && m.ctr !== null ? fmtCtrPct(m.ctr) : "—"}</span>
                                <span>{t("gscColPosition")}: {m && m.position !== null ? fmtPosition(m.position) : "—"}</span>
                                {m && isSeeoLowCtrMatch(m) && (
                                  <StatusBadge label={t("matchSeeoLowCtr")} tone="neutral" dot={false} title={t("matchSeeoLowCtrRule")} />
                                )}
                              </div>
                              {opp && (
                                <div className="mt-1">
                                  <StatusBadge
                                    label={t("matchOppBadge", { type: opp.type, status: opp.status })}
                                    tone="neutral"
                                    dot={false}
                                    title={t("matchOppDetailTitle", { type: opp.type, status: opp.status })}
                                  />
                                </div>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-3">
                                <a
                                  href={`/app/content?keyword=${encodeURIComponent(r.keyword)}${contentUrl ? `&url=${encodeURIComponent(contentUrl)}` : ""}`}
                                  className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                >
                                  {t("contentAction")}
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
                                <Link href="/app/opportunities" className="font-mono text-xs text-ink-60 hover:text-ink hover:underline">
                                  {t("matchOppAction")}
                                </Link>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* 分页加载（与研究结果视图同一 PAGE_SIZE 策略） */}
                      {matchRows.length > visibleMatchRows.length && (
                        <div className="mt-4 flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setMatchVisibleCount((count) => count + PAGE_SIZE)}
                            className="rounded-md border border-line bg-card px-4 py-2 font-sans text-sm text-ink hover:border-ink-25"
                          >
                            {t("loadMore")}
                          </button>
                          <span className="font-mono text-xs text-ink-40">
                            {t("shownCount", { shown: visibleMatchRows.length, total: matchRows.length })}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("matchRuleNote")}</p>
                <p className="mt-3 font-sans text-xs text-ink-40">{t("gscSourceNote")}</p>
              </>
            )}
          </div>
          )}
        </section>
      )}

      {/* P4-D：SERP 分析区（第一页快照 + 用户主动触发的分页加载；口径标注见组件内文案） */}
      {hasResult && expand.data?.seed && expand.data.serpSnapshot && (
        <div id="kw-serp" className="scroll-mt-4">
          <SerpSection
            key={`${expand.data.seed}-${location}-${device}-${expand.data.serpSnapshot.fetchedAt}`}
            seed={expand.data.seed}
            location={location}
            device={device}
            snapshot={expand.data.serpSnapshot}
          />
        </div>
      )}

      {/* P4-E：竞争与机会区（现有能力的入口集合；本页不复制竞品/机会/追踪逻辑） */}
      <section className="card-a mt-4 p-5" aria-label={t("nextStepsTitle")}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-ink">{t("nextStepsTitle")}</h3>
            <p className="mt-0.5 font-sans text-xs text-ink-40">{t("nextStepsSub")}</p>
          </div>
        </header>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <Link
            href="/app/competitors"
            className="rounded-lg border border-line bg-card p-4 transition-colors hover:border-ink-25"
          >
            <span className="font-sans text-sm font-medium text-ink">{t("entryCompetitors")}</span>
            <p className="mt-1 font-sans text-xs text-ink-40">{t("entryCompetitorsHint")}</p>
          </Link>
          <Link
            href="/app/opportunities"
            className="rounded-lg border border-line bg-card p-4 transition-colors hover:border-ink-25"
          >
            <span className="font-sans text-sm font-medium text-ink">{t("entryOpportunities")}</span>
            <p className="mt-1 font-sans text-xs text-ink-40">{t("entryOpportunitiesHint")}</p>
          </Link>
          <Link
            href="/app/position-tracking"
            className="rounded-lg border border-line bg-card p-4 transition-colors hover:border-ink-25"
          >
            <span className="font-sans text-sm font-medium text-ink">{t("entryTracking")}</span>
            <p className="mt-1 font-sans text-xs text-ink-40">{t("entryTrackingHint")}</p>
          </Link>
        </div>
        <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("nextStepsNote")}</p>
      </section>

      {/* 你的网站搜索机会（GSC · 独立数据域，与通用关键词发现明确分开） */}
      <section id="kw-gsc" className="card-a mt-4 scroll-mt-4 p-5" aria-label={t("gscTitle")}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-ink">{t("gscTitle")}</h3>
            <p className="mt-0.5 font-sans text-xs text-ink-40">{t("gscSubtitle")}</p>
          </div>
          {gscState.phase === "ready" && (
            <StatusBadge
              label={t("gscConnectedTag", { property: gscState.data.propertyUrl })}
              tone="pos"
              dot={false}
            />
          )}
        </header>

        {!activeId ? (
          <p className="mt-4 font-sans text-sm text-ink-40">{t("gscNoProject")}</p>
        ) : (
          <>
          {gscState.phase === "loading" && (
            <p className="mt-4 font-sans text-sm text-ink-40">{t("gscLoading")}</p>
          )}

          {/* 五种状态分别渲染：需登录 / 未连接 / 错误 / 空数据 / 正常（含部分字段缺失） */}
          {gscState.phase === "needs-login" && (
            <div className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-center">
              <p className="font-sans text-sm font-medium text-ink">{t("gscStateNeedsLogin")}</p>
              {gscState.message && <p className="mt-1 font-sans text-xs text-ink-40">{gscState.message}</p>}
              <p className="mt-2 font-sans text-xs text-ink-40">{t("gscStateNeedsLoginHint")}</p>
            </div>
          )}

          {gscState.phase === "not-connected" && (
            <div className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-center">
              <p className="font-sans text-sm font-medium text-ink">{t("gscStateNotConnected")}</p>
              <p className="mt-2 font-sans text-xs text-ink-40">{t("gscStateNotConnectedHint")}</p>
            </div>
          )}

          {gscState.phase === "error" && (
            <div className="mt-4 rounded-lg border border-neg/25 bg-neg/5 px-4 py-3">
              <StatusBadge label={t("gscStateError")} tone="neg" dot={false} />
              {gscState.message && <p className="mt-1 font-sans text-xs text-neg">{gscState.message}</p>}
            </div>
          )}

          {gscState.phase === "ready" && gscState.data.rows.length === 0 && (
            <div className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-center">
              <p className="font-sans text-sm font-medium text-ink">{t("gscStateEmpty")}</p>
              <p className="mt-2 font-sans text-xs text-ink-40">
                {t("gscStateEmptyHint", {
                  start: gscState.data.dateRange.start,
                  end: gscState.data.dateRange.end,
                })}
              </p>
            </div>
          )}

          {gscState.phase === "ready" && gscState.data.rows.length > 0 && (
            <>
              <p className="mt-3 font-sans text-xs text-ink-40">
                {t("gscSummary", {
                  start: gscState.data.dateRange.start,
                  end: gscState.data.dateRange.end,
                  clicks: formatNumber(gscState.data.summary.clicks, locale),
                  impressions: formatNumber(gscState.data.summary.impressions, locale),
                })}
                {gscState.data.fromCache ? ` · ${t("gscFromCache")}` : ""}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40">
                  {t("gscSortLabel")}
                  <select
                    value={gscSort}
                    onChange={(e) => setGscSort(e.target.value as GscSortMode)}
                    className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
                  >
                    <option value="impressions">{t("gscSortImpressions")}</option>
                    <option value="ctr">{t("gscSortCtr")}</option>
                    <option value="position">{t("gscSortPosition")}</option>
                    <option value="clicks">{t("gscSortClicks")}</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40">
                  {t("gscPositionFilter")}
                  <select
                    value={gscPositionFilter}
                    onChange={(e) => setGscPositionFilter(e.target.value as GscPositionFilter)}
                    className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
                  >
                    <option value="all">{t("gscPositionAll")}</option>
                    <option value="top5">{t("gscPositionTop5")}</option>
                    <option value="top10">{t("gscPositionTop10")}</option>
                    <option value="p11_20">{t("gscPositionP11_20")}</option>
                    <option value="p21_50">{t("gscPositionP21_50")}</option>
                  </select>
                </label>
                {/* 快捷筛选是 SeeO 的机会判断规则（见 gscQuickRuleNote），不是 Google 官方标准 */}
                <button
                  type="button"
                  onClick={() => setGscQuickFilter(gscQuickFilter === "low_ctr" ? "none" : "low_ctr")}
                  className={`rounded-md border px-2 py-1.5 font-mono text-xs transition-colors ${
                    gscQuickFilter === "low_ctr" ? "border-ink-25 text-ink" : "border-line text-ink-60 hover:border-ink-25"
                  }`}
                  title={t("gscQuickLowCtrRule")}
                >
                  {t("gscQuickLowCtr")}
                </button>
                <button
                  type="button"
                  onClick={() => setGscQuickFilter(gscQuickFilter === "page2" ? "none" : "page2")}
                  className={`rounded-md border px-2 py-1.5 font-mono text-xs transition-colors ${
                    gscQuickFilter === "page2" ? "border-ink-25 text-ink" : "border-line text-ink-60 hover:border-ink-25"
                  }`}
                  title={t("gscQuickPage2Rule")}
                >
                  {t("gscQuickPage2")}
                </button>
                <button
                  type="button"
                  onClick={handleExportGscCsv}
                  disabled={gscSortedRows.length === 0}
                  className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink hover:border-ink-25 disabled:opacity-60"
                  title={t("exportCsvTitle")}
                >
                  {t("exportCsv")}
                </button>
              </div>

              <div className="mt-4">
                {gscSortedRows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center font-sans text-sm text-ink-40">
                    {t("gscNoFilteredRows")}
                  </div>
                ) : (
                  <DataTable minWidthRem={56} ariaLabel={t("gscTitle")}>
                    <THead>
                      <Th>{t("gscColQuery")}</Th>
                      <Th>{t("gscColPage")}</Th>
                      <Th align="right" width="5rem">{t("gscColClicks")}</Th>
                      <Th align="right" width="6rem">{t("gscColImpressions")}</Th>
                      <Th align="right" width="6rem">{t("gscColCtr")}</Th>
                      <Th align="right" width="6rem">{t("gscColPosition")}</Th>
                      <Th align="right" width="12rem">{t("colAction")}</Th>
                    </THead>
                    <TBody>
                      {gscSortedRows.map((r) => (
                        <TR key={`${r.query}|${r.page ?? ""}`}>
                          <TD>
                            <span className="font-sans text-sm font-medium text-ink">{r.query || "—"}</span>
                          </TD>
                          <TD>
                            {r.page ? (
                              <a
                                href={r.page}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                title={r.page}
                              >
                                {r.page.length > 42 ? `${r.page.slice(0, 41)}…` : r.page}
                              </a>
                            ) : (
                              <span className="text-sm text-ink-40" title={t("gscPageUnavailable")}>—</span>
                            )}
                          </TD>
                          <TD align="right" numeric>
                            <span className="text-sm text-ink-60">{formatNumber(r.clicks, locale)}</span>
                          </TD>
                          <TD align="right" numeric>
                            <span className="text-sm text-ink-60">{formatNumber(r.impressions, locale)}</span>
                          </TD>
                          <TD align="right" numeric>
                            <span className="text-sm text-ink-60">{fmtCtrPct(r.ctr)}</span>
                          </TD>
                          <TD align="right" numeric>
                            <span className="text-sm text-ink-60">{fmtPosition(r.position)}</span>
                          </TD>
                          <TD align="right">
                            <span className="flex items-center justify-end gap-3">
                              <a
                                href={`/app/content?keyword=${encodeURIComponent(r.query)}${r.page ? `&url=${encodeURIComponent(r.page)}` : ""}`}
                                className="font-mono text-xs text-ink-60 hover:text-ink hover:underline"
                                title={t("gscContentTitle")}
                              >
                                {t("contentAction")}
                              </a>
                              <button
                                onClick={() => handleTrackFromExpand(r.query)}
                                disabled={!!trackingIds[r.query]}
                                className={`font-mono text-xs font-semibold ${
                                  trackingIds[r.query] ? "text-pos" : "text-brand hover:underline"
                                }`}
                                title={trackingIds[r.query] ? t("trackedTitle") : t("trackTitle")}
                              >
                                {trackingIds[r.query] ? `✓ ${t("trackedTitle")}` : t("trackAction")}
                              </button>
                            </span>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </DataTable>
                )}
              </div>

              <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("gscSourceNote")}</p>
              <p className="mt-3 font-sans text-xs text-ink-40">{t("gscQuickRuleNote")}</p>
            </>
          )}
          </>
          )}
        </section>

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

/**
 * 月度搜索量迷你趋势（DataForSEO 真实 monthly_searches，最近 12 个月）。
 * 只画真实数据点，不做外推；单点或缺失由调用方显示「—」。
 */
function TrendSparkline({
  points,
  ariaLabel,
}: {
  points: { year: number; month: number; searchVolume: number }[];
  ariaLabel: string;
}) {
  const sorted = [...points]
    .filter((p) => typeof p.searchVolume === "number")
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .slice(-12);
  const max = Math.max(...sorted.map((p) => p.searchVolume), 1);
  const W = 72;
  const H = 20;
  const PAD = 2;
  const step = sorted.length > 1 ? (W - PAD * 2) / (sorted.length - 1) : 0;
  const path = sorted
    .map((p, i) => {
      const x = PAD + i * step;
      const y = H - PAD - (p.searchVolume / max) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel} className="text-ink-40">
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
