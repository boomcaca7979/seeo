import { describe, it, expect } from "vitest";
import { checkAuditRateLimit } from "@/lib/rate-limit";

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
