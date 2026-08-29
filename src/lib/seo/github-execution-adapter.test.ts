// ===== GitHub Execution Adapter 单元测试（P3） =====
// 覆盖：分支命名确定性/清洗、敏感文件/路径穿越拒绝、hash 冲突、范围上限、
//       PR 幂等（open复用/merged拒绝/closed failed）、repo 校验（archived/权限）

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("DATAFORSEO_LOGIN", "login");
vi.stubEnv("DATAFORSEO_PASSWORD", "password");
vi.stubEnv("GSC_TOKEN_ENCRYPTION_KEY", "f".repeat(64));

const getGitHubConnectionByProjectMock = vi.fn();
const decryptSecretMock = vi.fn();

vi.mock("@/lib/db/github", () => ({
  getGitHubConnectionByProject: (...args: unknown[]) => getGitHubConnectionByProjectMock(...args),
}));

vi.mock("@/lib/crypto/secure-store", () => ({
  decryptSecret: (...args: unknown[]) => decryptSecretMock(...args),
  encryptSecret: vi.fn(),
}));

const ghCalls: Array<{ url: string; method: string; body?: unknown }> = [];

interface MockResponse { match: (url: string, method: string) => boolean; body: unknown; status?: number; headers?: Record<string, string> }

function mockGitHub(responses: MockResponse[]) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    void method;
    ghCalls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    for (const response of responses) {
      if (response.match(url, method)) {
        return {
          ok: (response.status ?? 200) < 400,
          status: response.status ?? 200,
          headers: new Headers(response.headers ?? { "x-ratelimit-remaining": "5000" }),
          text: async () => JSON.stringify(response.body),
          json: async () => response.body,
        } as Response;
      }
    }
    return { ok: false, status: 404, headers: new Headers(), text: async () => "", json: async () => ({}) } as Response;
  }));
}

import {
  buildBranchName,
  executeGitHubChanges,
  extractActionSpec,
  isPathAllowed,
  verifyRepository,
} from "./github-execution-adapter";

const connection = {
  id: 1, user_id: "u1", project_id: 2, owner: "acme", repository: "site",
  default_branch: "main", auth_mode: "pat", encrypted_credentials: "enc",
  connected_at: "now", updated_at: "now",
};

function fileResponse(sha: string, contentBase64: string) {
  return { content: contentBase64, sha, encoding: "base64" };
}

beforeEach(() => {
  ghCalls.length = 0;
  getGitHubConnectionByProjectMock.mockReset().mockResolvedValue(connection);
  decryptSecretMock.mockReset().mockReturnValue("pat-token");
});

describe("buildBranchName", () => {
  it("确定性：同 action/idempotencyKey 永远同名", () => {
    expect(buildBranchName(55, "2|rank_improvement|kw")).toBe(buildBranchName(55, "2|rank_improvement|kw"));
  });
  it("清洗非法字符 + 长度上限", () => {
    const name = buildBranchName(1, "2|type|LIKE this!!! very long string ".repeat(5));
    expect(name).toMatch(/^seeo\/action\//);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).not.toContain("!");
    expect(name).not.toContain(" ");
  });
});

describe("isPathAllowed（敏感文件/路径穿越）", () => {
  it("拒绝路径穿越 / 绝对路径 / 敏感文件", () => {
    expect(isPathAllowed("../../etc/passwd")).toBe(false);
    expect(isPathAllowed("/absolute/path")).toBe(false);
    expect(isPathAllowed(".env")).toBe(false);
    expect(isPathAllowed("config/.env.local")).toBe(false);
    expect(isPathAllowed(".github/workflows/deploy.yml")).toBe(false);
    expect(isPathAllowed("package-lock.json")).toBe(false);
    expect(isPathAllowed("db/migrations/001.sql")).toBe(false);
  });
  it("普通内容文件允许", () => {
    expect(isPathAllowed("src/app/page.tsx")).toBe(true);
    expect(isPathAllowed("content/blog/post.md")).toBe(true);
  });
});

describe("extractActionSpec", () => {
  it("无 filePath/newContent → null（MANUAL_REQUIRED，不猜映射）", () => {
    expect(extractActionSpec({})).toBe(null);
    expect(extractActionSpec({ filePath: "a.md" })).toBe(null);
  });
  it("显式 spec → 提取", () => {
    expect(extractActionSpec({ filePath: "a.md", newContent: "x" })).toEqual({ filePath: "a.md", newContent: "x" });
  });
});

describe("verifyRepository", () => {
  it("archived → GITHUB_REPOSITORY_ARCHIVED", async () => {
    mockGitHub([{ match: () => true, body: { default_branch: "main", archived: true } }]);
    await expect(verifyRepository("u1", 2)).rejects.toMatchObject({ code: "GITHUB_REPOSITORY_ARCHIVED" });
  });
  it("正常仓库 → 返回 owner/repo/defaultBranch", async () => {
    mockGitHub([{ match: () => true, body: { full_name: "acme/site", default_branch: "main", archived: false, permissions: { push: true } } }]);
    const result = await verifyRepository("u1", 2);
    expect(result).toEqual({ owner: "acme", repo: "site", defaultBranch: "main" });
  });
});

describe("executeGitHubChanges", () => {
  const spec = { filePath: "content/page.md", newContent: "# New content\nline2" };
  const baseResponses = (): MockResponse[] => [
    { match: (url: string, method: string) => { void method; return url.includes("/git/ref/heads/main") && method === "GET"; }, body: { object: { sha: "basesha0000" } } },
    { match: (url: string, method: string) => { void method; return url.includes("/git/ref/heads/seeo") && method === "GET"; }, body: { object: { sha: "branchsha" } }, status: 200 },
    { match: (url: string, method: string) => { void method; return url.includes("/contents/content/page.md") && method === "GET"; }, body: fileResponse("filesha", Buffer.from("old content", "utf8").toString("base64")) },
    { match: (url: string, method: string) => { void method; return url.includes("/contents/content/page.md") && method === "PUT"; }, body: { commit: { sha: "commitsha" } } },
    { match: (url: string, method: string) => { void method; return url.includes("/pulls?head"); }, body: [] },
    { match: (url: string, method: string) => { void method; return url.includes("/pulls") && method === "POST"; }, body: { number: 7, html_url: "https://github.com/acme/site/pull/7", state: "open", merged: false } },
  ];

  it("完整流程：branch → commit（SeeO Action 元数据）→ PR", async () => {
    mockGitHub(baseResponses());
    const result = await executeGitHubChanges("u1", 2, {
      actionId: 55, spec, evidence: [{ source: "rank_history", ref: "kw:1", summary: "#14" }],
      opportunityId: 9, idempotencyKey: "2|rank|kw",
    });
    expect(result).toMatchObject({ repository: "acme/site", branch: expect.stringContaining("seeo/action/55-"), commitSha: "commitsha", prNumber: 7, prState: "open" });
    const commitCall = ghCalls.find((call): call is { url: string; method: string; body: Record<string, unknown> } => call.method === "PUT");
    expect(String(commitCall?.body?.message)).toContain("SeeO Action: 55");
    expect(String(commitCall?.body?.message)).toContain("Opportunity: 9");
    const prCall = ghCalls.find((call): call is { url: string; method: string; body: Record<string, unknown> } => call.method === "POST" && String(call.url).endsWith("/pulls"));
    expect(String(prCall?.body?.body)).toContain("after explicit user approval");
  });

  it("PR 已 open → 幂等返回既有 PR，不重建、不产生第二个 commit", async () => {
    const responses = baseResponses();
    responses[4] = { match: (url: string, method: string) => { void method; return url.includes("/pulls?head"); }, body: [{ number: 7, html_url: "pr-url", state: "open", merged: false }] };
    mockGitHub(responses);
    const result = await executeGitHubChanges("u1", 2, {
      actionId: 55, spec, evidence: [], opportunityId: 9, idempotencyKey: "2|rank|kw",
    });
    expect(result.prNumber).toBe(7);
    expect(ghCalls.filter((call) => call.method === "POST" && String(call.url).endsWith("/pulls"))).toHaveLength(0);
    expect(ghCalls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("beforeHash 不匹配（preview 后文件被第三方修改）→ EXECUTION_CONFLICT，不写 commit", async () => {
    mockGitHub(baseResponses());
    await expect(executeGitHubChanges("u1", 2, {
      actionId: 55, spec, beforeHash: "different-blob-sha", evidence: [], opportunityId: 9, idempotencyKey: "k",
    })).rejects.toMatchObject({ code: "EXECUTION_CONFLICT" });
    expect(ghCalls.filter((call) => call.method === "PUT")).toHaveLength(0);
    expect(ghCalls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("beforeHash 一致 → 正常执行（无冲突）", async () => {
    mockGitHub(baseResponses());
    const result = await executeGitHubChanges("u1", 2, {
      actionId: 55, spec, beforeHash: "filesha", evidence: [], opportunityId: 9, idempotencyKey: "k",
    });
    expect(result.prNumber).toBe(7);
  });

  it("newContent 行数超限 → EXECUTION_SCOPE_TOO_LARGE，不创建 branch / commit / PR", async () => {
    mockGitHub(baseResponses());
    const oversized = { ...spec, newContent: Array.from({ length: 401 }, (_, i) => `line ${i}`).join("\n") };
    await expect(executeGitHubChanges("u1", 2, {
      actionId: 55, spec: oversized, evidence: [], opportunityId: 9, idempotencyKey: "k",
    })).rejects.toMatchObject({ code: "EXECUTION_SCOPE_TOO_LARGE" });
    expect(ghCalls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(ghCalls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("PR 已 merged → EXECUTION_CONFLICT（幂等：不重复执行）", async () => {
    const responses = baseResponses();
    responses[4] = { match: (url: string, method: string) => { void method; return url.includes("/pulls?head"); }, body: [{ number: 7, html_url: "pr-url", state: "closed", merged: true }] };
    mockGitHub(responses);
    await expect(executeGitHubChanges("u1", 2, { actionId: 55, spec, evidence: [], opportunityId: 9, idempotencyKey: "k" }))
      .rejects.toMatchObject({ code: "EXECUTION_CONFLICT" });
  });

  it("rate limited → GITHUB_RATE_LIMITED（带 retry-after）", async () => {
    mockGitHub([
      { match: () => true, body: { message: "rate limit" }, status: 429, headers: { "retry-after": "30" } },
    ]);
    await expect(verifyRepository("u1", 2)).rejects.toMatchObject({ code: "GITHUB_RATE_LIMITED" });
  });

  it("文件不存在 → EXECUTION_TARGET_NOT_FOUND", async () => {
    mockGitHub([
      { match: (url: string, method: string) => { void method; return url.includes("/git/ref/heads/main"); }, body: { object: { sha: "base" } } },
      { match: (url: string, method: string) => { void method; return url.includes("/git/ref/heads/seeo"); }, body: { object: { sha: "b" } } },
      { match: (url: string, method: string) => { void method; return url.includes("/pulls?head"); }, body: [] },
      { match: (url: string, method: string) => { void method; return url.includes("/contents/"); }, body: { message: "Not Found" }, status: 404 },
    ]);
    await expect(executeGitHubChanges("u1", 2, { actionId: 55, spec, evidence: [], opportunityId: 9, idempotencyKey: "k" }))
      .rejects.toMatchObject({ code: "EXECUTION_TARGET_NOT_FOUND" });
  });
});
