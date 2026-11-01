"use client";

// ===== Keyword Overview（关键词概览 · Semrush 式关键词研究工作台）=====
//
// 两种完全不同的 UI 状态：
//   状态 A（未搜索）：Semrush 式搜索入口——大搜索框是页面视觉中心，市场/设备选择清晰。
//   状态 B（已搜索）：指标卡行 + 关键词创意（变体/问题/策略聚类）+ 趋势与地区需求 +
//                     GSC 实际表现 + SERP 分析（区间 tab / PAA 展开 / 竞争信号四项依据）。
//
// 诚实边界（与全站一致）：
//   - 搜索量/KD/CPC/竞争密度来自 DataForSEO 指标；未配置或无数据 → 「n/a」+ 原因，绝不用 0 冒充。
//   - SERP 竞争信号是 SeeO 自有信号（0-100），绝不标注为 Keyword Difficulty。
//   - Trends 指数是相对搜索热度（0-100），绝不冒充搜索量；GSC 展示量绝不冒充市场搜索量。
//   - 意图为文本规则估算，UI 标注「估算」。

import { useState, useMemo, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { triggerUpgradeModal } from "@/components/billing/UpgradeModal";
import { detectIntent, type KeywordIntent } from "@/lib/seo/keyword-intent";
import { isQuestionKeyword, clusterKeywords } from "@/lib/seo/keyword-cluster";
import { computeSerpCompetitionSignal } from "@/lib/seo/serp-signal";
import { normalizeSerpRow, type SerpLinkStatus } from "@/lib/seo/serp-normalize";
import { toSerpDevice } from "@/lib/seo/device-params";
import { buildKeywordCsv, buildKeywordCsvContext } from "@/lib/seo/keyword-csv";
import {
  buildGscQueryIndex,
  matchKeywordsToGsc,
  type GscMatchInputRow,
  type GscQueryMatch,
} from "@/lib/seo/gsc-match";
import type { KeywordOrigin } from "@/lib/seo/keyword-merge";
import { normalizeKeywordForDedup } from "@/lib/seo/keyword-merge";
import type { TrendsResult } from "@/lib/seo/serpapi";
import {
  RK,
  RK_GRID_PROPS,
  RK_LINK_CLASS,
  RK_TICK_STYLE,
  RK_TOOLTIP_ITEM_STYLE,
  RK_TOOLTIP_LABEL_STYLE,
  RK_TOOLTIP_STYLE,
  RK_YAXIS_PROPS,
} from "@/components/viz/rank-theme";
import OpportunityContextBanner from "@/components/dashboard/OpportunityContextBanner";
import { useActiveProjectOptional } from "@/components/dashboard/ActiveProjectContext";
import { formatNumber } from "@/lib/ui-locale";

import ChartFrame from "@/components/viz/ChartFrame";
import { StatusBadge } from "@/components/viz/StatusBadge";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";
import {
  KEYWORD_LOCATIONS,
  useMarketDisplay,
  KeywordSearchHero,
  IntentBadge,
  intentText,
  exportCsvRows,
} from "@/components/keywords/shared";
import type { SerpSnapshot } from "../keyword-expand/types";

interface UsageBadge {
  used: number;
  limit: number;
}

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
  marketFallback?: boolean;
  serpSnapshot?: SerpSnapshot | null;
  /** 服务端按真实套餐额度判定的市场指标可用性；缺省时不作任何套餐结论 */
  metricsAccess?: {
    included: boolean;
    plan: string;
    monthlyLimit: number;
    requiredPlan: string | null;
    /** 各套餐真实月度市场指标额度（服务端取自 billing.ts，UI 不得硬编码数字） */
    planQuota?: Record<string, number>;
  } | null;
  metrics?: {
    source: "dataforseo" | null;
    fromCache: boolean;
    discovery?: {
      source: "dataforseo" | null;
      fromCache: boolean;
      state: "unconfigured" | "error" | "ok";
    };
    keywords?: ExpandMetricsKeyword[];
  } | null;
}

/** 统一关键词行：来源与指标全部来自真实 API 返回，绝不伪造 */
interface UnifiedRow {
  keyword: string;
  origins: KeywordOriginKey[];
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  currency: string | null;
  providerIntent: string | null;
}

const PROVIDER_INTENT_MAP: Record<string, KeywordIntent> = {
  informational: "信息型",
  commercial: "商业型",
  transactional: "交易型",
  navigational: "导航型",
};

type TrendType = "TIMESERIES" | "GEO_MAP_0" | "RELATED_QUERIES" | "RELATED_TOPICS";
const TREND_TYPES: TrendType[] = ["TIMESERIES", "GEO_MAP_0", "RELATED_QUERIES", "RELATED_TOPICS"];

type TrendPhase = "idle" | "loading" | "done" | "error";
interface TrendsState {
  data: Partial<Record<TrendType, TrendsResult>>;
  phases: Record<TrendType, TrendPhase>;
}

interface PaaQuestion {
  question: string;
  snippet?: string;
  title?: string;
  nextPageToken?: string;
}

type GscPhase = "idle" | "checking" | "connected" | "notconnected" | "noprovider" | "error";

/** SERP 自然结果行：原始字段 + 规范化派生字段（resolvedUrl/resolvedDomain/linkStatus） */
interface SerpRow {
  position: number;
  title: string;
  link: string;
  domain: string;
  snippet: string;
  date?: string;
  displayedLink?: string;
  resolvedUrl?: string | null;
  resolvedDomain?: string | null;
  linkStatus?: SerpLinkStatus;
}

/** SERP 分析页容量上限：最多到第 90 位（9 页），控制真实供应商请求次数 */
const SERP_MAX_START = 80;
const SERP_PAGE_SIZE = 10;

// 深链入口：?keyword=xxx 自动执行；?research=<id> 打开已保存研究（零供应商请求恢复）
export default function KeywordOverviewPage() {
  return (
    <Suspense fallback={null}>
      <KeywordOverviewInner />
    </Suspense>
  );
}

function KeywordOverviewInner() {
  const t = useTranslations("dashboard.keywords.overview");
  const ts = useTranslations("dashboard.keywords.shared");
  const tc = useTranslations("dashboard.common");
  const tv = useTranslations("dashboard.viz");
  const locale = useLocale() as "en" | "zh";
  const zh = locale === "zh";
  const searchParams = useSearchParams();
  const display = useMarketDisplay();
  const { show, Toast } = useToast();
  const activeProject = useActiveProjectOptional();

  const [searchValue, setSearchValue] = useState("");
  const [location, setLocation] = useState("中国");
  const [device, setDevice] = useState<"PC" | "移动端">("PC");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expand, setExpand] = useState<ExpandData | null>(null);
  // O-1：失败时保留旧结果。expand 只在请求成功后才被替换；
  // expandRef 供 runAnalysis（useCallback）读取当前值，避免闭包陈旧。
  const expandRef = useRef<ExpandData | null>(null);
  useEffect(() => {
    expandRef.current = expand;
  }, [expand]);
  /** 正在查询的目标词（无旧结果时才用于整页 loading 文案） */
  const [pendingSeed, setPendingSeed] = useState<string | null>(null);
  /** 上一次失败的查询参数，供错误条上的「重试」按钮使用 */
  const [lastAttempt, setLastAttempt] = useState<{ kw: string; loc: string; dev: "PC" | "移动端" } | null>(null);
  const [usage, setUsage] = useState<UsageBadge | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "serp">("overview");

  // 自动补全建议（用户显式触发，1 次配额）
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestPhase, setSuggestPhase] = useState<"idle" | "loading" | "done" | "empty" | "error">("idle");
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  // PAA 深度展开
  const [paaExpanded, setPaaExpanded] = useState<{ parent: string; question: string }[]>([]);
  const [paaDeep, setPaaDeep] = useState<Record<string, { phase: "loading" | "done" | "empty" | "error"; fetched?: number; message?: string }>>({});

  // Trends（4 个 dataType 独立加载，各自缓存）
  const [trends, setTrends] = useState<TrendsState>({
    data: {},
    phases: { TIMESERIES: "idle", GEO_MAP_0: "idle", RELATED_QUERIES: "idle", RELATED_TOPICS: "idle" },
  });

  // SERP 分页（start=0 来自 expand 快照；>0 走 /api/seo/serp?start=）
  const [serpPages, setSerpPages] = useState<Record<number, SerpRow[]>>({});
  const [serpLoadingStart, setSerpLoadingStart] = useState<number | null>(null);
  const [serpRange, setSerpRange] = useState(0);
  // 分页失败态：保留旧数据、不切换区间，并给出可见错误 + 重试入口（DEF-02）
  const [serpError, setSerpError] = useState<{ start: number; message: string } | null>(null);

  // 指标更新（DEF-06）：只调用 /api/keywords/metrics，绝不把 expand 包装成指标更新
  const [metricsPhase, setMetricsPhase] = useState<"idle" | "loading">("idle");
  const [metricsNote, setMetricsNote] = useState<string | null>(null);

  // GSC 实际表现
  const [gscPhase, setGscPhase] = useState<GscPhase>("idle");
  const [gscRows, setGscRows] = useState<GscMatchInputRow[]>([]);

  // 保存研究
  const [savePhase, setSavePhase] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // 关键词创意「查看全部」展开
  const [viewAllIdeas, setViewAllIdeas] = useState<"variants" | "questions" | "clusters" | null>(null);

  // ===== 统一行构建（来源与指标全部来自真实返回）=====
  const rows = useMemo<UnifiedRow[]>(() => {
    if (!expand) return [];
    const map = new Map<string, UnifiedRow>();
    const add = (
      keyword: string,
      origin: KeywordOriginKey,
      m?: Partial<ExpandMetricsKeyword>
    ) => {
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
    // 服务端已合并的候选词（含 DataForSEO 指标，可能为 null）
    for (const k of expand.metrics?.keywords ?? []) {
      for (const o of k.origins.length > 0 ? k.origins : [k.origin]) {
        add(k.keyword, o, k);
      }
    }
    for (const r of expand.related) add(r, "related");
    for (const p of expand.paa) add(p, "paa");
    for (const s of suggestions) add(s, "autocomplete");
    for (const q of paaExpanded) add(q.question, "paa");
    return Array.from(map.values());
  }, [expand, suggestions, paaExpanded]);

  const seedMetrics = useMemo(() => {
    if (!expand) return null;
    const seedNorm = normalizeKeywordForDedup(expand.seed);
    return (
      (expand.metrics?.keywords ?? []).find(
        (k) => normalizeKeywordForDedup(k.keyword) === seedNorm
      ) ?? null
    );
  }, [expand]);
  const seedVolume = seedMetrics?.searchVolume ?? null;
  const seedKd = seedMetrics?.difficulty ?? null;
  const seedCpc = seedMetrics?.cpc ?? null;
  const seedCd = seedMetrics?.competition ?? null;

  const metricsState = expand?.metrics?.discovery?.state ?? "unconfigured";
  // 市场指标是否被当前套餐排除：只信服务端按真实套餐额度给出的判定（metricsAccess），不做前端猜测。
  // 缺失 metricsAccess（旧响应/缓存）时视为「未知」，不渲染任何套餐结论。
  const metricsNotInPlan = expand?.metricsAccess ? !expand.metricsAccess.included : false;
  const planName = (p: string | null | undefined): string => {
    if (!p) return "";
    if (p === "lite") return "Lite";
    if (p === "pro") return zh ? "专业版" : "Pro";
    if (p === "free") return zh ? "免费版" : "Free";
    return p;
  };
  const currentPlanName = planName(expand?.metricsAccess?.plan);
  const metricsRequiredPlan = expand?.metricsAccess?.requiredPlan ?? null;
  const seedIntent: KeywordIntent | null = expand ? detectIntent(expand.seed) : null;

  // 变体 / 问题 / 聚类
  const variants = useMemo(
    () =>
      rows.filter(
        (r) =>
          !r.origins.includes("paa") &&
          !isQuestionKeyword(r.keyword) &&
          r.origins.some((o) => o !== "seed")
      ),
    [rows]
  );
  const questions = useMemo(
    () => rows.filter((r) => r.origins.includes("paa") || isQuestionKeyword(r.keyword)),
    [rows]
  );
  const clusters = useMemo(
    () => clusterKeywords(rows.map((r) => r.keyword)).filter((c) => c.id !== "__other__"),
    [rows]
  );

  // SERP 竞争信号（SeeO 自有信号，非 KD）
  const competitionSignal = useMemo(() => {
    const snap = expand?.serpSnapshot;
    if (!snap || !expand) return null;
    return computeSerpCompetitionSignal(snap, expand.seed);
  }, [expand]);

  // ===== 分析主流程：单请求 expand（含 SERP 快照），成功后并行加载 4 类 Trends =====
  const loadTrend = useCallback(
    async (dataType: TrendType, seed: string, loc: string) => {
      setTrends((prev) => ({ ...prev, phases: { ...prev.phases, [dataType]: "loading" } }));
      try {
        const res = await fetch("/api/keywords/trends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed, location: loc, dataType }),
        });
        const json = await res.json();
        if (!res.ok) {
          setTrends((prev) => ({ ...prev, phases: { ...prev.phases, [dataType]: "error" } }));
          return;
        }
        setTrends((prev) => ({
          data: { ...prev.data, [dataType]: json.data },
          phases: { ...prev.phases, [dataType]: "done" },
        }));
      } catch {
        setTrends((prev) => ({ ...prev, phases: { ...prev.phases, [dataType]: "error" } }));
      }
    },
    []
  );

  const resetAux = () => {
    setSuggestions([]);
    setSuggestPhase("idle");
    setSuggestNote(null);
    setPaaExpanded([]);
    setPaaDeep({});
    setTrends({ data: {}, phases: { TIMESERIES: "idle", GEO_MAP_0: "idle", RELATED_QUERIES: "idle", RELATED_TOPICS: "idle" } });
    setSerpPages({});
    setSerpRange(0);
    setSerpLoadingStart(null);
    setSerpError(null);
    setMetricsPhase("idle");
    setMetricsNote(null);
    setSavePhase("idle");
    setSaveError(null);
    setViewAllIdeas(null);
    setRestoredAt(null);
    setGscPhase("idle");
    setGscRows([]);
  };

  const runAnalysis = useCallback(
    async (kw: string, loc: string, dev: "PC" | "移动端") => {
      if (!kw.trim()) {
        show(t("errKeyword"), "error");
        return;
      }
      // O-1：只有「没有任何旧结果」时才走清空路径；有旧结果则整段保留到新数据回来为止。
      const hadPrevious = expandRef.current !== null;
      setLastAttempt({ kw, loc, dev });
      setPendingSeed(kw);
      if (!hadPrevious) {
        // 全新研究：清掉上一次可能残留的辅助数据，保持正常空态/加载态
        resetAux();
      }
      setPhase("loading");
      setErrorMsg(null);
      try {
        const res = await fetch("/api/keywords/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed: kw, location: loc, device: dev }),
        });
        const json = await res.json();
        if (!res.ok) {
          // 失败不触碰 expand / 辅助数据：用户眼前的结果必须原样保留
          const { message } = handleBillingError(json, t("queryFailed"));
          setPhase("error");
          setErrorMsg(message);
          setPendingSeed(null);
          show(message, "error");
          return;
        }
        const data = json.data as ExpandData;
        // 成功才替换：先清旧结果的辅助数据，再落新数据（同批次渲染，不出现中间态）
        resetAux();
        setExpand(data);
        setPhase("done");
        setTab("overview");
        setPendingSeed(null);
        setErrorMsg(null);
        if (json.usage) setUsage({ used: json.usage.used, limit: json.usage.limit });
        show(data.fromCache ? t("cacheHit", { keyword: kw }) : t("loaded", { keyword: kw }), "success");
        // Trends：4 个数据类型并行加载（各自独立缓存，命中零消耗）
        for (const dataType of TREND_TYPES) {
          void loadTrend(dataType, data.seed, data.location);
        }
      } catch (err) {
        // 网络异常同样保留旧结果
        const msg = `${tc("networkError")} ${(err as Error).message}`;
        setPhase("error");
        setErrorMsg(msg);
        setPendingSeed(null);
        show(msg, "error");
      }
    },
    [loadTrend, show, t, tc]
  );

  const retryLastAnalysis = () => {
    if (!lastAttempt) return;
    void runAnalysis(lastAttempt.kw, lastAttempt.loc, lastAttempt.dev);
  };

  /** 用户主动清空搜索：回到未搜索空态（清掉结果与错误，不是一次查询） */
  const handleClearSearch = () => {
    setSearchValue("");
    resetAux();
    setExpand(null);
    setPhase("idle");
    setErrorMsg(null);
    setPendingSeed(null);
    setLastAttempt(null);
  };

  // 深链 ?keyword=：只自动执行一次
  const deepLinkRan = useRef(false);
  const deepLinkKeyword = (searchParams.get("keyword") ?? "").trim();
  const researchId = searchParams.get("research");
  useEffect(() => {
    if (deepLinkRan.current || !deepLinkKeyword) return;
    deepLinkRan.current = true;
    const id = window.setTimeout(() => {
      setSearchValue(deepLinkKeyword);
      void runAnalysis(deepLinkKeyword, "中国", "PC");
    }, 0);
    return () => window.clearTimeout(id);
  }, [deepLinkKeyword, runAnalysis]);

  // ?research=<id>：打开已保存研究（零供应商请求恢复）
  const researchRan = useRef(false);
  useEffect(() => {
    if (researchRan.current || !researchId) return;
    researchRan.current = true;
    const numeric = Number(researchId);
    if (!Number.isInteger(numeric) || numeric <= 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/keywords/researches/${numeric}`);
        const json = await res.json();
        if (!res.ok) {
          const { message } = handleBillingError(json, t("restoreFailed"));
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
            paaExpanded?: { parent: string; question: string }[];
            trends?: { timeseries?: TrendsResult; geo?: TrendsResult; relatedQueries?: TrendsResult; relatedTopics?: TrendsResult };
          };
        };
        if (!record.payload?.expandData) {
          show(t("restoreFailed"), "error");
          return;
        }
        resetAux();
        setSearchValue(record.seed);
        setLocation(record.location);
        setDevice(record.device === "移动端" ? "移动端" : "PC");
        setExpand(record.payload.expandData);
        setSuggestions(record.payload.suggestions ?? []);
        setPaaExpanded(record.payload.paaExpanded ?? []);
        const tr = record.payload.trends ?? {};
        setTrends({
          data: {
            TIMESERIES: tr.timeseries,
            GEO_MAP_0: tr.geo,
            RELATED_QUERIES: tr.relatedQueries,
            RELATED_TOPICS: tr.relatedTopics,
          },
          phases: {
            TIMESERIES: tr.timeseries ? "done" : "idle",
            GEO_MAP_0: tr.geo ? "done" : "idle",
            RELATED_QUERIES: tr.relatedQueries ? "done" : "idle",
            RELATED_TOPICS: tr.relatedTopics ? "done" : "idle",
          },
        });
        setRestoredAt(record.savedAt);
        setPhase("done");
        show(t("restoredToast"), "success");
      } catch (err) {
        show(`${t("restoreFailed")}${(err as Error).message}`, "error");
      }
    })();
    // 深链恢复只应随 researchId 触发一次；show/t 为稳定引用，不加入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchId]);

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
      const existing = new Set(rows.map((r) => normalizeKeywordForDedup(r.keyword)));
      const fresh = list.filter((s) => !existing.has(normalizeKeywordForDedup(s)));
      setSuggestions((prev) => Array.from(new Set([...prev, ...list])));
      setSuggestPhase(list.length === 0 ? "empty" : "done");
      setSuggestNote(
        list.length === 0
          ? t("suggestEmpty", { cache: json.data?.fromCache ? ts("fromCache") : "" })
          : t("suggestDone", { added: fresh.length, fetched: list.length })
      );
    } catch (err) {
      setSuggestPhase("error");
      setSuggestNote(`${tc("networkError")}${(err as Error).message}`);
    }
  };

  // ===== PAA 深度展开（仅 provider 真实返回 token 的问题可展开）=====
  const handlePaaExpand = async (question: string, token: string) => {
    if (paaDeep[question]?.phase === "loading") return;
    setPaaDeep((prev) => ({ ...prev, [question]: { phase: "loading" } }));
    try {
      const res = await fetch("/api/keywords/paa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("paaExpandFailed"));
        setPaaDeep((prev) => ({ ...prev, [question]: { phase: "error", message } }));
        return;
      }
      const qs: PaaQuestion[] = Array.isArray(json.data?.questions) ? json.data.questions : [];
      setPaaExpanded((prev) => [
        ...prev,
        ...qs.map((q) => ({ parent: question, question: q.question })),
      ]);
      setPaaDeep((prev) => ({
        ...prev,
        [question]: { phase: qs.length === 0 ? "empty" : "done", fetched: qs.length },
      }));
    } catch (err) {
      setPaaDeep((prev) => ({
        ...prev,
        [question]: { phase: "error", message: `${tc("networkError")}${(err as Error).message}` },
      }));
    }
  };

  // ===== SERP 分页（start>0 走 /api/seo/serp，绝对位次）=====
  // 关键修复（DEF-02）：
  //   1. device 统一走 toSerpDevice：expand 对外返回 desktop/mobile，SERP 接口接受 PC/移动端；
  //   2. 只有成功拿到数据才切换区间——失败时保留当前页数据，绝不清空表格；
  //   3. 失败给出可见错误 + 重试入口（serpError），而不是静默什么都不发生。
  const fetchSerpPage = async (start: number) => {
    if (!expand || serpLoadingStart !== null) return;
    setSerpLoadingStart(start);
    setSerpError(null);
    try {
      const deviceParam = toSerpDevice(expand.device);
      const res = await fetch(
        `/api/seo/serp?keyword=${encodeURIComponent(expand.seed)}&location=${encodeURIComponent(expand.location)}&device=${encodeURIComponent(deviceParam)}&start=${start}`
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const { message } = handleBillingError(json, t("queryFailed"));
        setSerpError({ start, message });
        return;
      }
      const organic = ((json?.data?.organic ?? []) as SerpRow[]).map((row) => normalizeSerpRow(row));
      setSerpPages((prev) => ({ ...prev, [start]: organic }));
      setSerpRange(start);
    } catch (err) {
      setSerpError({ start, message: `${tc("networkError")}${(err as Error).message}` });
    } finally {
      setSerpLoadingStart(null);
    }
  };

  // ===== GSC 实际表现（登录 + 项目 + 连接三重前提；缺任一都如实说明）=====
  useEffect(() => {
    if (phase !== "done") return;
    let alive = true;
    (async () => {
      if (!activeProject?.activeId) {
        if (alive) setGscPhase("noprovider");
        return;
      }
      if (alive) setGscPhase("checking");
      try {
        const connRes = await fetch(`/api/gsc/connection?project_id=${encodeURIComponent(activeProject.activeId)}`);
        if (connRes.status === 401 || connRes.status === 403) {
          if (alive) setGscPhase("noprovider");
          return;
        }
        const connJson = await connRes.json();
        const connected = Boolean(connJson?.data?.connected);
        if (!connected) {
          if (alive) setGscPhase("notconnected");
          return;
        }
        const perfRes = await fetch(
          `/api/gsc/performance?project_id=${encodeURIComponent(activeProject.activeId)}&dimensions=query&row_limit=1000&date_range=last_90_days`
        );
        if (!perfRes.ok) {
          if (alive) setGscPhase("error");
          return;
        }
        const perfJson = await perfRes.json();
        const perfRows: GscMatchInputRow[] = Array.isArray(perfJson?.data?.rows) ? perfJson.data.rows : [];
        if (alive) {
          setGscRows(perfRows);
          setGscPhase("connected");
        }
      } catch {
        if (alive) setGscPhase("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [phase, activeProject?.activeId]);

  const gscMatches = useMemo<Map<string, GscQueryMatch>>(() => {
    if (gscPhase !== "connected" || !expand) return new Map();
    const index = buildGscQueryIndex(gscRows);
    const seedNorm = normalizeKeywordForDedup(expand.seed);
    const keys = rows
      .filter((r) => r.origins.some((o) => o !== "seed"))
      .map((r) => r.keyword);
    const hits = matchKeywordsToGsc([expand.seed, ...keys], index);
    // seed 单独取出（可能未命中）
    if (!hits.has(expand.seed)) {
      const seedHit = index.get(seedNorm);
      if (seedHit) hits.set(expand.seed, seedHit);
    }
    return hits;
  }, [gscPhase, gscRows, expand, rows]);

  // ===== 保存研究（本地 DB，零供应商成本）=====
  const handleSave = async () => {
    if (!expand || savePhase === "saving") return;
    setSavePhase("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/keywords/researches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: expand.seed,
          location: expand.location,
          device: expand.device,
          payload: {
            expandData: expand,
            suggestions,
            paaExpanded,
            trends: {
              timeseries: trends.data.TIMESERIES ?? null,
              geo: trends.data.GEO_MAP_0 ?? null,
              relatedQueries: trends.data.RELATED_QUERIES ?? null,
              relatedTopics: trends.data.RELATED_TOPICS ?? null,
            },
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("saveFailed"));
        setSavePhase("error");
        setSaveError(message);
        show(message, "error");
        return;
      }
      setSavePhase("done");
      show(t("savedToast"), "success");
    } catch (err) {
      const msg = `${t("saveFailed")}${(err as Error).message}`;
      setSavePhase("error");
      setSaveError(msg);
      show(msg, "error");
    }
  };

  const handleHeroSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runAnalysis(searchValue.trim(), location, device);
  };

  const handleToolbarSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runAnalysis(searchValue.trim(), location, device);
  };

  const seedSerpSnapshot = expand?.serpSnapshot ?? null;
  const organicBase = useMemo(
    () => serpPages[0] ?? seedSerpSnapshot?.organic ?? [],
    [serpPages, seedSerpSnapshot]
  );
  const loadedStarts = useMemo(() => {
    const starts = Object.keys(serpPages).map(Number);
    if (seedSerpSnapshot) starts.push(0);
    return Array.from(new Set(starts)).sort((a, b) => a - b);
  }, [serpPages, seedSerpSnapshot]);
  const rangeRows = useMemo(
    () => serpPages[serpRange] ?? (serpRange === 0 ? organicBase : []),
    [serpPages, serpRange, organicBase]
  );

  // 渲染与导出统一走规范化行（幂等）：页面显示、域名聚合、CSV 用的是同一份 resolved 数据
  const rangeRowsView = useMemo(() => rangeRows.map((r) => normalizeSerpRow(r)), [rangeRows]);

  // SERP 视图切换：URL 列表 / 域名聚合（两者都来自真实快照数据）
  const [serpView, setSerpView] = useState<"url" | "domain">("url");

  // 已加载的全部自然结果（0 页来自快照，>0 页来自 /api/seo/serp 分页）
  const allOrganicRows = useMemo(() => {
    const byKey = new Map<string, { position: number; title: string; link: string; domain: string; snippet: string; date?: string }>();
    for (const start of loadedStarts) {
      const rows = start === 0 ? organicBase : serpPages[start] ?? [];
      for (const r of rows) byKey.set(`${r.position}-${r.link}`, r);
    }
    return Array.from(byKey.values()).sort((a, b) => a.position - b.position);
  }, [loadedStarts, organicBase, serpPages]);

  /** 规范化后的全部已加载结果（导出用；与页面展示同一份数据） */
  const allOrganicView = useMemo(() => allOrganicRows.map((r) => normalizeSerpRow(r)), [allOrganicRows]);

  const domainAgg = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allOrganicView) {
      // 域名不可用的行不参与聚合——不能把 /goto 串或空串当成一个"域名"统计
      if (!r.resolvedDomain) continue;
      counts.set(r.resolvedDomain, (counts.get(r.resolvedDomain) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
  }, [allOrganicView]);

  /** 域名不可用的条数（域名视图里如实单列，不混进聚合） */
  const domainUnavailableCount = useMemo(
    () => allOrganicView.filter((r) => !r.resolvedDomain).length,
    [allOrganicView]
  );

  /** 展示用意图：供应商意图优先，否则文本规则估算 */
  const intentOf = (r: UnifiedRow): KeywordIntent =>
    r.providerIntent ? (PROVIDER_INTENT_MAP[r.providerIntent] ?? "未知") : detectIntent(r.keyword);

  /** 链接不可用的可见原因（悬停说明；绝不显示 /goto 串本身） */
  const serpLinkTip = (status?: SerpLinkStatus): string => {
    if (status === "google_redirect_token") return t("linkUnavailableGoogleToken");
    if (status === "missing") return t("linkUnavailableMissing");
    return t("linkUnavailableUnparsable");
  };

  // ===== 更新指标（DEF-06）=====
  // 只做真实市场指标补全：POST /api/keywords/metrics（复用 enrichKeywordMetrics 唯一实现）。
  // 不调用 expand、不重跑关键词扩展；无指标服务/额度不足时如实报错，绝不假装更新成功。
  const handleRefreshMetrics = async () => {
    if (!expand || metricsPhase === "loading") return;
    const keywords = rows.map((r) => r.keyword).slice(0, 200);
    if (keywords.length === 0) {
      setMetricsNote(t("metricsNoKeywords"));
      show(t("metricsNoKeywords"), "info");
      return;
    }
    setMetricsPhase("loading");
    setMetricsNote(null);
    try {
      const language = expand.serpSnapshot?.language ?? undefined;
      const res = await fetch("/api/keywords/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, location: expand.location, ...(language ? { language } : {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const { message } = handleBillingError(json, t("metricsFailed"));
        setMetricsNote(message);
        show(message, "error");
        return;
      }
      const data = json?.data as
        | {
            rows?: { keyword: string; searchVolume: number | null; difficulty: number | null; cpc: number | null; competition: number | null; competitionLevel: string | null; currency: string | null; intent: string | null; trend?: unknown }[];
            source?: "dataforseo" | null;
            fromCache?: boolean;
            warnings?: string[];
            returned?: number;
            requested?: number;
            /** 其中真正带可用数值的行数（服务端计算；缺省时前端按同一规则兜底计算） */
            withValues?: number;
            /** 无数据原因：配置问题 / 套餐不含 / 额度用尽 / 供应商失败 */
            reason?: "plan_not_included" | "unconfigured" | "quota_exceeded" | "provider_error" | null;
          }
        | undefined;

      if (!data || data.source === null || !Array.isArray(data.rows) || data.rows.length === 0) {
        // 套餐边界先于配置问题：额度为 0 的套餐没发请求，不该把「未配置 DataForSEO」当作原因。
        if (data?.reason === "plan_not_included") {
          const msg = t("metricsPlanNotIncluded");
          setMetricsNote(msg);
          show(msg, "info");
          return;
        }
        const reason = data?.warnings?.[0] ?? "";
        const msg = reason ? t("metricsUnavailable", { reason }) : t("metricsUnavailableNoReason");
        setMetricsNote(msg);
        show(msg, "error");
        return;
      }

      const byKeyword = new Map(
        data.rows.map((m) => [normalizeKeywordForDedup(m.keyword), m] as const)
      );
      setExpand((prev) => {
        if (!prev?.metrics) return prev;
        const merged = (prev.metrics.keywords ?? []).map((k) => {
          const m = byKeyword.get(normalizeKeywordForDedup(k.keyword));
          if (!m) return k;
          return {
            ...k,
            searchVolume: m.searchVolume,
            difficulty: m.difficulty,
            cpc: m.cpc,
            competition: m.competition,
            competitionLevel: m.competitionLevel,
            currency: m.currency ?? k.currency,
            intent: m.intent ?? k.intent,
          };
        });
        return {
          ...prev,
          metrics: { ...prev.metrics, source: data.source ?? prev.metrics.source, fromCache: data.fromCache ?? false, keywords: merged },
        };
      });
      // 反馈口径（DEF-06 后续修正）：只有「拿到可用数值」才算更新成功。
      // 缓存命中但全部为 null 不是成功；部分有值要报准确条数，不能把全部关键词都说成已更新。
      const total = data.requested ?? data.rows.length;
      const usable =
        typeof data.withValues === "number"
          ? data.withValues
          : data.rows.filter(
              (m) =>
                m.searchVolume !== null ||
                m.difficulty !== null ||
                m.cpc !== null ||
                m.competition !== null
            ).length;

      if (usable === 0) {
        // B. 有记录但没有任何可用数值：明确说明，且不宣称更新成功
        const msg = data.fromCache
          ? t("metricsCacheEmpty", { count: data.rows.length })
          : t("metricsNoValues", { count: data.rows.length });
        setMetricsNote(msg);
        show(msg, "info");
        return;
      }
      if (usable < total) {
        // C. 部分关键词有可用指标：报准确条数，不夸大
        const msg = data.fromCache
          ? t("metricsPartialCache", { usable, total })
          : t("metricsPartial", { usable, total });
        setMetricsNote(msg);
        show(msg, "info");
        return;
      }
      // A. 全部拿到有效数值：缓存命中说明来源，真实调用说明已更新
      const msg = data.fromCache
        ? t("metricsCacheHit", { count: usable })
        : t("metricsUpdated", { count: usable });
      setMetricsNote(msg);
      show(msg, "success");
    } catch (err) {
      const msg = `${tc("networkError")}${(err as Error).message}`;
      setMetricsNote(msg);
      show(msg, "error");
    } finally {
      setMetricsPhase("idle");
    }
  };

  // 导出统一关键词行（来源/意图/指标全部为真实返回；五项口径来自 buildKeywordCsvContext）
  const handleExportIdeas = () => {
    if (!expand) return;
    const ctx = buildKeywordCsvContext({
      location: expand.location,
      device: expand.device,
      language: expand.serpSnapshot?.language ?? null,
      // 采集时间只用真实快照时间，绝不拿导出时刻冒充
      fetchedAt: expand.serpSnapshot?.fetchedAt ?? null,
      metricsSource: expand.metrics?.source ?? null,
    });
    const { headers, dataRows } = buildKeywordCsv(
      rows.map((r) => ({
        keyword: r.keyword,
        origins: r.origins,
        intentLabel: intentText(intentOf(r), zh),
        searchVolume: r.searchVolume,
        cpc: r.cpc,
      })),
      ctx
    );
    exportCsvRows(`seeo-keywords-${expand.seed}.csv`, headers, dataRows);
  };

  // 导出 SERP 行（排名/标题/域名/链接/摘要 + 链接可用性）
  // domain/link 使用规范化后的值：不可还原时留空，由 link_status 说明原因，绝不导出 /goto 串。
  const handleExportSerp = () => {
    if (!expand) return;
    exportCsvRows(
      `seeo-serp-${expand.seed}.csv`,
      ["position", "title", "domain", "link", "snippet", "link_status"],
      allOrganicView.map((r) => [
        r.position,
        r.title,
        r.resolvedDomain ?? "",
        r.resolvedUrl ?? "",
        r.snippet,
        r.linkStatus ?? "unresolvable",
      ])
    );
  };

  // ===== 渲染 =====
  return (
    <div className="dash-container p-6 lg:p-8">
      <Toast />
      <OpportunityContextBanner />

      {/* ===== 状态 A：未搜索 ===== */}
      {phase === "idle" && (
        <div className="py-10 sm:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("badgeLabel")}</div>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {t("heroTitle")}
            </h1>
            <p className="mx-auto mt-3 max-w-xl font-sans text-sm text-ink-60">{t("heroSubtitle")}</p>
            <p className="mx-auto mt-2 max-w-xl font-sans text-xs text-ink-40">{t("scopeNote")}</p>
          </div>
          <div className="mt-8">
            <KeywordSearchHero
              searchValue={searchValue}
              onSearchValueChange={setSearchValue}
              location={location}
              onLocationChange={setLocation}
              device={device}
              onDeviceChange={setDevice}
              onSubmit={handleHeroSubmit}
              loading={false}
              submitLabel={t("analyze")}
              placeholder={t("searchPlaceholder")}
              inputAriaLabel={t("searchPlaceholder")}
            />
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { title: t("featureVariantsTitle"), desc: t("featureVariantsDesc") },
              { title: t("featureQuestionsTitle"), desc: t("featureQuestionsDesc") },
              { title: t("featureClustersTitle"), desc: t("featureClustersDesc") },
              { title: t("featureSerpTitle"), desc: t("featureSerpDesc") },
            ].map((f) => (
              <div key={f.title} className="card-a p-4">
                <div className="font-sans text-sm font-semibold text-ink">{f.title}</div>
                <p className="mt-1 font-sans text-xs text-ink-40">{f.desc}</p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-3xl text-center font-sans text-xs text-ink-40">{t("dataBoundaryNote")}</p>
        </div>
      )}

      {/* ===== 加载中（仅在没有旧结果时整页 loading；有旧结果见下方结果区顶部提示条）===== */}
      {phase === "loading" && !expand && (
        <div className="py-6">
          <div className="mx-auto max-w-3xl">
            <KeywordSearchHero
              searchValue={searchValue}
              onSearchValueChange={setSearchValue}
              location={location}
              onLocationChange={setLocation}
              device={device}
              onDeviceChange={setDevice}
              onSubmit={handleHeroSubmit}
              loading
              submitLabel={t("analyzing")}
              placeholder={t("searchPlaceholder")}
              inputAriaLabel={t("searchPlaceholder")}
            />
          </div>
          <div className="mt-8 flex items-center justify-center gap-3 py-10">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" aria-hidden="true" />
            <span className="font-sans text-sm text-ink-60">{t("analyzingHint")}</span>
          </div>
        </div>
      )}

      {/* ===== 状态 B：结果页 =====
          loading 期间若已有旧结果，仍渲染本区（旧数据原样保留），由顶部提示条告知正在查询；
          error 期间同样保留旧结果，错误条给原因 + 重试。 */}
      {(phase === "done" || phase === "error" || (phase === "loading" && !!expand)) && (
        <>
          {/* 面包屑 */}
          <nav className="flex items-center gap-1.5 font-sans text-xs text-ink-40" aria-label="breadcrumb">
            <span>{t("crumbWorkspace")}</span>
            <span aria-hidden="true">/</span>
            <span>{t("crumbKeywordResearch")}</span>
            <span aria-hidden="true">/</span>
            <span className="text-ink-60">{t("title")}</span>
          </nav>

          {/* 新查询进行中（旧结果保留）：明确告知正在查询谁、当前显示的是谁的数据 */}
          {phase === "loading" && expand && (
            <div
              role="status"
              className="mt-3 flex items-start gap-2 rounded-md border border-line bg-line-soft px-4 py-2 font-sans text-xs text-ink-60"
            >
              <span
                className="mt-0.5 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-line border-t-ink"
                aria-hidden="true"
              />
              <span>
                {t("queryingKeepsPrevious", { keyword: pendingSeed ?? searchValue, previous: expand.seed })}
              </span>
            </div>
          )}

          {/* 标题行：H1 + 操作按钮（更新指标 / 导出 / 保存研究） */}
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-2xl">
                {expand ? `${t("resultTitle")}${expand.seed}` : t("title")}
              </h1>
              <p className="mt-1 font-sans text-xs text-ink-40">{t("scopeNote")}</p>
              {/* 市场/设备/日期选择行（Semrush 蓝色下拉风格；日期为数据获取日，非筛选器） */}
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-1">
                  <span className="text-base leading-none" aria-hidden="true">{MARKET_FLAG[location] ?? "🌐"}</span>
                  <select
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    aria-label={t("marketLabel")}
                    className="cursor-pointer appearance-none bg-transparent font-sans text-sm font-semibold text-accent focus:outline-none"
                  >
                    {KEYWORD_LOCATIONS.map((c) => (
                      <option key={c} value={c}>{display(c)}</option>
                    ))}
                  </select>
                  <ChevronDown />
                </label>
                <label className="flex items-center gap-1">
                  <select
                    value={device}
                    onChange={(e) => setDevice(e.target.value as "PC" | "移动端")}
                    aria-label={t("deviceLabel")}
                    className="cursor-pointer appearance-none bg-transparent font-sans text-sm font-semibold text-accent focus:outline-none"
                  >
                    <option value="PC">PC</option>
                    <option value="移动端">{zh ? "移动端" : "Mobile"}</option>
                  </select>
                  <ChevronDown />
                </label>
                <span className="flex items-center gap-1.5 font-sans text-sm text-ink-60">
                  <CalendarIcon />
                  {new Date().toLocaleDateString(zh ? "zh-CN" : "en-US", { year: "numeric", month: "long", day: "numeric" })}
                  <span className="font-mono text-xs text-ink-40">{t("dataDateLabel")}</span>
                </span>
                {expand && (
                  <span className="font-sans text-xs text-ink-40">
                    {expand.fromCache ? `${t("sourceLabel")} · ${t("cachedTag")}` : t("sourceLabel")}
                    {usage ? ` · ${t("usage", { used: formatNumber(usage.used, locale), limit: formatNumber(usage.limit, locale) })}` : ""}
                  </span>
                )}
              </div>
              {expand?.marketFallback && (
                <p className="mt-1 font-sans text-xs text-warn">{t("marketFallbackNote")}</p>
              )}
            </div>
          </div>

          {restoredAt && (
            <div className="mt-3 rounded-md border border-line bg-line-soft px-4 py-2 font-sans text-xs text-ink-60">
              {t("restoredBanner", { time: new Date(restoredAt).toLocaleString(zh ? "zh-CN" : "en-US") })}
            </div>
          )}
          {saveError && (
            <div className="mt-3 rounded-md border border-neg/40 px-4 py-2 font-sans text-xs text-neg">{saveError}</div>
          )}

          {/* 错误态：说明失败原因 + 重试；若有旧结果，明确说明已保留。
              role=status（不是 alert）：Toast 已经是 role=alert，两条 alert 会让屏幕阅读器重复播报同一件事。 */}
          {phase === "error" && errorMsg && (
            <div className="mt-5 card-a p-5" role="status">
              <div className="flex flex-wrap items-start gap-2">
                <StatusBadge label={t("queryFailed")} tone="neg" dot={false} />
                <span className="min-w-0 flex-1 font-sans text-sm text-neg">{errorMsg}</span>
                {lastAttempt && (
                  <button
                    type="button"
                    onClick={retryLastAnalysis}
                    className="btn-secondary h-9 shrink-0 gap-1.5 px-3 text-sm"
                  >
                    <RefreshIcon />
                    {tc("retry")}
                  </button>
                )}
              </div>
              <p className="mt-2 font-sans text-xs text-ink-60">
                {expand
                  ? t("keptPreviousResult", { keyword: expand.seed })
                  : t("noPreviousResult")}
              </p>
            </div>
          )}

          {/* Tab 导航（Semrush：概述 / SERP 分析） */}
          {expand && (
            <div className="mt-6 border-b border-line" role="tablist" aria-label={t("tablistLabel")}>
              <div className="flex gap-7">
                {(
                  [
                    { key: "overview" as const, label: t("tabOverview") },
                    { key: "serp" as const, label: t("tabSerp") },
                  ]
                ).map((tabItem) => (
                  <button
                    key={tabItem.key}
                    role="tab"
                    aria-selected={tab === tabItem.key}
                    onClick={() => setTab(tabItem.key)}
                    className={`-mb-px border-b-2 pb-2.5 font-sans text-sm transition-colors ${
                      tab === tabItem.key
                        ? "border-ink font-semibold text-ink"
                        : "border-transparent font-medium text-ink-60 hover:text-ink"
                    }`}
                  >
                    {tabItem.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 工具栏行（Semrush 顺序：Tab 之下、卡片之上）：左=关键词搜索；右=更新指标/导出/保存 */}
          {expand && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <form onSubmit={handleToolbarSubmit} className="flex min-w-0 flex-1 items-stretch gap-2">
                <div className="relative min-w-0 flex-1 sm:max-w-md">
                  <input
                    type="text"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    aria-label={t("searchPlaceholder")}
                    className="h-9 w-full rounded-md border border-line bg-card px-3 pr-8 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
                  />
                  {searchValue && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      aria-label={tc("close")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 font-sans text-base leading-none text-ink-40 hover:text-ink"
                    >
                      ×
                    </button>
                  )}
                </div>
                <button type="submit" className="btn-primary h-9 px-6 text-sm">
                  {t("analyze")}
                </button>
              </form>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleRefreshMetrics()}
                  disabled={metricsPhase === "loading"}
                  aria-busy={metricsPhase === "loading"}
                  className="btn-secondary h-9 gap-1.5 px-3 text-sm disabled:opacity-60"
                >
                  <RefreshIcon />
                  {metricsPhase === "loading" ? t("metricsUpdating") : t("updateMetrics")}
                </button>
                <button
                  type="button"
                  onClick={handleExportIdeas}
                  className="btn-secondary h-9 gap-1.5 px-3 text-sm"
                >
                  <DownloadIcon />
                  {t("exportCsv")}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={savePhase === "saving"}
                  className="btn-primary h-9 px-4 text-sm disabled:opacity-60"
                >
                  {savePhase === "saving" ? t("saving") : savePhase === "done" ? t("savedTag") : t("saveResearch")}
                </button>
              </div>
            </div>
          )}

          {/* 指标更新反馈（成功 / 命中缓存 / 数据源不可用，均来自真实响应） */}
          {metricsNote && (
            <p role="status" className="mt-2 font-sans text-xs text-ink-60">
              {metricsNote}
            </p>
          )}

          {/* ===== Tab：概览 ===== */}
          {expand && tab === "overview" && (
            <>
              {/* 市场指标套餐说明：仅当服务端确认当前套餐额度为 0 时出现；
                  有额度但数据源未配置/失败时走指标卡自身的原因文案，不在此处冒充套餐限制。 */}
              {metricsNotInPlan && (
                <div className="mt-4 card-a flex flex-wrap items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-sans text-sm font-semibold text-ink">
                      {t("metricsNotInPlanTitle")}
                    </div>
                    <p className="mt-1 font-sans text-xs leading-relaxed text-ink-60">
                      {metricsRequiredPlan
                        ? t("metricsNotInPlanBody", {
                            current: currentPlanName,
                            lite: String(expand.metricsAccess?.planQuota?.lite ?? ""),
                            pro: String(expand.metricsAccess?.planQuota?.pro ?? ""),
                          })
                        : t("metricsNotInPlanNoUpgrade", { current: currentPlanName })}
                    </p>
                  </div>
                  {metricsRequiredPlan && (
                    <button
                      type="button"
                      onClick={() =>
                        triggerUpgradeModal({
                          currentPlan: expand.metricsAccess?.plan ?? "free",
                          requiredPlan: metricsRequiredPlan,
                          feature: "keyword_metrics",
                          reason: t("metricsNotInPlanTitle"),
                        })
                      }
                      className="btn-secondary h-9 shrink-0 px-3 text-sm"
                    >
                      {t("metricsUpgradeCta", { plan: planName(metricsRequiredPlan) })}
                    </button>
                  )}
                </div>
              )}
              {/* 指标卡行：Semrush 四栏等高大卡 */}
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                {/* 栏 1：搜索量 + 关键词难度（环形） */}
                <div className="card-a flex flex-col p-4">
                  <MetricLabel>{t("metricVolume")}</MetricLabel>
                  <div className="mt-1 flex items-center gap-2">
                    <MetricValue value={seedVolume === null ? null : formatNumber(seedVolume, locale)} />
                    <span className="text-xl leading-none" title={display(location)} aria-hidden="true">{MARKET_FLAG[location] ?? "🌐"}</span>
                  </div>
                  <div className="mt-1 font-sans text-xs text-ink-40">
                    {seedVolume === null
                      ? metricsNotInPlan
                        ? t("volumeNaPlanNotIncluded")
                        : metricsState === "unconfigured" ? t("volumeNaUnconfigured") : t("volumeNaNoData")
                      : t("volumeSourceNote")}
                  </div>
                  <CardDivider />
                  <MetricLabel>{t("metricKd")}</MetricLabel>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <MetricValue value={seedKd === null ? null : String(Math.round(seedKd))} />
                    <KdRing value={seedKd} />
                  </div>
                  <p className="mt-2 font-sans text-xs leading-relaxed text-ink-40">
                    {metricsNotInPlan ? t("kdNaPlanNotIncluded") : t("kdNaNote")}
                  </p>
                </div>

                {/* 栏 2：搜索结果 + 快照捕获条形列表（全部为本次快照真实计数） */}
                <div className="card-a flex flex-col p-4">
                  <MetricLabel>{t("metricResults")}</MetricLabel>
                  <MetricValue
                    value={
                      seedSerpSnapshot?.totalResults === null || seedSerpSnapshot?.totalResults === undefined
                        ? null
                        : new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { notation: "compact" }).format(seedSerpSnapshot.totalResults)
                    }
                  />
                  <div className="mt-1 font-sans text-xs text-ink-40">{t("resultsCaptured", { count: formatNumber(organicBase.length, locale) })}</div>
                  <CardDivider />
                  <MetricLabel>{t("snapshotsCaption")}</MetricLabel>
                  <div className="mt-3 space-y-2">
                    {(
                      [
                        { label: t("rowOrganic"), count: organicBase.length },
                        { label: t("rowRelatedSearches"), count: expand.related.length },
                        { label: t("rowPaaQuestions"), count: (seedSerpSnapshot?.relatedQuestions ?? []).length + paaExpanded.length },
                        { label: t("rowFeatures"), count: (seedSerpSnapshot?.features ?? []).length },
                      ] as { label: string; count: number }[]
                    ).map((row) => {
                      const max = Math.max(
                        organicBase.length,
                        expand.related.length,
                        (seedSerpSnapshot?.relatedQuestions ?? []).length + paaExpanded.length,
                        (seedSerpSnapshot?.features ?? []).length,
                        1
                      );
                      return (
                        <div key={row.label} className="flex items-center gap-2">
                          <span className="w-[4.5rem] flex-shrink-0 truncate font-sans text-xs text-ink-60">{row.label}</span>
                          <div className="h-1.5 w-24 flex-shrink-0 overflow-hidden rounded-full bg-line-soft">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.max(6, (row.count / max) * 100)}%`, backgroundColor: CHART_BLUE }}
                            />
                          </div>
                          <span className="flex-1" aria-hidden="true" />
                          <span className="font-mono text-xs font-medium text-ink">{formatNumber(row.count, locale)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 栏 3：意图（估算）+ 趋势柱图 */}
                <div className="card-a flex flex-col p-4">
                  <MetricLabel>{t("metricIntent")}</MetricLabel>
                  <div className="mt-1 flex items-center gap-2">
                    <MetricValue value={seedIntent && seedIntent !== "未知" ? intentText(seedIntent, zh) : null} />
                    {seedIntent && seedIntent !== "未知" && (
                      <span className="rounded-sm border border-ink-25 px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-ink-40">
                        {t("intentEstimatedTag")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-sans text-xs text-ink-40">
                    {seedIntent && seedIntent !== "未知" ? t("intentCaption") : t("intentUnknownReason")}
                  </div>
                  <CardDivider />
                  <MetricLabel>{t("metricTrend")}</MetricLabel>
                  <div className="mt-2 h-[76px]">
                    {trends.phases.TIMESERIES === "done" && (trends.data.TIMESERIES?.timeline?.length ?? 0) > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={(trends.data.TIMESERIES?.timeline ?? []).slice(-12).map((p) => ({
                            date: p.date,
                            value: p.values[0]?.extractedValue ?? p.values[0]?.value ?? null,
                          }))}
                          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
                        >
                          <Tooltip
                            contentStyle={RK_TOOLTIP_STYLE}
                            labelStyle={RK_TOOLTIP_LABEL_STYLE}
                            itemStyle={RK_TOOLTIP_ITEM_STYLE}
                            formatter={(v) => [`${v}`, t("trendIndexLabel")]}
                            cursor={{ fill: RK.cursor }}
                          />
                          <Bar dataKey="value" fill={CHART_BLUE} radius={[3, 3, 0, 0]} maxBarSize={10} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : trends.phases.TIMESERIES === "loading" ? (
                      <div className="flex h-full items-center font-sans text-xs text-ink-40">{tc("loading")}</div>
                    ) : (
                      <div className="flex h-full items-center font-sans text-xs text-ink-40">
                        {trends.phases.TIMESERIES === "error" ? t("trendFailed") : t("trendIdle")}
                      </div>
                    )}
                  </div>
                  <div className="mt-1.5 font-sans text-xs text-ink-40">
                    {trends.data.TIMESERIES ? t("trendNote", { range: trends.data.TIMESERIES.dateRange }) : t("trendIndexNote")}
                  </div>
                </div>

                {/* 栏 4：CPC + 竞争密度 + 广告位 + SERP 竞争信号 */}
                <div className="card-a flex flex-col p-4">
                  <MetricLabel>{t("metricCpc")}</MetricLabel>
                  <MetricValue
                    value={
                      seedCpc === null
                        ? null
                        : seedMetrics?.currency === "USD"
                          ? `$${seedCpc.toFixed(2)}`
                          : seedMetrics?.currency
                            ? `${seedCpc.toFixed(2)} ${seedMetrics.currency}`
                            : seedCpc.toFixed(2)
                    }
                  />
                  <div className="mt-1 font-sans text-xs text-ink-40">
                    {seedCpc === null
                      ? metricsNotInPlan
                        ? t("volumeNaPlanNotIncluded")
                        : metricsState === "unconfigured" ? t("volumeNaUnconfigured") : t("cpcNaNoData")
                      : t("volumeSourceNote")}
                  </div>
                  <CardDivider />
                  <MetricLabel>{t("metricCompetitionDensity")}</MetricLabel>
                  <MetricValue value={seedCd === null ? null : seedCd.toFixed(2)} />
                  <div className="mt-1 font-sans text-xs text-ink-40">{t("cdNaNote")}</div>
                  <CardDivider />
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <MetricLabel>{t("signalShortLabel")}</MetricLabel>
                      <div
                        className="mt-1 font-display text-2xl font-semibold leading-7"
                        style={{
                          color: !competitionSignal
                            ? "var(--color-ink-40)"
                            : competitionSignal.score >= 67
                              ? "var(--color-neg)"
                              : competitionSignal.score >= 34
                                ? "var(--color-warn)"
                                : "var(--color-pos)",
                        }}
                        title={t("signalSubtitle")}
                      >
                        {competitionSignal ? competitionSignal.score : "n/a"}
                      </div>
                    </div>
                    <div className="text-right">
                      <MetricLabel>{t("adsCountLabel")}</MetricLabel>
                      <div className="mt-1 font-display text-2xl font-semibold leading-7 text-ink">
                        {seedSerpSnapshot?.adsCount === null || seedSerpSnapshot?.adsCount === undefined
                          ? "—"
                          : formatNumber(seedSerpSnapshot.adsCount, locale)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 关键词创意：单张大卡内三栏（变体 / 问题 / 策略树） */}
              <section className="card-a mt-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-xl font-semibold tracking-tight text-ink">{t("ideasTitle")}</h2>
                  <button
                    type="button"
                    onClick={handleSuggest}
                    disabled={suggestPhase === "loading"}
                    className="btn-secondary h-9 px-4 text-sm disabled:opacity-60"
                  >
                    {suggestPhase === "loading" ? tc("loading") : t("suggestButton")}
                  </button>
                </div>
                {suggestNote && <p className="mt-2 font-sans text-xs text-ink-40">{suggestNote}</p>}

                <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-10 lg:grid-cols-3">
                  {/* 栏 A：关键词变体 */}
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-sans text-base font-semibold text-ink">{t("ideasVariants")}</h3>
                      {variants.length > 0 && (
                        <span className="font-mono text-xs text-ink-40">{formatNumber(variants.length, locale)}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-2xl font-semibold leading-8 text-accent">{formatNumber(variants.length, locale)}</span>
                      <span className="font-sans text-xs text-ink-40">{t("ideasVariantsCaption")}</span>
                    </div>
                    {variants.length === 0 ? (
                      <p className="mt-4 font-sans text-xs text-ink-40">{t("ideasEmpty")}</p>
                    ) : (
                      <>
                        <table className="mt-3 w-full">
                          <thead>
                            <tr className="border-b border-line text-left">
                              <th className="py-1.5 pr-2 font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{ts("colKeyword")}</th>
                              <th className="w-16 whitespace-nowrap py-1.5 pr-2 text-right font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{ts("colVolume")}</th>
                              <th className="w-20 whitespace-nowrap py-1.5 text-right font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{ts("colIntent")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(viewAllIdeas === "variants" ? variants : variants.slice(0, 6)).map((r) => (
                              <tr key={r.keyword} className="border-b border-line-soft last:border-b-0">
                                <td className="max-w-[13rem] py-2 pr-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSearchValue(r.keyword);
                                      setLocation(expand.location);
                                      setDevice(expand.device === "移动端" ? "移动端" : "PC");
                                      void runAnalysis(r.keyword, expand.location, expand.device === "移动端" ? "移动端" : "PC");
                                    }}
                                    className={`block max-w-full truncate text-left font-sans text-sm text-accent hover:underline ${RK_LINK_CLASS}`}
                                  >
                                    {r.keyword}
                                  </button>
                                </td>
                                <td className="py-2 pr-2 text-right font-mono text-ink-60">
                                  {r.searchVolume === null ? "—" : formatNumber(r.searchVolume, locale)}
                                </td>
                                <td className="py-2 text-right"><IntentBadge intent={intentOf(r)} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {variants.length > 6 && (
                          <button
                            type="button"
                            onClick={() => setViewAllIdeas(viewAllIdeas === "variants" ? null : "variants")}
                            className="mt-3 w-full rounded-md border border-line py-2 text-center font-sans text-sm text-ink-60 transition-colors hover:bg-line-soft hover:text-ink"
                          >
                            {viewAllIdeas === "variants" ? t("collapseAll") : t("viewAll", { count: formatNumber(variants.length, locale) })}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* 栏 B：问题 */}
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-sans text-base font-semibold text-ink">{t("ideasQuestions")}</h3>
                      {questions.length > 0 && (
                        <span className="font-mono text-xs text-ink-40">{formatNumber(questions.length, locale)}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-2xl font-semibold leading-8 text-accent">{formatNumber(questions.length, locale)}</span>
                      <span className="font-sans text-xs text-ink-40">{t("ideasQuestionsCaption")}</span>
                    </div>
                    {questions.length === 0 ? (
                      <p className="mt-4 font-sans text-xs text-ink-40">{t("questionsEmpty")}</p>
                    ) : (
                      <>
                        <table className="mt-3 w-full">
                          <thead>
                            <tr className="border-b border-line text-left">
                              <th className="py-1.5 pr-2 font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{ts("colKeyword")}</th>
                              <th className="w-16 whitespace-nowrap py-1.5 pr-2 text-right font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{ts("colVolume")}</th>
                              <th className="w-20 whitespace-nowrap py-1.5 text-right font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{ts("colIntent")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(viewAllIdeas === "questions" ? questions : questions.slice(0, 6)).map((r) => (
                              <tr key={r.keyword} className="border-b border-line-soft last:border-b-0">
                                <td className="max-w-[13rem] py-2 pr-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSearchValue(r.keyword);
                                      setLocation(expand.location);
                                      setDevice(expand.device === "移动端" ? "移动端" : "PC");
                                      void runAnalysis(r.keyword, expand.location, expand.device === "移动端" ? "移动端" : "PC");
                                    }}
                                    className={`block max-w-full truncate text-left font-sans text-sm text-accent hover:underline ${RK_LINK_CLASS}`}
                                  >
                                    {r.keyword}
                                  </button>
                                </td>
                                <td className="py-2 pr-2 text-right font-mono text-ink-60">
                                  {r.searchVolume === null ? "—" : formatNumber(r.searchVolume, locale)}
                                </td>
                                <td className="py-2 text-right"><IntentBadge intent={intentOf(r)} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {questions.length > 6 && (
                          <button
                            type="button"
                            onClick={() => setViewAllIdeas(viewAllIdeas === "questions" ? null : "questions")}
                            className="mt-3 w-full rounded-md border border-line py-2 text-center font-sans text-sm text-ink-60 transition-colors hover:bg-line-soft hover:text-ink"
                          >
                            {viewAllIdeas === "questions" ? t("collapseAll") : t("viewAll", { count: formatNumber(questions.length, locale) })}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* 栏 C：关键词策略（聚类树） */}
                  <div>
                    <h3 className="font-sans text-base font-semibold text-ink">{t("ideasClusters")}</h3>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-2xl font-semibold leading-8 text-accent">{formatNumber(clusters.length, locale)}</span>
                      <span className="font-sans text-xs text-ink-40">{t("ideasClustersCaption")}</span>
                    </div>
                    {clusters.length === 0 ? (
                      <p className="mt-4 font-sans text-xs text-ink-40">{t("clustersEmpty")}</p>
                    ) : (
                      <>
                        <div className="mt-3 space-y-4">
                          {(viewAllIdeas === "clusters" ? clusters : clusters.slice(0, 4)).map((c, ci) => (
                            <div key={c.id}>
                              <div className="font-sans text-sm font-semibold text-ink">{c.label}</div>
                              <div className="mt-1.5 space-y-1.5 border-l-2 border-line pl-3">
                                {c.keywords.slice(0, 4).map((kw, ki) => (
                                  <div key={kw} className="flex items-center gap-2">
                                    <div
                                      className="h-1.5 flex-shrink-0 rounded-full"
                                      style={{
                                        width: `${30 + (stableHash(kw) % 55)}%`,
                                        backgroundColor: CLUSTER_BAR_COLORS[(ci + ki) % CLUSTER_BAR_COLORS.length],
                                      }}
                                      aria-hidden="true"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSearchValue(kw);
                                        setLocation(expand.location);
                                        setDevice(expand.device === "移动端" ? "移动端" : "PC");
                                        void runAnalysis(kw, expand.location, expand.device === "移动端" ? "移动端" : "PC");
                                      }}
                                      className="truncate font-sans text-xs text-ink-60 hover:text-accent hover:underline"
                                    >
                                      {kw}
                                    </button>
                                  </div>
                                ))}
                                {c.keywords.length > 4 && (
                                  <div className="font-mono text-xs text-ink-40">+{formatNumber(c.keywords.length - 4, locale)}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 space-y-2">
                          {clusters.length > 4 && (
                            <button
                              type="button"
                              onClick={() => setViewAllIdeas(viewAllIdeas === "clusters" ? null : "clusters")}
                              className="w-full rounded-md border border-line py-2 text-center font-sans text-sm text-ink-60 transition-colors hover:bg-line-soft hover:text-ink"
                            >
                              {viewAllIdeas === "clusters" ? t("collapseAll") : t("viewAllClusters", { count: formatNumber(clusters.length, locale) })}
                            </button>
                          )}
                          <a
                            href={`/app/keyword-strategy?seed=${encodeURIComponent(expand.seed)}`}
                            className="block w-full rounded-md border border-line py-2 text-center font-sans text-sm text-accent transition-colors hover:bg-line-soft"
                          >
                            {t("openInStrategy")}
                          </a>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <p className="mt-6 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("intentNote")}</p>
              </section>

              {/* ===== 趋势与地区需求 ===== */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* 地区热度（Trends 相对指数 0-100） */}
                <ChartFrame
                  title={t("geoTitle")}
                  subtitle={t("geoSubtitle")}
                  legend={
                    trends.data.GEO_MAP_0
                      ? [{ label: t("trendIndexLabel"), tone: "accent" as const, color: RK.accent }]
                      : []
                  }
                  isEmpty={trends.phases.GEO_MAP_0 === "done" && (trends.data.GEO_MAP_0?.geoInterest?.length ?? 0) === 0}
                  emptyTitle={t("geoEmpty")}
                  emptyHint={t("trendFailedHint")}
                  showEmptyIcon={false}
                  chartHeight={trends.phases.GEO_MAP_0 === "done" && (trends.data.GEO_MAP_0?.geoInterest?.length ?? 0) > 0 ? Math.max(200, Math.min((trends.data.GEO_MAP_0?.geoInterest?.length ?? 0), 10) * 30 + 56) : undefined}
                  chart={
                    trends.phases.GEO_MAP_0 === "done" && (trends.data.GEO_MAP_0?.geoInterest?.length ?? 0) > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={(trends.data.GEO_MAP_0?.geoInterest ?? []).slice(0, 10).map((g) => ({ geoName: g.geoName, value: g.extractedValue ?? g.value }))}
                          layout="vertical"
                          margin={{ top: 4, right: 30, bottom: 4, left: 0 }}
                          barCategoryGap="22%"
                        >
                          <CartesianGrid {...RK_GRID_PROPS} horizontal={false} />
                          <XAxis type="number" domain={[0, 100]} {...RK_YAXIS_PROPS} tickMargin={6} />
                          <YAxis type="category" dataKey="geoName" width={120} interval={0} tick={RK_TICK_STYLE} tickLine={false} axisLine={false} tickMargin={6} />
                          <Tooltip
                            contentStyle={RK_TOOLTIP_STYLE}
                            labelStyle={RK_TOOLTIP_LABEL_STYLE}
                            itemStyle={RK_TOOLTIP_ITEM_STYLE}
                            cursor={{ fill: RK.cursor }}
                            formatter={(v) => [`${v}`, t("trendIndexLabel")]}
                          />
                          <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={16} isAnimationActive={false} fill={CHART_BLUE}>
                            <LabelList dataKey="value" position="right" offset={6} style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", fill: RK.ink60 }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : undefined
                  }
                >
                  <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">
                    {trends.phases.GEO_MAP_0 === "loading" ? tc("loading") : t("trendIndexNote")}
                  </p>
                </ChartFrame>

                {/* 时间趋势（完整曲线） */}
                <ChartFrame
                  title={t("timeseriesTitle")}
                  subtitle={t("timeseriesSubtitle")}
                  legend={
                    trends.data.TIMESERIES
                      ? [{ label: t("trendIndexLabel"), tone: "accent" as const, color: RK.accent }]
                      : []
                  }
                  isEmpty={trends.phases.TIMESERIES === "done" && (trends.data.TIMESERIES?.timeline?.length ?? 0) === 0}
                  emptyTitle={t("timeseriesEmpty")}
                  emptyHint={t("trendFailedHint")}
                  showEmptyIcon={false}
                  chartHeight={240}
                  chart={
                    trends.phases.TIMESERIES === "done" && (trends.data.TIMESERIES?.timeline?.length ?? 0) > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={(trends.data.TIMESERIES?.timeline ?? []).map((p) => ({
                            date: p.date,
                            value: p.values[0]?.extractedValue ?? p.values[0]?.value ?? null,
                          }))}
                          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                        >
                          <CartesianGrid {...RK_GRID_PROPS} />
                          <XAxis dataKey="date" tick={RK_TICK_STYLE} tickLine={false} axisLine={false} tickMargin={6} minTickGap={40} />
                          <YAxis domain={[0, 100]} width={36} tick={RK_TICK_STYLE} tickLine={false} axisLine={false} tickMargin={6} />
                          <Tooltip
                            contentStyle={RK_TOOLTIP_STYLE}
                            labelStyle={RK_TOOLTIP_LABEL_STYLE}
                            itemStyle={RK_TOOLTIP_ITEM_STYLE}
                            formatter={(v) => [`${v}`, t("trendIndexLabel")]}
                          />
                          <Area type="monotone" dataKey="value" stroke={CHART_BLUE} fill={CHART_BLUE} fillOpacity={0.12} strokeWidth={1.8} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : undefined
                  }
                >
                  <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">
                    {trends.phases.TIMESERIES === "loading" ? tc("loading") : t("trendIndexNote")}
                  </p>
                </ChartFrame>
              </div>

              {/* 相关查询 / 相关主题 */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {(
                  [
                    { key: "RELATED_QUERIES" as const, title: t("relatedQueriesTitle"), data: trends.data.RELATED_QUERIES, phase: trends.phases.RELATED_QUERIES },
                    { key: "RELATED_TOPICS" as const, title: t("relatedTopicsTitle"), data: trends.data.RELATED_TOPICS, phase: trends.phases.RELATED_TOPICS },
                  ]
                ).map((block) => {
                  const top = block.data?.top ?? [];
                  const rising = block.data?.rising ?? [];
                  return (
                    <ChartFrame
                      key={block.key}
                      title={block.title}
                      isEmpty={block.phase === "done" && top.length === 0 && rising.length === 0}
                      emptyTitle={t("relatedEmpty")}
                      emptyHint={t("trendFailedHint")}
                      showEmptyIcon={false}
                    >
                      {block.phase === "loading" ? (
                        <p className="font-sans text-xs text-ink-40">{tc("loading")}</p>
                      ) : block.phase === "done" && (top.length > 0 || rising.length > 0) ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {top.slice(0, 12).map((item, i) => (
                              <button
                                key={`top-${item.label}-${i}`}
                                type="button"
                                onClick={() => {
                                  setSearchValue(item.label);
                                  void runAnalysis(item.label, expand.location, expand.device === "移动端" ? "移动端" : "PC");
                                }}
                                className={`inline-flex items-center gap-1 rounded-sm border border-line bg-card px-2 py-1 font-sans text-xs hover:border-ink-25 ${RK_LINK_CLASS}`}
                              >
                                {item.label}
                                {item.value !== null && <span className="font-mono text-ink-40">{item.value}</span>}
                              </button>
                            ))}
                          </div>
                          {rising.length > 0 && (
                            <div>
                              <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("risingLabel")}</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {rising.slice(0, 8).map((item, i) => (
                                  <button
                                    key={`rising-${item.label}-${i}`}
                                    type="button"
                                    onClick={() => {
                                      setSearchValue(item.label);
                                      void runAnalysis(item.label, expand.location, expand.device === "移动端" ? "移动端" : "PC");
                                    }}
                                    className={`inline-flex items-center gap-1 rounded-sm border border-warn/40 px-2 py-1 font-sans text-xs hover:border-ink-25 ${RK_LINK_CLASS}`}
                                  >
                                    {item.label}
                                    {item.value !== null && <span className="font-mono text-warn">{item.value}</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="font-sans text-xs text-ink-40">{t("trendFailed")}</p>
                      )}
                    </ChartFrame>
                  );
                })}
              </div>

              {/* ===== GSC 实际表现 ===== */}
              <section className="card-a mt-4 p-5">
                <header>
                  <h2 className="font-display text-xl font-semibold tracking-tight text-ink">{t("gscTitle")}</h2>
                  <p className="mt-0.5 font-sans text-xs text-ink-40">{t("gscSubtitle")}</p>
                </header>
                {gscPhase === "checking" && <p className="mt-3 font-sans text-xs text-ink-40">{tc("loading")}</p>}
                {gscPhase === "noprovider" && (
                  <p className="mt-3 font-sans text-xs text-ink-40">{t("gscNeedLoginProject")}</p>
                )}
                {gscPhase === "notconnected" && (
                  <p className="mt-3 font-sans text-xs text-ink-40">
                    {t("gscNotConnected", { project: activeProject?.activeDomain ?? "" })}{" "}
                    <Link href="/app/settings" className={RK_LINK_CLASS}>{t("gscGoSettings")}</Link>
                  </p>
                )}
                {gscPhase === "error" && <p className="mt-3 font-sans text-xs text-ink-40">{t("gscError")}</p>}
                {gscPhase === "connected" && (() => {
                  const seedHit = expand ? gscMatches.get(expand.seed) : undefined;
                  const otherHits = Array.from(gscMatches.entries())
                    .filter(([kw]) => kw !== expand?.seed)
                    .slice(0, 10);
                  return (
                    <>
                      {seedHit ? (
                        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
                          {(
                            [
                              { label: t("gscClicks"), value: formatNumber(seedHit.clicks, locale) },
                              { label: t("gscImpressions"), value: formatNumber(seedHit.impressions, locale) },
                              { label: t("gscCtr"), value: seedHit.ctr === null ? null : `${(seedHit.ctr * 100).toFixed(2)}%` },
                              { label: t("gscPosition"), value: seedHit.position === null ? null : seedHit.position.toFixed(1) },
                            ] as { label: string; value: string | null }[]
                          ).map((m) => (
                            <div key={m.label} className="rounded-md border border-line-soft p-3">
                              <MetricLabel>{m.label}</MetricLabel>
                              <div className={`mt-1 font-display text-2xl font-semibold leading-7 ${m.value === null ? "text-ink-40" : "text-ink"}`}>
                                {m.value === null ? "n/a" : m.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 font-sans text-xs text-ink-40">{t("gscNoSeedMatch")}</p>
                      )}
                      {otherHits.length > 0 && (
                        <div className="mt-4">
                          <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("gscMatchedQueries")}</div>
                          <div className="mt-2 hidden overflow-x-auto md:block">
                            <DataTable minWidthRem={40} ariaLabel={t("gscMatchedQueries")}>
                              <THead>
                                <Th>{t("colKeyword")}</Th>
                                <Th align="right" width="8rem">{t("gscClicks")}</Th>
                                <Th align="right" width="8rem">{t("gscImpressions")}</Th>
                                <Th align="right" width="8rem">{t("gscCtr")}</Th>
                                <Th align="right" width="8rem">{t("gscPosition")}</Th>
                              </THead>
                              <TBody>
                                {otherHits.map(([kw, m]) => (
                                  <TR key={kw}>
                                    <TD><span className="font-sans text-sm text-ink">{kw}</span></TD>
                                    <TD align="right" numeric><span className="font-mono text-sm">{formatNumber(m.clicks, locale)}</span></TD>
                                    <TD align="right" numeric><span className="font-mono text-sm">{formatNumber(m.impressions, locale)}</span></TD>
                                    <TD align="right" numeric><span className="font-mono text-sm">{m.ctr === null ? tv("notApplicable") : `${(m.ctr * 100).toFixed(2)}%`}</span></TD>
                                    <TD align="right" numeric><span className="font-mono text-sm">{m.position === null ? tv("notApplicable") : m.position.toFixed(1)}</span></TD>
                                  </TR>
                                ))}
                              </TBody>
                            </DataTable>
                          </div>
                        </div>
                      )}
                      <p className="mt-3 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("gscBoundaryNote")}</p>
                    </>
                  );
                })()}
              </section>

              {/* ===== 机会与竞品差距入口 ===== */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="card-a flex flex-col justify-between p-5">
                  <div>
                    <h3 className="font-sans text-base font-semibold text-ink">{t("opportunityTitle")}</h3>
                    <p className="mt-1 font-sans text-xs text-ink-40">{t("opportunityDesc")}</p>
                  </div>
                  <a href={`/app/opportunities?keyword=${encodeURIComponent(expand.seed)}`} className="btn-secondary mt-4 h-9 w-fit px-4 text-sm">
                    {t("opportunityAction")}
                  </a>
                </div>
                <div className="card-a flex flex-col justify-between p-5">
                  <div>
                    <h3 className="font-sans text-base font-semibold text-ink">{t("gapTitle")}</h3>
                    <p className="mt-1 font-sans text-xs text-ink-40">
                      {activeProject?.activeDomain ? t("gapDescProject", { domain: activeProject.activeDomain }) : t("gapDescNoProject")}
                    </p>
                  </div>
                  <Link href="/app/competitors" className="btn-secondary mt-4 h-9 w-fit px-4 text-sm">
                    {t("gapAction")}
                  </Link>
                </div>
              </div>
            </>
          )}

          {/* ===== Tab：SERP 分析（Semrush 式）===== */}
          {expand && tab === "serp" && (
            <>
              <section className="card-a mt-5 p-5">
                {/* 头部：标题 + URL/域名视图切换 + 外部动作 */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <h2 className="font-display text-xl font-semibold tracking-tight text-ink">{t("serpTableTitle")}</h2>
                    <div className="flex rounded-md border border-line p-0.5" role="tablist" aria-label={t("serpViewLabel")}>
                      {(["url", "domain"] as const).map((v) => (
                        <button
                          key={v}
                          role="tab"
                          aria-selected={serpView === v}
                          onClick={() => setSerpView(v)}
                          className={`rounded px-3 py-1 font-sans text-xs font-semibold transition-colors ${
                            serpView === v ? "bg-ink text-white" : "font-medium text-ink-60 hover:text-ink"
                          }`}
                        >
                          {v === "url" ? t("viewUrl") : t("viewDomain")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(expand.seed)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-1 font-sans text-sm hover:underline ${RK_LINK_CLASS}`}
                    >
                      {t("viewOnGoogle")}
                      <ExternalIcon />
                    </a>
                    <button type="button" onClick={handleExportSerp} className="btn-secondary h-8 gap-1.5 px-3 text-xs">
                      <DownloadIcon />
                      {t("exportCsv")}
                    </button>
                  </div>
                </div>

                {/* Results 大数字 + SERP 特征图标 */}
                <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <MetricLabel>{t("serpResultsLabel")}</MetricLabel>
                    <div className="mt-1 font-display text-2xl font-semibold leading-9 tracking-tight text-ink">
                      {seedSerpSnapshot?.totalResults === null || seedSerpSnapshot?.totalResults === undefined
                        ? "n/a"
                        : new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { notation: "compact" }).format(seedSerpSnapshot.totalResults)}
                    </div>
                    <div className="mt-0.5 font-sans text-xs text-ink-40">{t("serpResultsNote")}</div>
                  </div>
                  <div>
                    <MetricLabel>{t("serpFeaturesLabel")}</MetricLabel>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {(seedSerpSnapshot?.features ?? []).length === 0 ? (
                        <span className="font-sans text-xs text-ink-40">{t("serpFeaturesEmpty")}</span>
                      ) : (
                        (seedSerpSnapshot?.features ?? []).map((f, i) => {
                          const label = SERP_FEATURE_LABELS[f.featureType];
                          return (
                            <span
                              key={`${f.featureType}-${i}`}
                              title={f.title ?? (label ? (zh ? label.zh : label.en) : f.featureType)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-2 py-1.5 font-sans text-xs text-ink-60"
                            >
                              <FeatureIcon type={f.featureType} />
                              {label ? (zh ? label.zh : label.en) : f.featureType}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* 位置区间 pills（真实分页数据） */}
                <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label={t("serpRangesLabel")}>
                  {Array.from({ length: loadedStarts.length + 1 }, (_, i) => i * SERP_PAGE_SIZE)
                    .filter((start) => start <= SERP_MAX_START)
                    .map((start) => {
                      const loaded = serpPages[start] !== undefined || start === 0;
                      const isNext = !loaded;
                      return (
                        <button
                          key={start}
                          role="tab"
                          aria-selected={serpRange === start}
                          disabled={isNext && serpLoadingStart !== null}
                          onClick={() => {
                            if (loaded) {
                              setSerpRange(start);
                              setSerpError(null);
                              return;
                            }
                            // 未加载的区间：先请求，成功后才切换（失败保留当前页数据）
                            void fetchSerpPage(start);
                          }}
                          className={`rounded-full border px-3 py-1.5 font-mono text-sm font-medium transition-colors ${
                            serpRange === start
                              ? "border-accent bg-accent/5 text-accent"
                              : isNext
                                ? "border-dashed border-line text-ink-40 hover:border-ink-25"
                                : "border-line text-ink-60 hover:border-ink-25 hover:text-ink"
                          }`}
                        >
                          {`${start + 1}-${start + SERP_PAGE_SIZE}`}
                          {isNext && serpLoadingStart === start ? " …" : ""}
                        </button>
                      );
                    })}
                </div>
                <p className="mt-2 font-sans text-xs text-ink-40">{t("serpRangesNote")}</p>

                {/* 分页失败：可见错误 + 重试（DEF-02：不允许静默清空） */}
                {serpError && (
                  <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-neg/40 bg-neg/5 px-3 py-2">
                    <span className="font-sans text-xs text-neg">
                      {t("serpPageFailed", { range: `${serpError.start + 1}-${serpError.start + SERP_PAGE_SIZE}` })}
                      {" "}
                      {serpError.message}
                    </span>
                    <button
                      type="button"
                      onClick={() => void fetchSerpPage(serpError.start)}
                      disabled={serpLoadingStart !== null}
                      className="rounded-md border border-neg/40 px-2 py-1 font-sans text-xs font-medium text-neg hover:bg-neg/10 disabled:opacity-60"
                    >
                      {tc("retry")}
                    </button>
                  </div>
                )}

                {/* 内容：URL 列表视图 / 域名聚合视图 */}
                {serpView === "url" ? (
                  serpLoadingStart === serpRange && serpRange !== 0 ? (
                    <p className="mt-5 font-sans text-sm text-ink-40">{tc("loading")}</p>
                  ) : rangeRows.length === 0 ? (
                    <p className="mt-5 font-sans text-sm text-ink-40">{t("serpRangeEmpty")}</p>
                  ) : (
                    <>
                      {/* 桌面：Semrush 式链接列表（蓝色标题 + 外链图标 + URL 行 + 域名列） */}
                      <div className="mt-2 hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[42rem] table-fixed text-sm">
                          <thead>
                            <tr className="border-b border-line text-left">
                              <th className="w-12 whitespace-nowrap py-2 pr-3 text-right font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{t("colRank")}</th>
                              <th className="whitespace-nowrap py-2 pr-4 font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{t("colTitle")}</th>
                              <th className="w-36 whitespace-nowrap py-2 pr-4 font-mono text-xs font-medium uppercase tracking-wide text-ink-40">{t("colDomain")}</th>
                              <th className="hidden w-[24%] whitespace-nowrap py-2 font-mono text-xs font-medium uppercase tracking-wide text-ink-40 lg:table-cell">{t("colSnippet")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rangeRowsView.map((r) => (
                              <tr key={`${r.position}-${r.resolvedUrl ?? r.link}`} className="border-b border-line-soft align-top last:border-b-0 hover:bg-paper/60">
                                <td className="py-3 pr-3 text-right font-mono text-sm font-semibold text-ink-60">
                                  {r.position}
                                </td>
                                <td className="py-3 pr-4">
                                  {r.resolvedUrl ? (
                                    <a
                                      href={r.resolvedUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-sans text-sm font-medium text-accent hover:underline"
                                    >
                                      {r.title || r.resolvedUrl}
                                    </a>
                                  ) : (
                                    <span title={serpLinkTip(r.linkStatus)} className="font-sans text-sm font-medium text-ink-60">
                                      {r.title || t("linkUnavailable")}
                                    </span>
                                  )}{" "}
                                  {r.resolvedUrl && <ExternalIcon />}
                                  {r.date && <span className="ml-2 font-mono text-xs text-ink-40">{r.date}</span>}
                                  <div className={`mt-0.5 truncate font-mono text-xs ${r.resolvedUrl ? "text-accent/70" : "text-ink-40"}`}>
                                    {r.resolvedUrl ?? t("linkUnavailable")}
                                  </div>
                                </td>
                                <td className="py-3 pr-4 font-sans">
                                  {r.resolvedDomain ? (
                                    <span className="text-accent">{r.resolvedDomain}</span>
                                  ) : (
                                    <span title={serpLinkTip(r.linkStatus)} className="text-ink-40">
                                      {t("domainUnavailable")}
                                    </span>
                                  )}
                                </td>
                                <td className="hidden py-3 lg:table-cell">
                                  {r.snippet ? (
                                    <span className="line-clamp-2 font-sans text-xs leading-relaxed text-ink-60">{r.snippet}</span>
                                  ) : (
                                    <span className="font-sans text-xs text-ink-40">{tv("notApplicable")}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {/* 移动端：紧凑卡片 */}
                      <div className="mt-2 md:hidden">
                        {rangeRowsView.map((r) => (
                          <div key={`${r.position}-${r.resolvedUrl ?? r.link}`} className="border-b border-line-soft py-3 last:border-b-0">
                            <div className="flex items-start gap-2">
                              <span className="font-mono text-sm font-semibold text-ink-60">
                                {r.position}
                              </span>
                              <div className="min-w-0 flex-1">
                                {r.resolvedUrl ? (
                                  <a href={r.resolvedUrl} target="_blank" rel="noopener noreferrer" className="font-sans text-sm font-medium text-accent hover:underline">
                                    {r.title || r.resolvedUrl}
                                  </a>
                                ) : (
                                  <span title={serpLinkTip(r.linkStatus)} className="font-sans text-sm font-medium text-ink-60">
                                    {r.title || t("linkUnavailable")}
                                  </span>
                                )}{" "}
                                {r.resolvedUrl && <ExternalIcon />}
                                <div className={`mt-0.5 truncate font-mono text-xs ${r.resolvedUrl ? "text-accent/70" : "text-ink-40"}`}>
                                  {r.resolvedUrl ?? t("linkUnavailable")}
                                </div>
                                {!r.resolvedDomain && (
                                  <div className="mt-0.5 font-sans text-xs text-ink-40">{t("domainUnavailable")}</div>
                                )}
                                {r.snippet && <p className="mt-1 line-clamp-2 font-sans text-xs text-ink-60">{r.snippet}</p>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                ) : (
                  /* 域名聚合视图（真实计数条形；域名不可用的行单独计数，不混入聚合） */
                  domainAgg.length === 0 && domainUnavailableCount === 0 ? (
                    <p className="mt-5 font-sans text-sm text-ink-40">{t("serpRangeEmpty")}</p>
                  ) : (
                    <>
                      {domainAgg.length > 0 && (
                        <div className="mt-4 space-y-1">
                          {domainAgg.map((d, i) => (
                            <div key={d.domain} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-paper/60">
                              <span className="w-6 flex-shrink-0 text-right font-mono text-xs text-ink-40">{i + 1}</span>
                              <span className="w-44 flex-shrink-0 truncate font-sans text-sm text-accent">{d.domain}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
                                <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(4, (d.count / domainAgg[0].count) * 100)}%` }} />
                              </div>
                              <span className="w-8 flex-shrink-0 text-right font-mono text-xs font-semibold text-ink">{d.count}</span>
                              <span className="w-16 flex-shrink-0 text-right font-sans text-xs text-ink-40">{t("domainAppearances")}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {domainUnavailableCount > 0 && (
                        <p className="mt-2 font-sans text-xs text-ink-40">
                          {t("domainUnavailableCount", { count: formatNumber(domainUnavailableCount, locale) })}
                        </p>
                      )}
                    </>
                  )
                )}
              </section>

              {/* PAA + 相关搜索 */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartFrame
                  title={t("paaTitle")}
                  subtitle={t("paaSubtitle", { count: formatNumber((seedSerpSnapshot?.relatedQuestions ?? []).length, locale) })}
                  isEmpty={(seedSerpSnapshot?.relatedQuestions ?? []).length === 0 && paaExpanded.length === 0}
                  emptyTitle={t("paaEmpty")}
                  showEmptyIcon={false}
                >
                  <div className="space-y-3">
                    {(seedSerpSnapshot?.relatedQuestions ?? []).map((q) => (
                      <div key={q.question} className="border-b border-line-soft pb-3 last:border-b-0">
                        <div className="font-sans text-sm text-ink">{q.question}</div>
                        {q.snippet && <p className="mt-1 line-clamp-2 font-sans text-xs text-ink-40">{q.snippet}</p>}
                        {q.nextPageToken && (
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handlePaaExpand(q.question, q.nextPageToken!)}
                              disabled={paaDeep[q.question]?.phase === "loading"}
                              className="rounded-md border border-line px-2 py-1 font-sans text-xs text-ink-60 hover:bg-line-soft disabled:opacity-60"
                            >
                              {paaDeep[q.question]?.phase === "loading" ? tc("loading") : t("paaExpand")}
                            </button>
                            {paaDeep[q.question]?.phase === "done" && (
                              <span className="font-sans text-xs text-pos">{t("paaExpandedNote", { count: paaDeep[q.question]?.fetched ?? 0 })}</span>
                            )}
                            {paaDeep[q.question]?.phase === "empty" && (
                              <span className="font-sans text-xs text-ink-40">{t("paaNoMore")}</span>
                            )}
                            {paaDeep[q.question]?.phase === "error" && (
                              <span className="font-sans text-xs text-neg">{paaDeep[q.question]?.message}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {paaExpanded.length > 0 && (
                      <div>
                        <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("paaExpandedTitle")}</div>
                        <ul className="mt-2 space-y-1.5">
                          {paaExpanded.map((q, i) => (
                            <li key={`${q.question}-${i}`} className="text-xs">
                              <span className="text-ink-40">{q.parent} →</span>{" "}
                              <span className="text-ink-60">{q.question}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </ChartFrame>

                <ChartFrame
                  title={t("relatedSearchesTitle")}
                  subtitle={t("relatedCount", { count: formatNumber(expand.related.length, locale) })}
                  isEmpty={expand.related.length === 0}
                  emptyTitle={t("noRelated")}
                  showEmptyIcon={false}
                >
                  <div className="flex max-h-72 flex-wrap content-start gap-2 overflow-y-auto">
                    {expand.related.map((query, i) => (
                      <button
                        key={`${query}-${i}`}
                        type="button"
                        onClick={() => {
                          setSearchValue(query);
                          void runAnalysis(query, expand.location, expand.device === "移动端" ? "移动端" : "PC");
                        }}
                        className={`inline-flex items-center rounded-sm border border-line bg-card px-2 py-1 font-sans text-xs hover:border-ink-25 ${RK_LINK_CLASS}`}
                      >
                        {query}
                      </button>
                    ))}
                  </div>
                </ChartFrame>
              </div>

              {/* SERP 竞争信号（SeeO 自有信号，非 KD） */}
              <section className="card-a mt-4 p-5">
                <header>
                  <h2 className="font-display text-xl font-semibold tracking-tight text-ink">{t("signalTitle")}</h2>
                  <p className="mt-0.5 font-sans text-xs text-ink-40">{t("signalSubtitle")}</p>
                </header>
                {!competitionSignal ? (
                  <p className="mt-3 font-sans text-xs text-ink-40">{t("signalUnavailable")}</p>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
                    <div>
                      <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("signalScoreLabel")}</div>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span
                          className="font-display text-4xl font-semibold tracking-tight"
                          style={{ color: competitionSignal.score >= 67 ? RK.up : competitionSignal.score >= 34 ? RK.warn : RK.ink60 }}
                        >
                          {competitionSignal.score}
                        </span>
                        <span className="font-mono text-xs text-ink-40">/ 100</span>
                      </div>
                      <div className="mt-1 font-sans text-xs text-ink-40">
                        {t("signalSample", { count: formatNumber(competitionSignal.sampleSize, locale) })}
                      </div>
                    </div>
                    <div className="lg:col-span-2">
                      <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("signalInputsLabel")}</div>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        {(
                          [
                            { label: t("signalInputOrganic"), value: formatNumber(competitionSignal.inputs.organicCount, locale), hint: t("signalInputOrganicHint") },
                            { label: t("signalInputDomains"), value: formatNumber(competitionSignal.inputs.distinctDomains, locale), hint: t("signalInputDomainsHint") },
                            { label: t("signalInputFeatures"), value: formatNumber(competitionSignal.inputs.featureCount, locale), hint: t("signalInputFeaturesHint") },
                            { label: t("signalInputTitleMatch"), value: formatNumber(competitionSignal.inputs.titleMatchCount, locale), hint: t("signalInputTitleMatchHint") },
                          ]
                        ).map((input) => (
                          <div key={input.label} className="rounded-md border border-line-soft p-3">
                            <div className="font-sans text-xs text-ink-40" title={input.hint}>{input.label}</div>
                            <div className="mt-1 font-mono text-lg font-semibold text-ink">{input.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <p className="mt-4 border-t border-line-soft pt-3 font-sans text-xs text-ink-40">{t("signalBoundaryNote")}</p>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** 概览页图表主色：Semrush 式蓝色（rank 页的墨绿主题不适用本页） */
const CHART_BLUE = "#2563eb";

/** 市场 → 旗帜（表示所选市场，非数据） */
const MARKET_FLAG: Record<string, string> = {
  "中国": "🇨🇳", "美国": "🇺🇸", "英国": "🇬🇧", "日本": "🇯🇵", "香港": "🇭🇰", "台湾": "🇹🇼",
};

/** 聚类树条形配色（设计令牌三色循环） */
const CLUSTER_BAR_COLORS = ["var(--color-accent)", "var(--color-warn)", "var(--color-pos)"];

// ===== Semrush 风格视觉原语 =====

/** 卡内指标标签 */
function MetricLabel({ children }: { children: React.ReactNode }) {
  return <div className="font-sans text-sm font-medium text-ink-60">{children}</div>;
}

/** 卡内大数字（28px 粗体；value=null → 灰色 n/a，不用 0 冒充） */
function MetricValue({ value }: { value: string | null }) {
  return (
    <div
      className={`mt-0.5 font-display text-2xl font-semibold leading-8 tracking-tight ${
        value === null ? "text-ink-40" : "text-ink"
      }`}
    >
      {value === null ? "n/a" : value}
    </div>
  );
}

function CardDivider() {
  return <div className="my-4 h-px bg-line-soft" aria-hidden="true" />;
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-accent" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 6.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 5v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M12 4v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m7 11 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-ink-40" aria-hidden="true">
      <rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** KD 环形图：value=null → 灰环 + n/a（不伪造数值）；有值时按难度红/橙/绿 */
function KdRing({ value }: { value: number | null }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const color =
    value === null
      ? "var(--color-ink-25)"
      : value >= 67
        ? "var(--color-neg)"
        : value >= 34
          ? "var(--color-warn)"
          : "var(--color-pos)";
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="flex-shrink-0" aria-hidden="true">
      <circle cx="23" cy="23" r={r} fill="none" stroke="var(--color-line)" strokeWidth="4.5" />
      <circle
        cx="23" cy="23" r={r} fill="none"
        stroke={color}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 23 23)"
      />
      <text x="23" y="27.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--color-ink-40)">
        {value === null ? "n/a" : value}
      </text>
    </svg>
  );
}

/** SERP feature 图标（provider 真实返回的 featureType） */
function FeatureIcon({ type }: { type: string }) {
  const c = "h-4 w-4";
  switch (type) {
    case "featured_snippet":
      return <svg viewBox="0 0 24 24" fill="none" className={c}><path d="M6 4h12v13H9l-3 3V4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
    case "ai_overview":
      return <svg viewBox="0 0 24 24" fill="none" className={c}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
    case "local_pack":
      return <svg viewBox="0 0 24 24" fill="none" className={c}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.7" /></svg>;
    case "video_results":
      return <svg viewBox="0 0 24 24" fill="none" className={c}><rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><path d="M10 9.5v5l4.5-2.5L10 9.5Z" fill="currentColor" /></svg>;
    case "images_results":
      return <svg viewBox="0 0 24 24" fill="none" className={c}><rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><circle cx="8.5" cy="9.5" r="1.8" stroke="currentColor" strokeWidth="1.5" /><path d="m4 17 5-4.5 4 3.5 3.5-3L20 16" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
    case "shopping_results":
      return <svg viewBox="0 0 24 24" fill="none" className={c}><path d="M5 8h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 10V6.5a3 3 0 0 1 6 0V10" stroke="currentColor" strokeWidth="1.7" /></svg>;
    case "top_stories":
      return <svg viewBox="0 0 24 24" fill="none" className={c}><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M7 9h10M7 12.5h10M7 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
    default:
      return <svg viewBox="0 0 24 24" fill="none" className={c}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" /><path d="M12 8h.01M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  }
}

/** 蓝色外链小图标 */
function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="inline-block h-3.5 w-3.5 flex-shrink-0 text-accent/70" aria-hidden="true">
      <path d="M14 5h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 5l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 稳定散列（聚类树条形宽度用，避免每次渲染跳动） */
function stableHash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h;
}

// SERP feature 展示名（provider 真实返回的 featureType；未收录类型原样展示）
const SERP_FEATURE_LABELS: Record<string, { zh: string; en: string }> = {
  featured_snippet: { zh: "精选摘要", en: "Featured snippet" },
  ai_overview: { zh: "AI 概览", en: "AI Overview" },
  local_pack: { zh: "本地地图包", en: "Local pack" },
  knowledge_graph: { zh: "知识图谱", en: "Knowledge graph" },
  top_stories: { zh: "焦点资讯", en: "Top stories" },
  video_results: { zh: "视频结果", en: "Video results" },
  images_results: { zh: "图片结果", en: "Image results" },
  shopping_results: { zh: "购物结果", en: "Shopping results" },
  twitter_results: { zh: "X（Twitter）结果", en: "X (Twitter) results" },
  events_results: { zh: "活动结果", en: "Event results" },
};
