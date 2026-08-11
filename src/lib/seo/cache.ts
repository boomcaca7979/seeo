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
  incrementUserApiUsage,
  type ApiType,
} from "@/lib/db";
import type { PlanTier } from "@/lib/auth";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// 各套餐的 API 月度限额配置
// free: 50 次 SerpApi / 0 次 DataForSEO
// lite: 300 次 SerpApi / 5 次 DataForSEO
// pro: 2000 次 SerpApi / 30 次 DataForSEO
const PLAN_LIMITS: Record<PlanTier, Record<ApiType, number>> = {
  free: { serpapi: 50, dataforseo: 0, content_check: 10 },
  lite: { serpapi: 300, dataforseo: 5, content_check: 50 },
  pro: { serpapi: 2000, dataforseo: 30, content_check: 300 },
};

/** 获取某套餐某 API 的月度限额 */
export function getPlanLimit(plan: PlanTier, apiType: ApiType): number {
  return PLAN_LIMITS[plan]?.[apiType] ?? PLAN_LIMITS.free[apiType];
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
 */
export async function consumeQuota(
  userId: string,
  apiType: ApiType,
  plan: PlanTier = "free"
): Promise<ApiUsage> {
  const month = currentMonth();
  const limit = getPlanLimit(plan, apiType);

  // 读取当前用户用量
  const existing = await getUserApiUsage(userId, apiType, month);
  const used = existing?.used ?? 0;

  if (used >= limit) {
    throw new QuotaExceededError(used, limit, apiType, month);
  }

  // 写入 DB（主存储，用户级）
  try {
    const updated = await incrementUserApiUsage(userId, apiType, month, limit);
    return { used: updated.used, limit: updated.limit, month };
  } catch {
    // DB 不可用时，仅依赖内存计数（不阻塞调用）
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
  const limit = getPlanLimit(plan, apiType);
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

  constructor(used: number, limit: number, apiType: ApiType, month: string) {
    const apiLabel = apiType === "dataforseo" ? "DataForSEO" : "SerpApi";
    super(`本月${apiLabel}额度已用尽（${used}/${limit}），下月 1 日自动重置`);
    this.name = "QuotaExceededError";
    this.used = used;
    this.limit = limit;
    this.apiType = apiType;
    this.month = month;
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
