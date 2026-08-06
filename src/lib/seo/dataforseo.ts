// ===== DataForSEO Backlinks 实现（服务端专用） =====
// 文档：https://docs.dataforseo.com/v3/seo/backlinks/api/
// 仅在 API Route 中通过 import 调用，确保 DATAFORSEO_LOGIN/PASSWORD 不暴露到前端 bundle

export interface BacklinkSummary {
  total_backlinks: number | null;
  referring_domains: number | null;
  domain_rank: number | null;
  dofollow_pct: number | null;
}

export interface BacklinkItem {
  source_url: string | null;
  anchor: string | null;
  target_url: string | null;
  dofollow: number | null; // 0/1
  source_rank: number | null;
  first_seen: string | null; // ISO YYYY-MM-DD
}

export interface BacklinkData {
  summary: BacklinkSummary;
  backlinks: BacklinkItem[];
  rawJson: { summary: unknown; backlinks: unknown };
}

/** 未配置凭证时的明确错误 */
export class DataForSeoNotConfiguredError extends Error {
  constructor() {
    super("未配置 DataForSEO 凭证（DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD）");
    this.name = "DataForSeoNotConfiguredError";
  }
}

/** DataForSEO 业务错误（透传 status_message） */
export class DataForSeoApiError extends Error {
  status_code: number;
  status_message: string;
  constructor(status_code: number, status_message: string) {
    super(`DataForSEO 错误 [${status_code}]: ${status_message}`);
    this.name = "DataForSeoApiError";
    this.status_code = status_code;
    this.status_message = status_message;
  }
}

const UPSTREAM_TIMEOUT_MS = 30_000;
const API_BASE = "https://api.dataforseo.com/v3";

function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new DataForSeoNotConfiguredError();
  }
  const token = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${token}`;
}

interface DfsTask<T> {
  status_code: number;
  status_message: string;
  result?: T[];
}

interface DfsResponse<T> {
  version: string;
  status_code: number;
  status_message: string;
  tasks: DfsTask<T>[];
}

interface DfsSummaryItem {
  type: string;
  total_backlinks?: number;
  referring_domains?: number;
  domain_rank?: number;
  backlinks?: {
    dofollow?: number;
    nofollow?: number;
  };
  info?: {
    backlinks?: number;
    referring_domains?: number;
    domain_rank?: number;
  };
}

interface DfsSummaryResult {
  total_count: number;
  items_count?: number;
  items?: DfsSummaryItem[];
}

interface DfsBacklinkItem {
  type: string;
  rank?: number;
  domain_from?: string;
  url_from?: string;
  url_to?: string;
  anchor?: string;
  is_dofollow?: boolean;
  first_seen?: string;
}

interface DfsBacklinksResult {
  total_count: number;
  items?: DfsBacklinkItem[];
}

function extractSummary(raw: DfsResponse<DfsSummaryResult>): BacklinkSummary {
  const item = raw.tasks?.[0]?.result?.[0]?.items?.[0];
  if (!item) {
    return {
      total_backlinks: null,
      referring_domains: null,
      domain_rank: null,
      dofollow_pct: null,
    };
  }
  // DataForSEO 返回结构兼容多版本：直接字段或 info 嵌套
  const total = item.total_backlinks ?? item.info?.backlinks ?? null;
  const refDomains = item.referring_domains ?? item.info?.referring_domains ?? null;
  const rank = item.domain_rank ?? item.info?.domain_rank ?? null;
  const dofollow = item.backlinks?.dofollow ?? null;
  const nofollow = item.backlinks?.nofollow ?? null;
  let dofollowPct: number | null = null;
  if (dofollow !== null && nofollow !== null && dofollow + nofollow > 0) {
    dofollowPct = Math.round((dofollow / (dofollow + nofollow)) * 1000) / 10;
  }
  return {
    total_backlinks: total !== null ? Number(total) : null,
    referring_domains: refDomains !== null ? Number(refDomains) : null,
    domain_rank: rank !== null ? Number(rank) : null,
    dofollow_pct: dofollowPct,
  };
}

function extractBacklinks(raw: DfsResponse<DfsBacklinksResult>): BacklinkItem[] {
  const items = raw.tasks?.[0]?.result?.[0]?.items ?? [];
  return items
    .filter((it) => it.type === "backlink")
    .map((it) => ({
      source_url: it.url_from ?? null,
      anchor: it.anchor ?? null,
      target_url: it.url_to ?? null,
      dofollow: it.is_dofollow === undefined ? null : (it.is_dofollow ? 1 : 0),
      source_rank: it.rank ?? null,
      first_seen: it.first_seen ?? null,
    }));
}

async function dfsFetch<T>(path: string, payload: unknown): Promise<DfsResponse<T>> {
  const authHeader = getAuthHeader();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let json: DfsResponse<T>;
    try {
      json = JSON.parse(text) as DfsResponse<T>;
    } catch {
      throw new Error(`DataForSEO 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    // HTTP 层错误
    if (!res.ok) {
      const msg = json.status_message || `HTTP ${res.status}`;
      throw new DataForSeoApiError(res.status, msg);
    }
    // 顶层业务错误
    if (json.status_code !== 20000) {
      throw new DataForSeoApiError(json.status_code, json.status_message || "未知错误");
    }
    // task 层错误
    const task = json.tasks?.[0];
    if (task && task.status_code !== 20000) {
      throw new DataForSeoApiError(task.status_code, task.status_message || "任务错误");
    }
    return json;
  } catch (e) {
    if (e instanceof DataForSeoNotConfiguredError) throw e;
    if (e instanceof DataForSeoApiError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("DataForSEO 请求超时（30s）");
    }
    throw new Error(`DataForSEO 请求失败：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchBacklinksOptions {
  limit?: number; // 外链列表条数，默认 100
}

/**
 * 并行拉取 summary + backlinks 两个端点。
 * 返回标准化数据 + 原始 JSON（存 raw_json 便于后续回溯）。
 */
export async function fetchBacklinks(
  domain: string,
  options?: FetchBacklinksOptions
): Promise<BacklinkData> {
  const limit = options?.limit ?? 100;
  const target = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();

  const [summaryRes, backlinksRes] = await Promise.all([
    dfsFetch<DfsSummaryResult>("/backlinks/summary/live", {
      target: target,
      include_subdomains: false,
      internal_list_limit: 1,
    }),
    dfsFetch<DfsBacklinksResult>("/backlinks/backlinks/live", {
      target: target,
      include_subdomains: false,
      limit,
      order_by: ["rank,desc"],
    }),
  ]);

  return {
    summary: extractSummary(summaryRes),
    backlinks: extractBacklinks(backlinksRes),
    rawJson: { summary: summaryRes, backlinks: backlinksRes },
  };
}

/** 是否已配置凭证（供路由层提前判断） */
export function isDataForSeoConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}
