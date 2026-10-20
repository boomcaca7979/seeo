"use client";

// ===== Position Tracking（排名追踪 · 指标 → 趋势 → 关键词表）=====
//
// 设计原则（与第一批 /app、/app/audit 共用同一套可视化规则）：
//   ① 指标卡：只放当前数据确实可计算的量（追踪词数 / 有排名数据 / 上升 / 下降），
//      口径随「市场 · 设备 · 分组」筛选变化，卡片与表格始终同一范围。
//   ② 排名趋势：只画真实历史（/api/tracking/history）。**排名数字越小越靠前**，
//      因此 Y 轴反向、上升=正向色、下降=负向色；量程按真实名次推出（锚点仍是第 1 名），
//      记录数 ≤ 2 时不画曲线，改为逐条列出真实记录（量程与稀疏判定都在图表组件里）。
//   ③ 关键词表：关键词 / 当前位置 / 前次位置 / 变化 / 对应 URL / 最近更新 / 操作。
//      "今日未刷新" 与 "未进前 100" 是两件不同的事实，必须分开显示。
//   ④ 项目范围：tracked_keywords 以 (domain, user_id) 归属项目，因此页面按域名筛选。
//      范围来源 = URL ?domain=（与 /app/audit、/app/backlinks 同一机制）+ Topbar 项目切换事件；
//      不新建第二套项目状态。额度仍是账号级，文案如实标注「全部项目」。
//
// 不改动：SerpApi 调用与额度、tracked_keywords / rank_history 结构、
//         刷新与历史记录机制、添加/分组/删除/深链交互、套餐权限。

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { triggerUpgradeModal } from "@/components/billing/UpgradeModal";
import { useEntitlements } from "@/components/billing/EntitlementsContext";
import { planLabel } from "@/lib/plan-labels";
import { handleBillingError } from "@/lib/billing-error-client";
import { formatNumber } from "@/lib/ui-locale";
import { formatRelativeTime } from "@/lib/relative-time";
import Modal from "@/components/dashboard/Modal";
import DomainSelect from "@/components/dashboard/DomainSelect";
import OpportunityContextBanner from "@/components/dashboard/OpportunityContextBanner";
import {
  PROJECT_CHANGED_EVENT,
  SELECTED_PROJECT_KEY,
  projectChangedDetail,
  setActiveProject,
} from "@/lib/project-selector";

import {
  RK,
  RK_LINK_CLASS,
  RK_RANK_BUCKET,
} from "@/components/viz/rank-theme";
import MultiRankTrend, { MultiRankSeries } from "@/components/dashboard/charts/MultiRankTrend";
import RankTrendChart from "@/components/dashboard/charts/RankTrendChart";
import { SPARSE_TREND_MAX } from "@/components/dashboard/charts/rank-axis";
import RankChangeBars from "@/components/dashboard/charts/RankChangeBars";
import { ChangeBadge } from "@/components/dashboard/Badges";

import PageHeader from "@/components/viz/PageHeader";
import MetricCard from "@/components/viz/MetricCard";
import ChartFrame from "@/components/viz/ChartFrame";
import { StatusBadge } from "@/components/viz/StatusBadge";
import { RankPosition } from "@/components/viz/RankPosition";
import { DataTable, THead, Th, TBody, TR, TD } from "@/components/viz/DataTable";

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
const TREND_DAYS = 30;
const TREND_SERIES_MAX = 5;

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
/** 项目列表项（/api/projects）：id 在鉴权模式为 UUID string、演示模式为整数，统一按 string 使用 */
interface ProjectItem { id: string; name: string; domain: string; }

type SortKey = "rank" | "change" | "refresh";
type SortDir = "asc" | "desc";

/** 本地时区 YYYY-MM-DD（与 SQLite date('now','localtime') 对齐） */
function todayLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
/** 追踪记录的日期部分（last_refreshed_at 形如 "YYYY-MM-DD HH:MM:SS"） */
function dayOf(ts: string | null): string | null {
  return ts ? ts.slice(0, 10) : null;
}

/**
 * 位置显示状态：
 *   live  有今日记录（position 为 null 表示确实未进前 100）
 *   stale 今日没刷新过，但有更早的快照 → 不能说"未进前 100"
 *   none  从未刷新过 → 尚无排名记录
 */
function positionState(row: TrackedKeyword, today: string): "live" | "stale" | "none" {
  if (row.todayPosition !== null) return "live";
  if (dayOf(row.last_refreshed_at) === today) return "live";
  if (row.last_refreshed_at) return "stale";
  return "none";
}

// ===== 深链入口（Action Center → 关键词机会：加入排名追踪）=====
// 支持 /app/position-tracking?keyword=xxx&domain=yyy：预填并打开"添加关键词"弹窗。
// 只有 keyword= 才自动开弹窗：单独的 domain= 是项目范围参数（项目详情/竞品页的跳转链接），
// 若也开弹窗，用户每次进入项目范围都会被一个空表单挡住（见设计原则 ④）。
// 不会自动提交（提交会消耗 SerpApi 额度），由用户确认后再添加。
export default function PositionTrackingPage() {
  return (
    <Suspense fallback={null}>
      <PositionTrackingInner />
    </Suspense>
  );
}

function PositionTrackingInner() {
  const t = useTranslations("dashboard.positionTracking");
  const tc = useTranslations("dashboard.common");
  const tch = useTranslations("dashboard.shared.charts");
  const locale = useLocale() as "en" | "zh";
  const searchParams = useSearchParams();
  const router = useRouter();
  const { plan: currentPlan } = useEntitlements();
  const display = (name: string) => LOCALE_DISPLAY[locale][name] ?? name;
  const deviceLabel = (d: Device) => (d === "PC" ? "PC" : t("deviceMobile"));
  const { show, Toast } = useToast();
  const [device, setDevice] = useState<Device>("PC");
  const [country, setCountry] = useState(RANK_LOCATIONS[0]);
  const [tracked, setTracked] = useState<TrackedKeyword[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [trackingLimit, setTrackingLimit] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<RankHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // BUG-34：历史请求失败（如 SerpApi 配额 429）原先静默丢弃，趋势卡显示得和「真的没数据」一模一样
  const [historyError, setHistoryError] = useState(false);
  const [multiFailed, setMultiFailed] = useState(0);
  const [trendNonce, setTrendNonce] = useState(0);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addKeyword, setAddKeyword] = useState("");
  const [addDomain, setAddDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loadError, setLoadError] = useState(false);

  // ===== 项目范围（情况 A：tracked_keywords 以 (domain, user_id) 归属项目）=====
  // 范围值本身 = 域名，唯一来源是 URL ?domain=（与 /app/audit 同一机制，不再复制一份 state）。
  // 页内项目选择器只改写 URL，因此硬刷新、前进后退、从详情页再次进入都天然还原范围。
  // null = 全部项目（账号级视图，侧边栏直接进入时的原有行为）。
  const scopeDomain = (searchParams.get("domain") ?? "").trim() || null;

  // setActiveProject 会**同步**派发 PROJECT_CHANGED_EVENT，而本组件正是该事件的监听方：
  // 若只比较 scopeDomain，router.replace 生效前它仍是旧值，事件回环会自触发无限递归
  // （实测 RangeError: Maximum call stack size exceeded）。pendingScopeRef 记录"正在应用中的范围"来短路。
  // 用 { domain } 包装而不是直接存 string | null：null 本身是合法范围（全部项目），
  // 若以 null 作"无待应用"哨兵，首次切回全部项目会被误判为重复而吞掉。
  const pendingScopeRef = useRef<{ domain: string | null } | null>(null);
  const applyScope = useCallback(
    (domain: string | null) => {
      const next = domain?.trim() || null;
      if (next === scopeDomain || pendingScopeRef.current?.domain === next) return;
      pendingScopeRef.current = { domain: next };
      const qs = new URLSearchParams(searchParams.toString());
      if (next) qs.set("domain", next);
      else qs.delete("domain");
      const qstr = qs.toString();
      router.replace(qstr ? `/app/position-tracking?${qstr}` : "/app/position-tracking", { scroll: false });
      // 复用既有项目上下文机制：范围命中已知项目时把它设为活跃项目（Topbar / 竞品页同步跟随）
      const hit = next ? projects.find((p) => p.domain === next) : null;
      if (hit) setActiveProject(hit.id);
    },
    [scopeDomain, searchParams, router, projects]
  );

  // 项目列表：范围选择器 + 项目名展示 + 返回详情页链接
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store", signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !Array.isArray(json.data)) return;
        setProjects(
          (json.data as Array<{ id: number | string; name: string; domain: string }>).map((p) => ({
            id: String(p.id),
            name: p.name,
            domain: p.domain,
          }))
        );
      } catch {
        // 项目列表取不到不影响范围本身：仍按 URL 域名筛选，选择器只列出已知项目
      }
    })();
    return () => controller.abort();
  }, []);

  // URL 追上待应用范围后清掉哨兵：否则"曾经是 A"会永久压制"现在再次切到 A"
  // （例：切到 A → 浏览器后退离开 A → 再点 Topbar 的 A，会被上面的短路静默吞掉）。
  // 事件回环守卫不受影响：setActiveProject 的派发发生在 applyScope 同步栈内，早于本次清理。
  useEffect(() => {
    if (pendingScopeRef.current?.domain === scopeDomain) pendingScopeRef.current = null;
  }, [scopeDomain]);

  // 直接打开带 ?domain= 的链接（书签、分享、从别的入口进来）时，URL 就是范围事实来源：
  // 域名唯一命中一个真实项目 → 用同一套共享机制把 Topbar 与持久化选中项一起对齐，
  // 而不是让顶部继续显示上一个项目。命中 0 个（手动域名）或 >1 个（同名域名）都不动项目状态，
  // 避免凭域名字符串造出一个并不存在的项目选中态。
  const urlScopeProject = useCallback((): ProjectItem | null => {
    if (!scopeDomain) return null;
    const hits = projects.filter((p) => p.domain === scopeDomain);
    return hits.length === 1 ? hits[0] : null;
  }, [scopeDomain, projects]);

  // force：忽略"localStorage 已经是对的"就跳过。Topbar 的内存选中态可能仍是旧项目
  // （它的 init 广播晚于本页写入），此时只靠 stored 比较无法把顶部拉回来。
  const alignContextToUrl = useCallback(
    (force: boolean) => {
      const hit = urlScopeProject();
      if (!hit) return;
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(SELECTED_PROJECT_KEY);
      } catch {
        return; // localStorage 不可用：本次不写，页面范围仍由 URL 决定
      }
      if (force || stored !== hit.id) setActiveProject(hit.id);
    },
    [urlScopeProject]
  );

  useEffect(() => {
    alignContextToUrl(false);
  }, [alignContextToUrl]);

  // Topbar 用户主动切换项目 → 页面范围跟随；Topbar 挂载广播（init）与本页写回自身的
  // 上下文（context）都不是"用户又切了一次"，因此不再需要按事件到达顺序猜"首个事件算基线"。
  useEffect(() => {
    const onProjectChanged = (e: Event) => {
      const detail = projectChangedDetail(e);
      if (!detail) return;
      if (detail.source === "user") {
        const hit = projects.find((p) => p.id === detail.id);
        if (hit) applyScope(hit.domain);
        return;
      }
      // init 晚到时（Topbar 读到的是切换前的 localStorage 旧值）以 URL 为准强制回写
      if (detail.source === "init") {
        const hit = projects.find((p) => p.id === detail.id);
        if (hit && scopeDomain && hit.domain !== scopeDomain) alignContextToUrl(true);
      }
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
    return () => window.removeEventListener(PROJECT_CHANGED_EVENT, onProjectChanged);
  }, [projects, applyScope, alignContextToUrl, scopeDomain]);

  // 深链预填并打开添加弹窗（延后一拍，避免 effect 体内同步 setState）
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const dlKeyword = (searchParams.get("keyword") ?? "").trim();
    const dlDomain = (searchParams.get("domain") ?? "").trim();
    if (!dlKeyword) return;
    deepLinkApplied.current = true;
    const id = window.setTimeout(() => {
      setAddKeyword(dlKeyword);
      if (dlDomain) setAddDomain(dlDomain);
      setAddModalOpen(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [searchParams]);
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
        setLoadError(false);
      } else {
        // 取数失败 ≠ 没有关键词：页面必须区分两者，不能显示空列表冒充"0 个"
        setLoadError(true);
        show(tc("loadFailed"), "error");
      }
    } catch {
      setLoadError(true);
      show(tc("networkError"), "error");
    } finally {
      setListLoading(false);
    }
  }, [show, tc]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/keywords/groups", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setGroups(json.data);
    } catch {
      show(tc("networkError"), "error");
    }
  }, [show, tc]);

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
    // BUG-31：行内「+ 分组」弹层只能靠点别处关闭，键盘用户 Escape 关不掉
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGroupMenuId(null);
    };
    window.addEventListener("click", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [groupMenuId, show, tc]);

  // 市场变化后自动切到该市场下有追踪词的位置（避免默认落在无数据的市场，导致"卡片有数、表格为空"）
  const scopedTracked = useMemo(
    () => (scopeDomain ? tracked.filter((row) => row.domain === scopeDomain) : tracked),
    [tracked, scopeDomain]
  );

  // 市场兜底按「范围」各执行一次：切项目后重新对齐该项目的市场，用户手动切换市场不受影响
  const marketScopeRef = useRef<string | null>(null);
  useEffect(() => {
    const key = scopeDomain ?? "__all__";
    if (marketScopeRef.current === key || scopedTracked.length === 0) return;
    const match = scopedTracked.find((k) => k.location === country && k.device === device);
    if (match) {
      marketScopeRef.current = key;
      return;
    }
    const first = scopedTracked[0];
    const id = window.setTimeout(() => {
      marketScopeRef.current = key;
      setCountry(first.location);
      setDevice(first.device);
    }, 0);
    return () => window.clearTimeout(id);
  }, [scopedTracked, scopeDomain, country, device]);

  const filteredTracked = useMemo(
    () =>
      scopedTracked.filter((row) => {
        if (row.location !== country) return false;
        if (row.device !== device) return false;
        if (groupFilter === "all") return true;
        if (groupFilter === "ungrouped") return row.groups.length === 0;
        const gid = Number(groupFilter.replace("group-", ""));
        return row.groups.some((g) => g.id === gid);
      }),
    [scopedTracked, country, device, groupFilter]
  );

  const lastRegionKeyRef = useRef<string>(`${country}|${device}`);
  useEffect(() => {
    const key = `${country}|${device}`;
    if (key === lastRegionKeyRef.current) return;
    lastRegionKeyRef.current = key;
    // BUG-20：这里曾额外调用 loadList()。GET /api/tracking 是账号级全量、
    // 市场/设备筛选全在前端做，重新取数拿到的是一模一样的载荷；
    // 而市场兜底会自动改写 country/device，于是每次进页面都变成 2× tracking
    // + 2× 每个关键词的 history（tracked 数组换引用 → 趋势 effect 重跑）。
    // 只重置选中词，列表由 loadList 的既有触发点（增删词、手动刷新）负责。
    setSelectedId(null);
  }, [country, device]);

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
      const res = await fetch(`/api/tracking/history?id=${keywordId}&days=${TREND_DAYS}`);
      const json = await res.json();
      if (res.ok) {
        setHistory(json.data ?? []);
        setHistoryError(false);
      } else {
        setHistory([]);
        setHistoryError(true);
      }
    } catch {
      setHistory([]);
      setHistoryError(true);
      show(tc("networkError"), "error");
    } finally {
      setHistoryLoading(false);
    }
  }, [show, tc]);

  const historyFetchRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedId === null) {
      const id = window.setTimeout(() => {
        setHistory([]);
        setHistoryError(false);
      }, 0);
      return () => window.clearTimeout(id);
    }
    if (historyFetchRef.current === selectedId) return;
    historyFetchRef.current = selectedId;
    void loadHistory(selectedId);
  }, [selectedId, loadHistory]);

  // 单关键词趋势始终来自当前范围（切换项目后不会保留其他项目的关键词）
  const selectedKeyword = filteredTracked.find((row) => row.id === selectedId) ?? null;
  useEffect(() => {
    const needFallback =
      (selectedId !== null && !filteredTracked.find((row) => row.id === selectedId)) ||
      (selectedId === null && filteredTracked.length > 0);
    if (needFallback) {
      const id = window.setTimeout(() => setSelectedId(filteredTracked[0]?.id ?? null), 0);
      return () => window.clearTimeout(id);
    }
  }, [filteredTracked, selectedId]);

  // ---- 指标（全部按当前「市场 · 设备 · 分组」范围计算，与表格同口径） ----
  const today = todayLocal();
  const stats = useMemo(() => {
    const ranked = filteredTracked.filter((row) => row.todayPosition !== null);
    return {
      total: filteredTracked.length,
      ranked: ranked.length,
      top3: ranked.filter((row) => (row.todayPosition as number) <= 3).length,
      top10: ranked.filter((row) => (row.todayPosition as number) <= 10).length,
      up: filteredTracked.filter((row) => row.change !== null && row.change > 0).length,
      down: filteredTracked.filter((row) => row.change !== null && row.change < 0).length,
    };
  }, [filteredTracked]);

  /** 最新快照时间（跨当前范围）；没有则 null */
  const latestSnapshot = useMemo(() => {
    let best: string | null = null;
    for (const row of filteredTracked) {
      if (row.last_refreshed_at && (!best || row.last_refreshed_at > best)) best = row.last_refreshed_at;
    }
    return best;
  }, [filteredTracked]);

  /** 今日没记录但有历史 → 如实说明"今日尚未刷新"（不冒充"未进前100"） */
  const staleToday =
    filteredTracked.length > 0 &&
    stats.ranked === 0 &&
    filteredTracked.some((row) => positionState(row, today) === "stale");

  const usagePercent = usage && usage.limit > 0 ? (usage.used / usage.limit) * 100 : 0;
  const snapshotLabel = latestSnapshot
    ? t("snapshotLatest", { date: dayOf(latestSnapshot) ?? "" })
    : t("snapshotNone");

  // 多关键词排名趋势：取当前筛选下前 5 个词的 30 天历史
  const [multiSeries, setMultiSeries] = useState<MultiRankSeries[]>([]);
  const [multiLoading, setMultiLoading] = useState(false);
  useEffect(() => {
    const top5 = filteredTracked.slice(0, TREND_SERIES_MAX);
    // cancelled 必须放在 effect 作用域：之前它定义在 setTimeout 回调里、
    // 靠「回调的返回值」置位，而返回值没人接收 → 守卫是死代码，
    // 切换筛选后上一轮 Promise.all 仍会覆盖新一轮的 multiSeries。
    let cancelled = false;
    const tid = window.setTimeout(() => {
      if (cancelled) return;
      if (top5.length === 0) {
        setMultiSeries([]);
        return;
      }
      setMultiLoading(true);
      (async () => {
        let failed = 0;
        const results = await Promise.all(
          top5.map(async (row) => {
            try {
              const res = await fetch(`/api/tracking/history?id=${row.id}&days=${TREND_DAYS}`, { cache: "no-store" });
              const json = await res.json();
              if (!res.ok) {
                failed += 1;
                return { keyword: row.keyword, points: [] as { date: string; rank: number | null }[] };
              }
              const points: { date: string; rank: number | null }[] = (json.data ?? []).map(
                (p: RankHistoryPoint) => ({ date: p.date, rank: p.position })
              );
              return { keyword: row.keyword, points };
            } catch {
              failed += 1;
              return { keyword: row.keyword, points: [] };
            }
          })
        );
        if (!cancelled) {
          setMultiSeries(results);
          setMultiFailed(failed);
          setMultiLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [filteredTracked, trendNonce]);

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
    if (scopedTracked.length === 0) { show(t("noKeywordsRefresh"), "info"); return; }
    // 防重复触发：refreshing 期间按钮已 disabled，这里二次兜底
    if (refreshing) return;
    setRefreshing(true);
    try {
      // P0：分批续请求，单次 HTTP 最多 20 个词，前端循环直到 hasMore=false
      // 项目范围内刷新：只消耗本项目关键词的额度，统计与表格保持同一范围
      const scopeQs = scopeDomain ? `&domain=${encodeURIComponent(scopeDomain)}` : "";
      let offset = 0;
      let totalSuccess = 0;
      let totalProcessed = 0;
      let hasMore = true;
      let lastUsage: UsageInfo | null = null;
      while (hasMore) {
        const res = await fetch(`/api/tracking/refresh?offset=${offset}${scopeQs}`, { method: "POST" });
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

  // ---- 排序（仅视图层：不改变任何排名计算或接口） ----
  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const rows = [...filteredTracked];
    rows.sort((a, b) => {
      if (sortKey === "rank") {
        const av = a.todayPosition;
        const bv = b.todayPosition;
        if (av === null && bv === null) return a.keyword.localeCompare(b.keyword);
        if (av === null) return 1; // 无数据永远排最后
        if (bv === null) return -1;
        return (av - bv) * dir;
      }
      if (sortKey === "change") {
        const av = a.change;
        const bv = b.change;
        if (av === null && bv === null) return a.keyword.localeCompare(b.keyword);
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av - bv) * dir;
      }
      const av = a.last_refreshed_at ?? "";
      const bv = b.last_refreshed_at ?? "";
      if (!av && !bv) return a.keyword.localeCompare(b.keyword);
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv) * dir;
    });
    return rows;
  }, [filteredTracked, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    // 位置默认最优在前（升序）；变化默认上升在前；最近更新默认最新在前
    setSortDir(key === "rank" || key === "change" ? (key === "rank" ? "asc" : "desc") : "desc");
  };
  const sortMark = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : "");

  const historyPoints = history.length;
  /** 真实历史逐条交给图表组件：量程、刻度密度、稀疏判定都在组件里做 */
  const trendPoints = history.map((h) => ({ date: h.date, rank: h.position }));
  /** 最近两次真实记录的变化（排名数字变小 = 上升） */
  const latestRecord = useMemo(() => {
    const withRank = history.filter((h) => h.position !== null);
    if (withRank.length === 0) return null;
    const last = withRank[withRank.length - 1];
    const prev = withRank.length > 1 ? withRank[withRank.length - 2] : null;
    return {
      date: last.date,
      position: last.position as number,
      url: last.url,
      delta: prev && prev.position !== null ? (prev.position as number) - (last.position as number) : null,
    };
  }, [history]);
  // 额度是账号级事实：按全部项目的关键词总数计算，绝不因项目范围而虚增可用额度。
  // null = /api/tracking 还没返回上限，此时不猜一个数字出来显示。
  const remaining = trackingLimit === null ? null : trackingLimit - tracked.length;
  const overBy = remaining !== null && remaining < 0 ? -remaining : 0;
  const slotsLeft = remaining !== null && remaining > 0 ? remaining : 0;

  const openUpgradeForQuota = () => {
    // 数字全部来自 /api/tracking 的真实返回：tracked.length 是账号总数，trackingLimit 是套餐上限
    triggerUpgradeModal({
      currentPlan,
      reason: t("quotaReached", { limit: trackingLimit ?? 0 }),
      keywordQuota: { total: tracked.length, limit: trackingLimit ?? 0 },
    });
  };

  const openAddModal = () => {
    if (remaining !== null && remaining <= 0) {
      openUpgradeForQuota();
      return;
    }
    // 项目范围内添加：目标域名默认就是当前项目，用户不必再选一次
    setAddDomain(scopeDomain ?? "");
    setAddModalOpen(true);
  };

  // ---- 范围展示派生值 ----
  const scopeProject = scopeDomain ? projects.find((p) => p.domain === scopeDomain) ?? null : null;
  const scopeName = scopeDomain
    ? scopeProject
      ? `${scopeProject.name} · ${scopeDomain}`
      : scopeDomain
    : t("scopeAllProjects");
  /** 本项目在其他「市场 · 设备」下的关键词：解释"此处为空"不等于"该项目没有关键词" */
  const scopeOtherMarkets: string[] = [];
  if (scopeDomain) {
    for (const row of scopedTracked) {
      if (row.location === country && row.device === device) continue;
      const label = `${display(row.location)} · ${deviceLabel(row.device)}`;
      if (!scopeOtherMarkets.includes(label)) scopeOtherMarkets.push(label);
    }
  }

  const changeHint = (value: number | null) =>
    value === null ? undefined : value > 0 ? t("changeHintUp", { n: value }) : value < 0 ? t("changeHintDown", { n: Math.abs(value) }) : t("changeHintFlat");

  const positionStateLabels = {
    staleLabel: t("notRefreshedToday"),
    noneLabel: t("noRankRecord"),
    unrankedLabel: t("notInTop100"),
  };

  /**
   * 排名分段分布：用**分段横条 + 图例**表达（不再使用环形图 / 圆形装饰）。
   * 颜色语义：Top3 绿（好）→ Top4-10 琥珀（需注意）→ Top11-100 墨绿（可分析）→ 未进前 100 中性灰（无数据）。
   */
  const rankSegments = [
    { key: "top3", label: t("statTop3"), value: stats.top3, color: RK_RANK_BUCKET.top3 },
    { key: "top10", label: t("statTop10"), value: stats.top10 - stats.top3, color: RK_RANK_BUCKET.top10 },
    { key: "top100", label: t("statTop100"), value: stats.ranked - stats.top10, color: RK_RANK_BUCKET.top100 },
    { key: "unranked", label: tch("notInTop100"), value: stats.total - stats.ranked, color: RK_RANK_BUCKET.unranked },
  ];

  /** 表格行操作（桌面与移动共用） */
  const rowActions = (row: TrackedKeyword, align: "end" | "start") => (
    <div className={`flex items-center gap-2 ${align === "end" ? "justify-end" : "justify-start"}`}>
      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setGroupMenuId(groupMenuId === row.id ? null : row.id); }}
          aria-haspopup="true"
          aria-expanded={groupMenuId === row.id}
          className="font-sans text-xs font-medium text-ink-60 hover:text-ink"
        >
          {t("addToGroupAction")}
        </button>
        {groupMenuId === row.id && (
          <div
            onClick={(e) => e.stopPropagation()}
            role="group"
            aria-label={t("addToGroup")}
            className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-line bg-card py-1"
          >
            <div className="px-3 py-2 text-xs text-ink-40">{groups.length === 0 ? t("noGroupsYet") : t("addToGroup")}</div>
            {groups.map((g) => {
              const inGroup = row.groups.some((rg) => rg.id === g.id);
              return (
                <button
                  key={g.id}
                  onClick={() => handleAddToGroup(g.id, row.id)}
                  disabled={inGroup}
                  className={`flex w-full items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-line-soft ${inGroup ? "cursor-default text-ink-40" : "text-ink"}`}
                >
                  <span>{g.name}</span>
                  {inGroup && <span className="text-xs text-pos">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
        className="font-sans text-xs font-medium text-ink-60 hover:text-neg"
      >
        {tc("delete")}
      </button>
    </div>
  );

  const rankCell = (row: TrackedKeyword, size: "sm" | "md" = "md") => (
    <RankPosition
      position={row.todayPosition}
      state={positionState(row, today)}
      {...positionStateLabels}
      className={size === "sm" ? "text-sm" : ""}
    />
  );
  const prevCell = (row: TrackedKeyword) =>
    row.yesterdayPosition === null ? (
      <span className="font-mono text-sm text-ink-40">{t("urlNone")}</span>
    ) : (
      <span className="font-mono text-sm text-ink-60">#{row.yesterdayPosition}</span>
    );
  const changeCell = (row: TrackedKeyword) =>
    row.change === null ? (
      <span className="font-mono text-sm text-ink-40">—</span>
    ) : (
      <ChangeBadge value={row.change} title={changeHint(row.change)} />
    );
  const urlCell = (row: TrackedKeyword) =>
    row.matchedUrl ? (
      <a
        href={row.matchedUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`block max-w-[20rem] truncate font-mono text-xs ${RK_LINK_CLASS}`}
        title={row.matchedUrl}
      >
        {row.matchedUrl.replace(/^https?:\/\//, "")}
      </a>
    ) : (
      <span className="font-sans text-xs text-ink-40">{t("urlNone")}</span>
    );
  const refreshCell = (row: TrackedKeyword) => (
    <span className="font-sans text-xs text-ink-40">
      {row.last_refreshed_at ? formatRelativeTime(row.last_refreshed_at, locale, tc) : t("neverRefreshed")}
    </span>
  );

  return (
    <div className="dash-container p-6 lg:p-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <button
              onClick={handleRefresh}
              disabled={refreshing || scopedTracked.length === 0}
              title={scopeDomain ? t("refreshScopeHint", { count: scopedTracked.length }) : undefined}
              className="btn-secondary disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 ${refreshing ? "loading-spin" : ""}`}>
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {refreshing ? t("refreshing") : t("refreshBtn")}
            </button>
            <button onClick={() => setCreateGroupModalOpen(true)} className="btn-secondary">
              <span className="text-base leading-none">+</span> {t("createGroupBtn")}
            </button>
            <button onClick={openAddModal} className="btn-primary">
              <span className="text-base leading-none">+</span> {t("addKeywordBtn")}
            </button>
          </>
        }
        meta={
          <>
            <span data-testid="position-scope-name">
              {t("scopeProjectLabel")}: {scopeName}
            </span>
            <span>·</span>
            <span>
              {t("scopeLabel")}: {display(country)} · {deviceLabel(device)}
              {groupFilter !== "all" ? ` · ${groupFilter === "ungrouped" ? t("ungrouped") : groups.find((g) => `group-${g.id}` === groupFilter)?.name ?? ""}` : ""}
            </span>
            <span>·</span>
            <span>
              {scopeDomain
                ? t("projectKeywordsCount", { count: formatNumber(scopedTracked.length, locale) })
                : t("accountKeywordsCount", { count: formatNumber(tracked.length, locale) })}
            </span>
            <span>·</span>
            <span>{snapshotLabel}</span>
            {usage && (
              <>
                <span>·</span>
                <span>
                  {t("serpapiMonthly", { used: formatNumber(usage.used, locale), limit: formatNumber(usage.limit, locale) })}
                </span>
                {usagePercent > 70 && <StatusBadge label={t("quotaTight")} tone="warn" dot={false} />}
              </>
            )}
          </>
        }
      />

      <OpportunityContextBanner />

      {/* 项目范围条：先回答"现在看的是哪个项目"，再给返回项目详情的入口 */}
      {scopeDomain && (
        <div className="mt-5 rounded-lg border border-line bg-paper px-4 py-3" data-testid="project-scope-banner">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-info">{t("scopeProjectLabel")}</span>
            <span className="font-sans text-sm font-medium text-ink">{scopeProject ? scopeProject.name : scopeDomain}</span>
            <span className="font-mono text-xs text-ink-60">{scopeDomain}</span>
            <span className="font-sans text-xs text-ink-40">{t("scopeBannerCount", { count: scopedTracked.length })}</span>
            {!scopeProject && (
              <StatusBadge label={t("scopeManualDomainBadge")} tone="warn" dot={false} />
            )}
            {scopeProject && (
              <Link
                href={`/app/projects/${scopeProject.id}`}
                className="ml-auto font-sans text-xs font-semibold text-brand hover:underline"
              >
                {t("scopeDetailLink")} →
              </Link>
            )}
          </div>
          <div className="mt-1 font-sans text-xs text-ink-40">{t("scopeBannerHint")}</div>
        </div>
      )}

      {/* 项目范围与筛选条 */}
      <div className={`flex flex-wrap items-center gap-3 ${scopeDomain ? "mt-4" : "mt-5"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="pt-scope-select" className="font-sans text-xs text-ink-40">{t("scopeProjectLabel")}</label>
          <select
            id="pt-scope-select"
            value={scopeDomain ?? ""}
            onChange={(e) => applyScope(e.target.value || null)}
            className="min-w-0 max-w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm text-ink focus:border-ink-25 focus:outline-none"
          >
            <option value="">{t("scopeAllProjects")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.domain}>{t("scopeProjectOption", { name: p.name, domain: p.domain })}</option>
            ))}
            {/* 手动域名（深链带来的非项目域名）必须能被选中显示，否则范围会看起来"消失" */}
            {scopeDomain && !scopeProject && (
              <option value={scopeDomain}>{t("scopeManualDomain", { domain: scopeDomain })}</option>
            )}
          </select>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="pt-region-select" className="font-sans text-xs text-ink-40">{t("region")}</label>
          <select id="pt-region-select" value={country} onChange={(e) => handleRegionChange(e.target.value)} className="min-w-0 max-w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
            {RANK_LOCATIONS.map((c) => (<option key={c} value={c}>{display(c)}</option>))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-sans text-xs text-ink-40">{t("device")}</span>
          <div className="flex gap-2" role="group" aria-label={t("device")}>
            {(["PC", "移动端"] as Device[]).map((d) => (
              <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} className={device === d ? "btn-primary" : "btn-secondary"}>{deviceLabel(d)}</button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="pt-group-select" className="font-sans text-xs text-ink-40">{t("group")}</label>
          <select id="pt-group-select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="min-w-0 max-w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
            <option value="all">{t("allGroups")}</option>
            <option value="ungrouped">{t("ungrouped")}</option>
            {groups.map((g) => (<option key={g.id} value={`group-${g.id}`}>{g.name}</option>))}
          </select>
        </div>
        <span className="ml-auto font-sans text-xs text-ink-40">{t("current", { scope: `${display(country)} · ${deviceLabel(device)}` })}</span>
      </div>

      {/* ===== 第一层：排名概览（≤4 项，全部按当前范围真实可算） ===== */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t("statTotal")}
          value={formatNumber(stats.total, locale)}
          caption={scopeDomain
            ? t("cardCaptionProject", { inScope: formatNumber(stats.total, locale), inProject: formatNumber(scopedTracked.length, locale) })
            : t("cardCaptionAccount", { inScope: formatNumber(stats.total, locale), account: formatNumber(tracked.length, locale) })}
          hint={t("metricTrackedHint")}
          hintStyle="plain"
        />
        <MetricCard
          label={t("metricRanked")}
          value={formatNumber(stats.ranked, locale)}
          caption={snapshotLabel}
          hint={t("metricRankedHint")}
          hintStyle="plain"
          tone={stats.ranked > 0 ? "pos" : undefined}
        />
        <MetricCard
          label={t("metricUp")}
          value={formatNumber(stats.up, locale)}
          caption={t("colChange")}
          hint={t("metricUpHint")}
          hintStyle="plain"
          tone={stats.up > 0 ? "pos" : undefined}
        />
        <MetricCard
          label={t("metricDown")}
          value={formatNumber(stats.down, locale)}
          caption={t("colChange")}
          hint={t("metricDownHint")}
          hintStyle="plain"
          tone={stats.down > 0 ? "neg" : undefined}
        />
      </div>

      {/* ===== 关键词额度：项目数 / 账号总数 / 套餐上限分列，不再用「24/3」这种容易被当成单个指标写法 ===== */}
      <div
        className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-line bg-paper px-3 py-2"
        data-testid="keyword-quota-row"
      >
        {scopeDomain && (
          <>
            <span className="font-sans text-xs text-ink-60">
              {t("projectKeywordsCount", { count: formatNumber(scopedTracked.length, locale) })}
            </span>
            <span className="font-sans text-xs text-ink-40">·</span>
          </>
        )}
        <span className="font-sans text-xs text-ink-60">
          {t("accountKeywordsCount", { count: formatNumber(tracked.length, locale) })}
        </span>
        {trackingLimit !== null && (
          <>
            <span className="font-sans text-xs text-ink-40">·</span>
            <span className="font-sans text-xs text-ink-60">
              {t("planKeywordsLimit", {
                plan: planLabel(currentPlan, locale),
                limit: formatNumber(trackingLimit, locale),
              })}
            </span>
            <span className="font-sans text-xs text-ink-40">{t("planKeywordsSharedHint")}</span>
            <span className="font-sans text-xs text-ink-40">·</span>
            {overBy > 0 ? (
              <>
                <StatusBadge label={t("keywordsOverLimit", { count: formatNumber(overBy, locale) })} tone="warn" dot={false} />
                <span className="font-sans text-xs text-ink-60">{t("keywordsOverLimitEffect")}</span>
                <button
                  onClick={openUpgradeForQuota}
                  className="ml-auto font-mono text-xs font-semibold text-brand hover:underline"
                >
                  {t("upgradePlanLink")} →
                </button>
              </>
            ) : (
              <span className="font-sans text-xs text-ink-60">
                {t("keywordsSlotsLeft", { count: formatNumber(slotsLeft, locale) })}
              </span>
            )}
          </>
        )}
      </div>

      {/* 今日未刷新：如实说明，而不是把"没记录"显示成"未进前 100" */}
      {staleToday && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
          <StatusBadge label={t("notRefreshedToday")} tone="warn" dot={false} />
          <span className="font-sans text-xs text-ink-60">
            {t("staleNotice", { date: (latestSnapshot ? dayOf(latestSnapshot) : null) ?? "" })}
          </span>
          <button onClick={handleRefresh} disabled={refreshing} className="ml-auto font-mono text-xs font-semibold text-brand hover:underline disabled:opacity-60">
            {t("refreshBtn")} →
          </button>
        </div>
      )}

      {/* ===== 第二层：排名趋势（只画当前项目范围内的关键词） ===== */}
      {scopedTracked.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <ChartFrame
            className="lg:col-span-4"
            title={t("chartDistribution")}
            subtitle={t("chartDistributionSub", { count: formatNumber(stats.total, locale) })}
            legend={rankSegments.map((s) => ({ label: s.label, tone: "neutral" as const, value: s.value, color: s.color }))}
            isEmpty={stats.total === 0}
            emptyTitle={tch("distributionEmpty")}
            emptyHint={tch("distributionEmptyHint")}
            showEmptyIcon={false}
            chartHeight={stats.total === 0 ? undefined : 236}
            chart={
              <div className="flex h-full flex-col justify-center gap-4">
                {/* 分段横条：宽度即占比，颜色即语义 */}
                <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-line-soft">
                  {rankSegments.map((s) =>
                    s.value > 0 ? (
                      <div
                        key={s.key}
                        style={{ width: `${(s.value / stats.total) * 100}%`, backgroundColor: s.color }}
                        title={`${s.label}: ${s.value}`}
                      />
                    ) : null
                  )}
                </div>
                <div className="space-y-2">
                  {rankSegments.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-2 font-mono text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 text-ink-60">
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
                        <span className="truncate">{s.label}</span>
                      </span>
                      <span className="shrink-0 text-ink">
                        {formatNumber(s.value, locale)}
                        <span className="text-ink-40">
                          {" "}
                          ({stats.total > 0 ? Math.round((s.value / stats.total) * 100) : 0}%)
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="border-t border-line-soft pt-2 font-mono text-xs text-ink-40">
                  {t("chartDistributionSub", { count: formatNumber(stats.total, locale) })}
                </p>
              </div>
            }
          />

          <ChartFrame
            className="lg:col-span-5"
            title={t("chartTrend")}
            subtitle={t("chartTrendSub")}
            isEmpty={!multiLoading && multiSeries.length === 0}
            emptyTitle={tch("multiRankEmpty")}
            emptyHint={tch("multiRankEmptyHint")}
            showEmptyIcon={false}
            chart={
              multiLoading ? (
                <div className="flex h-32 items-center justify-center font-sans text-xs text-ink-40">{tc("loading")}</div>
              ) : multiSeries.length > 0 && multiFailed === multiSeries.length ? (
                <LoadErrorState
                  onRetry={() => setTrendNonce((n) => n + 1)}
                  title={t("trendLoadErrorTitle")}
                  hint={t("trendLoadErrorHint")}
                />
              ) : (
                <>
                  <MultiRankTrend series={multiSeries} max={TREND_SERIES_MAX} />
                  {multiFailed > 0 && (
                    <p className="mt-1 font-sans text-xs text-neg">
                      {t("partialHistoryFailed", { count: multiFailed })}{" "}
                      <button onClick={() => setTrendNonce((n) => n + 1)} className="underline">
                        {t("loadErrorRetry")}
                      </button>
                    </p>
                  )}
                </>
              )
            }
          />

          <ChartFrame
            className="lg:col-span-3"
            title={t("chartChanges")}
            subtitle={t("chartChangesSub", { up: formatNumber(stats.up, locale), down: formatNumber(stats.down, locale) })}
            legend={[
              { label: t("legendImproved"), tone: "neutral" as const, value: stats.up, color: RK.up },
              { label: t("legendDeclined"), tone: "neutral" as const, value: stats.down, color: RK.down },
            ]}
            isEmpty={stats.up === 0 && stats.down === 0}
            emptyTitle={tch("rankChangeEmpty")}
            emptyHint={tch("rankChangeEmptyHint")}
            showEmptyIcon={false}
            chartHeight={stats.up === 0 && stats.down === 0 ? undefined : 236}
            chart={<RankChangeBars up={stats.up} down={stats.down} />}
          />
        </div>
      )}

      {/* 单关键词排名趋势（真实历史；排名数字越小越靠前） */}
      {selectedKeyword && (
        <ChartFrame
          className="mt-4"
          title={t("trendTitle")}
          subtitle={
            <>
              {selectedKeyword.keyword} · {selectedKeyword.domain} · {t("trendRange", { days: TREND_DAYS })}
              {historyPoints > 0 ? ` · ${historyPoints} ${tch("itemsUnit")}` : ""}
            </>
          }
          right={
            latestRecord ? (
              <span className="flex items-center gap-2">
                <span className="font-mono text-xl font-semibold text-ink">#{latestRecord.position}</span>
                {latestRecord.delta === null ? (
                  <span className="font-sans text-xs text-ink-40">{t("needTwoDays")}</span>
                ) : (
                  <ChangeBadge value={latestRecord.delta} title={changeHint(latestRecord.delta)} />
                )}
              </span>
            ) : (
              <span className="font-sans text-xs text-ink-40">{t("noRankRecord")}</span>
            )
          }
          legend={
            historyPoints > SPARSE_TREND_MAX
              ? [
                  { label: t("legendRankLine"), tone: "neutral" as const, color: RK.accent },
                  { label: t("legendImproved"), tone: "neutral" as const, color: RK.up },
                  { label: t("legendDeclined"), tone: "neutral" as const, color: RK.down },
                ]
              : undefined
          }
          isEmpty={!historyLoading && !historyError && historyPoints === 0}
          emptyTitle={t("noHistory")}
          emptyHint={t("mobileTrendHint")}
          showEmptyIcon={false}
          chart={
            historyLoading ? (
              <div className="flex h-32 items-center justify-center font-sans text-xs text-ink-40">
                {t("loadingHistory")}
              </div>
            ) : historyError ? (
              <LoadErrorState
                onRetry={() => {
                  historyFetchRef.current = null;
                  if (selectedId !== null) void loadHistory(selectedId);
                }}
                title={t("trendLoadErrorTitle")}
                hint={t("trendLoadErrorHint")}
              />
            ) : (
              <RankTrendChart points={trendPoints} />
            )
          }
        />
      )}

      {/* ===== 第三层：关键词数据表 ===== */}
      <section className="card-a mt-4 p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-ink">{t("tableTitle")}</h3>
            <p className="mt-0.5 font-sans text-xs text-ink-40">{snapshotLabel}</p>
          </div>
          <span className="font-sans text-xs text-ink-40">
            {groupFilter === "all"
              ? scopeDomain
                ? t("tableCountProject", { shown: filteredTracked.length, inProject: scopedTracked.length })
                : t("tableCountAccount", { shown: filteredTracked.length, account: tracked.length })
              : t("tableCountFiltered", { shown: filteredTracked.length, total: scopedTracked.length })}
          </span>
        </header>

        <div className="mt-4">
          {listLoading ? (
            <TableSkeleton rows={4} />
          ) : loadError ? (
            <LoadErrorState onRetry={() => void loadList()} />
          ) : scopedTracked.length === 0 ? (
            scopeDomain ? (
              <ProjectEmptyState
                projectName={scopeProject ? scopeProject.name : scopeDomain}
                domain={scopeDomain}
                onAdd={openAddModal}
              />
            ) : (
              <EmptyState onAdd={openAddModal} />
            )
          ) : sortedRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-4 py-12 text-center font-sans text-xs text-ink-40">
              <div>{groupFilter === "all" ? t("noKeywordsInScope") : t("noKeywordsInGroup")}</div>
              {scopeOtherMarkets.length > 0 && (
                <div className="mt-1">{t("otherMarketHint", { markets: scopeOtherMarkets.join(" / ") })}</div>
              )}
            </div>
          ) : (
            <>
              {/* 桌面端：数据表格（外层 overflow-x-auto 兜底，小屏横向滚动而非撑破页面） */}
              <div className="hidden overflow-x-auto md:block">
                <DataTable minWidthRem={56} ariaLabel={t("tableTitle")}>
                  <THead>
                    <Th>{t("keyword")}</Th>
                    <Th align="right" width="7rem">
                      <button
                        onClick={() => toggleSort("rank")}
                        title={`${t("sortLabel")}: ${t("sortRank")}`}
                        className="font-mono text-xs uppercase tracking-wide text-ink-40 hover:text-ink"
                      >
                        {t("colTodayRank")} {sortMark("rank")}
                      </button>
                    </Th>
                    <Th align="right" width="6rem">{t("colPrevRank")}</Th>
                    <Th align="right" width="6.5rem">
                      <button
                        onClick={() => toggleSort("change")}
                        title={`${t("sortLabel")}: ${t("sortChange")}`}
                        className="font-mono text-xs uppercase tracking-wide text-ink-40 hover:text-ink"
                      >
                        {t("colChange")} {sortMark("change")}
                      </button>
                    </Th>
                    <Th width="20%">{t("colUrl")}</Th>
                    <Th width="9rem">
                      <button
                        onClick={() => toggleSort("refresh")}
                        title={`${t("sortLabel")}: ${t("sortRefresh")}`}
                        className="font-mono text-xs uppercase tracking-wide text-ink-40 hover:text-ink"
                      >
                        {t("colLastRefresh")} {sortMark("refresh")}
                      </button>
                    </Th>
                    <Th align="right" width="8rem">{t("colActions")}</Th>
                  </THead>
                  <TBody>
                    {sortedRows.map((row) => (
                      <TR
                        key={row.id}
                        onClick={() => setSelectedId(row.id)}
                        className={selectedId === row.id ? "bg-line-soft/50" : ""}
                      >
                        <TD>
                          <div className="font-sans text-sm font-medium text-ink">{row.keyword}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink-40">
                            <span>{row.domain}</span>
                            {row.groups.map((g) => (
                              <span key={g.id} className="inline-flex items-center gap-1 rounded-sm border border-line bg-line-soft px-1.5 py-0.5 font-mono text-xs text-ink-60">
                                {g.name}
                                <button onClick={(e) => handleRemoveFromGroup(g.id, row.id, e)} className="text-ink-40 hover:text-neg" title={t("removeFromGroup")}>×</button>
                              </span>
                            ))}
                          </div>
                        </TD>
                        <TD align="right">{rankCell(row)}</TD>
                        <TD align="right">{prevCell(row)}</TD>
                        <TD align="right">{changeCell(row)}</TD>
                        <TD>{urlCell(row)}</TD>
                        <TD>{refreshCell(row)}</TD>
                        <TD align="right">{rowActions(row, "end")}</TD>
                      </TR>
                    ))}
                  </TBody>
                </DataTable>
              </div>

              {/* 移动端：紧凑卡片（不横向溢出） */}
              <div className="md:hidden">
                {sortedRows.map((row) => (
                  <div key={row.id} className="border-b border-line-soft py-3 last:border-b-0">
                    <button onClick={() => setSelectedId(row.id)} className="flex w-full flex-col gap-1.5 text-left">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-sans text-sm font-medium text-ink">{row.keyword}</span>
                        <span className="flex items-center gap-2">
                          {rankCell(row, "sm")}
                          {changeCell(row)}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-40">
                        <span>{row.domain}</span>
                        <span>
                          {t("colPrevRank")}: {row.yesterdayPosition === null ? t("urlNone") : `#${row.yesterdayPosition}`}
                        </span>
                        <span>{refreshCell(row)}</span>
                      </span>
                      {row.matchedUrl && <span className={`truncate font-mono text-xs ${RK_LINK_CLASS}`}>{row.matchedUrl.replace(/^https?:\/\//, "")}</span>}
                      {row.groups.length > 0 && (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {row.groups.map((g) => (
                            <span key={g.id} className="inline-flex items-center gap-1 rounded-sm border border-line bg-line-soft px-1.5 py-0.5 font-mono text-xs text-ink-60">
                              {g.name}
                              <button onClick={(e) => handleRemoveFromGroup(g.id, row.id, e)} className="text-ink-40 hover:text-neg">×</button>
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                    <div className="mt-2">{rowActions(row, "start")}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* 添加追踪关键词模态框 */}
      <Modal
        open={addModalOpen}
        onClose={() => { setAddModalOpen(false); setAddKeyword(""); }}
        title={trackingLimit === null ? t("addModalTitlePlain") : t("addModalTitle", { count: slotsLeft })}
        footer={
          <>
            <button onClick={() => { setAddModalOpen(false); setAddKeyword(""); }} className="btn-secondary">{tc("cancel")}</button>
            <button type="submit" form="add-keyword-form" disabled={adding || (remaining !== null && remaining <= 0)} className="btn-primary disabled:opacity-60">{adding ? t("adding") : t("addSubmit")}</button>
          </>
        }
      >
        <form id="add-keyword-form" onSubmit={handleAdd} className="space-y-4">
          <div>
            <label htmlFor="pt-add-keyword" className="text-xs text-ink-40">{t("keyword")}</label>
            <input type="text" id="pt-add-keyword" value={addKeyword} onChange={(e) => setAddKeyword(e.target.value)} required placeholder={t("keywordPlaceholder")} className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-ink-40">{t("targetDomain")}</label>
            <DomainSelect value={addDomain} onChange={setAddDomain} placeholder={t("domainPlaceholder")} className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none" />
            {/* 选了别的项目的域名：如实说明它不会出现在当前项目范围内，避免"添加成功但列表看不到" */}
            {scopeDomain && addDomain && addDomain !== scopeDomain && (
              <p className="mt-1 font-sans text-xs text-warn">{t("addDomainOutsideScope", { domain: addDomain })}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pt-add-region" className="text-xs text-ink-40">{t("region")}</label>
              <select id="pt-add-region" value={country} onChange={(e) => handleRegionChange(e.target.value)} className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
                {RANK_LOCATIONS.map((c) => (<option key={c} value={c}>{display(c)}</option>))}
              </select>
            </div>
            <div>
              <label htmlFor="pt-add-device" className="text-xs text-ink-40">{t("device")}</label>
              <select id="pt-add-device" value={device} onChange={(e) => setDevice(e.target.value as Device)} className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink focus:border-ink-25 focus:outline-none">
                <option value="PC">PC</option>
                <option value="移动端">{t("deviceMobile")}</option>
              </select>
            </div>
          </div>
          {trackingLimit !== null && (
            <p className="text-xs text-ink-40">{t("addModalHint", { limit: trackingLimit, plan: planLabel(currentPlan, locale) })}</p>
          )}
        </form>
      </Modal>

      <Modal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title={t("confirmDelete")}
        footer={
          <>
            <button onClick={() => setDeleteId(null)} className="btn-secondary">{tc("cancel")}</button>
            <button onClick={() => { if (deleteId) handleDelete(deleteId); setDeleteId(null); }} className="rounded-md bg-neg px-4 py-2 text-sm font-semibold text-card transition-opacity hover:opacity-90">{t("confirmDelete")}</button>
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
            <label htmlFor="pt-group-name" className="text-xs text-ink-40">{t("groupName")}</label>
            <input type="text" id="pt-group-name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} required maxLength={50} placeholder={t("groupNamePlaceholder")} className="mt-2 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="pt-group-desc" className="text-xs text-ink-40">{t("groupDesc")}</label>
            <textarea id="pt-group-desc" value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)} rows={3} maxLength={200} placeholder={t("groupDescPlaceholder")} className="mt-2 w-full resize-none rounded-md border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none" />
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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line py-14 text-center">
      <div className="font-mono text-xs uppercase tracking-wide text-ink-40">
        {t("tableTitle")}
      </div>
      <div className="mt-2 font-sans text-sm font-medium text-ink">{t("emptyTitle")}</div>
      <div className="mt-1 font-sans text-xs text-ink-60">{t("emptyHint")}</div>
      <button onClick={onAdd} className="btn-primary mt-4">{t("emptyAddBtn")}</button>
    </div>
  );
}

/** 当前项目还没有关键词：范围仍是本项目，给出直接添加入口，不冒充"账号里没有数据" */
function ProjectEmptyState({
  projectName,
  domain,
  onAdd,
}: {
  projectName: string;
  domain: string;
  onAdd: () => void;
}) {
  const t = useTranslations("dashboard.positionTracking");
  return (
    <div
      data-testid="project-empty-state"
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-4 py-14 text-center"
    >
      <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("scopeProjectLabel")}</div>
      <div className="mt-2 font-sans text-sm font-medium text-ink">{t("projectEmptyTitle")}</div>
      <div className="mt-1 font-mono text-xs text-ink-60">{projectName} · {domain}</div>
      <div className="mt-1 max-w-md font-sans text-xs text-ink-40">{t("projectEmptyHint")}</div>
      <button onClick={onAdd} className="btn-primary mt-4">{t("projectEmptyAddBtn")}</button>
    </div>
  );
}

/** 请求失败 / 数据暂不可用：与"该项目 0 个关键词"是两件不同的事实 */
function LoadErrorState({ onRetry, title, hint }: { onRetry: () => void; title?: string; hint?: string }) {
  const t = useTranslations("dashboard.positionTracking");
  return (
    <div
      data-testid="load-error-state"
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-4 py-14 text-center"
    >
      <div className="font-sans text-sm font-medium text-ink">{title ?? t("loadErrorTitle")}</div>
      <div className="mt-1 max-w-md font-sans text-xs text-ink-40">{hint ?? t("loadErrorHint")}</div>
      <button onClick={onRetry} className="btn-secondary mt-4">{t("loadErrorRetry")}</button>
    </div>
  );
}
