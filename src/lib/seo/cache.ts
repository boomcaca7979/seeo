// ===== 缓存层 + 月度用量保护 =====
// 主存储：SQLite api_cache / api_usage_per_user 表（部署友好）
// Fallback：data/cache/*.json + data/cache/usage.json（仅读，兼容本地历史数据）
// 用量计数按自然月归零，按用户+API类型隔离

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ApiUsage } from "./types";
import {
  getCache as dbGetCache,
  setCache as dbSetCache,
  getUserApiUsage,
  tryIncrementUserApiUsage,
  getApiDailyUsage,
  tryIncrementApiDailyUsage,
  type ApiType,
} from "@/lib/db";
import type { PlanTier } from "@/lib/auth";
import { getPlanLimits } from "@/lib/billing";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * 获取某套餐某 API 的月度限额
 * 统一从 billing.ts 的权威来源读取（优先 Supabase plan_limits 表，fallback DEFAULT_PLAN_LIMITS）
 */
export async function getPlanLimit(plan: PlanTier, apiType: ApiType): Promise<number> {
  const limits = await getPlanLimits(plan);
  const fieldMap: Record<ApiType, keyof typeof limits> = {
    serpapi: "serpapi_monthly_limit",
    dataforseo: "dataforseo_monthly_limit",
    content_check: "content_check_monthly_limit",
  };
  const field = fieldMap[apiType];
  const val = limits[field];
  return typeof val === "number" ? val : 0;
}

/**
 * 获取某套餐 SerpApi 每日限额（0 = 无日度限制）
 * 仅 SerpApi 支持日度限额（Free 套餐 3 次/天）
 */
export async function getSerpApiDailyLimit(plan: PlanTier): Promise<number> {
  const limits = await getPlanLimits(plan);
  return typeof limits.serpapi_daily_limit === "number" ? limits.serpapi_daily_limit : 0;
}

interface CacheEntry<T> {
  data: T;
  savedAt: number; // epoch ms
  params: Record<string, string>;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

function hashKey(...parts: string[]): string {
  // 简单稳定哈希（避免引入 crypto 大依赖）
  let h = 0;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return `k${(h >>> 0).toString(36)}`;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

// ---------- 用户级用量（P0 商业化改造） ----------

/**
 * 真实调用外部 API 前检查 + 计数 +1（按用户 + API 类型隔离）
 * 超过套餐限额时抛出 QuotaExceededError
 *
 * SerpApi 双 guard：每日限额（serpapi_daily_limit > 0 时）+ 月度限额。
 * 每日先消耗（次日重置，超限时对用户伤害更小），再消耗月度。
 *
 * 原子化：检查与递增在同一条 SQL 中完成，消除 TOCTOU 竞态
 */
export async function consumeQuota(
  userId: string,
  apiType: ApiType,
  plan: PlanTier = "free"
): Promise<ApiUsage> {
  const month = currentMonth();
  const limit = await getPlanLimit(plan, apiType);

  // ---- SerpApi 每日限额 guard（0 = 无日度限制） ----
  if (apiType === "serpapi") {
    const dailyLimit = await getSerpApiDailyLimit(plan);
    if (dailyLimit > 0) {
      const today = todayStr();
      try {
        const daily = await tryIncrementApiDailyUsage(userId, apiType, today, dailyLimit);
        if (!daily.ok) {
          throw new QuotaExceededError(daily.used, daily.limit, apiType, month, "daily");
        }
      } catch (e) {
        if (e instanceof QuotaExceededError) throw e;
        // DB 不可用时兜底：读当前日用量做应用层检查
        const existing = await getApiDailyUsage(userId, apiType, today);
        if ((existing?.used ?? 0) >= dailyLimit) {
          throw new QuotaExceededError(existing?.used ?? dailyLimit, dailyLimit, apiType, month, "daily");
        }
      }
    }
  }

  // ---- 月度限额 guard（原有逻辑） ----
  // 原子化消耗：DB 层 UPSERT + WHERE used < limit + RETURNING
  try {
    const result = await tryIncrementUserApiUsage(userId, apiType, month, limit);
    if (result.ok) {
      return { used: result.used, limit: result.limit, month };
    }
    // 已达上限
    throw new QuotaExceededError(result.used, result.limit, apiType, month);
  } catch (e) {
    // QuotaExceededError 直接抛出
    if (e instanceof QuotaExceededError) throw e;
    // DB 不可用时的 fallback：读当前用量做应用层检查（非原子，仅兜底）
    const existing = await getUserApiUsage(userId, apiType, month);
    const used = existing?.used ?? 0;
    if (used >= limit) {
      throw new QuotaExceededError(used, limit, apiType, month);
    }
    return { used: used + 1, limit, month };
  }
}

/**
 * 不消耗额度，仅返回当前用户某 API 的用量
 */
export async function peekUsage(
  userId: string = "demo-user",
  apiType: ApiType = "serpapi",
  plan: PlanTier = "free"
): Promise<ApiUsage> {
  const month = currentMonth();
  const limit = await getPlanLimit(plan, apiType);
  try {
    const existing = await getUserApiUsage(userId, apiType, month);
    if (existing) {
      return { used: existing.used, limit, month };
    }
  } catch {
    // DB 未初始化或不可用
  }
  return { used: 0, limit, month };
}

/** 配额超限错误 */
export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  readonly used: number;
  readonly limit: number;
  readonly apiType: ApiType;
  readonly month: string;
  /** 超限维度：monthly（月度）/ daily（每日） */
  readonly scope: "monthly" | "daily";

  constructor(used: number, limit: number, apiType: ApiType, month: string, scope: "monthly" | "daily" = "monthly") {
    const apiLabel = apiType === "dataforseo" ? "DataForSEO" : "SerpApi";
    super(
      scope === "daily"
        ? `今日${apiLabel}额度已用尽（${used}/${limit}），明日自动重置`
        : `本月${apiLabel}额度已用尽（${used}/${limit}），下月 1 日自动重置`
    );
    this.name = "QuotaExceededError";
    this.used = used;
    this.limit = limit;
    this.apiType = apiType;
    this.month = month;
    this.scope = scope;
  }
}

// ---------- 缓存 ----------

/** 读取文件缓存（fallback） */
async function readFileCache<T>(file: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.savedAt > CACHE_TTL_MS) {
      return null; // 过期
    }
    return entry;
  } catch {
    return null;
  }
}

export async function readCache<T>(
  namespace: string,
  params: Record<string, string>
): Promise<T | null> {
  const key = hashKey(namespace, ...Object.entries(params).map(([k, v]) => `${k}=${v}`));

  // 1. 先读 DB
  try {
    const row = await dbGetCache(key);
    if (row) {
      const expiresAt = new Date(row.expiresAt).getTime();
      if (Date.now() < expiresAt) {
        try {
          const entry = JSON.parse(row.value) as CacheEntry<T>;
          return entry.data;
        } catch {
          // value 解析失败，fallback 文件
        }
      }
    }
  } catch {
    // DB 未初始化或不可用，fallback
  }

  // 2. Fallback 文件（兼容本地历史数据）
  await ensureDir();
  const file = path.join(CACHE_DIR, `${namespace}-${key}.json`);
  const fileEntry = await readFileCache<T>(file);
  return fileEntry ? fileEntry.data : null;
}

export async function writeCache<T>(
  namespace: string,
  params: Record<string, string>,
  data: T
): Promise<void> {
  const key = hashKey(namespace, ...Object.entries(params).map(([k, v]) => `${k}=${v}`));
  const entry: CacheEntry<T> = { data, savedAt: Date.now(), params };
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

  // 写入 DB（主存储）
  try {
    await dbSetCache(key, JSON.stringify(entry), expiresAt);
    return;
  } catch {
    // DB 不可用时，fallback 文件（仅本地兜底）
  }

  // Fallback 文件写入
  await ensureDir();
  const file = path.join(CACHE_DIR, `${namespace}-${key}.json`);
  await fs.writeFile(file, JSON.stringify(entry, null, 2), "utf-8");
}
