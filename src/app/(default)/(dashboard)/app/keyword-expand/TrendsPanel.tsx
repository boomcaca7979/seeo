"use client";

// ===== Google Trends 面板（P4-C：趋势与相关需求维度）=====
// 请求策略（任务硬约束）：四个 data_type 各自独立、全部由用户显式点击触发；
// 绝不在页面加载时自动调用；缓存命中直接展示（不消耗新额度）；并发重复点击共享
// 同一服务端 in-flight 请求；配额不足时显示原因并保留已获取数据。
// 数据口径：Trends value 是相对指数（0-100）/ 上升百分比 / Breakout，不是月搜索量。

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { handleBillingError } from "@/lib/billing-error-client";
import ChartFrame from "@/components/viz/ChartFrame";
import { StatusBadge } from "@/components/viz/StatusBadge";
import {
  RK,
  RK_GRID_PROPS,
  RK_TOOLTIP_ITEM_STYLE,
  RK_TOOLTIP_LABEL_STYLE,
  RK_TOOLTIP_STYLE,
  RK_XAXIS_PROPS,
  RK_YAXIS_PROPS,
} from "@/components/viz/rank-theme";
import { formatNumber } from "@/lib/ui-locale";

export type TrendsDataTypeKey = "TIMESERIES" | "GEO_MAP_0" | "RELATED_QUERIES" | "RELATED_TOPICS";

/** 与 /api/keywords/trends 响应 data 字段一致 */
interface TrendsData {
  dataType: TrendsDataTypeKey;
  keyword: string;
  geo: string | null;
  hl: string;
  dateRange: string;
  fetchedAt: string;
  timeline?: { date: string; values: { query: string | null; value: number | null; extractedValue: number | null }[] }[];
  top?: { label: string; topicType: string | null; value: number | string | null; extractedValue: number | null }[];
  rising?: { label: string; topicType: string | null; value: number | string | null; extractedValue: number | null }[];  geoInterest?: { geoName: string; value: number | null; extractedValue: number | null }[];
  fromCache: boolean;
}

type TrendsPhase =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; data: TrendsData }
  | { phase: "error"; message: string };

const TRENDS_BUTTONS: { dataType: TrendsDataTypeKey; labelKey: string }[] = [
  { dataType: "TIMESERIES", labelKey: "trendsButtonTime" },
  { dataType: "GEO_MAP_0", labelKey: "trendsButtonGeo" },
  { dataType: "RELATED_QUERIES", labelKey: "trendsButtonQueries" },
  { dataType: "RELATED_TOPICS", labelKey: "trendsButtonTopics" },
];

const DATE_OPTIONS = [
  { value: "today 12-m", labelKey: "trendsRange12m" },
  { value: "today 5-y", labelKey: "trendsRange5y" },
] as const;

type TrendsDateKey = (typeof DATE_OPTIONS)[number]["value"];

/** 相关查询合并回调：top + rising（rising 单独标记），由父页面并入统一发现表 */
export interface TrendsQueryInput {
  label: string;
  rising: boolean;
}

export function TrendsPanel({
  seed,
  location,
  onQueriesLoaded,
}: {
  seed: string;
  location: string;
  /** RELATED_QUERIES 加载成功时回调（含缓存命中）；父页面据此合并来源标签 */
  onQueriesLoaded?: (queries: TrendsQueryInput[]) => void;
}) {
  const t = useTranslations("dashboard.keywords.expand");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const [dateRange, setDateRange] = useState<TrendsDateKey>("today 12-m");
  const [phases, setPhases] = useState<Record<TrendsDataTypeKey, TrendsPhase>>({
    TIMESERIES: { phase: "idle" },
    "GEO_MAP_0": { phase: "idle" },
    RELATED_QUERIES: { phase: "idle" },
    RELATED_TOPICS: { phase: "idle" },
  });

  const handleFetch = async (dataType: TrendsDataTypeKey) => {
    const current = phases[dataType];
    if (current.phase === "loading") return;
    setPhases((prev) => ({ ...prev, [dataType]: { phase: "loading" } }));
    try {
      const res = await fetch("/api/keywords/trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed, location, dataType, date: dateRange }),
      });
      const json = await res.json();
      if (!res.ok) {
        const { message } = handleBillingError(json, t("trendsFailed"));
        setPhases((prev) => ({ ...prev, [dataType]: { phase: "error", message } }));
        return;
      }
      const data = json.data as TrendsData;
      setPhases((prev) => ({ ...prev, [dataType]: { phase: "ready", data } }));
      if (dataType === "RELATED_QUERIES" && onQueriesLoaded) {
        const queries: TrendsQueryInput[] = [
          ...(data.top ?? []).map((item) => ({ label: item.label, rising: false })),
          ...(data.rising ?? []).map((item) => ({ label: item.label, rising: true })),
        ];
        onQueriesLoaded(queries);
      }
    } catch (err) {
      setPhases((prev) => ({
        ...prev,
        [dataType]: { phase: "error", message: `${tc("networkError")} ${(err as Error).message}` },
      }));
    }
  };

  const readyCount = (Object.values(phases) as TrendsPhase[]).filter((p) => p.phase === "ready").length;

  return (
    <div>
      {/* 触发区：每个 data_type 独立按钮（独立引擎调用/独立缓存），时间范围可选。
          不设「一键全部加载」——避免一次点击连发 4 个上游请求。 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {TRENDS_BUTTONS.map(({ dataType, labelKey }) => {
          const phase = phases[dataType];
          const isReady = phase.phase === "ready";
          return (
            <button
              key={dataType}
              type="button"
              onClick={() => handleFetch(dataType)}
              disabled={phase.phase === "loading"}
              title={t("trendsButtonTitle")}
              className={`rounded-md border px-2 py-1.5 font-mono text-xs transition-colors ${
                isReady ? "border-ink-25 text-ink" : "border-line text-ink-60 hover:border-ink-25"
              } disabled:opacity-60`}
            >
              {phase.phase === "loading" ? t("trendsLoading") : t(labelKey)}
              {isReady ? " ✓" : ""}
            </button>
          );
        })}
        <label className="flex items-center gap-1.5 font-sans text-xs text-ink-40">
          {t("trendsRangeLabel")}
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as TrendsDateKey)}
            className="rounded-md border border-line bg-card px-2 py-1.5 font-mono text-xs text-ink focus:border-ink-25 focus:outline-none"
          >
            {DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 font-sans text-xs text-ink-40">
        {t("trendsCostNote", { count: formatNumber(readyCount, locale) })}
      </p>

      {/* 结果区：各 data_type 独立渲染；未请求/加载中/错误/就绪互不干扰 */}
      {TRENDS_BUTTONS.map(({ dataType }) => {
        const phase = phases[dataType];
        if (phase.phase === "idle") return null;
        if (phase.phase === "error") {
          return (
            <div key={dataType} className="mt-3 rounded-md border border-neg/25 bg-neg/5 px-3 py-2">
              <StatusBadge label={t("trendsFailed")} tone="neg" dot={false} />
              <span className="ml-2 font-sans text-xs text-neg">{phase.message}</span>
            </div>
          );
        }
        if (phase.phase === "loading") {
          return (
            <p key={dataType} className="mt-3 font-sans text-xs text-ink-40">{t("trendsLoading")}</p>
          );
        }
        return <TrendsResultView key={dataType} data={phase.data} />;
      })}
    </div>
  );
}

function TrendsResultView({ data }: { data: TrendsData }) {
  const t = useTranslations("dashboard.keywords.expand");
  // 实际请求的时间范围如实展示（未知值原样显示，绝不猜测）
  const dateRangeLabel =
    data.dateRange === "today 12-m" ? t("trendsRange12m")
      : data.dateRange === "today 5-y" ? t("trendsRange5y")
      : data.dateRange;

  return (
    <div className="mt-4 border-t border-line-soft pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          label={
            data.dataType === "TIMESERIES" ? t("trendsButtonTime")
              : data.dataType === "GEO_MAP_0" ? t("trendsButtonGeo")
              : data.dataType === "RELATED_QUERIES" ? t("trendsButtonQueries")
              : t("trendsButtonTopics")
          }
          tone="info"
          dot={false}
        />
        {data.fromCache && <StatusBadge label={t("trendsFromCache")} tone="neutral" dot={false} />}
        <span className="font-mono text-xs text-ink-40">
          {data.geo ? `geo=${data.geo}` : t("trendsGeoGlobal")} · hl={data.hl} · {dateRangeLabel}
        </span>
      </div>

      {data.dataType === "TIMESERIES" && (
        <TimeseriesView
          points={(data.timeline ?? []).map((point) => ({
            date: point.date,
            // 真实 SerpApi 的 value 是字符串（如 "47"），数值口径回落到 extractedValue
            value: point.values[0]?.value ?? point.values[0]?.extractedValue ?? null,
          }))}
        />
      )}

      {data.dataType === "RELATED_QUERIES" && (
        <>
          <RankedListView
            title={t("trendsTopLabel")}
            items={data.top ?? []}
            rising={false}
            emptyText={t("trendsEmpty")}
          />
          <RankedListView
            title={t("trendsRisingLabel")}
            items={data.rising ?? []}
            rising
            emptyText={t("trendsEmpty")}
          />
          <p className="mt-2 font-sans text-xs text-ink-40">{t("trendsQueriesNote")}</p>
        </>
      )}

      {data.dataType === "RELATED_TOPICS" && (
        <>
          <RankedListView
            title={t("trendsTopLabel")}
            items={data.top ?? []}
            rising={false}
            emptyText={t("trendsEmpty")}
            showTopicType
          />
          <RankedListView
            title={t("trendsRisingLabel")}
            items={data.rising ?? []}
            rising
            emptyText={t("trendsEmpty")}
            showTopicType
          />
          <p className="mt-2 font-sans text-xs text-ink-40">{t("trendsTopicsNote")}</p>
        </>
      )}

      {data.dataType === "GEO_MAP_0" && (
        <>
          <GeoInterestView items={data.geoInterest ?? []} />
          <p className="mt-2 font-sans text-xs text-ink-40">{t("trendsGeoNote")}</p>
        </>
      )}
    </div>
  );
}

/** 兴趣趋势曲线：相对热度 0-100（不是月搜索量），只画真实返回的时间点 */
function TimeseriesView({ points }: { points: { date: string; value: number | null }[] }) {
  const t = useTranslations("dashboard.keywords.expand");
  const locale = useLocale() as "en" | "zh";
  const rows = points.filter((p) => p.value !== null) as { date: string; value: number }[];
  if (rows.length === 0) {
    return <p className="mt-3 font-sans text-xs text-ink-40">{t("trendsEmpty")}</p>;
  }
  return (
    <div className="mt-3">
      <ChartFrame
        title={t("trendsIotTitle")}
        subtitle={t("trendsIotSub", { count: formatNumber(rows.length, locale) })}
        chartHeight={220}
        chart={
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
              <CartesianGrid {...RK_GRID_PROPS} />
              <XAxis dataKey="date" {...RK_XAXIS_PROPS} />
              <YAxis domain={[0, 100]} allowDecimals={false} {...RK_YAXIS_PROPS} />
              <Tooltip
                contentStyle={RK_TOOLTIP_STYLE}
                labelStyle={RK_TOOLTIP_LABEL_STYLE}
                itemStyle={RK_TOOLTIP_ITEM_STYLE}
                formatter={(v) => [`${v}`, t("trendsIotSeries")]}
                cursor={{ fill: RK.cursor }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={RK.accent}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        }
      />
      <p className="mt-2 font-sans text-xs text-ink-40">{t("trendsScaleNote")}</p>
    </div>
  );
}

/** 热门/上升列表：top 显示相对指数（0-100）；rising 显示增长 % 或 Breakout */
function RankedListView({
  title,
  items,
  rising,
  emptyText,
  showTopicType = false,
}: {
  title: string;
  items: { label: string; topicType: string | null; value: number | string | null; extractedValue?: number | null }[];
  rising: boolean;
  emptyText: string;
  showTopicType?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="mt-3">
        <p className="font-mono text-xs uppercase tracking-wide text-ink-40">{title}</p>
        <p className="mt-1 font-sans text-xs text-ink-40">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <p className="font-mono text-xs uppercase tracking-wide text-ink-40">
        {title} ({items.length})
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={`${item.label}-${rising ? "r" : "t"}`}
            className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-card px-2 py-1 font-sans text-xs text-ink-60"
          >
            <span className="text-ink">{item.label}</span>
            {showTopicType && item.topicType && (
              <span className="font-mono text-ink-40">{item.topicType}</span>
            )}
            {rising ? (
              typeof item.value === "number" ? (
                <span className="font-mono text-pos">+{item.value}%</span>
              ) : item.value ? (
                <span className="font-mono font-semibold text-pos">{item.value}</span>
              ) : null
            ) : (
              // 真实 SerpApi 的 top.value 是字符串（如 "100"），数值口径取 extractedValue
              (() => {
                const n = typeof item.value === "number" ? item.value : item.extractedValue ?? null;
                return n !== null ? <span className="font-mono text-ink-40">{n}</span> : null;
              })()
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 地区兴趣：相对指数横向条（真实返回的地区才显示） */
function GeoInterestView({ items }: { items: { geoName: string; value: number | null }[] }) {
  const t = useTranslations("dashboard.keywords.expand");
  const rows = items.filter((item) => item.value !== null) as { geoName: string; value: number }[];
  if (rows.length === 0) {
    return <p className="mt-3 font-sans text-xs text-ink-40">{t("trendsEmpty")}</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.geoName} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate font-sans text-xs text-ink-60" title={row.geoName}>
            {row.geoName}
          </span>
          <span className="h-2 flex-1 rounded-sm bg-line-soft">
            <span
              className="block h-2 rounded-sm"
              style={{ width: `${(row.value / max) * 100}%`, backgroundColor: RK.accent }}
            />
          </span>
          <span className="w-10 text-right font-mono text-xs text-ink-60">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
