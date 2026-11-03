// ===== 策略 API：用户归属隔离 + Content Brief 持久化 =====
//
// 测试边界（勿误读）：
//   - 身份是 **Mock**：`@/lib/auth` 与 `resolveStrategyOwner` 被替换成可切换的当前用户，
//     不涉及真实 Supabase 登录、也不创建任何真实账号；
//   - 数据层是 **真实**：使用临时 SQLite 文件跑真实迁移、真实 SQL（user_id 条件、UNIQUE 等）。
// 因此本文件证明的是「API 在拿到某个 ownerId 后，绝不会读写别人的行」这一层，
// 而不是「Supabase 会话解析正确」。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import type { StrategyDoc } from "@/lib/seo/strategy-model";
import { useTempSqliteDb } from "@/lib/db/test-db";
import { closeDb } from "@/lib/db/migrations";

const authState = vi.hoisted(() => ({ user: "user-a" }));

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: async () => ({
    user: { id: authState.user },
    plan: "free",
    subscriptionStatus: "inactive",
    limits: { max_tracked_keywords: 3 },
    allowed: true,
    skip: false,
  }),
}));

vi.mock("@/lib/seo/strategy-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seo/strategy-service")>();
  return { ...actual, resolveStrategyOwner: async () => authState.user };
});

// 注意：useTempSqliteDb 名字以 use 开头，顶层调用会被 react-hooks 规则误判，
// 因此在 beforeAll 里声明（与 src/server/mcp/mcp.test.ts 一致）。
let temp: ReturnType<typeof useTempSqliteDb>;

const { createStrategy, saveStrategyDoc, getStrategy, getStrategyByShareToken } = await import(
  "@/lib/db/strategies"
);
const strategyRoute = await import("./route");
const detailRoute = await import("./[id]/route");
const shareRoute = await import("./[id]/share/route");
const keywordsRoute = await import("./[id]/keywords/route");
const retryRoute = await import("./[id]/retry/route");

function ctx(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function makeDoc(topicId = "t1"): StrategyDoc {
  return {
    topics: [
      {
        id: topicId,
        name: "mountain bike",
        keywordIds: ["mountain bike", "bike repair"],
        keywordCount: 2,
        pillarId: "mountain bike",
        pages: [
          {
            id: "p1",
            name: "bike repair",
            keywordIds: ["bike repair"],
            keywordCount: 1,
            totalVolume: null,
            avgKd: null,
            intentMix: [100, 0, 0],
          },
        ],
        totalVolume: null,
        avgKd: null,
        intentMix: [100, 0, 0],
        intentCounts: { informational: 2, commercial: 0, transactional: 0, navigational: 0, unknown: 0 },
        pillarReason: "test fixture",
      },
    ],
    keywords: [
      {
        id: "mountain bike",
        keyword: "mountain bike",
        seeds: ["mountain bike"],
        origins: ["seed"],
        volume: null,
        kd: null,
        cpc: null,
        metricsSource: null,
        intent: "信息型",
        intentSource: "estimated",
        manual: false,
        topicId,
        role: "pillar",
        pageId: null,
        serpFeatures: null,
      },
      {
        id: "bike repair",
        keyword: "bike repair",
        seeds: ["bike repair"],
        origins: ["related"],
        volume: null,
        kd: null,
        cpc: null,
        metricsSource: null,
        intent: "信息型",
        intentSource: "estimated",
        manual: false,
        topicId,
        role: "subpage",
        pageId: "p1",
        serpFeatures: null,
      },
    ],
    meta: {
      market: "美国",
      device: "PC",
      fetchedAt: "2026-11-02T06:00:00.000Z",
      sources: ["serpapi"],
      metrics: { volume: "unavailable", kd: "unavailable", cpc: "unavailable", intent: "estimated" },
      warnings: [],
      perSeed: [{ seed: "mountain bike", ok: true, related: 1, paa: 0 }],
      failedSeeds: [],
      addedSeeds: [],
      related: [],
      paa: [],
      method: { clustering: "rules", pillar: "score" },
    },
  };
}

async function newStrategy(user: string, seeds = ["mountain bike"]): Promise<number> {
  const row = await createStrategy(user, {
    name: `${user} strategy`,
    seeds,
    market: "美国",
    device: "PC",
  });
  await saveStrategyDoc(user, row.id, makeDoc(), "ready");
  return row.id;
}

beforeAll(() => {
  temp = useTempSqliteDb("strategy-owner");
  // 触发一次 schema 初始化（临时库），后续用例共用
  closeDb();
});

beforeEach(() => {
  authState.user = "user-a";
});

afterAll(() => {
  closeDb();
  temp.restore();
  fs.rmSync(temp.dir, { recursive: true, force: true });
});

describe("策略 API 归属隔离（Mock 身份 + 真实 SQLite）", () => {
  it("B 读不到 A 的策略；A 自己能读", async () => {
    const id = await newStrategy("user-a");

    const asA = await detailRoute.GET(new Request(`http://local/api/keywords/strategies/${id}`), ctx(id));
    expect(asA.status).toBe(200);
    const bodyA = await asA.json();
    expect(bodyA.data.name).toBe("user-a strategy");
    expect(bodyA.data.doc.keywords).toHaveLength(2);

    authState.user = "user-b";
    const asB = await detailRoute.GET(new Request(`http://local/api/keywords/strategies/${id}`), ctx(id));
    expect(asB.status).toBe(404);
    expect((await asB.json()).code).toBe("STRATEGY_NOT_FOUND");
  });

  it("B 改不了 A 的名称 / 收藏，伪造 owner 参数也无效", async () => {
    const id = await newStrategy("user-a");

    authState.user = "user-b";
    const rename = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        // 伪造 owner：body 里的 user_id / userId 都不应被采信
        body: JSON.stringify({ name: "pwned", user_id: "user-a", userId: "user-a" }),
      }),
      ctx(id)
    );
    expect(rename.status).toBe(404);

    const fav = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ favorites: ["mountain bike"] }),
      }),
      ctx(id)
    );
    expect(fav.status).toBe(404);

    authState.user = "user-a";
    const record = await getStrategy("user-a", id);
    expect(record?.name).toBe("user-a strategy");
    expect(record?.favorites).toEqual([]);
  });

  it("B 删不了 A 的策略；A 仍可读", async () => {
    const id = await newStrategy("user-a");

    authState.user = "user-b";
    const del = await detailRoute.DELETE(new Request(`http://local/api/keywords/strategies/${id}`, { method: "DELETE" }), ctx(id));
    expect(del.status).toBe(404);

    authState.user = "user-a";
    expect(await getStrategy("user-a", id)).not.toBeNull();
  });

  it("B 不能给 A 的策略追加关键词 / 重试 / 创建或撤销分享", async () => {
    const id = await newStrategy("user-a");

    authState.user = "user-b";
    const add = await keywordsRoute.POST(
      new Request(`http://local/api/keywords/strategies/${id}/keywords`, {
        method: "POST",
        body: JSON.stringify({ seeds: ["hacked seed"] }),
      }),
      ctx(id)
    );
    expect(add.status).toBe(404);

    const retry = await retryRoute.POST(
      new Request(`http://local/api/keywords/strategies/${id}/retry`, { method: "POST" }),
      ctx(id)
    );
    expect(retry.status).toBe(404);

    const sharePost = await shareRoute.POST(
      new Request(`http://local/api/keywords/strategies/${id}/share`, { method: "POST" }),
      ctx(id)
    );
    expect(sharePost.status).toBe(404);

    const shareDel = await shareRoute.DELETE(
      new Request(`http://local/api/keywords/strategies/${id}/share`, { method: "DELETE" }),
      ctx(id)
    );
    expect(shareDel.status).toBe(404);

    const shareGet = await shareRoute.GET(
      new Request(`http://local/api/keywords/strategies/${id}/share`),
      ctx(id)
    );
    expect(shareGet.status).toBe(404);

    // A 的数据完全没被 B 的操作污染
    authState.user = "user-a";
    const record = await getStrategy("user-a", id);
    expect(record?.shareToken).toBeNull();
    expect(record?.keywordCount).toBe(2);
    expect(record?.seeds).toEqual(["mountain bike"]);
  });

  it("B 的列表里看不到 A 的策略", async () => {
    await newStrategy("user-a", ["road bike"]);
    authState.user = "user-b";
    const res = await strategyRoute.GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});

describe("Content Brief 持久化", () => {
  it("保存后可读回；覆盖写会更新内容；删除后不再返回", async () => {
    const id = await newStrategy("user-a");

    const save = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          brief: { topicId: "t1", markdown: "# 第一版\n\n- H2 one", generatedAt: "2026-11-02T06:00:00.000Z" },
        }),
      }),
      ctx(id)
    );
    expect(save.status).toBe(200);
    const saved = (await save.json()).data.brief;
    expect(saved.topicName).toBe("mountain bike");
    expect(saved.markdown).toContain("第一版");

    const read = await detailRoute.GET(new Request(`http://local/api/keywords/strategies/${id}`), ctx(id));
    const readBody = await read.json();
    expect(readBody.data.briefs.t1.markdown).toContain("第一版");

    const overwrite = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: { topicId: "t1", markdown: "# 第二版", generatedAt: "2026-11-02T06:00:00.000Z" } }),
      }),
      ctx(id)
    );
    expect(overwrite.status).toBe(200);
    const afterOverwrite = await getStrategy("user-a", id);
    expect(afterOverwrite?.briefs.t1.markdown).toBe("# 第二版");
    expect(Object.keys(afterOverwrite?.briefs ?? {})).toHaveLength(1);

    const remove = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: { topicId: "t1", markdown: null } }),
      }),
      ctx(id)
    );
    expect(remove.status).toBe(200);
    const afterRemove = await getStrategy("user-a", id);
    expect(afterRemove?.briefs.t1).toBeUndefined();
  });

  it("brief 只对归属用户可见，B 既读不到也写不了", async () => {
    const id = await newStrategy("user-a");
    await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: { topicId: "t1", markdown: "# A 的私有大纲" } }),
      }),
      ctx(id)
    );

    authState.user = "user-b";
    const get = await detailRoute.GET(new Request(`http://local/api/keywords/strategies/${id}`), ctx(id));
    expect(get.status).toBe(404);

    const write = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: { topicId: "t1", markdown: "# B 想覆盖" } }),
      }),
      ctx(id)
    );
    expect(write.status).toBe(404);

    authState.user = "user-a";
    const record = await getStrategy("user-a", id);
    expect(record?.briefs.t1.markdown).toBe("# A 的私有大纲");
  });

  it("拒绝不属于该策略的 topicId / 空内容 / 超长内容", async () => {
    const id = await newStrategy("user-a");

    const badTopic = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: { topicId: "t-not-exist", markdown: "# x" } }),
      }),
      ctx(id)
    );
    expect(badTopic.status).toBe(400);
    expect((await badTopic.json()).code).toBe("BAD_BRIEF_TOPIC");

    const empty = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: { topicId: "t1", markdown: "   " } }),
      }),
      ctx(id)
    );
    expect(empty.status).toBe(400);

    const tooLong = await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: { topicId: "t1", markdown: "x".repeat(200_001) } }),
      }),
      ctx(id)
    );
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).code).toBe("BAD_BRIEF_TOO_LARGE");
  });
});

describe("公开分享：只读 + 不含私有编辑稿", () => {
  it("分享按 token 可读，但不含 briefs / favorites；撤销后立刻读不到", async () => {
    const id = await newStrategy("user-a");
    await detailRoute.PATCH(
      new Request(`http://local/api/keywords/strategies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: { topicId: "t1", markdown: "# 私有大纲" } }),
      }),
      ctx(id)
    );

    const created = await shareRoute.POST(
      new Request(`http://local/api/keywords/strategies/${id}/share`, { method: "POST" }),
      ctx(id)
    );
    expect(created.status).toBe(200);
    const token = (await created.json()).data.url.split("/").pop() as string;
    expect(token.length).toBeGreaterThanOrEqual(32);

    const shared = await getStrategyByShareToken(token);
    expect(shared?.doc?.keywords).toHaveLength(2);
    expect(shared?.briefs).toEqual({});
    expect(shared?.favorites).toEqual([]);

    const revoke = await shareRoute.DELETE(
      new Request(`http://local/api/keywords/strategies/${id}/share`, { method: "DELETE" }),
      ctx(id)
    );
    expect(revoke.status).toBe(200);
    expect(await getStrategyByShareToken(token)).toBeNull();
  });

  it("B 无法撤销 A 的分享（旧链接仍然有效）", async () => {
    const id = await newStrategy("user-a");
    const created = await shareRoute.POST(
      new Request(`http://local/api/keywords/strategies/${id}/share`, { method: "POST" }),
      ctx(id)
    );
    const token = (await created.json()).data.url.split("/").pop() as string;

    authState.user = "user-b";
    const revoke = await shareRoute.DELETE(
      new Request(`http://local/api/keywords/strategies/${id}/share`, { method: "DELETE" }),
      ctx(id)
    );
    expect(revoke.status).toBe(404);

    expect(await getStrategyByShareToken(token)).not.toBeNull();
  });
});
