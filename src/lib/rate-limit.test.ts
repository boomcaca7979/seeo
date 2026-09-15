import { describe, it, expect } from "vitest";
import {
  checkAuditRateLimit,
  checkSlidingWindowRateLimit,
  resetSlidingWindowLimiter,
  getClientIp,
} from "@/lib/rate-limit";

describe("checkAuditRateLimit", () => {
  // 注意：由于 buckets 是模块级 Map，测试间会共享状态
  // 用唯一 key 避免相互干扰

  it("匿名用户首次请求允许", () => {
    const key = `test-anon-${Date.now()}`;
    const result = checkAuditRateLimit(key, false);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // 3-1=2
  });

  it("匿名用户超过 3 次后被拒绝", () => {
    const key = `test-anon-limit-${Date.now()}`;
    checkAuditRateLimit(key, false); // 1
    checkAuditRateLimit(key, false); // 2
    checkAuditRateLimit(key, false); // 3
    const result = checkAuditRateLimit(key, false); // 4
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("登录用户首次请求允许", () => {
    const key = `test-auth-${Date.now()}`;
    const result = checkAuditRateLimit(key, true);
    expect(result.allowed).toBe(true);
  });

  it("登录用户额度高于匿名用户", () => {
    const anonKey = `test-anon-comp-${Date.now()}`;
    const authKey = `test-auth-comp-${Date.now()}`;
    const anonResult = checkAuditRateLimit(anonKey, false);
    const authResult = checkAuditRateLimit(authKey, true);
    // 登录用户剩余额度应大于匿名用户
    expect(authResult.remaining).toBeGreaterThan(anonResult.remaining);
  });
});

describe("checkSlidingWindowRateLimit（公开工具突发限流）", () => {
  it("窗口内未超限时放行，并递减剩余次数", () => {
    resetSlidingWindowLimiter();
    const first = checkSlidingWindowRateLimit("k1", 3, 60_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = checkSlidingWindowRateLimit("k1", 3, 60_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it("达到上限后拒绝，并给出正的 retryAfterSeconds", () => {
    resetSlidingWindowLimiter();
    checkSlidingWindowRateLimit("k2", 2, 60_000);
    checkSlidingWindowRateLimit("k2", 2, 60_000);
    const blocked = checkSlidingWindowRateLimit("k2", 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("不同 key 互不影响（按 IP 隔离）", () => {
    resetSlidingWindowLimiter();
    checkSlidingWindowRateLimit("ip-a", 1, 60_000);
    const otherIp = checkSlidingWindowRateLimit("ip-b", 1, 60_000);
    expect(otherIp.allowed).toBe(true);
    // 同一 IP 则已被限流
    expect(checkSlidingWindowRateLimit("ip-a", 1, 60_000).allowed).toBe(false);
  });

  it("窗口过期后重新计数", () => {
    resetSlidingWindowLimiter();
    checkSlidingWindowRateLimit("k3", 1, 0); // windowMs=0 → 立即过期
    const afterExpiry = checkSlidingWindowRateLimit("k3", 1, 0);
    expect(afterExpiry.allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("优先取 x-forwarded-for 的第一段", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" },
    });
    expect(getClientIp(req)).toBe("203.0.113.9");
  });

  it("回退到 x-real-ip", () => {
    const req = new Request("https://example.com", { headers: { "x-real-ip": "198.51.100.7" } });
    expect(getClientIp(req)).toBe("198.51.100.7");
  });

  it("两者都缺失时返回 unknown", () => {
    expect(getClientIp(new Request("https://example.com"))).toBe("unknown");
  });
});
