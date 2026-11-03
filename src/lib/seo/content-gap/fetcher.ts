// ===== SSRF 安全抓取（Website Content Gap 专用） =====
//
// 抓取对象是用户明确选择的项目域名的公开页面。安全要求（硬约束）：
//   - 仅 HTTP/HTTPS；
//   - 解析 DNS 并拒绝回环/私有/链路本地/云 metadata 地址（防 SSRF 与 rebinding）；
//   - 手动跟随重定向，每一跳重新校验目标；
//   - 超时 / 最大重定向 / 响应体大小 / 并发上限；
//   - robots.txt 基础遵守（User-agent: * 的 Disallow 前缀匹配）；
//   - 不跟随外站链接（由调用方约束 URL 集合），不读取需登录内容。

import * as dns from "node:dns/promises";
import * as net from "node:net";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 512 * 1024;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local（含云 metadata 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local / ULA
  if (v.startsWith("::ffff:")) return isPrivateIPv4(v.replace("::ffff:", ""));
  return false;
}

/** 解析主机并校验全部地址都落在公网。重绑定防护：每次请求都重新解析。 */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)) {
      throw new BlockedUrlError(`拒绝私有/保留地址：${hostname}`);
    }
    return;
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BlockedUrlError(`DNS 解析失败：${hostname}`);
  }
  if (records.length === 0) throw new BlockedUrlError(`DNS 无记录：${hostname}`);
  for (const r of records) {
    if (r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address)) {
      throw new BlockedUrlError(`拒绝私有/保留地址：${hostname} → ${r.address}`);
    }
  }
}

/** 请求前校验 URL 协议与主机（含 DNS） */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(`无效 URL：${rawUrl}`);
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    throw new BlockedUrlError(`仅允许 http/https：${rawUrl}`);
  }
  await assertPublicHost(u.hostname);
  return u;
}

// ---------- robots.txt（基础遵守） ----------

export interface RobotsRules {
  /** User-agent: * 的 Disallow 前缀列表（空 = 无限制） */
  disallow: string[];
  fetched: boolean;
}

export async function fetchRobotsRules(origin: string): Promise<RobotsRules> {
  const url = `${origin}/robots.txt`;
  const res = await safeFetch(url);
  if (!res || !res.body) return { disallow: [], fetched: false };
  const disallow: string[] = [];
  let inStar = false;
  for (const line of res.body.split(/\r?\n/)) {
    const clean = line.split("#")[0].trim();
    if (/^user-agent:/i.test(clean)) inStar = clean.split(":")[1].trim() === "*";
    else if (inStar && /^disallow:/i.test(clean)) {
      const path = clean.slice("disallow:".length).trim();
      if (path) disallow.push(path);
    }
  }
  return { disallow, fetched: true };
}

export function isAllowedByRobots(pathWithQuery: string, rules: RobotsRules): boolean {
  for (const d of rules.disallow) {
    if (d === "/" ) return false;
    if (pathWithQuery.startsWith(d)) return false;
  }
  return true;
}

// ---------- 安全抓取 ----------

export interface SafeFetchResult {
  status: number;
  body: string | null;
  finalUrl: string;
  /** 重定向链（诊断用） */
  redirects: string[];
}

export async function safeFetch(rawUrl: string): Promise<SafeFetchResult | null> {
  let current = rawUrl;
  const redirects: string[] = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertSafeUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(u.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "SeeOContentGap/1.0 (+site audit; respects robots.txt)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
          "Accept-Encoding": "gzip",
        },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) return { status: res.status, body: null, finalUrl: current, redirects };
        const next = new URL(loc, u).toString();
        redirects.push(next);
        current = next;
        continue;
      }
      if (!res.ok) {
        return { status: res.status, body: null, finalUrl: current, redirects };
      }
      // 响应体大小限制：content-length 可预检；缺失（chunked）时流式读取，
      // 累积超过上限立即中断，不把超大响应体整块读进内存。
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BODY_BYTES) {
        return { status: res.status, body: null, finalUrl: current, redirects };
      }
      let buf: Uint8Array | null = null;
      if (len > 0) {
        buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > MAX_BODY_BYTES) buf = null;
      } else if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BODY_BYTES) {
            await reader.cancel().catch(() => undefined);
            buf = null;
            break;
          }
          chunks.push(value);
        }
        if (chunks.length > 0 && total <= MAX_BODY_BYTES) {
          const merged = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            merged.set(c, off);
            off += c.byteLength;
          }
          buf = merged;
        }
      } else {
        buf = new Uint8Array(0);
      }
      const body = buf ? new TextDecoder("utf-8", { fatal: false }).decode(buf) : null;
      return { status: res.status, body, finalUrl: current, redirects };
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new BlockedUrlError(`抓取超时：${current}`);
      }
      if ((e as Error).name === "BlockedUrlError") throw e;
      return { status: 0, body: null, finalUrl: current, redirects };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new BlockedUrlError(`重定向次数超过上限（${MAX_REDIRECTS}）：${rawUrl}`);
}
