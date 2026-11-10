// ===== IndexNow 协议层 =====
//
// 只负责协议本身：Key 自发现、URL 白名单、payload、POST、响应分类、有限重试。
// 不涉及 GitHub、不涉及文件映射（那些在 indexnow-github.ts / indexnow-map.ts）。
//
// 官方依据（https://www.indexnow.org/documentation）：
//   - 单次 urlList 上限 10000
//   - Key 为 8–128 个 [a-zA-Z0-9-]，需在站点根目录放同名 .txt，内容即 Key
//   - 200 OK：URL submitted successfully（**仅表示已收到**）
//   - 202 Accepted：URL received. IndexNow key validation pending.
//   - 400 Bad request / 403 Forbidden(key 不合法) / 422 Unprocessable(host 或 schema 不符) / 429 限流

import fs from "node:fs";
import path from "node:path";
import {
  INDEXNOW_HOST,
  SITE_ORIGIN,
  isSubmittableUrl,
  type SiteLocale,
  type SitemapValidation,
} from "./indexnow-map.ts";

export { INDEXNOW_HOST, SITE_ORIGIN };

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const MAX_URLS_PER_REQUEST = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS = [5_000, 20_000];

/** Key 文件名规则：8–128 位 [a-z0-9-]，与官方一致 */
export const KEY_FILE_PATTERN = /^[a-z0-9-]{8,128}\.txt$/;

// ===== Key 发现 =====

export interface KeyFile {
  key: string;
  /** 相对仓库根的文件名，用于日志 */
  file: string;
}

/**
 * 从 public/ 自发现 Key：文件名符合规则，且**内容与文件名（去掉 .txt）完全一致**。
 * 必须恰好命中一个，否则抛错（多把 Key 会让校验结果不可预测）。
 */
export function findKeyFile(publicDir: string): KeyFile {
  if (!fs.existsSync(publicDir)) throw new Error(`public 目录不存在：${publicDir}`);
  const hits: KeyFile[] = [];
  for (const name of fs.readdirSync(publicDir)) {
    if (!KEY_FILE_PATTERN.test(name)) continue;
    const content = fs.readFileSync(path.join(publicDir, name), "utf-8").trim();
    const key = name.replace(/\.txt$/, "");
    if (content === key) hits.push({ key, file: name });
  }
  if (hits.length === 0) {
    throw new Error("public/ 下没有合法的 IndexNow Key 文件（文件名 8–128 位 [a-z0-9-]，内容须与文件名一致）");
  }
  if (hits.length > 1) {
    throw new Error(`public/ 下存在多个合法 Key 文件：${hits.map((h) => h.file).join(", ")}`);
  }
  return hits[0];
}

// ===== URL 过滤 =====

export interface PartitionedUrls {
  accepted: string[];
  rejected: string[];
}

/** 去重 + 白名单过滤；不做任何"猜测式"规范化（非规范形态一律拒绝而非改写） */
export function partitionSubmittable(urls: readonly string[]): PartitionedUrls {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (isSubmittableUrl(url)) accepted.push(url);
    else rejected.push(url);
  }
  return { accepted, rejected };
}

// ===== payload =====

export interface IndexNowPayload {
  host: string;
  key: string;
  urlList: string[];
}

/**
 * 构造请求体。根目录已放 Key 文件 → 按官方建议走 Option 1，省略 keyLocation。
 */
export function buildPayload(key: string, urls: readonly string[], host: string = INDEXNOW_HOST): IndexNowPayload {
  if (!key) throw new Error("缺少 IndexNow key");
  if (urls.length === 0) throw new Error("urlList 为空，拒绝发送");
  if (urls.length > MAX_URLS_PER_REQUEST) {
    throw new Error(`urlList 超过单次上限 ${MAX_URLS_PER_REQUEST}（实际 ${urls.length}）`);
  }
  return { host, key, urlList: [...urls] };
}

// ===== 响应分类 =====

/**
 * received              → 200：引擎已收到（不代表已抓取/已收录）
 * accepted_pending_key  → 202：已收到，Key 校验待处理；**禁止重发整批**
 * rejected              → 400/403/422：请求或 Key 错误，重试无意义
 * retryable             → 429/5xx/网络异常：可重试
 */
export type SubmitOutcome = "received" | "accepted_pending_key" | "rejected" | "retryable";

export interface Classification {
  outcome: SubmitOutcome;
  retryable: boolean;
  /** 人类可读原因，写进 Check Run summary */
  reason: string;
}

export function classifyHttpStatus(status: number): Classification {
  if (status === 200) {
    return { outcome: "received", retryable: false, reason: "200 received by IndexNow (not crawled, not indexed)" };
  }
  if (status === 202) {
    return {
      outcome: "accepted_pending_key",
      retryable: false,
      reason: "202 accepted; key validation pending (do not resend batch)",
    };
  }
  if (status === 400) return { outcome: "rejected", retryable: false, reason: "400 bad request" };
  if (status === 403) return { outcome: "rejected", retryable: false, reason: "403 key rejected" };
  if (status === 422) {
    return { outcome: "rejected", retryable: false, reason: "422 host/schema mismatch" };
  }
  if (status === 429) return { outcome: "retryable", retryable: true, reason: "429 rate limited" };
  if (status >= 500) return { outcome: "retryable", retryable: true, reason: `${status} upstream error` };
  if (status >= 200 && status < 300) {
    return { outcome: "received", retryable: false, reason: `${status} received by IndexNow` };
  }
  return { outcome: "rejected", retryable: false, reason: `${status} unexpected response` };
}

export function classifyNetworkError(error: unknown): Classification {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { outcome: "retryable", retryable: true, reason: `network error — ${msg}` };
}

// ===== 提交 =====

export interface SubmitOptions {
  key: string;
  urls: readonly string[];
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  backoffMs?: readonly number[];
  endpoint?: string;
  /** 测试注入；默认真实等待 */
  sleep?: (ms: number) => Promise<void>;
  /** 每次尝试后可观测 */
  onAttempt?: (info: { attempt: number; outcome: SubmitOutcome; httpStatus: number | null; reason: string }) => void;
}

export interface SubmitResult {
  outcome: SubmitOutcome;
  /** 实际发出的 HTTP POST 次数（含首次） */
  attempts: number;
  httpStatus: number | null;
  reason: string;
  /** 响应体前 500 字符，便于排障 */
  body: string;
  urlCount: number;
  rejectedUrls: string[];
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 提交一批 URL。
 *
 * 重试只发生在 retryable 分支（429/5xx/网络异常），且总次数受 maxAttempts 限制。
 * 202 不重试、不重发整批；400/403/422 不重试。
 */
export async function submitIndexNow(options: SubmitOptions): Promise<SubmitResult> {
  const {
    key,
    urls,
    fetchImpl = fetch,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs = DEFAULT_BACKOFF_MS,
    endpoint = INDEXNOW_ENDPOINT,
    sleep = realSleep,
    onAttempt,
  } = options;

  const { accepted, rejected } = partitionSubmittable(urls);
  if (accepted.length === 0) {
    throw new Error(`没有任何可提交的 URL（全部被白名单拒绝：${rejected.slice(0, 5).join(", ")}）`);
  }
  const payload = buildPayload(key, accepted);

  let lastReason = "";
  let lastStatus: number | null = null;
  let lastBody = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let classification: Classification;
    let body = "";
    let httpStatus: number | null = null;

    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      httpStatus = res.status;
      classification = classifyHttpStatus(res.status);
      body = (await res.text().catch(() => "")).slice(0, 500);
    } catch (error) {
      classification = classifyNetworkError(error);
    }

    lastReason = classification.reason;
    lastStatus = httpStatus;
    lastBody = body;
    onAttempt?.({ attempt, outcome: classification.outcome, httpStatus, reason: classification.reason });

    if (!classification.retryable) {
      return {
        outcome: classification.outcome,
        attempts: attempt,
        httpStatus,
        reason: classification.reason,
        body,
        urlCount: accepted.length,
        rejectedUrls: rejected,
      };
    }

    if (attempt < maxAttempts) {
      const wait = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1] ?? 5_000;
      await sleep(wait);
    }
  }

  return {
    outcome: "retryable",
    attempts: maxAttempts,
    httpStatus: lastStatus,
    reason: `${lastReason} (exhausted ${maxAttempts} attempts)`,
    body: lastBody,
    urlCount: accepted.length,
    rejectedUrls: rejected,
  };
}

// ===== 202 后置：只复检 Key 文件，不重发 =====

export interface KeyCheck {
  ok: boolean;
  status: number | null;
  reason: string;
}

/** 复检 https://www.seeo.asia/<key>.txt 是否可取且内容一致 */
export async function verifyKeyFile(
  key: string,
  fetchImpl: typeof fetch = fetch,
  origin: string = SITE_ORIGIN,
): Promise<KeyCheck> {
  const url = `${origin}/${key}.txt`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, status: res.status, reason: `key file ${res.status}` };
    const text = (await res.text()).trim();
    if (text !== key) return { ok: false, status: res.status, reason: "key file content mismatch" };
    return { ok: true, status: res.status, reason: "key file ok" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, reason: `key file unreachable: ${msg}` };
  }
}

// ===== 结论映射（Check Run）=====

export type CheckConclusion = "success" | "neutral" | "failure" | "action_required";

/** 协议结果 → Check Run conclusion。200 与 202 必须落在不同 conclusion。 */
export function conclusionFor(outcome: SubmitOutcome): CheckConclusion {
  switch (outcome) {
    case "received":
      return "success";
    case "accepted_pending_key":
      return "neutral";
    case "rejected":
      return "failure";
    case "retryable":
      return "action_required";
  }
}

// ===== 首次验证模式（verification-only）=====
//
// 用于首次上线：完整计算计划、写 Check Run，但**绝不**调用 submitIndexNow。
// 空计划记 no-op；非空计划记 neutral（不是 success，也不是 failure），
// 文案必须明确「已计划、未提交」，不能被读成 Bing 已接收。

export interface VerificationRecord {
  conclusion: "success" | "neutral";
  headline: string;
}

export function verificationOutcome(urlCount: number): VerificationRecord {
  if (urlCount === 0) {
    return { conclusion: "success", headline: "IndexNow verification: no changes detected; 0 URLs planned." };
  }
  return {
    conclusion: "neutral",
    headline: `Verification completed; ${urlCount} URLs planned; no URLs submitted.`,
  };
}

// ===== 入口前置条件（提交前的硬闸门）=====
//
// 位置很关键：这些断言必须在**创建 Check Run 之前**、更必须在 `submitIndexNow` 之前执行。
// 缺 head SHA 时若只是"跳过记录但照常提交"，就会出现「发了 URL 却查不到回执」的裸奔路径，
// 所以这里一律抛错，由 CLI 转成非零退出。

export const SHA40 = /^[0-9a-f]{40}$/i;

export type ShaSource = "plan" | "arg" | "env" | "none";

export interface HeadShaResolution {
  sha: string | null;
  source: ShaSource;
}

/**
 * head SHA 的优先级：真实部署 SHA > 显式 --sha > GITHUB_SHA。
 *
 * 之所以让 plan 优先：`submit` 模式可能被 `workflow_dispatch` 触发，此时 `GITHUB_SHA`
 * 是 main 的最新提交，而真正要比对的是**目标 deployment 的 SHA**——用错会把 diff 算偏。
 * `all` 模式没有 deployment，才允许回退到 `GITHUB_SHA`。
 */
export function resolveHeadSha(input: {
  planCurSha?: string | null;
  argSha?: string | null;
  envSha?: string | null;
}): HeadShaResolution {
  const candidates: Array<[Exclude<ShaSource, "none">, string | null | undefined]> = [
    ["plan", input.planCurSha],
    ["arg", input.argSha],
    ["env", input.envSha],
  ];
  for (const [source, value] of candidates) {
    const v = (value ?? "").trim();
    if (SHA40.test(v)) return { sha: v.toLowerCase(), source };
  }
  return { sha: null, source: "none" };
}

export class PreconditionError extends Error {
  readonly code: string;

  constructor(message: string, code = "PRECONDITION_FAILED") {
    super(message);
    this.name = "PreconditionError";
    this.code = code;
  }
}

/** 非 dry-run 模式必须拿到有效 40 位 SHA，否则中止（调用点在任何写操作之前） */
export function requireHeadSha(sha: string | null, mode: string): string {
  if (!sha || !SHA40.test(sha)) {
    throw new PreconditionError(
      `mode=${mode} 无法确定 40 位 head SHA（部署 SHA / --sha / GITHUB_SHA 均无效）；` +
        "已在创建 Check Run 与发送 IndexNow POST 之前中止",
      "HEAD_SHA_MISSING",
    );
  }
  return sha;
}

/** all 模式的确认闸门：必须精确等于 SUBMIT-ALL（不做 trim，大小写/空格都不放过） */
export function assertAllConfirm(confirm: string | null | undefined): void {
  if (confirm !== "SUBMIT-ALL") {
    throw new PreconditionError(
      `all 模式要求 --confirm 精确等于 SUBMIT-ALL（收到：${JSON.stringify(confirm ?? "")}），未发送任何请求`,
      "CONFIRM_MISMATCH",
    );
  }
}

// ===== locale 级 URL 组装（供脚本使用，避免脚本重复实现映射规则） =====
export function urlsForLocalePaths(
  entries: ReadonlyArray<{ path: string; locales: readonly SiteLocale[] }>,
  canonical: (locale: SiteLocale, p: string) => string,
): string[] {
  const out = new Set<string>();
  for (const { path: p, locales } of entries) {
    for (const l of locales) out.add(canonical(l, p));
  }
  return [...out].sort();
}

export type { SitemapValidation };
