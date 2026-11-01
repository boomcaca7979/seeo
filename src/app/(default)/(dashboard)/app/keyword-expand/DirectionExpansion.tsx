"use client";

// ===== 多方向扩词面板（P5-B）=====
// 请求策略（任务硬约束）：方向按钮只是查询组合策略，绝不是搜索数据；用户主动点击
// 某方向才发请求（页面加载绝不自动调用）；每方向最多 MAX_QUERIES_PER_DIRECTION 次
// 真实 Google Autocomplete 调用（/api/keywords/suggestions，24h 缓存命中零消耗）；
// 不递归、不串联二次扩词；只并入真实返回的建议词，模板本身绝不作为关键词展示。
// 市场不支持时明确禁用并说明（不输出错误翻译词）。
// 状态自包含：随 seed 变化由父组件以 key 重新挂载重置，不把旧方向状态带入新种子。

import { useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { handleBillingError } from "@/lib/billing-error-client";
import { formatNumber } from "@/lib/ui-locale";
import {
  EXPAND_DIRECTIONS,
  MAX_QUERIES_PER_DIRECTION,
  composeDirectionQueries,
  directionLanguageForMarket,
  type DirectionId,
} from "@/lib/seo/expand-directions";
import { normalizeKeywordForDedup } from "@/lib/seo/keyword-merge";

type DirectionPhase =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; fetched: number; added: number; requests: number; cacheHits: number }
  | { phase: "empty"; requests: number; cacheHits: number }
  | { phase: "error"; message: string; requests: number; cacheHits: number };

type RunAllPhase =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; requests: number; cacheHits: number; added: number };

interface DirectionExpansionProps {
  seed: string;
  location: string;
  /** 点击时已在发现列表中的关键词原文（去重计数与并入判断用；仅事件处理器读取） */
  existingKeywords: string[];
  /** 把真实 Autocomplete 返回的新建议词交给父组件并入统一发现表（来源 autocomplete） */
  onNewSuggestions: (words: string[]) => void;
  /**
   * 布局变体（默认不变）：
   * - card：自带描边留白的独立卡片（keyword-expand 页使用）
   * - embedded：去边框/外边距，供父级卡片内嵌（keyword-magic 右栏顶部），
   *   内部标题由父级卡片标题承担，避免同一层级出现两个「多方向扩词」。
   */
  variant?: "card" | "embedded";
}

export function DirectionExpansion({
  seed,
  location,
  existingKeywords,
  onNewSuggestions,
  variant = "card",
}: DirectionExpansionProps) {
  const t = useTranslations("dashboard.keywords.expand");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const [phases, setPhases] = useState<Partial<Record<DirectionId, DirectionPhase>>>({});
  const [runAll, setRunAll] = useState<RunAllPhase>({ phase: "idle" });
  // 本会话已产出过的归一词（含跨方向），避免同一批点击内因父组件状态尚未回流而重复计数
  const emittedRef = useRef<Set<string>>(new Set());
  // 当前市场的方向扩词模板语言；null = 暂无已验证模板（UI 明确禁用并说明，绝不输出错误翻译词）
  const directionLang = directionLanguageForMarket(location);
  const seedNorm = normalizeKeywordForDedup(seed);

  /** 该方向在当前市场语言下的组合查询（语言不可用时为空——调用方据此禁用） */
  const queriesForDirection = (id: DirectionId): string[] =>
    directionLang ? composeDirectionQueries(seed, id, directionLang) : [];

  /**
   * 单方向核心执行（P7：完整扩展与单方向按钮共用）：把该方向的组合查询逐个交给真实
   * Google Autocomplete。中途失败保留已获得的结果并明确报错；同一方向重复点击允许
   * （缓存内零消耗）。error/empty 相位也如实带出已发生的请求与缓存计数，供聚合统计。
   */
  const runDirectionCore = async (id: DirectionId): Promise<DirectionPhase> => {
    const queries = queriesForDirection(id);
    const existingKeys = new Set(
      [...existingKeywords, ...emittedRef.current].map((k) => normalizeKeywordForDedup(k))
    );
    const collected: string[] = [];
    let requests = 0;
    let cacheHits = 0;
    let fetchedTotal = 0;
    let errorMessage: string | null = null;
    for (const query of queries) {
      try {
        const res = await fetch("/api/keywords/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed: query, location }),
        });
        const json = await res.json();
        if (!res.ok) {
          const { message } = handleBillingError(json, t("suggestFailed"));
          errorMessage = message;
          break;
        }
        requests += 1;
        const returned = (json.data?.suggestions ?? []) as string[];
        fetchedTotal += returned.length;
        if (json.data?.fromCache) cacheHits += 1;
        for (const s of returned) {
          const key = normalizeKeywordForDedup(s);
          if (!key || key === seedNorm || existingKeys.has(key)) continue;
          existingKeys.add(key);
          collected.push(s);
        }
      } catch (err) {
        errorMessage = `${tc("networkError")} ${(err as Error).message}`;
        break;
      }
    }
    if (collected.length > 0) {
      for (const word of collected) emittedRef.current.add(normalizeKeywordForDedup(word));
      onNewSuggestions(collected);
    }
    if (errorMessage) return { phase: "error", message: errorMessage, requests, cacheHits };
    if (requests === 0) return { phase: "empty", requests: 0, cacheHits: 0 };
    if (collected.length === 0) return { phase: "empty", requests, cacheHits };
    return { phase: "done", fetched: fetchedTotal, added: collected.length, requests, cacheHits };
  };

  const handleRunDirection = async (id: DirectionId) => {
    const lang = directionLang;
    if (!lang || phases[id]?.phase === "loading" || runAll.phase === "loading") return;
    setPhases((prev) => ({ ...prev, [id]: { phase: "loading" } }));
    const result = await runDirectionCore(id);
    setPhases((prev) => ({ ...prev, [id]: result }));
  };

  /**
   * 完整扩展（P7）：按模板顺序执行全部适用方向，方向之间互不回滚——某方向失败只中断
   * 该方向剩余查询，已成功方向的结果与统计全部保留。配额耗尽时后续方向的请求会快速
   * 429（服务端在扣费前拒绝），如实计入各方向错误状态。
   */
  const handleRunAll = async () => {
    const lang = directionLang;
    if (!lang || runAll.phase === "loading") return;
    setRunAll({ phase: "loading" });
    let requests = 0;
    let cacheHits = 0;
    let added = 0;
    for (const dir of EXPAND_DIRECTIONS) {
      setPhases((prev) => ({ ...prev, [dir.id]: { phase: "loading" } }));
      const result = await runDirectionCore(dir.id);
      setPhases((prev) => ({ ...prev, [dir.id]: result }));
      if (result.phase === "done") {
        requests += result.requests;
        cacheHits += result.cacheHits;
        added += result.added;
      } else if (result.phase === "empty" || result.phase === "error") {
        requests += result.requests;
        cacheHits += result.cacheHits;
      }
    }
    setRunAll({ phase: "done", requests, cacheHits, added });
  };

  return (
    <div className={variant === "embedded" ? "" : "mt-4 rounded-lg border border-line-soft p-3"}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {variant === "embedded" ? null : (
          <h3 className="font-sans text-ui-body font-medium leading-[20px] text-ink">{t("directionsTitle")}</h3>
        )}
        <span className="font-mono text-ui-caption leading-[16px] text-ink-40">
          {t("directionsCostNote", { max: MAX_QUERIES_PER_DIRECTION })}
        </span>
      </div>
      {directionLang === null ? (
        <p className="mt-2 font-sans text-ui-caption leading-[16px] text-ink-40">
          {t("directionsUnsupported", { market: location })}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRunAll}
              disabled={runAll.phase === "loading"}
              title={t("directionRunAllTitle", { max: MAX_QUERIES_PER_DIRECTION })}
              className={`h-[32px] whitespace-nowrap rounded-md border px-3 font-mono text-ui-caption font-semibold leading-[16px] transition-colors ${
                runAll.phase === "loading"
                  ? "border-line bg-card text-ink-40 opacity-60"
                  : "border-brand bg-brand text-white hover:opacity-90"
              }`}
            >
              {runAll.phase === "loading" ? t("directionRunAllRunning") : t("directionRunAll")}
            </button>
            {EXPAND_DIRECTIONS.map((dir) => {
              const phase = phases[dir.id]?.phase ?? "idle";
              const queryCount = queriesForDirection(dir.id).length;
              return (
                <button
                  key={dir.id}
                  type="button"
                  onClick={() => handleRunDirection(dir.id)}
                  disabled={phase === "loading" || runAll.phase === "loading"}
                  title={t("directionCostTitle", { max: queryCount })}
                  className={`h-[32px] whitespace-nowrap rounded-md border px-3 font-mono text-ui-caption leading-[16px] transition-colors ${
                    phase === "loading"
                      ? "border-line bg-card text-ink-40 opacity-60"
                      : "border-line bg-card text-ink-60 hover:border-ink-25 hover:text-ink"
                  }`}
                >
                  {phase === "loading" ? t("directionLoading") : t(`direction_${dir.id}`)}
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-sans text-ui-caption leading-[16px] text-ink-40">{t("directionsDataNote")}</p>
          {/* 完整扩展聚合统计：真实请求/缓存/新增合计，失败方向的结果保留 */}
          {runAll.phase === "done" && (
            <p className="mt-1.5 font-sans text-ui-caption font-medium leading-[16px] text-ink">
              {t("directionRunAllDone", {
                requests: formatNumber(runAll.requests, locale),
                cacheHits: formatNumber(runAll.cacheHits, locale),
                added: formatNumber(runAll.added, locale),
              })}
            </p>
          )}
          {/* 每方向结果状态：真实请求数/缓存命中数/新增数如实汇报 */}
          {EXPAND_DIRECTIONS.map((dir) => {
            const st = phases[dir.id];
            if (!st || st.phase === "idle" || st.phase === "loading") return null;
            return (
              <p key={dir.id} className="mt-1.5 font-sans text-ui-caption leading-[16px] text-ink-60">
                {t(`direction_${dir.id}`)}：
                {st.phase === "done" &&
                  t("directionDone", {
                    fetched: formatNumber(st.fetched, locale),
                    added: formatNumber(st.added, locale),
                    requests: formatNumber(st.requests, locale),
                    cacheHits: formatNumber(st.cacheHits, locale),
                  })}
                {st.phase === "empty" && t("directionEmpty", { requests: formatNumber(st.requests, locale) })}
                {st.phase === "error" && (
                  <span className="text-neg">
                    {t("directionError")} {st.message}
                  </span>
                )}
              </p>
            );
          })}
        </>
      )}
    </div>
  );
}
