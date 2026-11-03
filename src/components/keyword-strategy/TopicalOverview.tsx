// ===== Topical Overview：真实主题气泡图 + 四宫格统计 =====
// 气泡来自真实 Topic（数量、名称、权重都来自策略数据）：
//   · 有真实 Volume → 半径按主题搜索量合计；
//   · 没有 Volume → 半径按关键词数量（图例明确写「按关键词数量布局」，不冒充搜索量）。
//
// 缩放交互（滚轮 / 触控板捏合 / 右侧按钮共用同一份视图状态）：
//   · 视图状态放在 ref 里，直接写 transform —— 交互过程中不触发 React 重渲染；
//   · wheel 监听必须走原生 addEventListener({ passive: false })，React 的 onWheel 是 passive，拦不住页面滚动；
//   · macOS Chromium 的触控板捏合 = wheel + ctrlKey；Safari = gesturestart/gesturechange，两条都接；
//   · 缩放锚点取指针位置：先换算世界坐标，再反推平移，保证指针下的内容不动；
//   · 普通滚轮到达缩放上下限后不再 preventDefault，让页面恢复滚动，避免图表变成「滚动陷阱」。
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Expand, ZoomIn, ZoomOut } from "./icons";
import type { StrategyTopic, TileId, TileResult } from "@/lib/seo/strategy-model";

const CHART_W = 1080;
const CHART_H = 330;

const MIN_SCALE = 0.7;
const MAX_SCALE = 2.5;
const BUTTON_STEP = 1.25;
const BUTTON_ANIM_MS = 180;
const BUTTON_EASE = `transform ${BUTTON_ANIM_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
const WHEEL_INTENSITY = 0.0018;
const PINCH_INTENSITY = 0.008;

type View = { scale: number; x: number; y: number };

interface BubbleNode {
  id: string;
  name: string;
  cx: number;
  cy: number;
  r: number;
  count: number;
  volume: number | null;
  fill: string;
  stroke: string;
}

const TINTS = [
  { fill: "#eeeaff", stroke: "#c9c2f8" },
  { fill: "#e7eefc", stroke: "#b9ccf3" },
  { fill: "#eaf5f1", stroke: "#b3ded0" },
  { fill: "#fdf0e6", stroke: "#f2cdae" },
  { fill: "#f2ecfa", stroke: "#d3c5ee" },
] as const;

/**
 * 确定性布局：第 0 个在中心附近，其余沿黄金角螺旋展开。
 * 半径按权重（volume 优先，否则关键词数）开方，保证面积与权重近似线性。
 */
export function layoutTopicBubbles(topics: StrategyTopic[], hasVolume: boolean): BubbleNode[] {
  const list = topics.slice(0, 18);
  if (list.length === 0) return [];
  const weights = list.map((t) => (hasVolume ? (t.totalVolume ?? 0) : t.keywordCount));
  const maxWeight = Math.max(1, ...weights);
  const cx = CHART_W / 2;
  const cy = CHART_H / 2;

  return list.map((topic, i) => {
    const w = weights[i] / maxWeight;
    const r = 20 + Math.sqrt(w) * 58;
    const angle = i * 2.399963;
    const dist = i === 0 ? 0 : 46 + 34 * Math.sqrt(i);
    const rawX = cx + Math.cos(angle) * dist * 2.05;
    const rawY = cy + Math.sin(angle) * dist * 0.72;
    const x = Math.min(CHART_W - r - 8, Math.max(r + 8, rawX));
    const y = Math.min(CHART_H - r - 8, Math.max(r + 8, rawY));
    const tint = TINTS[i % TINTS.length];
    return {
      id: topic.id,
      name: topic.name,
      cx: Math.round(x),
      cy: Math.round(y),
      r: Math.round(r),
      count: topic.keywordCount,
      volume: topic.totalVolume,
      fill: tint.fill,
      stroke: tint.stroke,
    };
  });
}

export function TopicalOverviewCard({
  topics,
  keywordCount,
  hasVolume,
  onExport,
  onHelp,
}: {
  topics: StrategyTopic[];
  keywordCount: number;
  hasVolume: boolean;
  onExport: () => void;
  onHelp: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View>({ scale: 1, x: 0, y: 0 });
  const frameRef = useRef(0);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bubbles = useMemo(() => layoutTopicBubbles(topics, hasVolume), [topics, hasVolume]);
  const core = bubbles[0];

  const write = useCallback((animate: boolean) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    if (animate) {
      stage.style.transition = BUTTON_EASE;
      animTimerRef.current = setTimeout(() => {
        if (stageRef.current) stageRef.current.style.transition = "none";
        animTimerRef.current = null;
      }, BUTTON_ANIM_MS + 20);
    } else {
      stage.style.transition = "none";
    }
    const { scale, x, y } = viewRef.current;
    stage.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  }, []);

  /** 约束：放大时内容必须铺满视口（不留白边）；缩小时居中。 */
  const clampView = useCallback((scale: number, x: number, y: number): View => {
    const el = viewportRef.current;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    if (!el) return { scale: s, x, y };
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (s >= 1) {
      return {
        scale: s,
        x: Math.min(0, Math.max(w - w * s, x)),
        y: Math.min(0, Math.max(h - h * s, y)),
      };
    }
    return { scale: s, x: (w - w * s) / 2, y: (h - h * s) / 2 };
  }, []);

  /** 按钮动画进行中插入滚轮时，从当前渲染值接管，避免跳变。 */
  const syncVisualState = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !animTimerRef.current) return;
    const m = new DOMMatrixReadOnly(getComputedStyle(stage).transform);
    viewRef.current = { scale: m.a, x: m.e, y: m.f };
    clearTimeout(animTimerRef.current);
    animTimerRef.current = null;
    stage.style.transition = "none";
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      write(false);
    });
  }, [write]);

  /** 以 (px, py) 为锚点缩放到 nextScale；同一份 viewRef 供所有入口使用。 */
  const zoomAt = useCallback(
    (nextScale: number, px: number, py: number, animate: boolean) => {
      const cur = viewRef.current;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      if (Math.abs(s - cur.scale) < 0.0005) return;
      const worldX = (px - cur.x) / cur.scale;
      const worldY = (py - cur.y) / cur.scale;
      viewRef.current = clampView(s, px - worldX * s, py - worldY * s);
      if (animate) write(true);
      else schedule();
    },
    [clampView, schedule, write]
  );

  const zoomByButton = useCallback(
    (direction: 1 | -1) => {
      const el = viewportRef.current;
      if (!el) return;
      const factor = direction > 0 ? BUTTON_STEP : 1 / BUTTON_STEP;
      zoomAt(viewRef.current.scale * factor, el.clientWidth / 2, el.clientHeight / 2, true);
    },
    [zoomAt]
  );

  const resetView = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    viewRef.current = { scale: 1, x: 0, y: 0 };
    write(true);
  }, [write]);

  const handleZoomIn = useCallback(() => zoomByButton(1), [zoomByButton]);
  const handleZoomOut = useCallback(() => zoomByButton(-1), [zoomByButton]);

  // 原生 wheel / Safari gesture：React 的 onWheel 是 passive 的，无法阻止页面滚动。
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let gestureStartScale = 0;
    let gestureActive = false;

    const onWheel = (e: WheelEvent) => {
      syncVisualState();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= rect.height;
      if (delta === 0) return;

      const pinch = e.ctrlKey || e.metaKey;
      if (pinch && gestureActive) return; // Safari 同时派发 gesture 时避免双重缩放

      const scale = viewRef.current.scale;
      const zoomingIn = delta < 0;
      const atLimit = zoomingIn ? scale >= MAX_SCALE - 0.001 : scale <= MIN_SCALE + 0.001;
      // 普通滚轮到边界后放行，页面继续滚动；捏合手势始终留在图表内。
      if (!pinch && atLimit) return;

      e.preventDefault();
      const intensity = pinch ? PINCH_INTENSITY : WHEEL_INTENSITY;
      const factor = Math.min(1.22, Math.max(0.82, Math.exp(-delta * intensity)));
      zoomAt(scale * factor, e.clientX - rect.left, e.clientY - rect.top, false);
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureActive = true;
      gestureStartScale = viewRef.current.scale;
      if (stageRef.current) stageRef.current.style.transition = "none";
    };

    const onGestureChange = (e: Event) => {
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
      if (!g.scale) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = (typeof g.clientX === "number" ? g.clientX : rect.left + rect.width / 2) - rect.left;
      const py = (typeof g.clientY === "number" ? g.clientY : rect.top + rect.height / 2) - rect.top;
      zoomAt(gestureStartScale * g.scale, px, py, false);
    };

    const onGestureEnd = () => {
      gestureActive = false;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [syncVisualState, zoomAt]);

  // 容器尺寸变化后重新夹取平移量，避免放大状态下出现留白。
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const v = viewRef.current;
      viewRef.current = clampView(v.scale, v.x, v.y);
      write(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [clampView, write]);

  useEffect(() => {
    write(false);
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [write]);

  return (
    <section className="rounded-md border border-[#e3e4e3] bg-white">
      <header className="flex h-10 items-center justify-between gap-4 border-b border-[#e9eae9] px-5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-[0.9375rem] font-semibold text-[#1a1e19]">Topical Overview</h2>
          <span className="shrink-0 text-[0.8125rem] text-[#6b6c6b]">
            {topics.length} topics, {keywordCount} keywords
          </span>
          <span className="hidden shrink-0 text-[0.75rem] text-[#8a8c89] xl:inline">
            {hasVolume ? "气泡面积 = 主题搜索量" : "气泡面积 = 关键词数量（无搜索量数据）"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <button type="button" onClick={onHelp} className="text-[0.8125rem] text-[#245ee2] hover:underline">
            How to work with data
          </button>
          <button
            type="button"
            onClick={onExport}
            className="h-8 rounded-sm border border-[#d6d8d7] bg-white px-3 text-[0.8125rem] text-[#1a1e19] hover:bg-[#f7f8f7]"
          >
            Export
          </button>
        </div>
      </header>

      <div className="relative overflow-hidden bg-white">
        <div
          ref={viewportRef}
          className="relative w-full select-none overflow-hidden"
          style={{ aspectRatio: `${CHART_W} / ${CHART_H}` }}
          aria-label="Topic bubble map — scroll or pinch to zoom"
        >
          <div ref={stageRef} className="absolute inset-0" style={{ transformOrigin: "0 0", willChange: "transform" }}>
            {bubbles.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[0.8125rem] text-[#6b6c6b]">
                还没有可展示的主题：先创建策略或调整筛选条件。
              </div>
            ) : (
              <>
                <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Topic bubble map">
                  <g>
                    {bubbles.map((b) => (
                      <g key={b.id}>
                        <circle cx={b.cx} cy={b.cy} r={b.r} fill={b.fill} opacity="0.95" />
                        <circle cx={b.cx} cy={b.cy} r={b.r} fill="none" stroke={b.stroke} strokeWidth="1" opacity="0.9" />
                        <title>{`${b.name} · ${b.count} keywords${b.volume !== null ? ` · ${b.volume} volume` : ""}`}</title>
                      </g>
                    ))}
                  </g>
                </svg>

                {bubbles
                  .filter((b) => b.r >= 34)
                  .map((b) => (
                    <span
                      key={`label-${b.id}`}
                      className="absolute -translate-x-1/2 -translate-y-1/2 max-w-[130px] truncate rounded-sm border border-[#dcdcf6] bg-white/95 px-1.5 py-0.5 text-[0.6875rem] leading-[15px] text-[#1a1e19] shadow-[0_1px_2px_rgba(26,30,25,0.06)] xl:max-w-[190px] xl:px-2 xl:py-1 xl:text-[0.8125rem] xl:leading-[18px]"
                      style={{ left: `${(b.cx / CHART_W) * 100}%`, top: `${(b.cy / CHART_H) * 100}%` }}
                      title={b.name}
                    >
                      {b.name}
                    </span>
                  ))}

                {core && (
                  <div
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border border-[#dcdcf6] bg-white px-3 py-1.5 text-center shadow-[0_1px_2px_rgba(26,30,25,0.08)]"
                    style={{ left: "50%", top: "50%" }}
                  >
                    <div className="whitespace-nowrap text-[0.75rem] leading-[17px] text-[#1a1e19] xl:text-[0.875rem] xl:leading-[19px]">
                      {core.name}
                    </div>
                    <div className="whitespace-nowrap text-[0.75rem] leading-[17px] font-semibold text-[#1a1e19] xl:text-[0.875rem] xl:leading-[19px]">
                      Keywords: {core.count}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="absolute top-4 right-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleZoomIn}
              aria-label="Zoom in"
              title="Zoom in"
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#d6d8d7] bg-white text-[#4b4d4a] hover:bg-[#f7f8f7]"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              aria-label="Zoom out"
              title="Zoom out"
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#d6d8d7] bg-white text-[#4b4d4a] hover:bg-[#f7f8f7]"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={resetView}
              aria-label="Fit to screen"
              title="Fit to screen"
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#d6d8d7] bg-white text-[#4b4d4a] hover:bg-[#f7f8f7]"
            >
              <Expand className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 四宫格：视图筛选（Best for Strategy / Easy Start / Quick Conversions / More Potential Traffic） */
export function StatTiles({
  tiles,
  active,
  onSelect,
}: {
  tiles: TileResult[];
  active: TileId | null;
  onSelect: (id: TileId | null) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-[#e3e4e3] bg-[#e3e4e3] lg:grid-cols-4">
      {tiles.map((tile) => {
        const isActive = active === tile.id;
        return (
          <button
            key={tile.id}
            type="button"
            onClick={() => onSelect(isActive ? null : tile.id)}
            aria-pressed={isActive}
            title={tile.reason}
            disabled={!tile.available}
            className={`flex min-h-20 flex-col justify-start gap-1 px-4 py-2 text-left ${
              isActive ? "bg-[#eaeef6] ring-1 ring-[#8796ef] ring-inset" : "bg-white hover:bg-[#f7f8f7]"
            } ${tile.available ? "" : "cursor-not-allowed opacity-70"}`}
          >
            <div className="flex items-baseline gap-2">
              {tile.id === "strategy" && <span className="text-[0.875rem] leading-none">🔥</span>}
              <span className="text-[0.9375rem] font-semibold text-[#1a1e19]">{tile.label}</span>
              <span className="text-[0.9375rem] text-[#4b4d4a]">{tile.available ? tile.count : "—"}</span>
            </div>
            <p className="text-[0.8125rem] leading-[18px] text-[#4b4d4a]">{tile.available ? tile.desc : tile.reason}</p>
          </button>
        );
      })}
    </div>
  );
}
