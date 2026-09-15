// ===== 公开外链检查工具（/tools/backlink-checker）服务层 =====
//
// 目标：让匿名访客在无需登录的前提下拿到真实的外链概况预览，
// 同时把 DataForSEO 成本约束在可控范围内。
//
// 复用策略（不新建另一套 backlink 数据服务）：
//   - 数据获取：沿用 src/lib/seo/dataforseo.ts 的 fetchBacklinks（summary + backlinks 两个 live 端点）
//   - 缓存/持久化：沿用 src/lib/db/backlinks.ts 的 getBacklinkSummary / listBacklinks / saveBacklinks，
//     仅换一个保留的 user_id 作用域（PUBLIC_CACHE_SCOPE），因此天然获得 7 天快照语义，
//     并与登录用户的数据完全隔离
//   - 冷却标记：沿用 src/lib/seo/cache.ts 的 readCache / writeCache（DB 支持，跨实例可见）
//   - 每日额度：沿用 src/lib/db 的 tryIncrementApiDailyUsage（单条 SQL 原子递增，消除 TOCTOU）
//
// 成本模型：DataForSEO 每次真实刷新 = 2 次 provider 调用（summary + backlinks）。
// 因此开销只发生在「缓存未命中且不在冷却期」的那一次请求上；
// 同域名重复查询、以及 7 天内的再次查询，全部由缓存承担，不产生 provider 成本。

import { getBacklinkSummary, listBacklinks, saveBacklinks, type BacklinkSummaryRow } from "@/lib/db/backlinks";
import { tryIncrementApiDailyUsage } from "@/lib/db";
import { fetchBacklinks, isDataForSeoConfigured } from "./dataforseo";
import { readCache, writeCache } from "./cache";

// ---------- 常量 ----------

/** 公开工具专用的缓存作用域（与真实用户的 user_id 永不冲突） */
export const PUBLIC_CACHE_SCOPE = "public:backlink-checker";
/** 全局每日真实刷新预算的额度维度 key */
export const PUBLIC_GLOBAL_SCOPE = "public:backlink-checker:global";

/** 快照有效期：7 天（与登录用户的外链缓存语义一致） */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 单域名刷新冷却：抑制失败重试风暴与同域高频轮询（跨实例，DB 支持） */
export const COOLDOWN_MS = 10 * 60 * 1000;

/** 免费预览展示的外链样本条数 */
export const PREVIEW_SAMPLE_LIMIT = 5;
/** 单次刷新实际持久化的外链行上限（provider 侧 limit，与登录用户一致） */
export const STORED_LINK_LIMIT = 100;

export const CACHE_TTL_DAYS = 7;

/** 单访客每日允许触发的真实刷新次数（缓存命中不计数） */
export const IP_DAILY_FETCH_LIMIT = (() => {
  const raw = Number(process.env.PUBLIC_BACKLINK_IP_DAILY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
})();

/** 全站每日允许触发的真实刷新总次数——公开工具的硬成本上限 */
export const GLOBAL_DAILY_FETCH_LIMIT = (() => {
  const raw = Number(process.env.PUBLIC_BACKLINK_GLOBAL_DAILY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
})();

// ---------- 域名校验与归一化 ----------

export type PublicDomainError = "EMPTY" | "INVALID_DOMAIN" | "PRIVATE_HOST";

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const BLOCKED_EXACT = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".lan", ".home", ".test", ".invalid", ".example", ".onion"];

/**
 * 归一化并校验用户输入的域名。
 *
 * 接受：example.com / EXAMPLE.com / https://example.com/path?q=1 / example.com:8080 /
 *       末尾带点、带斜杠、带空格、以及 Unicode 国际化域名（由 URL 解析转 punycode）
 * 拒绝：空输入、无法解析的主机名、IPv4/IPv6 字面量、localhost 与内部/保留域名
 *
 * 说明：本工具面向公网域名，因此对任何 IP 字面量一律拒绝（包含公网 IP），
 * 以避免把接口变成任意地址探针；私网/环回/链路本地地址同样在内。
 */
export function normalizePublicDomain(
  raw: string
): { ok: true; domain: string } | { ok: false; code: PublicDomainError } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, code: "EMPTY" };
  if (trimmed.length > 512) return { ok: false, code: "INVALID_DOMAIN" };

  // 交给 URL 解析处理协议 / 路径 / 查询 / 端口 / 尾点，并顺带完成 IDN → punycode
  let hostname: string;
  try {
    const candidate = /^[a-z][a-z0-9+.\-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed.replace(/^\/+/, "")}`;
    hostname = new URL(candidate).hostname;
  } catch {
    return { ok: false, code: "INVALID_DOMAIN" };
  }

  hostname = hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname) return { ok: false, code: "INVALID_DOMAIN" };

  // 统一到裸域名：并入 `www.` 前缀，使 www.example.com 与 example.com 共享同一条
  // 缓存快照与同一次 provider 调用。否则同一站点会产生两条缓存、两次 DataForSEO
  // 消耗，并把单域名冷却绕开（冷却按规范化域名维度判定）。
  if (hostname.startsWith("www.") && hostname.split(".").length > 2) {
    hostname = hostname.slice(4);
  }

  // IPv6 字面量（URL 解析结果为 [::1] 形式）
  if (hostname.startsWith("[") || hostname.includes(":")) return { ok: false, code: "PRIVATE_HOST" };
  // IPv4 字面量（含公网 IP：本工具只接域名）
  if (IPV4_RE.test(hostname)) return { ok: false, code: "PRIVATE_HOST" };

  if (BLOCKED_EXACT.has(hostname)) return { ok: false, code: "PRIVATE_HOST" };
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return { ok: false, code: "PRIVATE_HOST" };

  if (hostname.length > 253) return { ok: false, code: "INVALID_DOMAIN" };

  const labels = hostname.split(".");
  if (labels.length < 2) return { ok: false, code: "INVALID_DOMAIN" };
  for (const label of labels) {
    if (!label || label.length > 63) return { ok: false, code: "INVALID_DOMAIN" };
    if (label.startsWith("-") || label.endsWith("-")) return { ok: false, code: "INVALID_DOMAIN" };
    if (!/^[a-z0-9-]+$/.test(label)) return { ok: false, code: "INVALID_DOMAIN" };
  }
  // TLD 必须为字母组成，或 punycode 形式（IDN）
  const tld = labels[labels.length - 1];
  if (!/^([a-z]{2,}|xn--[a-z0-9-]{2,})$/.test(tld)) return { ok: false, code: "INVALID_DOMAIN" };

  return { ok: true, domain: hostname };
}

// ---------- 结果类型 ----------

export interface PublicBacklinkSample {
  sourceUrl: string | null;
  anchor: string | null;
  targetUrl: string | null;
  dofollow: boolean | null;
  sourceRank: number | null;
  firstSeen: string | null;
}

export interface PublicBacklinkPreview {
  domain: string;
  summary: {
    totalBacklinks: number | null;
    referringDomains: number | null;
    domainRank: number | null;
    dofollowPct: number | null;
  };
  /** 来源权重最高的若干条外链（免费预览样本） */
  sample: PublicBacklinkSample[];
  /** 样本中 dofollow 的条数（仅统计样本，页面必须如此标注） */
  sampleDofollow: number;
  /** 该域名本次刷新实际持久化的外链行数 */
  storedLinks: number;
  cachedAt: string | null;
  fromCache: boolean;
  preview: {
    sampleLimit: number;
    storedLimit: number;
    cacheDays: number;
  };
}

/**
 * 对外错误码。取值全部来自集中式 catalog（src/lib/errors/api-error-codes.ts），
 * 因此前端与其他消费方都能用统一的 code → 本地化文案映射。
 */
export type PublicPreviewErrorCode =
  | "INVALID_DOMAIN"
  | "PRIVATE_HOST"
  | "BACKLINK_COOLDOWN"
  | "CHECKER_DAILY_LIMIT"
  | "CHECKER_BUDGET_EXHAUSTED"
  | "DATAFORSEO_NOT_CONFIGURED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR";

export type PublicPreviewOutcome =
  | { ok: true; data: PublicBacklinkPreview }
  | { ok: false; code: PublicPreviewErrorCode; retryAfterSeconds: number };

// ---------- 内部工具 ----------

function fetchedAtMs(value: string): number {
  const parsed = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(60, Math.ceil((next - now) / 1000));
}

function buildPreview(
  domain: string,
  summary: BacklinkSummaryRow,
  rows: Array<{
    source_url: string | null;
    anchor: string | null;
    target_url: string | null;
    dofollow: number | null;
    source_rank: number | null;
    first_seen: string | null;
  }>,
  fromCache: boolean
): PublicBacklinkPreview {
  // listBacklinks 已按 source_rank DESC 排序，直接截取前 N 条即「来源权重最高」
  const sample: PublicBacklinkSample[] = rows.slice(0, PREVIEW_SAMPLE_LIMIT).map((row) => ({
    sourceUrl: row.source_url,
    anchor: row.anchor,
    targetUrl: row.target_url,
    dofollow: row.dofollow === null ? null : row.dofollow === 1,
    sourceRank: row.source_rank,
    firstSeen: row.first_seen,
  }));

  return {
    domain,
    summary: {
      totalBacklinks: summary.total_backlinks,
      referringDomains: summary.referring_domains,
      domainRank: summary.domain_rank,
      dofollowPct: summary.dofollow_pct,
    },
    sample,
    sampleDofollow: sample.filter((item) => item.dofollow === true).length,
    storedLinks: rows.length,
    cachedAt: summary.fetched_at,
    fromCache,
    preview: {
      sampleLimit: PREVIEW_SAMPLE_LIMIT,
      storedLimit: STORED_LINK_LIMIT,
      cacheDays: CACHE_TTL_DAYS,
    },
  };
}

/** 读取公开作用域内的有效快照；过期或不存在返回 null */
async function readFreshPreview(domain: string): Promise<PublicBacklinkPreview | null> {
  const summary = await getBacklinkSummary(PUBLIC_CACHE_SCOPE, domain);
  if (!summary) return null;
  if (Date.now() - fetchedAtMs(summary.fetched_at) > CACHE_TTL_MS) return null;
  const rows = await listBacklinks(PUBLIC_CACHE_SCOPE, domain, STORED_LINK_LIMIT);
  return buildPreview(domain, summary, rows, true);
}

async function readCooldownMarker(domain: string): Promise<number> {
  try {
    const marker = await readCache<{ at: number }>("public-blink-fetch", { domain });
    return marker?.at ?? 0;
  } catch {
    return 0;
  }
}

// ---------- 主入口 ----------

/**
 * 获取公开外链预览。
 *
 * 顺序（成本从低到高）：
 *   1. 域名校验（本地，零成本）
 *   2. 7 天缓存命中 → 直接返回，不消耗任何额度、不触发 provider
 *   3. provider 未配置 → 明确报错，不消耗额度
 *   4. 单域名冷却（DB 标记，含失败重试抑制）
 *   5. 单访客每日刷新上限（原子）
 *   6. 全站每日刷新上限（原子，硬成本闸门）
 *   7. DataForSEO 真实刷新 → 持久化 → 返回
 */
export async function getPublicBacklinkPreview(
  rawDomain: string,
  clientIp: string
): Promise<PublicPreviewOutcome> {
  const normalized = normalizePublicDomain(rawDomain);
  if (!normalized.ok) {
    return {
      ok: false,
      code: normalized.code === "PRIVATE_HOST" ? "PRIVATE_HOST" : "INVALID_DOMAIN",
      retryAfterSeconds: 0,
    };
  }
  const domain = normalized.domain;

  // 2) 缓存优先：命中即返回，零 provider 成本、零额度消耗
  //    （放在 provider 配置检查之前，让凭证临时缺失时仍可降级服务已缓存的域名）
  const cached = await readFreshPreview(domain);
  if (cached) return { ok: true, data: cached };

  if (!isDataForSeoConfigured()) {
    return { ok: false, code: "DATAFORSEO_NOT_CONFIGURED", retryAfterSeconds: 0 };
  }

  // 3) 单域名冷却
  const markedAt = await readCooldownMarker(domain);
  if (markedAt > 0 && Date.now() - markedAt < COOLDOWN_MS) {
    return {
      ok: false,
      code: "BACKLINK_COOLDOWN",
      retryAfterSeconds: Math.max(1, Math.ceil((COOLDOWN_MS - (Date.now() - markedAt)) / 1000)),
    };
  }

  // 4) 单访客每日上限
  const day = utcDay();
  const ipScope = `public-checker:ip:${clientIp}`;
  const ipUsage = await tryIncrementApiDailyUsage(ipScope, "dataforseo", day, IP_DAILY_FETCH_LIMIT);
  if (!ipUsage.ok) {
    return { ok: false, code: "CHECKER_DAILY_LIMIT", retryAfterSeconds: secondsUntilUtcMidnight() };
  }

  // 5) 全站每日上限
  const globalUsage = await tryIncrementApiDailyUsage(PUBLIC_GLOBAL_SCOPE, "dataforseo", day, GLOBAL_DAILY_FETCH_LIMIT);
  if (!globalUsage.ok) {
    return { ok: false, code: "CHECKER_BUDGET_EXHAUSTED", retryAfterSeconds: secondsUntilUtcMidnight() };
  }

  // 6) 先落冷却标记：即使 provider 失败也不会被同一访客立刻重试打穿
  try {
    await writeCache("public-blink-fetch", { domain }, { at: Date.now() }, COOLDOWN_MS);
  } catch {
    // 标记写入失败不阻断主流程（每日额度仍是硬闸门）
  }

  let fetched;
  try {
    fetched = await fetchBacklinks(domain, { limit: STORED_LINK_LIMIT });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 记录服务端日志便于排查；对外只暴露归一化错误码，不回传 provider 细节
    console.error("[public-backlink-checker] provider error", { domain, message });
    return {
      ok: false,
      code: /超时|timeout|abort/i.test(message) ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR",
      retryAfterSeconds: 0,
    };
  }

  await saveBacklinks(PUBLIC_CACHE_SCOPE, {
    domain,
    summary: { ...fetched.summary, raw_json: JSON.stringify(fetched.rawJson) },
    rows: fetched.backlinks,
  });

  const fresh = await readFreshPreview(domain);
  if (!fresh) {
    return { ok: false, code: "UPSTREAM_ERROR", retryAfterSeconds: 0 };
  }
  return { ok: true, data: { ...fresh, fromCache: false } };
}
