// ===== GitHub 侧能力测试 =====
// 覆盖：状态显式排序（不能取数组首元素）、"最新状态"判定（不能 some(success)）、
// 分页、前序部署选择（含工作流延迟执行）、快照失败分类、幂等状态机。

import { describe, it, expect } from "vitest";

import {
  buildSummary,
  decideIdempotency,
  fetchDeploymentSitemap,
  findPreviousProductionDeployment,
  latestUsableStatus,
  listAllDeploymentStatuses,
  nextPageUrl,
  parseAttempt,
  probeGone,
  sortStatusesDesc,
  type CheckRun,
  type DeploymentStatus,
  type GithubContext,
} from "./indexnow-github";

const ctx: GithubContext = { repo: "o/r", token: "t" };

function status(partial: Partial<DeploymentStatus> & { id: number; created_at: string }): DeploymentStatus {
  return { state: "success", environment_url: "https://seeo-a.vercel.app", ...partial } as DeploymentStatus;
}

/** 按 URL 片段路由的 fetch 替身 */
function routerFetch(routes: Array<{ match: string; status?: number; body?: unknown; text?: string; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit) throw new Error(`unexpected url: ${url}`);
    const body = hit.text ?? (hit.body === undefined ? "" : JSON.stringify(hit.body));
    return new Response(body, { status: hit.status ?? 200, headers: hit.headers ?? {} });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("状态排序与“最新状态”判定", () => {
  it("created_at 降序，同秒用 id 降序破平", () => {
    const sorted = sortStatusesDesc([
      status({ id: 10, created_at: "2026-11-01T00:00:00Z" }),
      status({ id: 12, created_at: "2026-11-03T00:00:00Z" }),
      status({ id: 11, created_at: "2026-11-03T00:00:00Z" }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual([12, 11, 10]);
  });

  it("不能因为历史里有 success 就判定成功：最新是 inactive → 不可用", () => {
    const statuses = [
      status({ id: 2, created_at: "2026-11-05T00:00:00Z", state: "inactive" }),
      status({ id: 1, created_at: "2026-11-01T00:00:00Z", state: "success" }),
    ];
    // 若实现写成 statuses.some(s => s.state === "success")，这里会错判为可用
    expect(latestUsableStatus(statuses)).toBeNull();
  });

  it("最新是 success 但缺少 environment_url → 不可用", () => {
    expect(latestUsableStatus([status({ id: 1, created_at: "2026-11-01T00:00:00Z", environment_url: null })])).toBeNull();
  });

  it("数组顺序是升序时仍取真正最新的一条", () => {
    const statuses = [
      status({ id: 1, created_at: "2026-11-01T00:00:00Z" }),
      status({ id: 2, created_at: "2026-11-04T00:00:00Z" }),
    ];
    expect(latestUsableStatus(statuses)?.id).toBe(2);
  });
});

describe("分页", () => {
  it("nextPageUrl 只认 rel=next", () => {
    const header = '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"';
    expect(nextPageUrl(header)).toBe("https://api.github.com/x?page=2");
    expect(nextPageUrl('<https://api.github.com/x?page=5>; rel="last"')).toBeNull();
    expect(nextPageUrl(null)).toBeNull();
  });

  it("statuses 跨页合并，不假设一页装完", async () => {
    const { impl, calls } = routerFetch([
      {
        match: "page=2",
        body: [status({ id: 1, created_at: "2026-11-01T00:00:00Z" })],
      },
      {
        match: "/statuses?per_page=100",
        body: [status({ id: 9, created_at: "2026-11-03T00:00:00Z" })],
        headers: { link: '<https://api.github.com/repos/o/r/deployments/7/statuses?per_page=100&page=2>; rel="next"' },
      },
    ]);
    const all = await listAllDeploymentStatuses({ ...ctx, fetchImpl: impl }, 7);
    expect(all.map((s) => s.id)).toEqual([9, 1]);
    expect(calls).toHaveLength(2);
  });
});

describe("前序 Production 部署选择", () => {
  const current = { id: 100, created_at: "2026-11-10T00:00:00Z" };

  it("延迟执行时不能取列表第一条（那条比当前更新）", async () => {
    const { impl } = routerFetch([
      {
        match: "/deployments?environment=Production",
        body: [
          { id: 101, sha: "c".repeat(40), ref: "c".repeat(40), environment: "Production", created_at: "2026-11-12T00:00:00Z" },
          { id: 100, sha: "b".repeat(40), ref: "b".repeat(40), environment: "Production", created_at: "2026-11-10T00:00:00Z" },
          { id: 99, sha: "a".repeat(40), ref: "a".repeat(40), environment: "Production", created_at: "2026-11-06T00:00:00Z" },
        ],
      },
      { match: "/deployments/101/statuses", body: [status({ id: 501, created_at: "2026-11-12T00:01:00Z" })] },
      { match: "/deployments/99/statuses", body: [status({ id: 499, created_at: "2026-11-06T00:01:00Z" })] },
    ]);
    const prev = await findPreviousProductionDeployment({ ...ctx, fetchImpl: impl }, current);
    expect(prev?.deployment.id).toBe(99);
  });

  it("最新状态非 success 的部署被跳过，继续往前找", async () => {
    const { impl } = routerFetch([
      {
        match: "/deployments?environment=Production",
        body: [
          { id: 100, sha: "b".repeat(40), ref: "b".repeat(40), environment: "Production", created_at: "2026-11-10T00:00:00Z" },
          { id: 99, sha: "a".repeat(40), ref: "a".repeat(40), environment: "Production", created_at: "2026-11-08T00:00:00Z" },
          { id: 98, sha: "d".repeat(40), ref: "d".repeat(40), environment: "Production", created_at: "2026-11-06T00:00:00Z" },
        ],
      },
      {
        match: "/deployments/99/statuses",
        body: [status({ id: 499, created_at: "2026-11-08T00:01:00Z", state: "failure" })],
      },
      { match: "/deployments/98/statuses", body: [status({ id: 498, created_at: "2026-11-06T00:01:00Z" })] },
    ]);
    const prev = await findPreviousProductionDeployment({ ...ctx, fetchImpl: impl }, current);
    expect(prev?.deployment.id).toBe(98);
  });

  it("Preview 部署即使更新也不入选", async () => {
    const { impl } = routerFetch([
      {
        match: "/deployments?environment=Production",
        body: [
          { id: 100, sha: "b".repeat(40), ref: "b".repeat(40), environment: "Production", created_at: "2026-11-10T00:00:00Z" },
          { id: 97, sha: "e".repeat(40), ref: "e".repeat(40), environment: "Preview", created_at: "2026-11-09T00:00:00Z" },
          { id: 96, sha: "f".repeat(40), ref: "f".repeat(40), environment: "Production", created_at: "2026-11-05T00:00:00Z" },
        ],
      },
      { match: "/deployments/96/statuses", body: [status({ id: 496, created_at: "2026-11-05T00:01:00Z" })] },
    ]);
    const prev = await findPreviousProductionDeployment({ ...ctx, fetchImpl: impl }, current);
    expect(prev?.deployment.id).toBe(96);
  });
});

describe("部署 Sitemap 快照失败分类", () => {
  const base = "https://seeo-abc.vercel.app";
  const sitemap = (urls: string[]) =>
    `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
  const good = sitemap(["https://www.seeo.asia", "https://www.seeo.asia/zh"]);

  it("401 必须被识别为 Deployment Protection，且不重试", async () => {
    const { impl, calls } = routerFetch([{ match: "sitemap.xml", status: 401 }]);
    const r = await fetchDeploymentSitemap(base, { fetchImpl: impl, sleep: async () => undefined });
    expect(r.failure).toBe("protected-401");
    expect(r.retryable).toBe(false);
    expect(r.detail).toContain("Deployment Protection");
    expect(calls).toHaveLength(1);
  });

  it.each([
    [403, "forbidden-403"],
    [404, "gone-404"],
    [410, "expired-410"],
  ])("%i → %s", async (code, expected) => {
    const { impl } = routerFetch([{ match: "sitemap.xml", status: code }]);
    const r = await fetchDeploymentSitemap(base, { fetchImpl: impl, sleep: async () => undefined });
    expect(r.failure).toBe(expected);
    expect(r.retryable).toBe(false);
  });

  it("5xx 先失败后成功 → 重试可恢复", async () => {
    let n = 0;
    const impl = (async () => {
      n += 1;
      if (n === 1) return new Response("boom", { status: 503 });
      return new Response(good, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchDeploymentSitemap(base, { fetchImpl: impl, sleep: async () => undefined });
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("网络异常 → network，可重试标记为 true", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await fetchDeploymentSitemap(base, { fetchImpl: impl, sleep: async () => undefined, attempts: 1 });
    expect(r.failure).toBe("network");
    expect(r.retryable).toBe(true);
    expect(r.detail).toContain("ECONNREFUSED");
  });

  it("200 但不是 sitemap → invalid-xml", async () => {
    const { impl } = routerFetch([{ match: "sitemap.xml", status: 200, text: "<html>login</html>" }]);
    const r = await fetchDeploymentSitemap(base, { fetchImpl: impl, sleep: async () => undefined });
    expect(r.failure).toBe("invalid-xml");
  });

  it("200 但 0 条 loc → empty", async () => {
    const { impl } = routerFetch([{ match: "sitemap.xml", status: 200, text: "<urlset></urlset>" }]);
    const r = await fetchDeploymentSitemap(base, { fetchImpl: impl, sleep: async () => undefined });
    expect(r.failure).toBe("empty");
  });

  it("混入非规范域名 → invalid-urls", async () => {
    const { impl } = routerFetch([
      { match: "sitemap.xml", status: 200, text: sitemap(["https://www.seeo.asia/a", "https://seeo.asia/b"]) },
    ]);
    const r = await fetchDeploymentSitemap(base, { fetchImpl: impl, sleep: async () => undefined });
    expect(r.failure).toBe("invalid-urls");
  });

  it("合法 sitemap → ok 且返回 URL 列表", async () => {
    const { impl } = routerFetch([{ match: "sitemap.xml", status: 200, text: good }]);
    const r = await fetchDeploymentSitemap(base, { fetchImpl: impl, sleep: async () => undefined });
    expect(r.ok).toBe(true);
    expect(r.urls).toEqual(["https://www.seeo.asia", "https://www.seeo.asia/zh"]);
  });
});

describe("删除实证", () => {
  it("404/410 才算下线", async () => {
    for (const code of [404, 410]) {
      const impl = (async () => new Response("", { status: code })) as unknown as typeof fetch;
      expect((await probeGone("https://www.seeo.asia/gone", impl)).gone).toBe(true);
    }
  });

  it("200 仍然可达 → 不提交删除", async () => {
    const impl = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const r = await probeGone("https://www.seeo.asia/alive", impl);
    expect(r.gone).toBe(false);
    expect(r.detail).toContain("still reachable");
  });
});

describe("幂等状态机", () => {
  const run = (over: Partial<CheckRun>): CheckRun =>
    ({ id: 1, name: "indexnow/deployment-1", status: "completed", conclusion: "success", ...over }) as CheckRun;

  it("无记录 → 执行，attempt=1", () => {
    expect(decideIdempotency(null)).toMatchObject({ action: "proceed", attempt: 1 });
  });

  it("success / neutral / failure → 跳过", () => {
    expect(decideIdempotency(run({ conclusion: "success" })).action).toBe("skip");
    expect(decideIdempotency(run({ conclusion: "neutral" })).action).toBe("skip");
    expect(decideIdempotency(run({ conclusion: "failure" })).action).toBe("skip");
  });

  it("action_required 且未超预算 → 允许一次重试", () => {
    const d = decideIdempotency(run({ conclusion: "action_required", output: { summary: "outcome=retryable; attempt=1" } }));
    expect(d).toMatchObject({ action: "proceed", attempt: 2 });
  });

  it("action_required 且达 3 次 → 停止", () => {
    const d = decideIdempotency(run({ conclusion: "action_required", output: { summary: "attempt=3" } }));
    expect(d.action).toBe("skip");
  });

  it("in_progress 10 分钟内 → 跳过（在飞）", () => {
    const started = new Date(Date.now() - 2 * 60_000).toISOString();
    const d = decideIdempotency(run({ status: "in_progress", conclusion: null, started_at: started }), new Date(), 3);
    expect(d.action).toBe("skip");
  });

  it("in_progress 超过 10 分钟 → 视为陈旧，允许重试", () => {
    const started = new Date(Date.now() - 30 * 60_000).toISOString();
    const d = decideIdempotency(run({ status: "in_progress", conclusion: null, started_at: started }), new Date(), 3);
    expect(d).toMatchObject({ action: "proceed", attempt: 2 });
  });
});

describe("summary 编解码", () => {
  it("buildSummary 可被 parseAttempt 解析", () => {
    const s = buildSummary({
      outcome: "received",
      attempt: 2,
      added: 1,
      updated: 3,
      deleted: 0,
      urls: 4,
      cur: "https://a.vercel.app",
      prev: "https://b.vercel.app",
    });
    expect(parseAttempt(s)).toBe(2);
    expect(s).toContain("outcome=received");
    expect(s).toContain("cur=https://a.vercel.app");
  });

  it("无 attempt 字段时返回 0", () => {
    expect(parseAttempt("outcome=submitting")).toBe(0);
    expect(parseAttempt(null)).toBe(0);
  });
});
