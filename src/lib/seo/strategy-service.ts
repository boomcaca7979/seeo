// ===== 关键词策略业务层（生成 / 增量添加 / 分享 token）=====
//
// 数据真实性：
//   - 关键词全部来自 SerpApi 真实扩词（related_searches + PAA）；
//   - volume / KD / CPC 只在 DataForSEO 已配置且套餐含额度时补全，否则保持 null；
//   - 绝不使用样例数字、随机值或 SERP 条数冒充指标。
//
// 配额：
//   - 每个种子 1 次 SerpApi（24h 缓存命中不扣费）；
//   - DataForSEO 指标补全在所有种子合并后**只调用一次**，不是每种子一次。

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { AuthResult, PlanTier } from "@/lib/auth";
import { expandKeyword, getSerpUsage } from "./serp-service";
import { extractSerpContentKeywords } from "./serp-keywords";
import { isDataForSeoConfigured } from "./dataforseo";
import { enrichKeywordMetrics } from "./keyword-research-service";
import { normalizeKeywordForDedup } from "./keyword-merge";
import {
  buildStrategyDoc,
  deriveStrategyStatus,
  normalizeKeyword,
  type SeedExpansion,
  type StrategyDoc,
} from "./strategy-model";
import { peekUsage, getSerpApiDailyLimit } from "./cache";
import { setStrategyProgress, saveStrategyDoc, type StrategyStatus } from "@/lib/db/strategies";
import { resolveSerpMarket } from "./serpapi";
import { extractCompactSnapshot, type SerpSnapshotMap } from "./serp-snapshot";

// ---------- 市场 ----------

export interface MarketOption {
  id: string;
  /** SeeO/供应商使用的市场名（SerpApi location + DataForSEO location_name 的键） */
  zh: string;
  en: string;
  flag: string;
}

/** 7 个市场：id 仅用于 URL/DB，请求一律用 zh（供应商映射的键） */
export const STRATEGY_MARKETS: readonly MarketOption[] = [
  { id: "us", zh: "美国", en: "United States", flag: "🇺🇸" },
  { id: "uk", zh: "英国", en: "United Kingdom", flag: "🇬🇧" },
  { id: "cn", zh: "中国", en: "China", flag: "🇨🇳" },
  { id: "jp", zh: "日本", en: "Japan", flag: "🇯🇵" },
  { id: "de", zh: "德国", en: "Germany", flag: "🇩🇪" },
  { id: "hk", zh: "香港", en: "Hong Kong", flag: "🇭🇰" },
  { id: "tw", zh: "台湾", en: "Taiwan", flag: "🇨🇳" },
] as const;

export function resolveMarket(input: string): MarketOption | null {
  const value = input.trim();
  if (!value) return null;
  return (
    STRATEGY_MARKETS.find((m) => m.id === value) ??
    STRATEGY_MARKETS.find((m) => m.zh === value) ??
    STRATEGY_MARKETS.find((m) => m.en.toLowerCase() === value.toLowerCase()) ??
    null
  );
}

/** 市场有效性：必须命中 7 个受支持市场之一，绝不回落到中国 */
export function assertSupportedMarket(input: string): MarketOption {
  const market = resolveMarket(input);
  if (!market) {
    const error = new Error(`不支持的市场：${input || "(空)"}`);
    (error as Error & { code?: string }).code = "UNSUPPORTED_MARKET";
    throw error;
  }
  // SerpApi 映射必须存在（防止市场名与供应商键脱节）
  if (resolveSerpMarket(market.zh).fallback) {
    const error = new Error(`市场未在 SerpApi 映射中登记：${market.zh}`);
    (error as Error & { code?: string }).code = "UNSUPPORTED_MARKET";
    throw error;
  }
  return market;
}

// ---------- 种子校验 ----------

export const MAX_SEEDS = 5;

export interface SeedValidation {
  seeds: string[];
  /** 被丢弃的重复项（用户可见提示） */
  duplicates: string[];
  error: string | null;
}

export function validateSeeds(input: string[] | string): SeedValidation {
  const list = Array.isArray(input)
    ? input
    : input.split(/[\n,，]/g);
  const seen = new Set<string>();
  const seeds: string[] = [];
  const duplicates: string[] = [];
  for (const raw of list) {
    const trimmed = String(raw).replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = normalizeKeywordForDedup(trimmed);
    if (seen.has(key)) {
      duplicates.push(trimmed);
      continue;
    }
    seen.add(key);
    seeds.push(trimmed);
  }
  if (seeds.length === 0) return { seeds, duplicates, error: "请至少输入一个种子关键词" };
  if (seeds.length > MAX_SEEDS) {
    return { seeds: seeds.slice(0, MAX_SEEDS), duplicates, error: `最多支持 ${MAX_SEEDS} 个种子关键词` };
  }
  return { seeds, duplicates, error: null };
}

// ---------- 配额预检 ----------

export interface QuotaPreflight {
  ok: boolean;
  needed: number;
  /** 当前可用次数（月/日取小） */
  available: number;
  /** 可用次数少于种子数：允许执行，但可能只成功一部分（缓存命中不消耗） */
  tight: boolean;
  monthlyRemaining: number;
  dailyRemaining: number | null;
  message: string | null;
}

/**
 * 开跑前预检：SerpApi 月度余额 + 日度余额（free 3/天）。
 * 缓存命中不扣费，所以这里只做「最多可能消耗」的保守判断，
 * 不足时直接告知而不发起任何供应商请求。
 */
export async function preflightSerpQuota(
  userId: string,
  plan: PlanTier,
  seedCount: number
): Promise<QuotaPreflight> {
  const usage = await peekUsage(userId, "serpapi", plan);
  const monthlyRemaining = Math.max(0, usage.limit - usage.used);
  const dailyLimit = await getSerpApiDailyLimit(plan);
  let dailyRemaining: number | null = null;
  if (dailyLimit > 0) {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    // 日用量读取失败不影响主流程（由 consumeQuota 兜底拦截）
    try {
      const { getApiDailyUsage } = await import("@/lib/db");
      const row = await getApiDailyUsage(userId, "serpapi", today);
      dailyRemaining = Math.max(0, dailyLimit - (row?.used ?? 0));
    } catch {
      dailyRemaining = dailyLimit;
    }
  }
  const available = dailyRemaining === null ? monthlyRemaining : Math.min(monthlyRemaining, dailyRemaining);
  // 缓存命中不消耗额度：因此「可用次数 < 种子数」不硬拦，只在 0 次时拒绝。
  // 逐次消耗由 consumeQuota 强约束，绝不会超额调用供应商。
  if (available <= 0) {
    return {
      ok: false,
      needed: seedCount,
      available,
      tight: true,
      monthlyRemaining,
      dailyRemaining,
      message:
        `SerpApi 额度已用尽（月度剩余 ${monthlyRemaining}` +
        (dailyRemaining !== null ? `、今日剩余 ${dailyRemaining}` : "") +
        "）。请升级套餐或等待额度重置后再创建策略。",
    };
  }
  const tight = available < seedCount;
  return {
    ok: true,
    needed: seedCount,
    available,
    tight,
    monthlyRemaining,
    dailyRemaining,
    message: tight
      ? `当前可用 ${available} 次 SerpApi 请求，少于种子数 ${seedCount}：缓存命中的种子不受影响，未命中的种子可能因额度不足失败并标记为 Partial。`
      : null,
  };
}

// ---------- 生成 ----------

export interface RunStrategyParams {
  userId: string;
  plan: PlanTier;
  strategyId: number;
  seeds: string[];
  /** 已校验的市场名（中文，供应商键） */
  market: string;
  device: "PC" | "移动端";
  /** true = 本次运行是 Add keywords（新种子来自用户手动追加） */
  manual?: boolean;
  /** Add keywords：保留原有词并合并新种子的结果 */
  existing?: StrategyDoc | null;
  /** 重试失败种子：保留其它种子上一轮的 perSeed 记录 */
  previousMeta?: StrategyDoc["meta"] | null;
  existingFavorites?: string[];
}

export interface RunStrategyResult {
  status: StrategyStatus;
  doc: StrategyDoc;
}

/**
 * 真实生成：逐种子 SerpApi 扩词 → 全局去重 → (可选) 一次指标补全 → 聚类/主题/Pillar。
 * 单种子失败不阻断其它种子（partial），全部失败才 failed。
 */
export async function runStrategy(params: RunStrategyParams): Promise<RunStrategyResult> {
  const { userId, plan, strategyId, market, device } = params;
  const seeds = params.seeds;
  const total = seeds.length || 1;

  await setStrategyProgress(userId, strategyId, { status: "running", progress: 5, error: null });

  const expansions: SeedExpansion[] = [];
  // 本轮新产生的 compact SERP 快照（每成功种子一份，来自同一次已有 SerpApi 响应，零额外成本）
  const freshSnapshots: SerpSnapshotMap = {};
  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];
    try {
      const expansion = await expandKeyword(userId, plan, { keyword: seed, location: market, device });
      const organic = expansion.serpSnapshot?.organic ?? [];
      expansions.push({
        seed,
        ok: true,
        related: expansion.related,
        paa: expansion.paa,
        // 从真实 SERP 标题/摘要提取的候选（来源标记 serp_content，零额外 API 成本）
        content: extractSerpContentKeywords(organic, seed, 12),
        fetchedAt: expansion.serpSnapshot?.fetchedAt ?? null,
        manual: params.manual === true,
        metrics: new Map(),
        serpFeatures: (expansion.serpSnapshot?.features ?? []).map((f) => f.featureType),
      });
      if (expansion.serpSnapshot) {
        freshSnapshots[normalizeKeyword(seed)] = extractCompactSnapshot(seed, market, expansion.serpSnapshot);
      }
    } catch (e) {
      expansions.push({
        seed,
        ok: false,
        error: (e as Error).message,
        related: [],
        paa: [],
        fetchedAt: null,
        manual: params.manual === true,
        metrics: new Map(),
        serpFeatures: null,
      });
    }
    const progress = 10 + Math.round((60 * (i + 1)) / total);
    await setStrategyProgress(userId, strategyId, { progress });
  }

  const okCount = expansions.filter((e) => e.ok).length;
  if (okCount === 0) {
    const doc = buildStrategyDoc({
      seeds,
      expansions,
      market,
      device,
      existing: params.existing?.keywords ?? undefined,
    });
    await setStrategyProgress(userId, strategyId, {
      status: "failed",
      progress: 100,
      error: "全部种子扩词失败，未生成任何结果",
    });
    await saveStrategyDoc(userId, strategyId, doc, "failed");
    return { status: "failed", doc };
  }

  // 指标补全：所有种子合并后只调用一次（DataForSEO 未配置时静默跳过，指标保持 null）
  await setStrategyProgress(userId, strategyId, { progress: 75 });
  const candidateKeys = new Set<string>();
  for (const expansion of expansions) {
    if (!expansion.ok) continue;
    for (const kw of [expansion.seed, ...expansion.related, ...expansion.paa]) {
      const id = normalizeKeyword(kw);
      if (id) candidateKeys.add(id);
    }
  }
  if (isDataForSeoConfigured() && candidateKeys.size > 0) {
    const list = [...candidateKeys].slice(0, 700);
    const enriched = await enrichKeywordMetrics(userId, plan, list, market);
    if (enriched.rows.length > 0) {
      const byKeyword = new Map(enriched.rows.map((r) => [normalizeKeywordForDedup(r.keyword), r]));
      for (const expansion of expansions) {
        const metrics = new Map<string, { volume: number | null; kd: number | null; cpc: number | null; intent: string | null }>();
        for (const kw of [expansion.seed, ...expansion.related, ...expansion.paa]) {
          const row = byKeyword.get(normalizeKeywordForDedup(kw));
          if (row) metrics.set(normalizeKeyword(kw), { volume: row.searchVolume, kd: row.difficulty, cpc: row.cpc, intent: row.intent });
        }
        expansion.metrics = metrics;
      }
    }
  }

  await setStrategyProgress(userId, strategyId, { progress: 85 });
  // 快照合并：Add keywords / 重试场景保留旧种子的历史快照，只更新本轮种子的
  const priorSnapshots: SerpSnapshotMap =
    params.previousMeta?.serpSnapshots ?? params.existing?.meta.serpSnapshots ?? {};
  const mergedSnapshots: SerpSnapshotMap = { ...priorSnapshots, ...freshSnapshots };
  const doc = buildStrategyDoc({
    seeds,
    expansions,
    market,
    device,
    existing: params.existing?.keywords ?? undefined,
    snapshots: mergedSnapshots,
  });

  // 重试场景：把上一轮其它种子的结果并回 perSeed，避免历史记录被这一轮覆盖
  if (params.previousMeta) {
    const retried = new Set(seeds.map((s) => s.trim().toLowerCase()));
    const kept = params.previousMeta.perSeed.filter((p) => !retried.has(p.seed.trim().toLowerCase()));
    doc.meta.perSeed = [...kept, ...doc.meta.perSeed];
    doc.meta.failedSeeds = doc.meta.perSeed.filter((p) => !p.ok).map((p) => p.seed);
    doc.meta.addedSeeds = [
      ...new Set([...(params.previousMeta.addedSeeds ?? []), ...doc.meta.addedSeeds]),
    ];
    doc.meta.serpSnapshots = mergedSnapshots;
    const keptWarnings = params.previousMeta.warnings.filter((w) => !w.startsWith("种子「"));
    const failedWarnings = doc.meta.perSeed
      .filter((p) => !p.ok)
      .map((p) => `种子「${p.seed}」扩词失败：${p.error ?? "未知原因"}`);
    doc.meta.warnings = [...new Set([...keptWarnings, ...failedWarnings, ...doc.meta.warnings.filter((w) => !w.startsWith("种子「"))])];
  }

  const status: StrategyStatus = deriveStrategyStatus(doc.meta.perSeed);
  await saveStrategyDoc(userId, strategyId, doc, status);
  return { status, doc };
}

// ---------- 归属 ----------

/**
 * 策略数据归属：
 *   - 已登录（生产）：Supabase user.id，严格按账号隔离；
 *   - 演示模式（未开启鉴权）：浏览器级随机 scope cookie（`demo:<scope>`），
 *     不共用固定 demo-user，避免不同访客互相读到策略。
 */
const SCOPE_COOKIE = "seeo_ks_scope";

export async function resolveStrategyOwner(auth: AuthResult): Promise<string> {
  if (auth.user?.id && !auth.skip) return auth.user.id;
  const jar = await cookies();
  let scope = jar.get(SCOPE_COOKIE)?.value;
  if (!scope || !/^[a-f0-9]{16,64}$/.test(scope)) {
    scope = randomBytes(12).toString("hex");
    try {
      jar.set(SCOPE_COOKIE, scope, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    } catch {
      // 只读上下文无法写 cookie：本次退化为一次性 scope，仍然不与他人共享
    }
  }
  return `demo:${scope}`;
}

/** 后台任务入口（route 的 after() 调用；失败时由调用方标记 failed） */
export async function createStrategyRun(params: RunStrategyParams): Promise<RunStrategyResult> {
  return runStrategy(params);
}

// ---------- 分享 ----------

/** 24 字节随机 → 32 字符 base64url（不可预测，不可枚举） */
export function createShareToken(): string {
  return randomBytes(24).toString("base64url");
}

// ---------- 展示辅助 ----------

export function strategySharePath(token: string): string {
  return `/share/keyword-strategy/${token}`;
}

/** 供 API 返回的用量快照（测试前后可比对） */
export async function strategyUsage(userId: string, plan: PlanTier) {
  return getSerpUsage(userId, plan);
}
