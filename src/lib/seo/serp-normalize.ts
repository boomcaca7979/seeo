// ===== SERP 链接规范化（唯一实现）=====
//
// 背景（2026-11-01 验收 DEF-01）：SerpApi 的部分 organic 结果 `link` / `domain`
// 返回的是 Google 站内跳转串 `/goto?url=CAES…`。这是 Google 的不透明重定向 token
// （protobuf 编码，`CAES` 是字段标记），**不是** base64 包裹的真实 URL——解码后得到
// 的是二进制字节而不是地址，因此不能"解码当链接用"，也不能把该串当域名展示。
//
// 设计原则：
//   1. 只做可验证的解析：`/url?q=<真实地址>` 这类 Google 公开包装可以安全还原；
//      `/goto?url=<token>` 一律判定为「不可还原」，绝不猜测。
//   2. 域名优先取 provider 自己的 `domain` 字段；该字段本身是跳转串/URL 形态时，
//      退回 `displayedLink`（Google 结果里可见的面包屑，如 `https://a.com › path`）
//      里可解析出的主机名；都没有则为 null。
//   3. 不改写原始 `link` / `domain`（竞争信号等内部逻辑仍按原值计算），
//      只补充 resolvedUrl / resolvedDomain / linkStatus 三个派生字段。
//   4. 幂等：同一行重复规范化结果一致，历史快照读出来再规范化也不会漂移。

export type SerpLinkStatus =
  /** 拿到可验证的 http(s) 真实地址 */
  | "ok"
  /** Google 内部跳转 token（/goto?url=…），无法还原真实地址 */
  | "google_redirect_token"
  /** 存在但无法安全解析（相对路径、非 http 协议、纯文本等） */
  | "unresolvable"
  /** provider 未返回链接 */
  | "missing";

export interface SerpLinkResolution {
  /** 可安全作为外链打开的地址；不可还原时为 null */
  url: string | null;
  /** 真实域名（不含协议/路径）；不可知时为 null */
  domain: string | null;
  status: SerpLinkStatus;
  domainSource: "provider" | "link" | "displayed_link" | null;
}

/** 主机名形态校验：至少两段、只允许字母数字与连字符，排除 `/goto?url=` 这类串 */
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** provider 偶尔返回 HTML 转义过的 &amp;，还原后再解析 query */
function decodeAmp(s: string): string {
  return s.replace(/&amp;/g, "&");
}

function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * 是否是 Google 内部跳转 token（`/goto?url=…`，可能是相对路径或 google.com 绝对地址）。
 * 注意与 `/url?q=` 区分：后者是可安全还原的公开包装。
 */
function isGoogleGotoToken(value: string): boolean {
  return /^\/goto\b/i.test(value) || /(^|\/)goto\?/i.test(value);
}

function looksLikeHostname(value: string): boolean {
  if (!value || value.includes("/") || value.includes("?") || value.includes("#") || /\s/.test(value)) return false;
  return HOSTNAME_RE.test(value);
}

/**
 * Google `/url?q=` 包装的安全还原（唯一允许的"解码"路径）。
 * 相对形态（`/url?q=…`）与绝对形态（`https://www.google.com/url?q=…`）都支持。
 * 解析不出合法的 http(s) 地址时返回 null——不做任何猜测。
 */
function unwrapGoogleUrl(raw: string): string | null {
  const isWrapper = /^(?:https?:\/\/(?:www\.)?google\.[a-z.]+)?\/url\?/i.test(raw);
  if (!isWrapper) return null;
  try {
    const u = new URL(raw, "https://www.google.com");
    const target = u.searchParams.get("q") ?? u.searchParams.get("url");
    if (!target) return null;
    const decoded = decodeURIComponent(target);
    if (!/^https?:\/\//i.test(decoded)) return null;
    // 目标仍可能是又一层 Google 包装：只递归一层，避免构造性死循环
    if (/^https?:\/\/(?:www\.)?google\.[a-z.]+\/url\?/i.test(decoded)) {
      return unwrapGoogleUrl(decoded);
    }
    return hostnameOf(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * 从 Google 结果的 displayedLink 面包屑里取主机名。
 * 形如 `https://www.oneas1a.com › ai代理是什...`、`www.a.com/path`、`7个回应`（无主机名）。
 * 只取第一段可解析的 host，取不到就返回 null。
 */
export function hostFromDisplayedLink(displayed: string | null | undefined): string | null {
  const raw = (displayed ?? "").trim();
  if (!raw) return null;
  // 面包屑分隔符：空格或 › / >
  const head = raw.split(/[\s\u203a>]/)[0] ?? "";
  if (!head) return null;
  const withoutScheme = head.replace(/^https?:\/\//i, "");
  const hostPart = withoutScheme.split("/")[0]?.toLowerCase() ?? "";
  return looksLikeHostname(hostPart) ? hostPart : null;
}

/**
 * 规范化单条 SERP 链接。
 * @param link provider 返回的 link（可能是真实 URL、Google 包装、/goto token、相对路径）
 * @param providerDomain provider 返回的 domain（可能是真实域名，也可能是 /goto token）
 * @param displayedLink provider 返回的 displayedLink（可见面包屑，用于兜底取域名）
 */
export function resolveSerpLink(
  link: string | null | undefined,
  providerDomain?: string | null,
  displayedLink?: string | null
): SerpLinkResolution {
  const rawLink = decodeAmp((link ?? "").trim());
  const rawDomain = (providerDomain ?? "").trim();
  const displayedHost = hostFromDisplayedLink(displayedLink);
  const providerHost = looksLikeHostname(rawDomain) ? rawDomain.toLowerCase() : null;

  const done = (status: SerpLinkStatus, url: string | null): SerpLinkResolution => {
    const linkHost = url ? hostnameOf(url) : null;
    // 有可验证的真实地址时，以地址主机为准（provider 的 domain 可能是可注册域，
    // 例如 developers.google.com 只给 google.com；链接主机才是"真实域名"）。
    const domain = linkHost ?? providerHost ?? displayedHost ?? null;
    const domainSource: SerpLinkResolution["domainSource"] = linkHost
      ? "link"
      : providerHost
        ? "provider"
        : displayedHost
          ? "displayed_link"
          : null;
    return { url, domain, status, domainSource };
  };

  if (!rawLink) return done("missing", null);

  // Google 内部跳转 token：不可还原（绝不解码成外链）
  if (isGoogleGotoToken(rawLink)) return done("google_redirect_token", null);

  // Google /url?q= 包装：可安全还原
  const unwrapped = unwrapGoogleUrl(rawLink);
  if (unwrapped) return done("ok", unwrapped);

  // 协议相对 //host/path
  if (/^\/\//.test(rawLink)) {
    const absolute = `https:${rawLink}`;
    return hostnameOf(absolute) ? done("ok", absolute) : done("unresolvable", null);
  }

  if (/^https?:\/\//i.test(rawLink)) {
    return hostnameOf(rawLink) ? done("ok", rawLink) : done("unresolvable", null);
  }

  // 相对路径或其他文本：不可安全打开
  return done("unresolvable", null);
}

export interface SerpRowLike {
  link?: string | null;
  domain?: string | null;
  displayedLink?: string | null;
  resolvedUrl?: string | null;
  resolvedDomain?: string | null;
  linkStatus?: SerpLinkStatus;
}

export interface NormalizedSerpFields {
  resolvedUrl: string | null;
  resolvedDomain: string | null;
  linkStatus: SerpLinkStatus;
}

/** 幂等：已带规范化字段的行原样返回（避免对同一行反复解析） */
export function normalizeSerpRow<T extends SerpRowLike>(row: T): T & NormalizedSerpFields {
  if (row.linkStatus !== undefined && row.resolvedUrl !== undefined) {
    return row as T & NormalizedSerpFields;
  }
  const r = resolveSerpLink(row.link, row.domain, row.displayedLink);
  return { ...row, resolvedUrl: r.url, resolvedDomain: r.domain, linkStatus: r.status };
}

export function normalizeSerpRows<T extends SerpRowLike>(rows: T[]): (T & NormalizedSerpFields)[] {
  return rows.map((row) => normalizeSerpRow(row));
}

/** 规范化整个 SERP 结果（organic 逐行），不改动其他字段 */
export function normalizeSerpResult<T extends { organic: SerpRowLike[] }>(
  result: T
): Omit<T, "organic"> & { organic: (T["organic"][number] & NormalizedSerpFields)[] } {
  return { ...result, organic: normalizeSerpRows(result.organic) };
}

/** 面向用户的链接不可用原因（中文/英文由调用方选择文案键，这里只给状态） */
export function isLinkUsable(status: SerpLinkStatus | undefined): boolean {
  return status === "ok";
}
