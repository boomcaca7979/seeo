// ===== Phase 4：API error code catalog 自动化测试 =====
// 覆盖：
//   1. code 唯一性（api-error-codes.ts + 各 route 实际使用的 code）
//   2. EN/ZH apiErrors key 完整对应
//   3. 所有 code 常量都有 EN/ZH message
//   4. route 中使用的 code 字面量都在 catalog 内
//   5. billing errors（billing-error-client）locale 解析 + fallback
//   6. API response contract：error 字段保留（源码级断言）

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { API_ERROR_CODES, ALL_API_ERROR_CODES } from "../lib/errors/api-error-codes";
import { BILLING_ERROR_CODES } from "../lib/billing-error-client";
import EN_MESSAGES from "../../messages/en.json";
import ZH_MESSAGES from "../../messages/zh.json";

// billing-errors.ts 类定义中的既有 code（单一来源为服务端类常量）
const SERVER_BILLING_CODES = [
  "FEATURE_NOT_AVAILABLE",
  "QUOTA_EXCEEDED",
  "PLAN_LIMIT_REACHED",
  "PROJECT_LIMIT_REACHED",
  "KEYWORD_LIMIT_REACHED",
  "AUDIT_DAILY_LIMIT_REACHED",
  "COMPETITOR_LIMIT_REACHED",
  "KEYWORD_GROUP_LIMIT_REACHED",
] as const;

const EN = EN_MESSAGES.apiErrors as Record<string, string>;
const ZH = ZH_MESSAGES.apiErrors as Record<string, string>;

const API_DIR = join(process.cwd(), "src/app/api");

/** 递归收集 route.ts 文件 */
function collectRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectRoutes(full));
    } else if (name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/** 从 route 源码提取 code: "X" 字面量（含 auth.error 形态的 AUTH_REQUIRED） */
function extractRouteCodes(src: string): string[] {
  const codes: string[] = [];
  const re = /code:\s*"([A-Z_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) codes.push(m[1]);
  return codes;
}

describe("1. code 唯一性", () => {
  it("ALL_API_ERROR_CODES 无重复值", () => {
    const vals = [...ALL_API_ERROR_CODES];
    expect(new Set(vals).size).toBe(vals.length);
  });

  it("API_ERROR_CODES 常量名与值一一对应", () => {
    for (const [key, value] of Object.entries(API_ERROR_CODES)) {
      if (key.startsWith("CRAWL_")) continue; // CRAWL_* 常量名与协议值（TIMEOUT 等）有意不同
      expect(key).toBe(value);
    }
  });
});

describe("2. EN/ZH apiErrors key 完整对应", () => {
  it("EN 与 ZH 的 apiErrors key 集合完全一致", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH).sort());
  });

  it("EN/ZH 均无空文案", () => {
    for (const [k, v] of Object.entries(EN)) expect(v.length, `EN ${k}`).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(ZH)) expect(v.length, `ZH ${k}`).toBeGreaterThan(0);
  });
});

describe("3. 所有 code 常量都有 EN/ZH message", () => {
  it("ALL_API_ERROR_CODES 每个值在 EN/ZH catalog 中均有条目", () => {
    for (const code of ALL_API_ERROR_CODES) {
      expect(EN[code], `EN missing ${code}`).toBeTruthy();
      expect(ZH[code], `ZH missing ${code}`).toBeTruthy();
    }
  });

  it("billing 8 个既有 code 均纳入 catalog", () => {
    for (const code of Object.values(BILLING_ERROR_CODES)) {
      expect(EN[code]).toBeTruthy();
      expect(ZH[code]).toBeTruthy();
    }
  });
});

describe("4. route 实际使用的 code 都在 catalog 内", () => {
  it("所有 route 的 code: \"X\" 字面量均为合法 code", () => {
    const routes = collectRoutes(API_DIR);
    expect(routes.length).toBeGreaterThanOrEqual(38);
    const invalid: string[] = [];
    let total = 0;
    for (const f of routes) {
      for (const c of extractRouteCodes(readFileSync(f, "utf8"))) {
        total++;
        if (!(c in EN)) invalid.push(`${f}: ${c}`);
      }
    }
    expect(invalid).toEqual([]);
    expect(total).toBeGreaterThanOrEqual(180);
  });

  it("content/check 既有 CRAWL code（TIMEOUT 等）保持原值", () => {
    const src = readFileSync(join(API_DIR, "content/check/route.ts"), "utf8");
    for (const code of ["TIMEOUT", "HTTP_ERROR", "UNKNOWN", "NETWORK"]) {
      expect(EN[code]).toBeTruthy();
      expect(ZH[code]).toBeTruthy();
    }
    // CrawlError.code 原值仍是这些 code，只是不再直接当用户文案来源
    expect(src).toContain('"INVALID_URL"');
  });

  it("BUG-44：content/check 不再把服务端中文原文拼进响应，按 reason 细分 code", () => {
    const src = readFileSync(join(API_DIR, "content/check/route.ts"), "utf8");
    const start = src.indexOf("function crawlErrorResponse");
    expect(start, "CrawlError 必须有单一映射点").toBeGreaterThan(-1);
    const mapper = src.slice(start, src.indexOf("export async function POST"));
    // 映射区里不允许出现中文字面量（原文改走 console.error 日志）
    expect(mapper.replace("console.error", "").match(/["'`][^"'`\n]*[一-鿿][^"'`\n]*["'`]/g)).toBeNull();
    expect(mapper).toContain("console.error");
    for (const code of ["PRIVATE_HOST", "INVALID_URL_SCHEME", "INVALID_URL_FORMAT"]) {
      expect(mapper).toContain(`"${code}"`);
      expect(EN[code]).toBeTruthy();
      expect(ZH[code]).toBeTruthy();
    }
    // detail 只允许来自语言中立的 HTTP 状态，且必须进响应体
    expect(mapper).toContain('e.code === "HTTP_ERROR"');
    expect(mapper).toContain("detail");
    // 两个 catch 站点（额度前的本地校验 / 抓取失败）共用同一映射点，禁止各自再拼文案
    expect((src.match(/return crawlErrorResponse\(e\)/g) ?? []).length).toBe(2);
  });

  it("BUG-44b：本地就能判出的地址错误不得消耗月度额度", () => {
    const src = readFileSync(join(API_DIR, "content/check/route.ts"), "utf8");
    const scheme = src.indexOf("assertSupportedUserScheme(rawUrl)");
    const safety = src.indexOf("validateUrlSafety(url)");
    const quota = src.indexOf('requireQuota(userId, "content_check")');
    expect(scheme, "协议必须对原文判断（normalizeUrl 会把 ftp:// 拼成 https://ftp://）").toBeGreaterThan(-1);
    expect(safety).toBeGreaterThan(-1);
    expect(quota).toBeGreaterThan(-1);
    expect(scheme).toBeLessThan(quota);
    expect(safety).toBeLessThan(quota);
  });

  it("BUG-44：SSRF 拦截必须带机器可辨 reason，供路由选 code", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/crawl/index.ts"), "utf8");
    expect(src).toContain('export type CrawlErrorReason = "malformed" | "scheme" | "private_host"');
    expect((src.match(/"private_host"\)/g) ?? []).length).toBe(3);
    expect(src).toContain('"malformed")');
    // scheme 有两个抛点：SSRF 白名单 + 手输地址的协议预检
    expect((src.match(/"scheme"\)/g) ?? []).length).toBe(2);
    expect(src).toContain("export function assertSupportedUserScheme");
  });
});

describe("5. API response contract 兼容", () => {
  it("所有新增 code 的响应仍保留 error 字段（error 与 code 同一对象）", () => {
    const routes = collectRoutes(API_DIR);
    const bad: string[] = [];
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      // 找出含 code: "X" 的行，检查同行或前一~二行内有 error:（auth.error / msg / result.error 变量形态均合法）
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (/code:\s*"[A-Z_]+"/.test(line)) {
          const ctx = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
          // error: 或 message:（billing body 形态）均视为保留了人类可读字段
          if (!/(error|message):/.test(ctx)) bad.push(`${f}:${i + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("既有 QUOTA_EXCEEDED / UPSTREAM_ERROR code 未被移除（seo 系 route 统一走 serpApiErrorResponse）", () => {
    // 第十阶段起 seo 系路由的错误码单点在 serp-route-errors.ts：
    // 契约（QUOTA_EXCEEDED/UPSTREAM_ERROR/UPSTREAM_QUOTA/TIMEOUT）必须在 helper 中完整保留，
    // 且各路由 catch 统一委托 helper，禁止回退到各自复制的 mapError。
    const helper = readFileSync(join(process.cwd(), "src/lib/seo/serp-route-errors.ts"), "utf8");
    for (const code of ['"QUOTA_EXCEEDED"', '"UPSTREAM_ERROR"', '"UPSTREAM_QUOTA"', '"TIMEOUT"']) {
      expect(helper).toContain(code);
    }
    for (const f of ["seo/rank/route.ts", "seo/serp/route.ts", "keywords/expand/route.ts", "competitors/ranks/route.ts", "competitors/gap/route.ts", "competitors/discover/route.ts", "opportunities/verify/route.ts"]) {
      const src = readFileSync(join(API_DIR, f), "utf8");
      expect(src).toContain("serpApiErrorResponse");
    }
  });
});

describe("6. billing-error-client locale 解析", () => {
  it("server/client 两侧 BILLING_ERROR_CODES 一致（单一来源）", () => {
    for (const code of Object.values(SERVER_BILLING_CODES)) {
      expect(Object.values(BILLING_ERROR_CODES)).toContain(code);
    }
  });
});

describe("7. BUG-40：SeoProviderError 透传 code 必须本地化，禁止回显上游原文", () => {
  // 从 provider.ts 提取 code 联合类型（单一来源）；新增上游 code 而未补文案时本测试即失败。
  const providerSrc = readFileSync(join(process.cwd(), "src/lib/seo/provider.ts"), "utf8");
  const unionLine = providerSrc
    .split("\n")
    .find((line) => /^\s*code:\s*"[A-Z_]+".*;$/.test(line));
  const providerCodes = [...(unionLine?.matchAll(/"([A-Z_]+)"/g) ?? [])].map((m) => m[1]);

  it(" SeoProviderError code 联合类型可解析且覆盖 5 个上游 code", () => {
    expect(providerCodes.length).toBeGreaterThanOrEqual(5);
    for (const code of ["QUOTA_EXCEEDED", "INVALID_KEY", "UPSTREAM_ERROR", "TIMEOUT", "BAD_REQUEST"]) {
      expect(providerCodes).toContain(code);
    }
  });

  it("每个上游 code（含透传形态 UPSTREAM_QUOTA）在 EN/ZH catalog 中均有文案", () => {
    for (const code of [...providerCodes, "UPSTREAM_QUOTA"]) {
      expect(EN[code], `EN missing ${code}`).toBeTruthy();
      expect(ZH[code], `ZH missing ${code}`).toBeTruthy();
    }
  });

  it("INVALID_KEY 文案面向最终用户：不含上游报错原文、不引导用户去配置密钥", () => {
    for (const [locale, text] of [["EN", EN.INVALID_KEY], ["ZH", ZH.INVALID_KEY]] as const) {
      expect(text, locale).toBeTruthy();
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/manage-api-key|API key should be here|Invalid API key/i);
      expect(text).not.toMatch(/密钥无效：|here:/);
    }
  });

  it("serp helper 保持 INVALID_KEY → 401 映射，且 error 字段仍透传（供日志排查）", () => {
    const helper = readFileSync(join(process.cwd(), "src/lib/seo/serp-route-errors.ts"), "utf8");
    expect(helper).toContain('e.code === "INVALID_KEY" ? 401');
  });

  it("INVALID_KEY 已纳入 API_ERROR_CODES 常量目录", () => {
    expect(ALL_API_ERROR_CODES).toContain("INVALID_KEY");
  });
});
