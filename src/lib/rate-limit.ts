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
