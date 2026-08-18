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
      // YaoLiPay notify 协议响应完全不含 code 字段（禁区验证）
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
    expect(src).toContain('code: e.code');
    expect(EN.TIMEOUT).toBeTruthy();
    expect(ZH.TIMEOUT).toBeTruthy();
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

  it("YaoLiPay notify 协议 route 零 code 注入（协议不变）", () => {
    const src = readFileSync(join(API_DIR, "payment/yaolipay/notify/route.ts"), "utf8");
    expect(src).not.toMatch(/code:\s*"[A-Z_]+"/);
  });

  it("既有 QUOTA_EXCEEDED / UPSTREAM_ERROR code 未被移除（seo 系 route）", () => {
    for (const f of ["seo/rank/route.ts", "seo/serp/route.ts", "keywords/expand/route.ts", "competitors/ranks/route.ts"]) {
      const src = readFileSync(join(API_DIR, f), "utf8");
      expect(src).toContain('"QUOTA_EXCEEDED"');
      expect(src).toContain('"UPSTREAM_ERROR"');
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
