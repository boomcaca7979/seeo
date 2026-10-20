// ===== 路由类型闸门契约（tsc --noEmit 不得靠「关掉类型检查」变绿）=====
// 失败形态：删掉 src/app/[locale]/[...rest]/page.tsx 后，Oct 16 那次生产构建留下的
// .next/types/validator.ts 仍在 `import("../../src/app/[locale]/[...rest]/page.js")`，
// 于是 npx tsc --noEmit 报 TS2307 —— 这是**过期生成物**，不是源码错误。
// 允许的处理只有一种：把过期目录原地改名留证（.next/types.stale-oct16），让 dev 服务
// 重新生成 .next/dev/types；禁止的规避是改 tsconfig（排除 .next/types、去掉 validator
// 或放宽 strict），那会让真实路由类型错误从此不参与检查。
//
// 本文件锁死两侧：① tsconfig 仍把生成类型纳入 include 且保持 strict；
// ② 当前参与检查的 validator 不再引用已删除路由，但仍在逐条校验路由。

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");
const has = (rel: string) => existsSync(fileURLToPath(new URL(rel, import.meta.url)));

const tsconfig = JSON.parse(read("../../tsconfig.json").replace(/\/\/.*$/gm, ""));
const DELETED_CATCH_ALL = "../../src/app/[locale]/[...rest]/page.tsx";

/** 实际参与检查的生成类型：dev 优先（next dev 写 .next/dev/types），否则构建产物 */
const LIVE_VALIDATORS = [
  "../../.next/dev/types/validator.ts",
  "../../.next/types/validator.ts",
].filter(has);

describe("tsconfig 仍然接收路由生成类型", () => {
  it("include 覆盖 .next/types 与 .next/dev/types", () => {
    expect(tsconfig.include).toContain(".next/types/**/*.ts");
    expect(tsconfig.include).toContain(".next/dev/types/**/*.ts");
  });

  it("exclude 没有把 .next 或 validator 偷偷摘掉", () => {
    expect(tsconfig.exclude ?? []).not.toContain(".next");
    expect(JSON.stringify(tsconfig.exclude ?? [])).not.toContain("validator");
    expect(JSON.stringify(tsconfig.exclude ?? [])).not.toContain(".next/types");
  });

  it("strict 与 noEmit 保持打开（不靠放宽选项变绿）", () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.noEmit).toBe(true);
  });
});

describe("被删路由不可能再把生成器拖回旧引用", () => {
  it("src/app/[locale]/[...rest]/page.tsx 确实不存在（catch-all 已被路由级 404 取代）", () => {
    expect(has(DELETED_CATCH_ALL)).toBe(false);
  });
});

describe("当前生成的 validator：过期引用已消失，路由校验仍在工作", () => {
  it.each(LIVE_VALIDATORS.map((p, i) => [i, p]))("#%s %s", (_i, p) => {
    const src = read(p);
    // 过期引用形态：指向已删除的 [...rest] 页面（源码或 .js 产物写法都算）
    expect(src).not.toContain("[...rest]");
    expect(src).not.toContain("[__rest]");
    // 仍逐条校验路由：每个路由一段 "// Validate <路径>"
    const validations = src.match(/^\/\/ Validate /gm) ?? [];
    expect(validations.length).toBeGreaterThan(100);
  });
});
