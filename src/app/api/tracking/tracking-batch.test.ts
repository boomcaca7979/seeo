// ===== 批量加入追踪：隔离库上的真实写入契约 =====
//
// 对应 UI 的「Add to keyword tracking」逐词调用 /api/tracking 的行为：
//   - 多个关键词逐个写入；
//   - 重复词由 UNIQUE 拦截（400 / 已存在），不会写第二行；
//   - 达到套餐上限后返回 403 KEYWORD_LIMIT_REACHED，并带 limit/used，供弹窗显示真实用量；
//   - 已成功写入的行在失败之后仍然保留（部分成功）。
//
// 身份仍为 Mock（可配置 plan/limit），数据库是临时文件；不触碰仓库内任何真实库。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { useTempSqliteDb } from "@/lib/db/test-db";
import { closeDb } from "@/lib/db/migrations";

const authState = vi.hoisted(() => ({
  limit: 3,
  user: "demo:batch-test",
}));

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: async () => ({
    user: { id: authState.user },
    plan: "free",
    subscriptionStatus: "inactive",
    limits: { max_tracked_keywords: authState.limit },
    allowed: true,
    skip: false,
  }),
}));

// useTempSqliteDb 以 use 开头，顶层调用会被 react-hooks 规则误判 → 放到 beforeAll。
let temp: ReturnType<typeof useTempSqliteDb>;

const trackingRoute = await import("./route");
const { listTrackedKeywords } = await import("@/lib/db");

function post(keyword: string, domain = "batch.example") {
  return trackingRoute.POST(
    new Request("http://local/api/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, location: "美国", device: "PC", domain }),
    })
  );
}

beforeAll(() => {
  temp = useTempSqliteDb("tracking-batch");
  closeDb();
});

beforeEach(() => {
  authState.limit = 3;
  authState.user = "demo:batch-test";
});

afterAll(() => {
  closeDb();
  temp.restore();
  fs.rmSync(temp.dir, { recursive: true, force: true });
});

describe("批量加入追踪（真实 SQLite，Mock 身份）", () => {
  it("3 个关键词：2 个新增 + 1 个重复被拦截 + 额度用尽后明确拒绝", async () => {
    const a = await post("mountain bike");
    expect(a.status).toBe(200);

    const b = await post("bike repair");
    expect(b.status).toBe(200);

    // 重复词：后端按 (user, keyword, location, device, domain) UNIQUE 拦截
    const dup = await post("mountain bike");
    expect(dup.status).toBe(400);
    expect((await dup.json()).error).toContain("已在追踪中");

    // 第 3 个不同关键词：正好用满 3 个额度
    const c = await post("bike tires");
    expect(c.status).toBe(200);

    // 第 4 个：上限拒绝，带真实 limit/used
    const over = await post("bike helmet");
    expect(over.status).toBe(403);
    const overBody = await over.json();
    expect(overBody.code).toBe("KEYWORD_LIMIT_REACHED");
    expect(overBody.limit).toBe(3);
    expect(overBody.used).toBe(3);

    // 部分成功：前 3 条仍然存在，重复词没有写第二行
    const rows = await listTrackedKeywords("demo:batch-test");
    expect(rows.map((r) => r.keyword).sort()).toEqual(["bike repair", "bike tires", "mountain bike"]);
  });

  it("额度为 0 时第一个词就被拒绝（不会先写一条再报错）", async () => {
    authState.user = "demo:empty-quota";
    authState.limit = 0;

    const res = await post("road bike");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("KEYWORD_LIMIT_REACHED");
    expect(await listTrackedKeywords("demo:empty-quota")).toEqual([]);
  });

  it("GET 返回 limit 与实际条数，刷新后仍能看到已写入的词", async () => {
    authState.user = "demo:refresh";
    authState.limit = 5;
    await post("gravel bike");
    await post("cyclocross bike");

    const res = await trackingRoute.GET(new Request("http://local/api/tracking"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.limit).toBe(5);
    expect(json.data.map((r: { keyword: string }) => r.keyword).sort()).toEqual(["cyclocross bike", "gravel bike"]);
  });
});
