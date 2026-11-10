// ===== IndexNow 的 GitHub 侧能力 =====
//
// 三块：Deployments（含分页与「最新状态」判定）、部署专属 Sitemap 快照、Check Runs 状态机。
//
// 设计要点（四轮审计结论）：
//   1. 前序部署必须按 created_at 严格早于当前、且**排序后最新状态**为 success；
//      禁止 statuses.some(success)。
//   2. 快照只认部署专属 URL 的真实产物，绝不回退到 git 重建，也不降级为全量提交。
//   3. 幂等记录用 Check Runs（不用 Commit Status）：202 要能落在 neutral 而不是永久 pending。
//   4. GITHUB_TOKEN + checks:write 即可，不需要 PAT / GitHub App / 数据库。

import { SITE_ORIGIN, extractSitemapUrls, validateSitemapUrls } from "./indexnow-map.ts";

const API_VERSION = "2022-11-28";
export const API_BASE = "https://api.github.com";

export interface GithubContext {
  repo: string; // "owner/name"
  token: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

export interface Deployment {
  id: number;
  sha: string;
  ref: string;
  environment: string | null;
  created_at: string;
}

export interface DeploymentStatus {
  id: number;
  state: "queued" | "pending" | "in_progress" | "success" | "failure" | "error" | "inactive";
  created_at: string;
  environment_url?: string | null;
  description?: string | null;
}

export interface CheckRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: "action_required" | "cancelled" | "failure" | "neutral" | "success" | "skipped" | "stale" | "timed_out" | null;
  external_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  output?: { title?: string | null; summary?: string | null };
}

// ===== 基础请求 =====

interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

async function ghRequest(ctx: GithubContext, pathOrUrl: string, init: RequestInit = {}): Promise<RawResponse> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${ctx.apiBase ?? API_BASE}${pathOrUrl}`;
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${ctx.token}`,
      "x-github-api-version": API_VERSION,
      "user-agent": "seeo-indexnow",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new GithubApiError(res.status, pathOrUrl, text.slice(0, 300));
  }
  return { status: res.status, headers: res.headers, body, text };
}

export class GithubApiError extends Error {
  // 注意：不能写成构造器参数属性（`constructor(readonly status: number)`）——
  // Node 的 --experimental-strip-types 只做类型擦除，不支持参数属性这类需要代码生成的语法。
  readonly status: number;
  readonly path: string;
  readonly detail: string;

  constructor(status: number, path: string, detail: string) {
    super(`GitHub API ${status} on ${path}: ${detail}`);
    this.name = "GithubApiError";
    this.status = status;
    this.path = path;
    this.detail = detail;
  }
}

/** 解析 Link 头里的 rel="next" */
export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m && m[2] === "next") return m[1];
  }
  return null;
}

// ===== Deployments =====

export async function getDeployment(ctx: GithubContext, id: number): Promise<Deployment> {
  const res = await ghRequest(ctx, `/repos/${ctx.repo}/deployments/${id}`);
  return res.body as Deployment;
}

/** 拉取某部署的**全部**状态（跟 Link 分页），不假设一页装完 */
export async function listAllDeploymentStatuses(ctx: GithubContext, id: number): Promise<DeploymentStatus[]> {
  let url: string | null = `/repos/${ctx.repo}/deployments/${id}/statuses?per_page=100`;
  const all: DeploymentStatus[] = [];
  while (url) {
    const res: RawResponse = await ghRequest(ctx, url);
    const page = Array.isArray(res.body) ? (res.body as DeploymentStatus[]) : [];
    all.push(...page);
    url = nextPageUrl(res.headers.get("link"));
  }
  return all;
}

/** created_at 降序，同时间用 id 降序破平（id 单调递增） */
export function sortStatusesDesc(statuses: readonly DeploymentStatus[]): DeploymentStatus[] {
  return [...statuses].sort((a, b) => {
    const byTime = String(b.created_at).localeCompare(String(a.created_at));
    return byTime !== 0 ? byTime : b.id - a.id;
  });
}

/**
 * 该部署**当前最新状态**：显式排序后取第一条。
 * 只有 state === "success" 且带 environment_url 才返回，否则 null。
 */
export function latestUsableStatus(statuses: readonly DeploymentStatus[]): DeploymentStatus | null {
  const sorted = sortStatusesDesc(statuses);
  const latest = sorted[0];
  if (!latest) return null;
  if (latest.state !== "success") return null;
  if (!latest.environment_url) return null;
  return latest;
}

export interface PreviousDeployment {
  deployment: Deployment;
  status: DeploymentStatus;
}

/** 拉取 Production 部署列表（跟 Link 分页，最多 maxPages 页），已按创建时间倒序 */
async function listProductionDeployments(ctx: GithubContext, maxPages: number): Promise<Deployment[]> {
  let url: string | null = `/repos/${ctx.repo}/deployments?environment=Production&per_page=100`;
  const all: Deployment[] = [];
  let page = 0;
  while (url && page < maxPages) {
    const res: RawResponse = await ghRequest(ctx, url);
    const batch = Array.isArray(res.body) ? (res.body as Deployment[]) : [];
    for (const d of batch) {
      if (d.environment !== "Production") continue; // 双保险：不信任 query 过滤
      all.push(d);
    }
    url = nextPageUrl(res.headers.get("link"));
    page += 1;
  }
  return all.sort((a, b) => {
    const byTime = String(b.created_at).localeCompare(String(a.created_at));
    return byTime !== 0 ? byTime : b.id - a.id;
  });
}

/** 最新的一个「最新状态为 success」的 Production 部署（供人工 dry-run 缺省目标） */
export async function findLatestProductionDeployment(
  ctx: GithubContext,
  options: { maxPages?: number } = {},
): Promise<PreviousDeployment | null> {
  const list = await listProductionDeployments(ctx, options.maxPages ?? 3);
  for (const deployment of list) {
    const statuses = await listAllDeploymentStatuses(ctx, deployment.id);
    const status = latestUsableStatus(statuses);
    if (status) return { deployment, status };
  }
  return null;
}

/**
 * 找「创建时间严格早于当前部署、且最新状态为 success」的最近一个 Production 部署。
 *
 * 不能取列表第一条：工作流延迟执行时，列表第一条可能已经是当前部署**之后**的新部署。
 */
export async function findPreviousProductionDeployment(
  ctx: GithubContext,
  current: { id: number; created_at: string },
  options: { maxPages?: number } = {},
): Promise<PreviousDeployment | null> {
  const list = await listProductionDeployments(ctx, options.maxPages ?? 3);
  const candidates = list.filter((d) => {
    if (d.id === current.id) return false;
    // 严格早于当前部署；同秒用 id 破平
    return d.created_at < current.created_at || (d.created_at === current.created_at && d.id < current.id);
  });

  for (const deployment of candidates) {
    const statuses = await listAllDeploymentStatuses(ctx, deployment.id);
    const status = latestUsableStatus(statuses);
    if (status) return { deployment, status };
  }
  return null;
}

// ===== 部署专属 Sitemap 快照 =====

export type SnapshotFailure =
  | "network"
  | "protected-401"
  | "forbidden-403"
  | "gone-404"
  | "expired-410"
  | "upstream-5xx"
  | "invalid-xml"
  | "invalid-urls"
  | "empty";

export interface SnapshotResult {
  ok: boolean;
  urls: string[];
  failure?: SnapshotFailure;
  detail?: string;
  /** 是否值得再试（网络/5xx 值得，401/404/410 不值得） */
  retryable: boolean;
  httpStatus: number | null;
}

/**
 * 读取 `<deploymentUrl>/sitemap.xml` 并校验。
 *
 * 失败分类必须区分：网络不通 ≠ 401 保护 ≠ 410 过期。
 * 401/403 **只**代表 Deployment Protection，不得自动关闭、不得加 bypass secret。
 */
export async function fetchDeploymentSitemap(
  deploymentUrl: string,
  options: { fetchImpl?: typeof fetch; attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SnapshotResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${deploymentUrl.replace(/\/+$/, "")}/sitemap.xml`;

  let last: SnapshotResult = { ok: false, urls: [], failure: "network", detail: "not attempted", retryable: true, httpStatus: null };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        headers: { accept: "application/xml,text/xml,*/*" },
        signal: AbortSignal.timeout(15_000),
      });
      const status = res.status;

      if (status === 401) {
        return {
          ok: false,
          urls: [],
          failure: "protected-401",
          detail: `${url} → 401（Vercel Deployment Protection）。需人工在 Vercel 侧处理，禁止自动关闭或新增 bypass secret`,
          retryable: false,
          httpStatus: 401,
        };
      }
      if (status === 403) {
        return { ok: false, urls: [], failure: "forbidden-403", detail: `${url} → 403`, retryable: false, httpStatus: 403 };
      }
      if (status === 404) {
        return { ok: false, urls: [], failure: "gone-404", detail: `${url} → 404（部署可能已被删除）`, retryable: false, httpStatus: 404 };
      }
      if (status === 410) {
        return {
          ok: false,
          urls: [],
          failure: "expired-410",
          detail: `${url} → 410（Vercel 保留期到期，不可恢复使用）`,
          retryable: false,
          httpStatus: 410,
        };
      }
      if (status >= 500) {
        last = { ok: false, urls: [], failure: "upstream-5xx", detail: `${url} → ${status}`, retryable: true, httpStatus: status };
        if (attempt < attempts) {
          await sleep(2_000 * attempt);
          continue;
        }
        return last;
      }
      if (status < 200 || status >= 300) {
        return { ok: false, urls: [], failure: "invalid-xml", detail: `${url} → ${status}`, retryable: false, httpStatus: status };
      }

      const text = await res.text();
      if (!/<urlset[\s>]/.test(text)) {
        return { ok: false, urls: [], failure: "invalid-xml", detail: `${url} 返回 200 但不是 sitemap（无 <urlset>）`, retryable: false, httpStatus: status };
      }
      const urls = extractSitemapUrls(text);
      if (urls.length === 0) {
        return { ok: false, urls: [], failure: "empty", detail: `${url} 解析出 0 条 <loc>`, retryable: false, httpStatus: status };
      }
      const validation = validateSitemapUrls(urls);
      if (!validation.ok) {
        return { ok: false, urls, failure: "invalid-urls", detail: validation.reason ?? "bad urls", retryable: false, httpStatus: status };
      }
      return { ok: true, urls, retryable: false, httpStatus: status };
    } catch (error) {
      const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      last = { ok: false, urls: [], failure: "network", detail: `${url} 连接失败 —— ${msg}`, retryable: true, httpStatus: null };
      if (attempt < attempts) {
        await sleep(2_000 * attempt);
        continue;
      }
      return last;
    }
  }
  return last;
}

/** 删除通知前的实证：只有 404/410 才算"确已下线" */
export async function probeGone(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ gone: boolean; status: number | null; detail: string }> {
  try {
    const res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const status = res.status;
    if (status === 404 || status === 410) return { gone: true, status, detail: `${status} gone` };
    return { gone: false, status, detail: `${status} still reachable` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { gone: false, status: null, detail: `probe failed: ${msg}` };
  }
}

// ===== Check Runs =====

export const CHECK_PREFIX_AUTO = "indexnow/deployment-";
export const CHECK_PREFIX_MANUAL = "indexnow/manual/";

export function autoCheckRunName(deploymentId: number | string): string {
  return `${CHECK_PREFIX_AUTO}${deploymentId}`;
}

/** 从 summary 解析 attempt；解析不到按 0 处理（无记录） */
export function parseAttempt(summary: string | null | undefined): number {
  if (!summary) return 0;
  const m = summary.match(/attempt=(\d+)/);
  return m ? Number(m[1]) : 0;
}

export interface CheckRunQuery {
  sha: string;
  name: string;
  externalId?: string;
}

/** 查既有记录（同名同名一次返回最新一条） */
export async function findCheckRun(ctx: GithubContext, query: CheckRunQuery): Promise<CheckRun | null> {
  const qs = new URLSearchParams({ check_name: query.name, filter: "latest", per_page: "100" });
  const res = await ghRequest(ctx, `/repos/${ctx.repo}/commits/${query.sha}/check-runs?${qs.toString()}`);
  const body = res.body as { check_runs?: CheckRun[] } | null;
  const runs = body?.check_runs ?? [];
  const match = runs.find((r) => r.name === query.name);
  if (!match) return null;
  if (query.externalId && match.external_id && match.external_id !== query.externalId) return null;
  return match;
}

export interface CreateCheckRunInput {
  name: string;
  headSha: string;
  externalId: string;
  detailsUrl?: string;
  title: string;
  summary: string;
  text?: string;
  conclusion?: "success" | "neutral" | "failure" | "action_required";
}

export async function createCheckRun(ctx: GithubContext, input: CreateCheckRunInput): Promise<CheckRun> {
  const body: Record<string, unknown> = {
    name: input.name,
    head_sha: input.headSha,
    external_id: input.externalId,
    status: "in_progress",
    started_at: new Date().toISOString(),
    output: { title: input.title, summary: input.summary, text: input.text ?? "" },
  };
  if (input.detailsUrl) body.details_url = input.detailsUrl;
  const res = await ghRequest(ctx, `/repos/${ctx.repo}/check-runs`, { method: "POST", body: JSON.stringify(body) });
  return res.body as CheckRun;
}

export async function updateCheckRun(
  ctx: GithubContext,
  id: number,
  update: {
    conclusion: "success" | "neutral" | "failure" | "action_required";
    title: string;
    summary: string;
    text?: string;
  },
): Promise<CheckRun> {
  const body = {
    status: "completed",
    conclusion: update.conclusion,
    completed_at: new Date().toISOString(),
    output: { title: update.title, summary: update.summary, text: update.text ?? "" },
  };
  const res = await ghRequest(ctx, `/repos/${ctx.repo}/check-runs/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  return res.body as CheckRun;
}

// ===== 幂等判定 =====

export type IdempotencyDecision =
  | { action: "proceed"; attempt: number; reason: string }
  | { action: "skip"; reason: string };

/**
 * 依据既有 Check Run 决定是否继续。
 *
 * - 无记录 → 执行，attempt=1
 * - success → 已收到，跳过
 * - neutral → 202 已记录，跳过（不补发）
 * - failure → 确定性失败，跳过并要求人工
 * - action_required → attempt < 3 允许再试一次；否则停止
 * - in_progress → 10 分钟内视为在飞，跳过；超时视为陈旧，允许重试
 */
export function decideIdempotency(
  existing: CheckRun | null,
  now: Date = new Date(),
  maxAttempts = 3,
): IdempotencyDecision {
  if (!existing) return { action: "proceed", attempt: 1, reason: "no previous record" };

  const summary = existing.output?.summary ?? "";
  const attempt = parseAttempt(summary);

  if (existing.status === "completed") {
    switch (existing.conclusion) {
      case "success":
        return { action: "skip", reason: "already completed: success (URLs received)" };
      case "neutral":
        return { action: "skip", reason: "already completed: neutral (202 accepted, key validation pending)" };
      case "failure":
        return { action: "skip", reason: "already completed: failure (definitive; requires human)" };
      case "action_required":
        if (attempt >= maxAttempts) {
          return { action: "skip", reason: `attempt budget exhausted (${attempt}/${maxAttempts}); requires human` };
        }
        return { action: "proceed", attempt: attempt + 1, reason: `previous run left unknown outcome (attempt ${attempt})` };
      default:
        return { action: "skip", reason: `already completed with conclusion ${existing.conclusion}` };
    }
  }

  const startedAt = existing.started_at ? new Date(existing.started_at) : null;
  const ageMin = startedAt ? (now.getTime() - startedAt.getTime()) / 60_000 : Number.POSITIVE_INFINITY;
  if (ageMin < 10) {
    return { action: "skip", reason: `in progress (started ${Math.round(ageMin)} min ago)` };
  }
  if (attempt >= maxAttempts) {
    return { action: "skip", reason: `in progress but attempt budget exhausted (${attempt}/${maxAttempts})` };
  }
  return { action: "proceed", attempt: Math.max(attempt, 1) + 1, reason: `stale in_progress (>${Math.round(ageMin)} min)` };
}

/** summary 统一格式（可被 parseAttempt 解析） */
export function buildSummary(fields: {
  outcome: string;
  attempt: number;
  added: number;
  updated: number;
  deleted: number;
  urls: number;
  cur?: string | null;
  prev?: string | null;
  at?: string;
}): string {
  const at = fields.at ?? new Date().toISOString();
  const parts = [
    `outcome=${fields.outcome}`,
    `attempt=${fields.attempt}`,
    `added=${fields.added}`,
    `updated=${fields.updated}`,
    `deleted=${fields.deleted}`,
    `urls=${fields.urls}`,
    `at=${at}`,
  ];
  if (fields.cur) parts.push(`cur=${fields.cur}`);
  if (fields.prev) parts.push(`prev=${fields.prev}`);
  return parts.join("; ");
}

/** 提交前的硬校验：所有 URL 必须属于规范 origin（脚本入口再调一次，双保险） */
export function assertCanonicalOrigin(urls: readonly string[], origin: string = SITE_ORIGIN): void {
  for (const u of urls) {
    if (u !== origin && !u.startsWith(`${origin}/`)) {
      throw new Error(`非规范域名的 URL 混入提交集合：${u}`);
    }
  }
}
