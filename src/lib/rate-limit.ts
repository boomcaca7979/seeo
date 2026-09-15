// ===== 简单内存级 Rate Limiter（serverless 单实例内有效） =====
// 匿名用户按 IP 限流，登录用户按 userId 限流
// 注：Vercel serverless 多实例间内存不共享，此为基础防护层

interface RateBucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 小时窗口

// 匿名用户：每天最多 3 次审计
const ANON_LIMIT = 3;
// 登录用户：每天最多 20 次审计（域名冷却由 audit API 单独控制）
const AUTH_LIMIT = 20;

const buckets = new Map<string, RateBucket>();

/** 获取客户端 IP（兼容 Vercel 代理头） */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();
  return "unknown";
}

/**
 * 检查审计请求限流
 * @returns { allowed: boolean; remaining: number; resetMs: number }
 */
export function checkAuditRateLimit(
  key: string,
  isAuthed: boolean
): { allowed: boolean; remaining: number; resetMs: number } {
  const limit = isAuthed ? AUTH_LIMIT : ANON_LIMIT;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    // 新窗口
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetMs: WINDOW_MS };
  }

  if (bucket.count >= limit) {
    const resetMs = WINDOW_MS - (now - bucket.windowStart);
    return { allowed: false, remaining: 0, resetMs };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, resetMs: WINDOW_MS - (now - bucket.windowStart) };
}

/** 构建限流 key：登录用 user:xxx，匿名用 ip:xxx */
export function buildRateLimitKey(req: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  return `ip:${getClientIp(req)}`;
}

// ---------- 通用滑动窗口限流（公开工具类接口用） ----------
// 与审计限流同源（内存级、单实例内有效），但窗口与额度由调用方决定，
// 用于抑制匿名公开接口的突发轮询；持久化的每日上限由 DB 层另行兜底。

interface SlidingBucket {
  count: number;
  windowStart: number;
}

const slidingBuckets = new Map<string, SlidingBucket>();

/**
 * 通用滑动窗口限流
 * @param key 限流维度（如 `public-checker:ip:1.2.3.4`）
 * @param limit 窗口内允许的最大请求数
 * @param windowMs 窗口长度（毫秒）
 * @returns { allowed, remaining, retryAfterSeconds }
 */
export function checkSlidingWindowRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = slidingBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    slidingBuckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    const resetMs = windowMs - (now - bucket.windowStart);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: limit - bucket.count,
    retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - bucket.windowStart)) / 1000)),
  };
}

/** 仅供测试：清空滑动窗口状态 */
export function resetSlidingWindowLimiter(): void {
  slidingBuckets.clear();
}
