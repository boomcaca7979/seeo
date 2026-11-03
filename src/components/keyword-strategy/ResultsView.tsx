// ===== 结果页：真实策略数据（创建中 / 部分失败 / 就绪）=====
// 这里不生成任何数据：所有主题、关键词、指标都来自 strategy.doc（服务端真实生成）。
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Book,
  Chat,
  ChevronDown,
  ChevronUp,
  Question,
  Share,
  AddKeywords,
} from "./icons";
import { OutlineButton, SolidButton } from "./ui";
import { StatTiles, TopicalOverviewCard } from "./TopicalOverview";
import { FilterBar, StrategyTable, filterKeywords, type TableFilter } from "./StrategyTable";
import {
  buildContentBrief,
  scoreTopics,
  type ContentBrief,
  type SavedBrief,
  type SavedBriefMap,
  type StrategyDoc,
  type TileId,
} from "@/lib/seo/strategy-model";
import { Dialog, FiltersDialog, ShareDialog, AddKeywordsDialog, BriefDialog, TrackingDialog, type FiltersValue, type TrackingResult } from "./dialogs";
import { CompareSerpDialog, PriorityStrip, SerpIntelPanel } from "./SerpIntel";
import { buildStrategyCsv, downloadCsv } from "./export";

export interface StrategyViewData {
  id: number;
  name: string;
  seeds: string[];
  market: string;
  device: string;
  status: "running" | "ready" | "partial" | "failed";
  progress: number;
  keywordCount: number;
  createdAt: string;
  updatedAt: string;
  doc: StrategyDoc;
  favorites: string[];
  /** 已保存的 Content Brief（按 topicId） */
  briefs?: SavedBriefMap;
  /** Strategy Priority 用户覆盖（topicId → level） */
  priorityOverrides?: Record<string, "recommended" | "review" | "low">;
  shareToken: string | null;
  /** 用户手动追加的种子（Add keywords） */
  addedSeeds?: string[];
  error: string | null;
}

function useMainScrolled(threshold: number) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = document.querySelector("main");
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > threshold);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

export function ResultsView({
  strategy,
  onChanged,
  onNotify,
}: {
  strategy: StrategyViewData;
  onChanged: (next: StrategyViewData) => void;
  onNotify: (message: string, kind?: "info" | "error") => void;
}) {
  const [view, setView] = useState<"topics" | "pages" | "table" | "intel">("topics");
  const [filter, setFilter] = useState<TableFilter>({
    q: "",
    intent: "",
    origin: "",
    role: "",
    favoritesOnly: false,
    topicIds: null,
  });
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(strategy.favorites));
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [activeTile, setActiveTile] = useState<TileId | null>(null);
  const [seedMenu, setSeedMenu] = useState(false);
  const [activeSeed, setActiveSeed] = useState(strategy.seeds[0] ?? "");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [brief, setBrief] = useState<ContentBrief | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(strategy.name);
  const scrolled = useMainScrolled(320);
  const favoritesDirty = useRef<string | null>(null);
  // onNotify 由父组件传入，可能每次渲染都是新函数；收藏保存的防抖不能依赖它的身份，
  // 否则 400ms 定时器会被 cleanup 清掉，导致收藏根本没写库（2026-11-02 实测）。
  const notifyRef = useRef(onNotify);
  useEffect(() => {
    notifyRef.current = onNotify;
  }, [onNotify]);

  const doc = strategy.doc;
  const tiles = useMemo(() => scoreTopics(doc), [doc]);
  const hasVolume = doc.meta.metrics.volume === "provider";

  const applyFilter = useCallback((patch: Partial<TableFilter>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
  }, []);

  const visibleKeywords = useMemo(() => {
    const withTile: TableFilter = {
      ...filter,
      topicIds: activeTile ? tiles.find((t) => t.id === activeTile)?.topicIds ?? [] : filter.topicIds,
    };
    return filterKeywords(doc, withTile, favorites);
  }, [doc, filter, favorites, activeTile, tiles]);

  // 收藏持久化（防抖 400ms，失败不阻塞 UI）
  useEffect(() => {
    const list = [...favorites].sort();
    const payload = JSON.stringify(list);
    if (favoritesDirty.current === null) {
      favoritesDirty.current = payload;
      return;
    }
    if (favoritesDirty.current === payload) return;
    favoritesDirty.current = payload;
    const timer = setTimeout(async () => {
      try {
        await fetch(`/api/keywords/strategies/${strategy.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ favorites: list }),
        });
      } catch {
        notifyRef.current("收藏状态保存失败，请稍后重试", "error");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [favorites, strategy.id]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSelect = useCallback((id: string, on: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const exportCsv = useCallback(
    (rowsOnly?: "selection") => {
      const source =
        rowsOnly === "selection"
          ? doc.keywords.filter((k) => selection.has(k.id))
          : visibleKeywords;
      if (source.length === 0) {
        onNotify("没有可导出的关键词", "info");
        return;
      }
      const csv = buildStrategyCsv(doc, source, {
        name: strategy.name,
        market: strategy.market,
        device: strategy.device,
        collectedAt: doc.meta.fetchedAt,
      });
      downloadCsv(csv, `keyword-strategy-${strategy.id}.csv`);
    },
    [doc, visibleKeywords, selection, strategy, onNotify]
  );

  const openBrief = useCallback(
    (topicId: string) => {
      const next = buildContentBrief(doc, topicId);
      if (!next) {
        onNotify("该主题暂无可用数据", "error");
        return;
      }
      setBrief(next);
      setBriefOpen(true);
    },
    [doc, onNotify]
  );

  const saveBrief = useCallback(
    async (markdown: string, generatedAt: string) => {
      const topicId = brief?.topicId;
      if (!topicId) throw new Error("缺少主题，无法保存");
      const res = await fetch(`/api/keywords/strategies/${strategy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: { topicId, markdown, generatedAt } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "保存失败，请稍后重试");
      const saved = json.data?.brief as SavedBrief | null;
      if (saved) {
        onChanged({ ...strategy, briefs: { ...(strategy.briefs ?? {}), [saved.topicId]: saved } });
      }
      onNotify("Content Brief 已保存");
    },
    [brief, strategy, onChanged, onNotify]
  );

  const shareAction = useCallback(
    async (method: "POST" | "DELETE") => {
      setShareBusy(true);
      try {
        const res = await fetch(`/api/keywords/strategies/${strategy.id}/share`, { method });
        const json = await res.json();
        if (!res.ok) {
          onNotify(json.error ?? "分享操作失败", "error");
          return;
        }
        onChanged({ ...strategy, shareToken: json.data.url ? json.data.url.split("/").pop() : null });
        onNotify(method === "POST" ? "分享链接已创建（只读）" : "分享已撤销，旧链接失效");
      } catch {
        onNotify("分享操作失败", "error");
      } finally {
        setShareBusy(false);
      }
    },
    [strategy, onChanged, onNotify]
  );

  const addKeywords = useCallback(
    async (seeds: string[]) => {
      setAddBusy(true);
      setAddError(null);
      try {
        const res = await fetch(`/api/keywords/strategies/${strategy.id}/keywords`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seeds }),
        });
        const json = await res.json();
        if (!res.ok) {
          setAddError(json.error ?? "添加失败");
          return;
        }
        setAddOpen(false);
        onNotify("已开始扩词，完成后自动更新结果");
        onChanged({ ...strategy, status: "running", progress: 5 });
      } catch {
        setAddError("添加失败，请稍后重试");
      } finally {
        setAddBusy(false);
      }
    },
    [strategy, onChanged, onNotify]
  );

  const rename = useCallback(async () => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      const res = await fetch(`/api/keywords/strategies/${strategy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error ?? "重命名失败", "error");
        return;
      }
      onChanged({ ...strategy, name });
      setRenameOpen(false);
      onNotify("名称已更新");
    } catch {
      onNotify("重命名失败", "error");
    }
  }, [renameValue, strategy, onChanged, onNotify]);

  const trackTargets = useMemo(
    () => (selection.size > 0 ? doc.keywords.filter((k) => selection.has(k.id)) : visibleKeywords),
    [selection, doc.keywords, visibleKeywords]
  );

  const shareUrl = strategy.shareToken ? `/share/keyword-strategy/${strategy.shareToken}` : null;
  const running = strategy.status === "running";
  const failedSeeds = doc.meta.failedSeeds;

  return (
    <div className="pb-10">
      <div className="px-6 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[0.8125rem] text-[#4b4d4a]">
            <Link href="/app" className="text-[#245ee2] hover:underline">
              工作台
            </Link>
            <span className="text-[#9a9c99]">›</span>
            <span>关键词研究</span>
            <span className="text-[#9a9c99]">›</span>
            <span>关键词策略构造器</span>
          </nav>
          <div className="flex items-center gap-5">
            <Link href="/docs" className="flex items-center gap-1.5 text-[0.8125rem] text-[#245ee2] hover:underline">
              <Book className="h-4 w-4" />
              User manual
            </Link>
            <Link href="/contact" className="flex items-center gap-1.5 text-[0.8125rem] text-[#245ee2] hover:underline">
              <Chat className="h-4 w-4" />
              Send feedback
            </Link>
          </div>
        </div>

        <Link
          href="/app/keyword-strategy/list"
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-sm border border-[#d6d8d7] bg-white px-2 text-[0.8125rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
        >
          <span aria-hidden="true">←</span>
          Go to all lists
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <h1 className="flex flex-wrap items-baseline gap-x-2 text-[1.375rem] leading-[30px] font-semibold text-[#1a1e19]">
            <span>Keyword Strategy Builder:</span>
            <span className="relative inline-flex items-center">
              <button
                type="button"
                onClick={() => setSeedMenu((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={seedMenu}
                className="inline-flex items-center gap-1 text-[1.375rem] leading-[30px] font-semibold text-[#245ee2] hover:underline"
              >
                {activeSeed || strategy.seeds[0] || "strategy"}
                <ChevronDown className="mt-1 h-4 w-4" />
              </button>
              {seedMenu && (
                <>
                  <button
                    type="button"
                    aria-label="Close seed menu"
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setSeedMenu(false)}
                  />
                  <ul
                    role="listbox"
                    className="absolute top-full left-0 z-20 mt-1 min-w-[220px] rounded-md border border-[#e3e4e3] bg-white py-1 shadow-[0_6px_20px_rgba(26,30,25,0.14)]"
                  >
                    {strategy.seeds.map((seed) => (
                      <li key={seed}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={seed === activeSeed}
                          onClick={() => {
                            setActiveSeed(seed);
                            setSeedMenu(false);
                          }}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[0.8125rem] hover:bg-[#f4f5f5] ${
                            seed === activeSeed ? "font-medium text-[#1a1e19]" : "text-[#4b4d4a]"
                          }`}
                        >
                          <span className="truncate">{seed}</span>
                          {seed === activeSeed && <span className="text-[#8796ef]">✓</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </span>
          </h1>

          <div className="flex items-center gap-2">
            <OutlineButton onClick={() => setShareOpen(true)} disabled={running || !strategy.doc.keywords.length}>
              <Share className="h-4 w-4" />
              Share
            </OutlineButton>
            <OutlineButton onClick={() => setAddOpen(true)} disabled={running}>
              <AddKeywords className="h-4 w-4" />
              Add keywords
            </OutlineButton>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-[0.8125rem] text-[#4b4d4a]">
          <span>
            <span className="text-[#1a1e19]">Database:</span> {strategy.market} · {strategy.device}
          </span>
          <span>
            <span className="text-[#1a1e19]">Volume / KD:</span>{" "}
            {hasVolume ? "SerpApi + DataForSEO" : "不可用（未配置 DataForSEO 额度）"}
          </span>
          <span>
            <span className="text-[#1a1e19]">Seed keywords:</span> {strategy.seeds.length}
            {(strategy.addedSeeds?.length ?? 0) > 0 && (
              <span className="text-[#6b6c6b]"> + {strategy.addedSeeds!.length} 手动追加</span>
            )}
          </span>
          <span>
            <span className="text-[#1a1e19]">Keywords:</span> {doc.keywords.length}
          </span>
          <span className="flex items-center gap-1">
            <span className="text-[#1a1e19]">策略:</span>
            <span className="max-w-[220px] truncate" title={strategy.name}>
              {strategy.name}
            </span>
            <button type="button" onClick={() => setRenameOpen(true)} className="text-[#245ee2] hover:underline">
              重命名
            </button>
          </span>
        </div>

        {(running || strategy.status === "partial" || strategy.status === "failed") && (
          <div
            className={`mt-3 rounded-md border px-4 py-3 ${
              strategy.status === "failed"
                ? "border-[#f3c9c4] bg-[#fdf3f2]"
                : strategy.status === "partial"
                  ? "border-[#f5dfb7] bg-[#fdf8ef]"
                  : "border-[#dcdcf6] bg-[#f5f4ff]"
            }`}
          >
            {running ? (
              <div className="flex flex-wrap items-center gap-3 text-[0.8125rem] text-[#4b4d4a]">
                <span className="font-medium text-[#1a1e19]">正在生成真实策略…</span>
                <span className="h-1.5 w-40 overflow-hidden rounded-full bg-[#e3e4e3]">
                  <span
                    className="block h-full rounded-full bg-[#8796ef] transition-all"
                    style={{ width: `${Math.max(5, strategy.progress)}%` }}
                  />
                </span>
                <span className="tabular-nums">{strategy.progress}%</span>
                <span className="text-[0.75rem] text-[#6b6c6b]">页面可以停留，刷新后会自动恢复进度。</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-[0.8125rem] text-[#4b4d4a]">
                <span className="font-medium text-[#1a1e19]">
                  {strategy.status === "failed" ? "生成失败" : "部分种子失败"}
                </span>
                <span className="min-w-0">
                  {strategy.error
                    ? strategy.error
                    : `失败种子：${failedSeeds.join("、") || "—"}（其它种子的真实结果已保留）`}
                </span>
                {failedSeeds.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await fetch(`/api/keywords/strategies/${strategy.id}/retry`, { method: "POST" });
                      const json = await res.json();
                      if (!res.ok) onNotify(json.error ?? "重试失败", "error");
                      else {
                        onNotify("已开始重试失败种子");
                        onChanged({ ...strategy, status: "running", progress: 5 });
                      }
                    }}
                    className="rounded-sm border border-[#d6d8d7] bg-white px-2 py-1 text-[0.75rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
                  >
                    重试失败种子
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {doc.meta.warnings.length > 0 && (
          <details className="mt-2 rounded-md border border-[#e9eae9] bg-white px-3 py-2 text-[0.75rem] leading-[18px] text-[#6b6c6b]">
            <summary className="cursor-pointer text-[0.8125rem] text-[#4b4d4a]">
              数据说明（{doc.meta.warnings.length}）
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {doc.meta.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
              <li>{doc.meta.method.clustering}</li>
              <li>{doc.meta.method.pillar}</li>
              <li>
                采集时间：{doc.meta.fetchedAt ? new Date(doc.meta.fetchedAt).toLocaleString() : "—"} · 来源：
                {doc.meta.sources.join(" / ")}
              </li>
            </ul>
          </details>
        )}

        <div className="mt-4 flex items-end gap-6 border-b border-[#dfe1e0]">
          {(
            [
              { id: "topics" as const, label: "Topics and pages" },
              { id: "pages" as const, label: "Pages" },
              { id: "table" as const, label: "Table" },
              { id: "intel" as const, label: "SERP Intel" },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              aria-selected={view === t.id}
              role="tab"
              className={`relative -mb-px pb-3 text-[0.875rem] leading-[20px] ${
                view === t.id ? "font-semibold text-[#1a1e19]" : "text-[#4b4d4a] hover:text-[#1a1e19]"
              }`}
            >
              {t.label}
              {view === t.id && <span className="absolute inset-x-0 bottom-0 border-b-[3px] border-[#8796ef]" />}
            </button>
          ))}
        </div>

        <div className="mt-2">
          {view === "intel" ? (
            <SerpIntelPanel doc={doc} onNotify={onNotify} />
          ) : (
            <>
              <PriorityStrip
                doc={doc}
                overrides={strategy.priorityOverrides ?? {}}
                onSaveOverride={(topicId, level) => {
                  void (async () => {
                    try {
                      const res = await fetch(`/api/keywords/strategies/${strategy.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ priorityOverride: { topicId, level } }),
                      });
                      const json = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        onNotify(json.error ?? "优先级保存失败", "error");
                        return;
                      }
                      onChanged({
                        ...strategy,
                        priorityOverrides: {
                          ...(strategy.priorityOverrides ?? {}),
                          ...(level ? { [topicId]: level } : { [topicId]: undefined as never }),
                        },
                      });
                      onNotify(level ? "优先级已保存（手动覆盖）" : "已恢复自动优先级");
                    } catch {
                      onNotify("优先级保存失败，请稍后重试", "error");
                    }
                  })();
                }}
              />
              <TopicalOverviewCard
                topics={doc.topics}
                keywordCount={doc.keywords.length}
                hasVolume={hasVolume}
                onExport={() => exportCsv()}
                onHelp={() => onNotify(`${doc.meta.method.clustering} ${doc.meta.method.pillar}`, "info")}
              />
              <StatTiles tiles={tiles} active={activeTile} onSelect={setActiveTile} />
            </>
          )}

          <div className="mt-px">
            <FilterBar
              filter={filter}
              onFilter={applyFilter}
              onExport={() => exportCsv()}
              onAddFilters={() => setFiltersOpen(true)}
              onActions={() => setActionsOpen(true)}
              selectionCount={selection.size}
              onBatchFavorite={() => {
                const ids = [...selection];
                setFavorites((prev) => new Set([...prev, ...ids]));
                onNotify(`已收藏 ${ids.length} 个关键词`);
              }}
              onBatchTrack={() => setTrackingOpen(true)}
              onBatchExport={() => exportCsv("selection")}
              onClearSelection={() => setSelection(new Set())}
              onCompareSerp={() => setCompareOpen(true)}
              seeds={strategy.seeds}
              showFavoritesOnly
            />
          </div>

          {view !== "intel" ? (
            <div className="-mx-6 overflow-x-auto px-6 xl:mx-0 xl:overflow-visible xl:px-0">
              <div className="min-w-[980px] xl:min-w-0">
                <StrategyTable
                  doc={doc}
                  view={view}
                  keywords={visibleKeywords}
                  favorites={favorites}
                  selection={selection}
                  onToggleFavorite={toggleFavorite}
                  onSelect={onSelect}
                  onGenerate={openBrief}
                  onExport={() => exportCsv()}
                />
              </div>
            </div>
          ) : null}

          <p className="mt-3 text-[0.75rem] leading-[18px] text-[#8a8c89]">
            共 {doc.keywords.length} 个真实关键词 · {doc.topics.length} 个主题 · 当前筛选 {visibleKeywords.length} 个 ·
            指标来源 {doc.meta.sources.join(" / ")}
            {hasVolume ? "" : "（搜索量 / KD 未提供，显示为 —）"}
          </p>
        </div>
      </div>

      <div className="fixed right-6 bottom-6 z-30 flex flex-col items-center gap-3">
        {scrolled && (
          <button
            type="button"
            aria-label="Back to top"
            onClick={() => document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d6d8d7] bg-[#e9ebe9] text-[#4b4d4a] shadow-[0_2px_6px_rgba(26,30,25,0.16)] hover:bg-[#dfe2e0]"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label="Help"
          onClick={() => onNotify("数据来自 SerpApi 真实 SERP；Volume/KD 需 DataForSEO 额度。", "info")}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[#c290ff] text-white shadow-[0_2px_8px_rgba(26,30,25,0.2)] hover:bg-[#b57bf7]"
        >
          <Question className="h-5 w-5" />
        </button>
      </div>

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        url={shareUrl}
        busy={shareBusy}
        onCreate={() => shareAction("POST")}
        onRevoke={() => shareAction("DELETE")}
      />

      <AddKeywordsDialog
        key={`add-${addOpen}`}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={addKeywords}
        busy={addBusy}
        error={addError}
      />

      <FiltersDialog
        key={`filters-${filtersOpen}`}
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        topics={doc.topics}
        value={{ topics: filter.topicIds ?? [], role: filter.role, favoritesOnly: filter.favoritesOnly }}
        onApply={(v: FiltersValue) =>
          applyFilter({
            topicIds: v.topics.length > 0 ? v.topics : null,
            role: v.role,
            favoritesOnly: v.favoritesOnly,
          })
        }
        onReset={() => {
          applyFilter({ topicIds: null, role: "", favoritesOnly: false });
          setActiveTile(null);
        }}
      />

      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="重命名策略"
        footer={
          <>
            <OutlineButton onClick={() => setRenameOpen(false)}>取消</OutlineButton>
            <SolidButton onClick={rename} disabled={!renameValue.trim()}>
              保存
            </SolidButton>
          </>
        }
      >
        <label className="block text-[0.8125rem] font-medium text-[#1a1e19]" htmlFor="rename-input">
          策略名称
        </label>
        <input
          id="rename-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          className="mt-1 h-9 w-full rounded-sm border border-[#d6d8d7] px-3 text-[0.875rem] text-[#1a1e19] outline-none focus:border-[#8796ef]"
        />
      </Dialog>

      <Dialog
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title="Actions"
        footer={<OutlineButton onClick={() => setActionsOpen(false)}>关闭</OutlineButton>}
      >
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setFavorites((prev) => new Set([...prev, ...visibleKeywords.map((k) => k.id)]));
              setActionsOpen(false);
            }}
            className="block w-full rounded-sm border border-[#d6d8d7] px-3 py-2 text-left text-[0.8125rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
          >
            收藏当前筛选的 {visibleKeywords.length} 个关键词
          </button>
          <button
            type="button"
            onClick={() => {
              setFavorites((prev) => {
                const next = new Set(prev);
                for (const k of visibleKeywords) next.delete(k.id);
                return next;
              });
              setActionsOpen(false);
            }}
            className="block w-full rounded-sm border border-[#d6d8d7] px-3 py-2 text-left text-[0.8125rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
          >
            取消收藏当前筛选的关键词
          </button>
          <button
            type="button"
            onClick={() => {
              setActionsOpen(false);
              setTrackingOpen(true);
            }}
            className="block w-full rounded-sm border border-[#d6d8d7] px-3 py-2 text-left text-[0.8125rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
          >
            加入关键词追踪（{selection.size > 0 ? `${selection.size} 个已选` : `${visibleKeywords.length} 个当前筛选`}）
          </button>
          <button
            type="button"
            onClick={() => {
              exportCsv();
              setActionsOpen(false);
            }}
            className="block w-full rounded-sm border border-[#d6d8d7] px-3 py-2 text-left text-[0.8125rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
          >
            导出当前筛选结果（CSV）
          </button>
          <button
            type="button"
            onClick={() => {
              setFilter({ q: "", intent: "", origin: "", role: "", favoritesOnly: false, topicIds: null });
              setActiveTile(null);
              setActionsOpen(false);
            }}
            className="block w-full rounded-sm border border-[#d6d8d7] px-3 py-2 text-left text-[0.8125rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
          >
            清空所有筛选
          </button>
        </div>
      </Dialog>

      <TrackingDialog
        key={`track-${trackingOpen}-${selection.size}`}
        open={trackingOpen}
        onClose={() => setTrackingOpen(false)}
        keywords={trackTargets.map((k) => k.keyword)}
        market={strategy.market}
        device={strategy.device}
        onDone={(r: TrackingResult) => {
          const parts = [`新增 ${r.added}`];
          if (r.duplicated > 0) parts.push(`已存在 ${r.duplicated}`);
          if (r.failed > 0) parts.push(`失败 ${r.failed}`);
          if (r.skipped > 0) parts.push(`未尝试 ${r.skipped}`);
          const bad = r.failed > 0 || r.skipped > 0 || r.limitReached;
          const reason = r.message ? `——${r.message.slice(0, 120)}` : "";
          onNotify(`关键词追踪：${parts.join(" · ")}${bad ? reason : ""}`, bad ? "error" : "info");
          if (r.added > 0) setSelection(new Set());
        }}
      />

      <CompareSerpDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        strategyId={strategy.id}
        selectedKeywords={[...selection]}
      />

      <BriefDialog
        key={`brief-${brief?.topicId ?? "none"}`}
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
        brief={brief}
        saved={brief ? strategy.briefs?.[brief.topicId] ?? null : null}
        onSave={saveBrief}
      />

    </div>
  );
}
