// ===== 缓存层 + 月度用量保护 =====
// 主存储：SQLite api_cache / api_usage 表（部署友好）
// Fallback：data/cache/*.json + data/cache/usage.json（仅读，兼容本地历史数据）
// 用量计数按自然月归零，超过 80 次拒绝调用

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ApiUsage } from "./types";
import {
  getCache as dbGetCache,
  setCache as dbSetCache,
  getApiUsage as dbGetApiUsage,
  incrementApiUsage as dbIncrementApiUsage,
} from "@/lib/db";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const USAGE_LIMIT = 100;
const USAGE_SOFT_LIMIT = 80; // 超过 80 拒绝新调用，但允许读缓存
const USAGE_FILE = "usage.json";

interface CacheEntry<T> {
  data: T;
  savedAt: number; // epoch ms
  params: Record<string, string>;
}

interface UsageFile {
  month: string; // YYYY-MM
  used: number;
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

// ---------- 用量 ----------

/** 读取文件用量（fallback） */
async function readFileUsage(): Promise<UsageFile | null> {
  try {
    const file = path.join(CACHE_DIR, USAGE_FILE);
    const raw = await fs.readFile(file, "utf-8");
    const obj = JSON.parse(raw) as UsageFile;
    return obj;
  } catch {
    return null;
  }
}

/** 综合读取用量：优先 DB，fallback 到文件 */
async function readUsage(): Promise<UsageFile> {
  const month = currentMonth();
  // 1. 先读 DB
  try {
    const dbUsage = await dbGetApiUsage(month);
    if (dbUsage) {
      return { month, used: dbUsage.used };
    }
  } catch {
    // DB 未初始化或不可用，fallback
  }
  // 2. Fallback 文件
  const fileUsage = await readFileUsage();
  if (fileUsage && fileUsage.month === month) {
    return fileUsage;
  }
  return { month, used: 0 };
}

/** 真实调用 SerpApi 前检查 + 计数 +1 */
export async function consumeQuota(): Promise<ApiUsage> {
  const month = currentMonth();
  const u = await readUsage();
  if (u.used >= USAGE_SOFT_LIMIT) {
    throw new Error("QUOTA_EXCEEDED");
  }
  // 写入 DB（主存储）
  try {
    const updated = await dbIncrementApiUsage(month);
    return { used: updated.used, limit: USAGE_LIMIT, month };
  } catch {
    // DB 不可用时，仅依赖内存计数（不再写文件，per 铁律 2.5）
    return { used: u.used + 1, limit: USAGE_LIMIT, month };
  }
}

/** 不消耗额度，仅返回当前用量 */
export async function peekUsage(): Promise<ApiUsage> {
  const u = await readUsage();
  return { used: u.used, limit: USAGE_LIMIT, month: u.month };
}

export const USAGE_LIMIT_VALUE = USAGE_SOFT_LIMIT;

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
