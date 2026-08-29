// ===== GitHub Provider（P3，服务端专用） =====
// 认证（优先级）：
//   A. GitHub App：env GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID
//      → JWT(RS256) → installation token（短时效、repo 范围、适合 SaaS）
//   B. PAT fallback（self-host/开发）：连接时用户提供，AES-256-GCM 加密存储于 github_connections
// 只做 HTTP + 错误映射；connection/授权/scope guard 在 connection/adapter 层。

import { createSign } from "node:crypto";

const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 20_000;

export type GitHubErrorCode =
  | "GITHUB_NOT_CONNECTED"
  | "GITHUB_NOT_CONFIGURED"
  | "GITHUB_PERMISSION_DENIED"
  | "GITHUB_REPOSITORY_NOT_FOUND"
  | "GITHUB_REPOSITORY_ARCHIVED"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_PROVIDER_ERROR";

export class GitHubError extends Error {
  code: GitHubErrorCode;
  status: number;
  retryAfterSeconds: number | null;
  constructor(code: GitHubErrorCode, status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "GitHubError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_INSTALLATION_ID
  );
}

function codeForStatus(status: number): GitHubErrorCode {
  if (status === 401 || status === 403) return "GITHUB_PERMISSION_DENIED";
  if (status === 404) return "GITHUB_REPOSITORY_NOT_FOUND";
  if (status === 422) return "GITHUB_PROVIDER_ERROR";
  return "GITHUB_PROVIDER_ERROR";
}

async function ghFetch<T>(token: string, url: string, init?: {
  method?: string;
  body?: unknown;
  accept?: string;
}): Promise<{ data: T; rateLimitRemaining: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const hasBody = init?.body !== undefined;
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: init?.accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429 || res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
        const retryAfter = res.headers.get("retry-after");
        const reset = res.headers.get("x-ratelimit-reset");
        const wait = retryAfter ? Number(retryAfter) : reset ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) : null;
        throw new GitHubError("GITHUB_RATE_LIMITED", res.status, `GitHub rate limit reached${wait ? `，${wait}s 后重置` : ""}`, wait);
      }
      if (res.status === 403 && body.includes("archived")) {
        throw new GitHubError("GITHUB_REPOSITORY_ARCHIVED", res.status, "仓库已归档，不可写入");
      }
      throw new GitHubError(codeForStatus(res.status), res.status, `GitHub API 错误（${res.status}）：${body.slice(0, 200)}`);
    }
    const remaining = res.headers.get("x-ratelimit-remaining");
    const data = res.status === 204 ? ({} as T) : ((await res.json()) as T);
    return { data, rateLimitRemaining: remaining === null ? null : Number(remaining) };
  } catch (e) {
    if (e instanceof GitHubError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new GitHubError("GITHUB_PROVIDER_ERROR", 0, "GitHub 请求超时（20s）");
    }
    throw new GitHubError("GITHUB_PROVIDER_ERROR", 0, `GitHub 请求失败：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ===== GitHub App token（JWT + installation token） =====

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function buildAppJWT(): string {
  const appId = process.env.GITHUB_APP_ID ?? "";
  const rawKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(rawKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

interface InstallationTokenCache { token: string; expiresAt: number }
let installationTokenCache: InstallationTokenCache | null = null;

/** installation token（缓存至过期前 5 分钟） */
export async function getGitHubAppToken(): Promise<string> {
  if (installationTokenCache && Date.now() < installationTokenCache.expiresAt) {
    return installationTokenCache.token;
  }
  const jwt = buildAppJWT();
  const { data } = await ghFetch<{ token: string; expires_at: string }>(
    jwt,
    `${API_BASE}/app/installations/${process.env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    { method: "POST" }
  );
  installationTokenCache = { token: data.token, expiresAt: Date.parse(data.expires_at) - 5 * 60_000 };
  return data.token;
}

// ===== 仓库 / 分支 / 文件 / PR API =====

export interface GitHubRepo {
  full_name: string;
  default_branch: string;
  archived: boolean;
  permissions?: { push?: boolean };
}

/** PAT 模式：列出用户可写仓库（App 模式列出 installation 仓库走同一 /installation/repositories） */
export async function listGitHubRepositories(token: string, appMode: boolean): Promise<Array<{ full_name: string; default_branch: string; archived: boolean }>> {
  const path = appMode ? "/installation/repositories" : "/user/repos?sort=updated&per_page=50";
  const { data } = await ghFetch<{ repositories?: Array<GitHubRepo> } | GitHubRepo[]>(token, `${API_BASE}${path}`);
  const repos = Array.isArray(data) ? data : (data.repositories ?? []);
  return repos.map((repo) => ({ full_name: repo.full_name, default_branch: repo.default_branch, archived: repo.archived }));
}

export async function getGitHubRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
  const { data } = await ghFetch<GitHubRepo>(token, `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  return data;
}

export async function getGitHubBranchSha(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const { data } = await ghFetch<{ object: { sha: string } }>(
    token,
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  return data.object.sha;
}

export async function createGitHubBranch(token: string, owner: string, repo: string, branch: string, fromSha: string): Promise<void> {
  await ghFetch(token, `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: fromSha },
  });
}

export interface GitHubFileContent {
  content: string; // utf-8 解码后
  sha: string; // file blob sha（更新时必填）
}

export async function getGitHubFile(token: string, owner: string, repo: string, path: string, ref: string): Promise<GitHubFileContent | null> {
  const { data } = await ghFetch<{ content?: string; sha?: string; encoding?: string; message?: string }>(
    token,
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`
  );
  if (typeof data.content !== "string") return null;
  if (data.encoding !== "base64") return null;
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha ?? "" };
}

export async function putGitHubFile(token: string, owner: string, repo: string, params: {
  path: string;
  branch: string;
  content: string;
  fileSha: string;
  message: string;
}): Promise<{ commitSha: string }> {
  const { data } = await ghFetch<{ commit: { sha: string } }>(
    token,
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(params.path).replace(/%2F/g, "/")}`,
    {
      method: "PUT",
      body: {
        message: params.message,
        content: Buffer.from(params.content, "utf8").toString("base64"),
        sha: params.fileSha,
        branch: params.branch,
      },
    }
  );
  return { commitSha: data.commit.sha };
}

export interface GitHubPullRequest {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged: boolean;
}

export async function createGitHubPullRequest(token: string, owner: string, repo: string, params: {
  title: string;
  body: string;
  head: string;
  base: string;
}): Promise<GitHubPullRequest> {
  const { data } = await ghFetch<GitHubPullRequest>(
    token,
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    { method: "POST", body: params }
  );
  return data;
}

/** 查询 PR 状态（幂等/状态轮询用；按 head 分支定位，避免依赖 PR number） */
export async function getGitHubPullRequestForBranch(token: string, owner: string, repo: string, headBranch: string): Promise<GitHubPullRequest | null> {
  const { data } = await ghFetch<GitHubPullRequest[]>(
    token,
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(owner)}:${encodeURIComponent(headBranch)}&state=all&per_page=1`
  );
  return data[0] ?? null;
}
