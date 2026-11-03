// ===== 策略结果表格：Topics / Pages / Table 三个视图共享同一份真实策略数据 =====
// 三种视图只是同一份 doc 的不同投影，切换不会改数据、更不会重新生成。
"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Star,
  SortIcon,
  LinkIcon,
  Chat,
  CartIcon,
  ListLines,
  VideoIcon,
  MessageSquare,
  Download,
  Sliders,
} from "./icons";
import { IntentBar, KdValue, LinkButton, OutlineButton, SolidButton } from "./ui";
import {
  formatKd,
  formatVolume,
  type StrategyDoc,
  type StrategyKeyword,
  type StrategyPage,
  type StrategyTopic,
} from "@/lib/seo/strategy-model";

const ROW_GRID = "grid grid-cols-[40px_32px_minmax(0,1fr)_101px_104px_64px_72px_132px] items-center gap-2 px-4";
const SUB_GRID = "grid grid-cols-[24px_24px_minmax(0,1fr)_101px_104px_64px_72px_132px] items-center gap-2 px-4";
const FLAT_GRID = "grid grid-cols-[32px_minmax(0,1fr)_150px_101px_104px_64px_72px_120px] items-center gap-2 px-4";
const PAGE_GRID = "grid grid-cols-[32px_minmax(0,1fr)_150px_101px_104px_64px_72px_120px] items-center gap-2 px-4";

const SERP_ICONS: Record<string, React.ReactNode> = {
  site_links: <LinkIcon className="h-4 w-4" />,
  reviews: <Star className="h-4 w-4" />,
  video: <VideoIcon className="h-4 w-4" />,
  people_also_ask: <Chat className="h-4 w-4" />,
  popular_products: <CartIcon className="h-4 w-4" />,
  related_searches: <ListLines className="h-4 w-4" />,
  discussions_and_forums: <MessageSquare className="h-4 w-4" />,
};

export interface TableFilter {
  q: string;
  intent: string;
  origin: string;
  role: string;
  favoritesOnly: boolean;
  topicIds: string[] | null;
}

export function filterKeywords(doc: StrategyDoc, filter: TableFilter, favorites: Set<string>): StrategyKeyword[] {
  const q = filter.q.trim().toLowerCase();
  return doc.keywords.filter((k) => {
    if (q && !k.keyword.toLowerCase().includes(q)) return false;
    if (filter.intent && k.intent !== filter.intent) return false;
    if (filter.origin && !k.seeds.includes(filter.origin.toLowerCase())) return false;
    if (filter.role === "pillar" && k.role !== "pillar") return false;
    if (filter.role === "subpage" && k.role !== "subpage") return false;
    if (filter.role === "ungrouped" && k.role !== "unassigned") return false;
    if (filter.favoritesOnly && !favorites.has(k.id)) return false;
    if (filter.topicIds && !filter.topicIds.includes(k.topicId)) return false;
    return true;
  });
}

function StarButton({
  id,
  active,
  onToggle,
}: {
  id: string;
  active: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      aria-label={active ? `Remove ${id} from favorites` : `Add ${id} to favorites`}
      aria-pressed={active}
      className={`shrink-0 ${active ? "text-[#ffb020]" : "text-[#c9cbc9] hover:text-[#ffb020]"}`}
    >
      <Star filled={active} className="h-4 w-4" />
    </button>
  );
}


export function FilterBar({
  filter,
  onFilter,
  onExport,
  onAddFilters,
  onActions,
  selectionCount,
  onBatchFavorite,
  onBatchTrack,
  onBatchExport,
  onClearSelection,
  onCompareSerp,
  seeds,
  showFavoritesOnly,
}: {
  filter: TableFilter;
  onFilter: (patch: Partial<TableFilter>) => void;
  onExport: () => void;
  onAddFilters: () => void;
  onActions: () => void;
  selectionCount: number;
  onBatchFavorite: () => void;
  onBatchTrack: () => void;
  onBatchExport: () => void;
  onClearSelection: () => void;
  /** 选中 2–5 个词时出现：SERP Overlap 比较（缺快照需用户确认后才会发请求） */
  onCompareSerp?: () => void;
  seeds: string[];
  showFavoritesOnly: boolean;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-4 px-3">
      <div className="flex h-6 w-[220px] max-w-full items-center overflow-hidden rounded-sm border border-[#d6d8d7] bg-white">
        <input
          value={filter.q}
          onChange={(e) => onFilter({ q: e.target.value })}
          placeholder="Filter by page or keyword"
          aria-label="Filter by page or keyword"
          className="h-full min-w-0 flex-1 px-2 text-[0.8125rem] text-[#1a1e19] outline-none placeholder:text-[#8a8c89]"
        />
        <button
          type="button"
          aria-label="Search"
          onClick={(e) => (e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement | null)?.focus()}
          className="flex h-full w-7 items-center justify-center border-l border-[#e3e4e3] text-[#4b4d4a]"
        >
          <span className="text-[0.75rem]">⌕</span>
        </button>
      </div>

      <select
        value={filter.intent}
        onChange={(e) => onFilter({ intent: e.target.value })}
        aria-label="Filter by intent"
        className="h-6 rounded-sm border border-[#d6d8d7] bg-white px-1 text-[0.8125rem] text-[#1a1e19]"
      >
        <option value="">All intents</option>
        <option value="信息型">信息型</option>
        <option value="商业型">商业型</option>
        <option value="交易型">交易型</option>
        <option value="导航型">导航型</option>
        <option value="未知">未知</option>
      </select>

      <select
        value={filter.origin}
        onChange={(e) => onFilter({ origin: e.target.value })}
        aria-label="Filter by seed"
        className="h-6 rounded-sm border border-[#d6d8d7] bg-white px-1 text-[0.8125rem] text-[#1a1e19]"
      >
        <option value="">All seeds</option>
        {seeds.map((s) => (
          <option key={s} value={s.toLowerCase()}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={filter.role}
        onChange={(e) => onFilter({ role: e.target.value })}
        aria-label="Filter by page role"
        className="h-6 rounded-sm border border-[#d6d8d7] bg-white px-1 text-[0.8125rem] text-[#1a1e19]"
      >
        <option value="">Pillar + Subpages</option>
        <option value="pillar">Pillar only</option>
        <option value="subpage">Subpages only</option>
        <option value="ungrouped">Ungrouped only</option>
      </select>

      <button type="button" onClick={onAddFilters} className="text-[0.8125rem] font-medium text-[#245ee2] hover:underline">
        + Add filters
      </button>

      {showFavoritesOnly && (
        <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-[#1a1e19]">
          <input
            type="checkbox"
            checked={filter.favoritesOnly}
            onChange={(e) => onFilter({ favoritesOnly: e.target.checked })}
            className="h-4 w-4 accent-[#191c19]"
          />
          Show favorites only
        </label>
      )}

      {selectionCount > 0 && (
        <span className="flex items-center gap-2 text-[0.8125rem] text-[#1a1e19]">
          {selectionCount} selected
          <button type="button" onClick={onBatchFavorite} className="text-[#245ee2] hover:underline">
            Favorite
          </button>
          <button type="button" onClick={onBatchTrack} className="text-[#245ee2] hover:underline">
            Track
          </button>
          <button type="button" onClick={onBatchExport} className="text-[#245ee2] hover:underline">
            Export selected
          </button>
          {selectionCount >= 2 && selectionCount <= 5 && onCompareSerp ? (
            <button type="button" onClick={onCompareSerp} className="text-[#245ee2] hover:underline">
              Compare SERP
            </button>
          ) : null}
          <button type="button" onClick={onClearSelection} className="text-[#6b6c6b] hover:underline">
            Clear
          </button>
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <OutlineButton compact onClick={onExport}>
          <Download className="h-3.5 w-3.5" />
          Export
        </OutlineButton>
        <OutlineButton compact onClick={onActions}>
          <Sliders className="h-3.5 w-3.5" />
          Actions
        </OutlineButton>
      </div>
    </div>
  );
}

function ColumnHeader() {
  return (
    <div className={`${ROW_GRID} h-10 border-b border-[#e9eae9] text-[0.8125rem] text-[#6b6c6b]`}>
      <span />
      <span />
      <span>Pillar page</span>
      <span className="text-right">Keywords</span>
      <span>Intent</span>
      <span className="text-right">KD %</span>
      <span className="text-right">Volume</span>
      <span />
    </div>
  );
}

function SubpagesHeader({ count }: { count: number }) {
  return (
    <div className={`${ROW_GRID} h-10 text-[0.8125rem] text-[#6b6c6b]`}>
      <span />
      <span />
      <span>
        <span className="underline underline-offset-2">Subpages:</span> <span className="text-[#1a1e19]">{count}</span>
      </span>
      <span className="text-right">Keywords</span>
      <span>Intent</span>
      <span className="text-right">KD %</span>
      <span className="text-right">Volume</span>
      <span />
    </div>
  );
}

function PillarKeywordsPanel({
  topic,
  doc,
  favorites,
  onToggleFavorite,
}: {
  topic: StrategyTopic;
  doc: StrategyDoc;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(doc.keywords.map((k) => [k.id, k])), [doc.keywords]);
  const pillar = topic.pillarId ? byId.get(topic.pillarId) : null;
  const rows = topic.keywordIds
    .map((id) => byId.get(id))
    .filter((k): k is StrategyKeyword => Boolean(k))
    .slice(0, 12);

  return (
    <div className="grid gap-6 px-4 pt-4 pb-2 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
      <div>
        <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_24px] items-stretch">
          <span className="flex items-center py-2 text-[0.8125rem] font-semibold text-[#1a1e19]">Keyword</span>
          <span className="flex items-center justify-end gap-1 border-b border-[#e9eae9] bg-[#f4f5f5] px-2 py-2 text-[0.8125rem] text-[#4b4d4a]">
            KD %
            <SortIcon className="h-3 w-3 text-[#8a8c89]" />
          </span>
          <span className="flex items-center justify-end border-b border-[#e9eae9] bg-[#f4f5f5] px-2 py-2 text-[0.8125rem] text-[#4b4d4a]">
            Volume
          </span>
          <span />
        </div>
        {rows.map((k) => (
          <div key={k.id} className="grid h-9 grid-cols-[minmax(0,1fr)_72px_72px_24px] items-center border-b border-[#eff0ef]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate pr-2 text-[0.8125rem] text-[#1a1e19]" title={k.keyword}>
                {k.keyword}
              </span>
              {k.intentSource === "estimated" && (
                <span className="shrink-0 rounded-full bg-[#f1f2f1] px-1.5 text-[0.6875rem] leading-[18px] text-[#6b6c6b]">
                  估算
                </span>
              )}
            </span>
            <span className="flex justify-end pr-2 text-[0.8125rem] text-[#1a1e19]">
              <KdValue kd={k.kd} />
            </span>
            <span className="text-right text-[0.8125rem] text-[#1a1e19] tabular-nums">{formatVolume(k.volume)}</span>
            <span className="flex justify-end">
              <StarButton id={k.id} active={favorites.has(k.id)} onToggle={onToggleFavorite} />
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-sm bg-[#f7f8f7] p-4">
        <div className="text-[0.8125rem] font-semibold text-[#1a1e19]">SERP features</div>
        {pillar?.serpFeatures && pillar.serpFeatures.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {pillar.serpFeatures.map((f) => (
              <span key={f} className="flex items-center gap-2 text-[0.8125rem] text-[#6b6c6b]">
                <span className="text-[#8a8c89]">{SERP_ICONS[f] ?? <ListLines className="h-4 w-4" />}</span>
                <span className="underline decoration-[#c9cbc9] decoration-dotted underline-offset-2">{f.replace(/_/g, " ")}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[0.8125rem] leading-[18px] text-[#6b6c6b]">
            No SERP features captured for this keyword. Only real SERP snapshots are shown — nothing is copied from the seed.
          </p>
        )}
        <p className="mt-3 text-[0.75rem] leading-[17px] text-[#8a8c89]">
          Pillar 依据：{topic.pillarReason}
        </p>
      </div>
    </div>
  );
}

function PillarRow({
  topic,
  doc,
  expanded,
  onToggle,
  onGenerate,
  favorites,
  onToggleFavorite,
}: {
  topic: StrategyTopic;
  doc: StrategyDoc;
  expanded: boolean;
  onToggle: () => void;
  onGenerate: (topicId: string) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
}) {
  const pillar = topic.pillarId ? doc.keywords.find((k) => k.id === topic.pillarId) : null;
  const label = pillar?.keyword ?? `${topic.name} (no pillar)`;
  return (
    <div className="relative border-b border-[#e9eae9]">
      <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-[#8796ef]" aria-hidden="true" />
      <div className={`${ROW_GRID} h-13`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          className="flex h-full items-center justify-center border-r border-[#e9eae9] text-[#6b6c6b] hover:text-[#1a1e19]"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="flex items-center justify-center">
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-[#eaeef6] px-1 text-[0.6875rem] text-[#245ee2]">
            P
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[0.875rem] leading-[20px] text-[#1a1e19]" title={label}>
            {label}
          </span>
          {pillar?.intentSource === "estimated" && (
            <span className="shrink-0 rounded-full bg-[#f1f2f1] px-1.5 text-[0.6875rem] leading-[18px] text-[#6b6c6b]">估算</span>
          )}
        </span>
        <span className="text-right text-[0.8125rem] text-[#1a1e19] tabular-nums">{topic.keywordCount}</span>
        <span>
          <IntentBar mix={topic.intentMix} label={topic.name} />
        </span>
        <span className="text-right text-[0.8125rem] text-[#1a1e19]">
          <KdValue kd={topic.avgKd} />
        </span>
        <span className="text-right text-[0.8125rem] text-[#1a1e19] tabular-nums">{formatVolume(topic.totalVolume)}</span>
        <span className="flex justify-end">
          <SolidButton onClick={() => onGenerate(topic.id)}>Generate content</SolidButton>
        </span>
      </div>

      {expanded && (
        <div className="border-t border-[#e9eae9]">
          <PillarKeywordsPanel topic={topic} doc={doc} favorites={favorites} onToggleFavorite={onToggleFavorite} />
          <div className="flex items-center justify-center pb-3">
            <LinkButton onClick={onToggle}>View all</LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}

function SubpageRow({
  page,
  doc,
  favorites,
  onToggleFavorite,
  onGenerate,
}: {
  page: StrategyPage;
  doc: StrategyDoc;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onGenerate: (topicId: string) => void;
}) {
  const topicId = page.id.split("-p-")[0];
  const [open, setOpen] = useState(false);
  // 该子页面下的真实关键词：pageId 归属。没有子节点时绝不渲染假箭头。
  const rows = useMemo(() => doc.keywords.filter((k) => k.pageId === page.id), [doc.keywords, page.id]);
  const expandable = rows.length > 0;
  return (
    <div className="relative flex items-stretch">
      <span className="relative w-6 shrink-0" aria-hidden="true">
        <span className="absolute top-1/2 left-0 h-4 w-6 -translate-y-full rounded-bl-md border-b border-l border-[#dcdedf]" />
      </span>
      <div className="min-w-0 flex-1 rounded-md border border-[#e3e4e3] bg-white">
        <div className={`${SUB_GRID} h-13`}>
          {expandable ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? `Collapse ${page.name}` : `Expand ${page.name}`}
              className="flex h-full items-center justify-center text-[#6b6c6b] hover:text-[#1a1e19]"
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <span />
          <span className="truncate text-[0.875rem] leading-[20px] text-[#1a1e19]" title={page.name}>
            {page.name}
          </span>
          <span className="text-right text-[0.8125rem] text-[#1a1e19] tabular-nums">{page.keywordCount}</span>
          <span>
            <IntentBar mix={page.intentMix} label={page.name} />
          </span>
          <span className="text-right text-[0.8125rem] text-[#1a1e19]">
            <KdValue kd={page.avgKd} />
          </span>
          <span className="text-right text-[0.8125rem] text-[#1a1e19] tabular-nums">{formatVolume(page.totalVolume)}</span>
          <span className="flex justify-end">
            <SolidButton onClick={() => onGenerate(topicId)}>Generate content</SolidButton>
          </span>
        </div>
        {open && expandable && (
          <div className="border-t border-[#eff0ef] px-3 py-1">
            {rows.map((k) => (
              <div
                key={k.id}
                className="grid h-9 grid-cols-[minmax(0,1fr)_72px_72px_24px] items-center border-b border-[#eff0ef] last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate pr-2 text-[0.8125rem] text-[#1a1e19]" title={k.keyword}>
                    {k.keyword}
                  </span>
                  {k.intentSource === "estimated" && (
                    <span className="shrink-0 rounded-full bg-[#f1f2f1] px-1.5 text-[0.6875rem] leading-[18px] text-[#6b6c6b]">
                      估算
                    </span>
                  )}
                </span>
                <span className="flex justify-end pr-2 text-[0.8125rem] text-[#1a1e19]">
                  <KdValue kd={k.kd} />
                </span>
                <span className="flex justify-end pr-2 text-[0.8125rem] text-[#1a1e19] tabular-nums">{formatVolume(k.volume)}</span>
                <span className="flex justify-end">
                  <StarButton id={k.id} active={favorites.has(k.id)} onToggle={onToggleFavorite} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TopicBlock({
  topic,
  doc,
  pages,
  onGenerate,
  favorites,
  onToggleFavorite,
}: {
  topic: StrategyTopic;
  doc: StrategyDoc;
  pages: StrategyPage[];
  onGenerate: (topicId: string) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [pillarOpen, setPillarOpen] = useState(false);

  return (
    <section className="mb-3">
      <div className="rounded-md border border-[#e3e4e3] bg-white">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-11 w-full items-center gap-2 border-b border-[#e9eae9] px-4 text-left text-[0.8125rem] text-[#6b6c6b]"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span>Topic:</span>
          <span className="text-[0.875rem] font-semibold text-[#1a1e19]">{topic.name}</span>
          <span className="ml-4">
            Total Volume: <span className="font-semibold text-[#1a1e19]">{formatVolume(topic.totalVolume)}</span>
          </span>
          <span className="ml-4">
            Average KD: <span className="font-semibold text-[#1a1e19]">{formatKd(topic.avgKd)}</span>
          </span>
          <span className="ml-4">
            Keywords: <span className="font-semibold text-[#1a1e19]">{topic.keywordCount}</span>
          </span>
        </button>

        {open && (
          <div>
            <ColumnHeader />
            <PillarRow
              topic={topic}
              doc={doc}
              expanded={pillarOpen}
              onToggle={() => setPillarOpen((v) => !v)}
              onGenerate={onGenerate}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
            />
            {pages.length > 0 && (
              <div className="px-3 pt-2 pb-3">
                <SubpagesHeader count={pages.length} />
                <div className="relative space-y-2">
                  {pages.length > 1 && (
                    <span className="pointer-events-none absolute top-0 bottom-6 left-0 w-px bg-[#dcdedf]" aria-hidden="true" />
                  )}
                  {pages.map((page) => (
                    <SubpageRow
                      key={page.id}
                      page={page}
                      doc={doc}
                      favorites={favorites}
                      onToggleFavorite={onToggleFavorite}
                      onGenerate={onGenerate}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FlatHeader({ first }: { first: string }) {
  return (
    <div className={`${FLAT_GRID} h-10 border-b border-[#e9eae9] text-[0.8125rem] text-[#6b6c6b]`}>
      <span />
      <span>{first}</span>
      <span>Topic</span>
      <span>Intent</span>
      <span>Source</span>
      <span className="text-right">KD %</span>
      <span className="text-right">Volume</span>
      <span className="text-right">Actions</span>
    </div>
  );
}

export function StrategyTable({
  doc,
  view,
  keywords,
  favorites,
  selection,
  onToggleFavorite,
  onSelect,
  onGenerate,
  onExport,
}: {
  doc: StrategyDoc;
  view: "topics" | "pages" | "table";
  keywords: StrategyKeyword[];
  favorites: Set<string>;
  selection: Set<string>;
  onToggleFavorite: (id: string) => void;
  onSelect: (id: string, on: boolean) => void;
  onGenerate: (topicId: string) => void;
  onExport: () => void;
}) {
  const visibleIds = useMemo(() => new Set(keywords.map((k) => k.id)), [keywords]);
  const visibleTopics = useMemo(
    () =>
      doc.topics
        .map((t) => ({ topic: t, pages: t.pages.filter((p) => p.keywordIds.some((id) => visibleIds.has(id))) }))
        .filter(({ topic, pages }) => (topic.pillarId ? visibleIds.has(topic.pillarId) : false) || pages.length > 0),
    [doc.topics, visibleIds]
  );

  if (keywords.length === 0) {
    return (
      <div className="rounded-md border border-[#e3e4e3] bg-white py-10 text-center text-[0.8125rem] text-[#6b6c6b]">
        No keywords match this filter.
      </div>
    );
  }

  if (view === "table") {
    return (
      <div className="rounded-md border border-[#e3e4e3] bg-white">
        <FlatHeader first="Keyword" />
        <div className="divide-y divide-[#eff0ef]">
          {keywords.map((k) => {
            const topic = doc.topics.find((t) => t.id === k.topicId);
            return (
              <div key={k.id} className={`${FLAT_GRID} h-12`}>
                <input
                  type="checkbox"
                  aria-label={`Select ${k.keyword}`}
                  checked={selection.has(k.id)}
                  onChange={(e) => onSelect(k.id, e.target.checked)}
                  className="h-4 w-4 accent-[#191c19]"
                />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[0.875rem] text-[#1a1e19]" title={k.keyword}>
                    {k.keyword}
                  </span>
                  {k.manual && (
                    <span className="shrink-0 rounded-full bg-[#eaeef6] px-1.5 text-[0.6875rem] leading-[18px] text-[#245ee2]">
                      手动
                    </span>
                  )}
                </span>
                <span className="truncate text-[0.8125rem] text-[#6b6c6b]" title={topic?.name ?? ""}>
                  {topic?.name ?? "—"}
                </span>
                <span className="flex items-center gap-1.5 text-[0.8125rem] text-[#4b4d4a]">
                  {k.intent}
                  {k.intentSource === "estimated" && (
                    <span className="rounded-full bg-[#f1f2f1] px-1.5 text-[0.6875rem] leading-[18px] text-[#6b6c6b]">估算</span>
                  )}
                </span>
                <span className="truncate text-[0.75rem] text-[#6b6c6b]" title={k.seeds.join(", ")}>
                  {k.seeds[0] ?? "—"}
                </span>
                <span className="text-right text-[0.8125rem] text-[#1a1e19]">
                  <KdValue kd={k.kd} />
                </span>
                <span className="text-right text-[0.8125rem] text-[#1a1e19] tabular-nums">{formatVolume(k.volume)}</span>
                <span className="flex items-center justify-end gap-2">
                  <StarButton id={k.id} active={favorites.has(k.id)} onToggle={onToggleFavorite} />
                </span>
              </div>
            );
          })}
        </div>
        <div className="border-t border-[#e9eae9] py-3 text-center">
          <LinkButton onClick={onExport}>Export all {doc.keywords.length} keywords</LinkButton>
        </div>
      </div>
    );
  }

  if (view === "pages") {
    const rows = visibleTopics.flatMap(({ topic, pages }) => {
      const pillar = topic.pillarId ? doc.keywords.find((k) => k.id === topic.pillarId) : null;
      const pillarRow = pillar
        ? [{ id: `${topic.id}-pillar`, name: pillar.keyword, topic: topic.name, count: topic.keywordCount, kd: topic.avgKd, volume: topic.totalVolume, mix: topic.intentMix, role: "Pillar" }]
        : [];
      const pageRows = pages.map((p) => ({
        id: p.id,
        name: p.name,
        topic: topic.name,
        count: p.keywordCount,
        kd: p.avgKd,
        volume: p.totalVolume,
        mix: p.intentMix,
        role: "Subpage",
      }));
      return [...pillarRow, ...pageRows];
    });

    return (
      <div className="rounded-md border border-[#e3e4e3] bg-white">
        <div className={`${PAGE_GRID} h-10 border-b border-[#e9eae9] text-[0.8125rem] text-[#6b6c6b]`}>
          <span />
          <span>Page</span>
          <span>Topic</span>
          <span className="text-right">Keywords</span>
          <span>Intent</span>
          <span className="text-right">KD %</span>
          <span className="text-right">Volume</span>
          <span className="text-right">Role</span>
        </div>
        <div className="divide-y divide-[#eff0ef]">
          {rows.map((r) => (
            <div key={r.id} className={`${PAGE_GRID} h-12`}>
              <span />
              <span className="truncate text-[0.875rem] text-[#1a1e19]" title={r.name}>
                {r.name}
              </span>
              <span className="truncate text-[0.8125rem] text-[#6b6c6b]" title={r.topic}>
                {r.topic}
              </span>
              <span className="text-right text-[0.8125rem] text-[#1a1e19] tabular-nums">{r.count}</span>
              <span>
                <IntentBar mix={r.mix} label={r.name} />
              </span>
              <span className="text-right text-[0.8125rem] text-[#1a1e19]">
                <KdValue kd={r.kd} />
              </span>
              <span className="text-right text-[0.8125rem] text-[#1a1e19] tabular-nums">{formatVolume(r.volume)}</span>
              <span className="text-right text-[0.75rem] text-[#6b6c6b]">{r.role}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mt-2">
        {visibleTopics.map(({ topic, pages }) => (
          <TopicBlock
            key={topic.id}
            topic={topic}
            doc={doc}
            pages={pages}
            onGenerate={onGenerate}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
      {visibleTopics.length === 0 && (
        <div className="rounded-md border border-[#e3e4e3] bg-white py-10 text-center text-[0.8125rem] text-[#6b6c6b]">
          No topics match this filter.
        </div>
      )}
    </div>
  );
}
