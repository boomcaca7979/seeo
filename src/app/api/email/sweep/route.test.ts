// ===== GET /api/email/sweep 路由测试 =====
// 只验证路由层防线与契约：CRON_SECRET fail-closed、正常返回、异常收敛为 500。
// 邮件资格逻辑由 src/lib/email/lifecycle.test.ts 覆盖。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  sweep: vi.fn(async () => ({ targets: 2, processed: 1, results: [] })),
}));

vi.mock("@/lib/email/lifecycle", () => ({
  runLifecycleEmailSweep: h.sweep,
}));

import { GET } from "./route";

const ORIG_CRON = process.env.CRON_SECRET;

function req(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return new Request("http://localhost/api/email/sweep", { headers });
}

beforeEach(() => {
  h.sweep.mockClear();
  h.sweep.mockImplementation(async () => ({ targets: 2, processed: 1, results: [] }));
  process.env.CRON_SECRET = "test-cron-secret";
});

afterEach(() => {
  if (ORIG_CRON === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIG_CRON;
});

describe("GET /api/email/sweep", () => {
  it("缺少 Authorization → 401（fail-closed）", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it("错误的 secret → 401", async () => {
    const res = await GET(req("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it("未配置 CRON_SECRET → 一律 401（不允许无鉴权运行）", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it("正确 secret → 200 且返回 sweep 结果", async () => {
    const res = await GET(req("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { targets: number } };
    expect(json.data.targets).toBe(2);
    expect(h.sweep).toHaveBeenCalledTimes(1);
  });

  it("sweep 内部异常 → 收敛为 500，不泄漏堆栈", async () => {
    h.sweep.mockImplementation(async () => {
      throw new Error("db down");
    });
    const res = await GET(req("Bearer test-cron-secret"));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("db down");
  });
});
