"use client";

// ===== Keyword Strategy Builder（关键词策略构造器）=====
//
// 工作流程：
//   ① 种子词研究（/api/keywords/expand）→ 主题聚类（clusterKeywords）/ 意图分类（detectIntent）
//   ② 浏览主题与关键词，按主题或按意图组织视图
//   ③ 勾选关键词 → 创建策略分组（复用 /api/keywords/groups 持久化）
//      分组成员必须是已追踪关键词 → 创建时自动批量加入追踪（/api/tracking，本地 DB）
//   ④ 管理已有策略：查看成员、移除成员、删除分组
//
// 不新建数据系统：分组/追踪全部复用既有表与 API。

import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/dashboard/Toast";
import { handleBillingError } from "@/lib/billing-error-client";
import { detectIntent, type KeywordIntent } from "@/lib/seo/keyword-intent";
import { clusterKeywords } from "@/lib/seo/keyword-cluster";
import type { KeywordOrigin } from "@/lib/seo/keyword-merge";
import { normalizeKeywordForDedup } from "@/lib/seo/keyword-merge";
import { useActiveProjectOptional } from "@/components/dashboard/ActiveProjectContext";
import { RK_LINK_CLASS } from "@/components/viz/rank-theme";
import { StatusBadge } from "@/components/viz/StatusBadge";
import {
  KeywordSearchHero,
  IntentBadge,
} from "@/components/keywords/shared";

interface ExpandMetricsKeyword {
  keyword: string;
  origin: KeywordOrigin;
  origins: KeywordOrigin[];
}

interface ExpandData {
  seed: string;
  related: string[];
  paa: string[];
  location: string;
  device: string;
  fromCache: boolean;
  metrics?: { keywords?: ExpandMetricsKeyword[] } | null;
}

interface KeywordGroupWithCount {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  keywordCount: number;
}

interface TrackedRow {
  id: number;
  keyword: string;
  location: string;
  device: string;
  domain: string;
}

const INTENT_ORDER: KeywordIntent[] = ["信息型", "商业型", "交易型", "导航型", "未知"];

export default function KeywordStrategyPage() {
  return (
    <Suspense fallback={null}>
      <KeywordStrategyInner />
    </Suspense>
  );
}

function KeywordStrategyInner() {
  const t = useTranslations("dashboard.keywords.strategy");
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

  // 组织视图：按主题 / 按意图
  const [viewMode, setViewMode] = useState<"topic" | "intent">("topic");
  const [openClusters, setOpenClusters] = useState<Set<string>>(new Set());

  // 选择与创建
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [strategyName, setStrategyName] = useState("");
  const [strategyDesc, setStrategyDesc] = useState("");
  const [busy, setBusy] = useState(false);

  // 已有策略
  const [groups, setGroups] = useState<KeywordGroupWithCount[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);
  const [groupMembers, setGroupMembers] = useState<Record<number, TrackedRow[]>>({});

  // ===== 关键词池 =====
  const allKeywords = useMemo<string[]>(() => {
    if (!expand) return [];
    const seen = new Set<string>();
    const list: string[] = [];
    const add = (kw: string) => {
      const norm = normalizeKeywordForDedup(kw);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      list.push(kw);
    };
    for (const k of expand.metrics?.keywords ?? []) add(k.keyword);
    for (const r of expand.related) add(r);
    for (const p of expand.paa) add(p);
    return list;
  }, [expand]);

  const clusters = useMemo(
    () => (expand ? clusterKeywords(allKeywords).filter((c) => c.id !== "__other__") : []),
    [expand, allKeywords]
  );

  const otherCluster = useMemo(
    () => (expand ? clusterKeywords(allKeywords).find((c) => c.id === "__other__") : undefined),
    [expand, allKeywords]
  );

  const intentGroups = useMemo(() => {
    const map = new Map<KeywordIntent, string[]>();
    for (const kw of allKeywords) {
      const intent = detectIntent(kw);
      map.set(intent, [...(map.get(intent) ?? []), kw]);
    }
    return INTENT_ORDER.filter((i) => map.has(i)).map((i) => ({ intent: i, keywords: map.get(i)! }));
  }, [allKeywords]);

  // ===== 研究种子词 =====
  const runAnalysis = async (kw: string, loc: string, dev: "PC" | "移动端") => {
    if (!kw.trim()) {
      show(t("errKeyword"), "error");
      return;
    }
    setPhase("loading");
    setErrorMsg(null);
    setExpand(null);
    setSelected(new Set());
    setStrategyName("");
    setStrategyDesc("");
    setOpenClusters(new Set());
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

  // ===== 已有策略列表 =====
  useEffect(() => {
    let alive = true;
    fetch("/api/keywords/groups")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (alive) setGroups(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setGroupsLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const openGroupMembers = async (groupId: number) => {
    if (openGroupId === groupId) {
      setOpenGroupId(null);
      return;
    }
    setOpenGroupId(groupId);
    if (groupMembers[groupId]) return;
    try {
      const res = await fetch(`/api/keywords/groups/${groupId}/members`);
      const json = await res.json();
      if (res.ok) {
        setGroupMembers((prev) => ({ ...prev, [groupId]: Array.isArray(json?.data) ? json.data : [] }));
      }
    } catch {
      // 成员加载失败保持空
    }
  };

  const removeMember = async (groupId: number, keywordId: number) => {
    try {
      const res = await fetch(`/api/keywords/groups/${groupId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: keywordId }),
      });
      if (!res.ok) {
        show(t("memberRemoveFailed"), "error");
        return;
      }
      setGroupMembers((prev) => ({
        ...prev,
        [groupId]: (prev[groupId] ?? []).filter((m) => m.id !== keywordId),
      }));
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, keywordCount: Math.max(0, g.keywordCount - 1) } : g))
      );
      show(t("memberRemoved"), "success");
    } catch {
      show(t("memberRemoveFailed"), "error");
    }
  };

  const deleteGroup = async (groupId: number) => {
    if (!window.confirm(t("groupDeleteConfirm"))) return;
    try {
      const res = await fetch(`/api/keywords/groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) {
        show(t("groupDeleteFailed"), "error");
        return;
      }
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      if (openGroupId === groupId) setOpenGroupId(null);
      show(t("groupDeleted"), "success");
    } catch {
      show(t("groupDeleteFailed"), "error");
    }
  };

  // ===== 创建策略分组：批量追踪 + 建组 + 关联成员 =====
  const createStrategy = async () => {
    if (busy || selected.size === 0) return;
    const targetDomain = activeProject?.activeDomain?.trim();
    if (!targetDomain) {
      show(t("selectProjectFirst"), "error");
      return;
    }
    const name = strategyName.trim();
    if (!name) {
      show(t("nameRequired"), "error");
      return;
    }
    setBusy(true);
    try {
      // 1) 确保追踪（已追踪跳过；套餐触顶即停）
      let tracked: TrackedRow[] = [];
      const trackRes = await fetch(`/api/tracking?domain=${encodeURIComponent(targetDomain)}`);
      if (trackRes.ok) {
        const json = await trackRes.json();
        tracked = (Array.isArray(json?.data) ? json.data : []) as TrackedRow[];
      }
      const trackedMap = new Map(tracked.map((r) => [r.keyword, r.id]));
      let planLimitHit = false;
      let trackedDirty = false;
      for (const keyword of selected) {
        if (trackedMap.has(keyword)) continue;
        const res = await fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword, location, device, domain: targetDomain }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          if (
            json?.code === "KEYWORD_LIMIT_REACHED" ||
            json?.code === "PLAN_LIMIT_EXCEEDED" ||
            json?.code === "PLAN_LIMIT_REACHED"
          ) {
            planLimitHit = true;
            break;
          }
          continue;
        }
        trackedDirty = true;
      }
      // 全部追踪完成后一次性刷新 id 索引（避免逐词全量重拉）
      if (trackedDirty) {
        const listRes = await fetch(`/api/tracking?domain=${encodeURIComponent(targetDomain)}`);
        if (listRes.ok) {
          const listJson = await listRes.json();
          const newList = (Array.isArray(listJson?.data) ? listJson.data : []) as TrackedRow[];
          tracked = newList;
          trackedMap.clear();
          for (const r of newList) trackedMap.set(r.keyword, r.id);
        }
      }
      if (planLimitHit) {
        show(t("planLimitHit"), "error");
        setBusy(false);
        return;
      }
      // 2) 建组
      const createRes = await fetch("/api/keywords/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: strategyDesc.trim() || undefined }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok) {
        const { message } = handleBillingError(createJson, t("groupCreateFailed"));
        show(message, "error");
        setBusy(false);
        return;
      }
      const groupId = createJson.data.id as number;
      // 3) 关联成员
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
      // 4) 刷新已有策略列表
      const listRes = await fetch("/api/keywords/groups");
      if (listRes.ok) {
        const listJson = await listRes.json();
        setGroups(Array.isArray(listJson?.data) ? listJson.data : []);
      }
      setBusy(false);
      setSelected(new Set());
      setStrategyName("");
      setStrategyDesc("");
      show(
        missing === 0
          ? t("strategyCreated", { joined })
          : t("strategyCreatedPartial", { joined, missing }),
        "success"
      );
    } catch (err) {
      setBusy(false);
      show(`${tc("networkError")}${(err as Error).message}`, "error");
    }
  };

  const toggleCluster = (id: string) => {
    setOpenClusters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleKeyword = (kw: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const selectClusterAll = (kws: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const kw of kws) next.add(kw);
      return next;
    });
  };

  const fmt = (n: number) => new Intl.NumberFormat(zh ? "zh-CN" : "en-US").format(n);

  return (
    <div className="dash-container p-6 lg:p-8">
      <Toast />

      {/* ===== 状态 A：未开始 ===== */}
      {phase === "idle" && (
        <div className="py-10 sm:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <div className="font-mono text-xs uppercase tracking-wide text-ink-40">{t("badgeLabel")}</div>
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{t("heroTitle")}</h1>
            <p className="mx-auto mt-3 max-w-xl font-sans text-sm text-ink-60">{t("heroSubtitle")}</p>
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
          <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { title: t("step1Title"), desc: t("step1Desc") },
              { title: t("step2Title"), desc: t("step2Desc") },
              { title: t("step3Title"), desc: t("step3Desc") },
            ].map((f, i) => (
              <div key={f.title} className="card-a p-4">
                <div className="font-mono text-xs text-ink-40">{`0${i + 1}`}</div>
                <div className="mt-1 font-sans text-sm font-semibold text-ink">{f.title}</div>
                <p className="mt-1 font-sans text-xs text-ink-40">{f.desc}</p>
              </div>
            ))}
          </div>

          {/* 已有策略（空状态也有明确入口） */}
          <div className="mx-auto mt-10 max-w-3xl">
            <ExistingGroupsSection
              groups={groups}
              groupsLoaded={groupsLoaded}
              openGroupId={openGroupId}
              groupMembers={groupMembers}
              onOpen={openGroupMembers}
              onRemoveMember={removeMember}
              onDelete={deleteGroup}
              t={t}
              zh={zh}
              linkClass={RK_LINK_CLASS}
            />
          </div>
        </div>
      )}

      {/* ===== 加载中 ===== */}
      {phase === "loading" && (
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

      {/* ===== 工作台 ===== */}
      {(phase === "done" || phase === "error") && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
                {expand ? `${t("resultTitle")}${expand.seed}` : t("heroTitle")}
              </h1>
              {expand && (
                <p className="mt-0.5 font-sans text-xs text-ink-40">
                  {`${expand.location} · ${expand.device === "移动端" ? (zh ? "移动端" : "Mobile") : "PC"}${expand.fromCache ? ` · ${t("cachedTag")}` : ""}`}
                </p>
              )}
            </div>
          </div>
          <form onSubmit={handleHeroSubmit} className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="h-10 flex-1 rounded-md border border-line bg-card px-4 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label={ts("marketLabel")} className="h-10 rounded-md border border-line bg-card px-3 text-sm text-ink focus:border-ink-25 focus:outline-none">
                {["中国", "美国", "英国", "日本", "香港", "台湾"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select value={device} onChange={(e) => setDevice(e.target.value as "PC" | "移动端")} aria-label={ts("deviceLabel")} className="h-10 rounded-md border border-line bg-card px-3 text-sm text-ink focus:border-ink-25 focus:outline-none">
                <option value="PC">PC</option>
                <option value="移动端">{zh ? "移动端" : "Mobile"}</option>
              </select>
              <button type="submit" className="btn-primary h-10 px-6 text-sm">
                {t("analyze")}
              </button>
            </div>
          </form>

          {phase === "error" && errorMsg && (
            <div className="mt-5 card-a p-5"><span className="font-sans text-sm text-neg">{errorMsg}</span></div>
          )}

          {expand && (
            <>
              {/* 视图切换 + 已选统计 */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <div className="flex rounded-md border border-line p-0.5" role="tablist" aria-label={t("viewModeLabel")}>
                  {(
                    [
                      { key: "topic" as const, label: t("viewByTopic") },
                      { key: "intent" as const, label: t("viewByIntent") },
                    ]
                  ).map((v) => (
                    <button
                      key={v.key}
                      role="tab"
                      aria-selected={viewMode === v.key}
                      onClick={() => setViewMode(v.key)}
                      className={`rounded px-3 py-1.5 font-sans text-sm transition-colors ${
                        viewMode === v.key ? "bg-ink font-semibold text-white" : "font-medium text-ink-60 hover:text-ink"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <span className="font-sans text-xs text-ink-40">
                  {t("poolSummary", { total: fmt(allKeywords.length), selected: fmt(selected.size) })}
                </span>
              </div>

              {/* 主题视图 */}
              {viewMode === "topic" && (
                <div className="mt-4 space-y-3">
                  {clusters.length === 0 && !otherCluster && (
                    <p className="card-a p-5 font-sans text-sm text-ink-40">{t("noClusters")}</p>
                  )}
                  {clusters.map((c) => {
                    const open = openClusters.has(c.id);
                    const intentMix = new Map<KeywordIntent, number>();
                    for (const kw of c.keywords) {
                      const it = detectIntent(kw);
                      intentMix.set(it, (intentMix.get(it) ?? 0) + 1);
                    }
                    return (
                      <div key={c.id} className="card-a p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleCluster(c.id)}
                            aria-expanded={open}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <svg viewBox="0 0 24 24" fill="none" className={`h-3.5 w-3.5 flex-shrink-0 text-ink-40 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">
                              <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="truncate font-sans text-base font-semibold text-ink">{c.label}</span>
                          </button>
                          <span className="font-mono text-xs text-ink-40">{fmt(c.keywords.length)}</span>
                          <span className="hidden gap-1 sm:flex">
                            {INTENT_ORDER.filter((i) => intentMix.has(i)).map((i) => (
                              <IntentBadge key={i} intent={i} />
                            ))}
                          </span>
                          <button type="button" onClick={() => selectClusterAll(c.keywords)} className="rounded-md border border-line px-2 py-1 font-sans text-xs text-ink-60 hover:bg-line-soft">
                            {t("selectClusterAll")}
                          </button>
                        </div>
                        {open && (
                          <ul className="mt-3 space-y-2 border-l border-line pl-4">
                            {c.keywords.map((kw) => (
                              <li key={kw} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={selected.has(kw)}
                                  onChange={() => toggleKeyword(kw)}
                                  aria-label={kw}
                                  className="h-4 w-4 accent-black"
                                />
                                <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink">{kw}</span>
                                <IntentBadge intent={detectIntent(kw)} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  {otherCluster && otherCluster.keywords.length > 0 && (
                    <div className="card-a p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCluster(otherCluster.id)}
                          aria-expanded={openClusters.has(otherCluster.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <svg viewBox="0 0 24 24" fill="none" className={`h-3.5 w-3.5 flex-shrink-0 text-ink-40 transition-transform ${openClusters.has(otherCluster.id) ? "rotate-90" : ""}`} aria-hidden="true">
                            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className="truncate font-sans text-base font-semibold text-ink-60">{t("otherCluster")}</span>
                        </button>
                        <span className="font-mono text-xs text-ink-40">{fmt(otherCluster.keywords.length)}</span>
                      </div>
                      {openClusters.has(otherCluster.id) && (
                        <ul className="mt-3 space-y-2 border-l border-line pl-4">
                          {otherCluster.keywords.map((kw) => (
                            <li key={kw} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selected.has(kw)}
                                onChange={() => toggleKeyword(kw)}
                                aria-label={kw}
                                className="h-4 w-4 accent-black"
                              />
                              <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink">{kw}</span>
                              <IntentBadge intent={detectIntent(kw)} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 意图视图 */}
              {viewMode === "intent" && (
                <div className="mt-4 space-y-3">
                  {intentGroups.length === 0 && (
                    <p className="card-a p-5 font-sans text-sm text-ink-40">{t("noClusters")}</p>
                  )}
                  {intentGroups.map((g) => (
                    <div key={g.intent} className="card-a p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <IntentBadge intent={g.intent} />
                        <span className="font-sans text-sm text-ink-40">
                          {t("intentCount", { count: fmt(g.keywords.length) })}
                        </span>
                        <button type="button" onClick={() => selectClusterAll(g.keywords)} className="ml-auto rounded-md border border-line px-2 py-1 font-sans text-xs text-ink-60 hover:bg-line-soft">
                          {t("selectClusterAll")}
                        </button>
                      </div>
                      <ul className="mt-3 space-y-2 border-l border-line pl-4">
                        {g.keywords.map((kw) => (
                          <li key={kw} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected.has(kw)}
                              onChange={() => toggleKeyword(kw)}
                              aria-label={kw}
                              className="h-4 w-4 accent-black"
                            />
                            <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink">{kw}</span>
                            <IntentBadge intent={detectIntent(kw)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {/* 创建策略（选中后显示） */}
              {selected.size > 0 && (
                <div className="sticky bottom-4 z-20 mt-4 rounded-md border border-line bg-card p-4 shadow-lg">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <div className="flex-1">
                      <div className="font-sans text-sm font-semibold text-ink">
                        {t("selectedCount", { count: fmt(selected.size) })}
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          type="text"
                          value={strategyName}
                          onChange={(e) => setStrategyName(e.target.value)}
                          placeholder={t("namePlaceholder")}
                          aria-label={t("namePlaceholder")}
                          className="h-9 rounded-md border border-line bg-card px-3 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={strategyDesc}
                          onChange={(e) => setStrategyDesc(e.target.value)}
                          placeholder={t("descPlaceholder")}
                          aria-label={t("descPlaceholder")}
                          className="h-9 rounded-md border border-line bg-card px-3 text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setSelected(new Set())} className="btn-secondary h-9 px-3 text-sm">
                        {t("clearSelected")}
                      </button>
                      <button type="button" onClick={createStrategy} disabled={busy} className="btn-primary h-9 px-4 text-sm disabled:opacity-60">
                        {busy ? tc("processing") : t("createStrategy")}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 font-sans text-xs text-ink-40">{t("createNote", { domain: activeProject?.activeDomain ?? "" })}</p>
                </div>
              )}

              {/* 已有策略 */}
              <div className="mt-6">
                <h3 className="font-display text-lg font-semibold text-ink">{t("existingTitle")}</h3>
                <div className="mt-3">
                  <ExistingGroupsSection
                    groups={groups}
                    groupsLoaded={groupsLoaded}
                    openGroupId={openGroupId}
                    groupMembers={groupMembers}
                    onOpen={openGroupMembers}
                    onRemoveMember={removeMember}
                    onDelete={deleteGroup}
                    t={t}
                    zh={zh}
                    linkClass={RK_LINK_CLASS}
                  />
                </div>
              </div>

              <p className="mt-4 font-sans text-xs text-ink-40">{t("honestyNote")}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ===== 已有策略分组（复用区块：空态/列表/成员管理）=====
function ExistingGroupsSection({
  groups,
  groupsLoaded,
  openGroupId,
  groupMembers,
  onOpen,
  onRemoveMember,
  onDelete,
  t,
  zh,
  linkClass,
}: {
  groups: KeywordGroupWithCount[];
  groupsLoaded: boolean;
  openGroupId: number | null;
  groupMembers: Record<number, TrackedRow[]>;
  onOpen: (id: number) => void;
  onRemoveMember: (groupId: number, keywordId: number) => void;
  onDelete: (id: number) => void;
  t: ReturnType<typeof useTranslations>;
  zh: boolean;
  linkClass: string;
}) {
  if (!groupsLoaded) {
    return <p className="font-sans text-xs text-ink-40">{t("loadingGroups")}</p>;
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line py-8 text-center">
        <div className="font-sans text-sm font-medium text-ink">{t("noGroupsTitle")}</div>
        <p className="mt-1 font-sans text-xs text-ink-40">{t("noGroupsHint")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id} className="card-a p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onOpen(g.id)} aria-expanded={openGroupId === g.id} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <svg viewBox="0 0 24 24" fill="none" className={`h-3.5 w-3.5 flex-shrink-0 text-ink-40 transition-transform ${openGroupId === g.id ? "rotate-90" : ""}`} aria-hidden="true">
                <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="truncate font-sans text-base font-semibold text-ink">{g.name}</span>
            </button>
            <span className="font-mono text-xs text-ink-40">{t("memberCount", { count: g.keywordCount })}</span>
            <StatusBadge label={new Date(g.created_at).toLocaleDateString(zh ? "zh-CN" : "en-US")} tone="neutral" dot={false} />
            <button type="button" onClick={() => onDelete(g.id)} className="rounded-md border border-line px-2 py-1 font-sans text-xs text-neg hover:bg-line-soft">
              {t("deleteGroup")}
            </button>
          </div>
          {g.description && <p className="mt-1 font-sans text-xs text-ink-40">{g.description}</p>}
          {openGroupId === g.id && (
            <ul className="mt-3 space-y-2 border-l border-line pl-4">
              {(groupMembers[g.id] ?? []).length === 0 ? (
                <li className="font-sans text-xs text-ink-40">{t("membersLoading")}</li>
              ) : (
                (groupMembers[g.id] ?? []).map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink">{m.keyword}</span>
                    <span className="font-mono text-xs text-ink-40">{`${m.location} · ${m.device}`}</span>
                    <a href={`/app/keyword-overview?keyword=${encodeURIComponent(m.keyword)}`} className={`font-sans text-xs hover:underline ${linkClass}`}>
                      {t("openOverview")}
                    </a>
                    <button
                      type="button"
                      onClick={() => onRemoveMember(g.id, m.id)}
                      className="rounded border border-line px-1.5 py-0.5 font-sans text-xs text-ink-60 hover:bg-line-soft"
                    >
                      {t("removeMember")}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
