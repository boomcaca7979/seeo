// ===== Typography contract（Semrush/Intergalactic 风格 Inter 体系）=====
// 覆盖：字体注册（next/font Inter 变量字体）、字体栈（拉丁 Inter + CJK 系统回退）、
// 字号 scale（12/14/16/20/24/32/36/48）、行高层级（小字 1.45–1.5 / 正文 1.5–1.6 / 标题 1.08–1.3）、
// 大标题负 tracking + 中文覆写、按钮/徽章最小字号、全站 weight 统一 600 层级（无 700）。

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GLOBALS = readFileSync(join(ROOT, "src/app/globals.css"), "utf-8");
const DEFAULT_LAYOUT = readFileSync(join(ROOT, "src/app/(default)/layout.tsx"), "utf-8");
const LOCALE_LAYOUT = readFileSync(join(ROOT, "src/app/[locale]/layout.tsx"), "utf-8");

/** 递归收集 src 下所有 .tsx 源码（不含测试） */
function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collectTsx(p));
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("字体注册（next/font/google Inter）", () => {
  it("两个 root layout 均以 next/font/google 注册 Inter 变量字体（--font-inter，display swap，单实例）", () => {
    for (const src of [DEFAULT_LAYOUT, LOCALE_LAYOUT]) {
      expect(src).toContain("Inter");
      expect(src).toMatch(/Inter\(\s*\{[\s\S]*?variable:\s*"--font-inter"/);
      expect(src).toMatch(/Inter\(\s*\{[\s\S]*?display:\s*"swap"/);
    }
  });

  it("不再加载未使用的 Space Grotesk（消除双 display 字体的不一致视觉）", () => {
    expect(DEFAULT_LAYOUT).not.toContain("Space_Grotesk");
    expect(LOCALE_LAYOUT).not.toContain("Space_Grotesk");
    expect(GLOBALS).not.toContain("space-grotesk");
  });
});

describe("字体栈（拉丁 Inter + CJK 系统回退）", () => {
  it("--font-sans / --font-display 均为 Inter 栈且含 PingFang SC 与 Microsoft YaHei 回退", () => {
    const sans = GLOBALS.match(/--font-sans:\s*([^;]+);/)?.[1] ?? "";
    expect(sans).toContain("var(--font-inter)");
    expect(sans).toContain("system-ui");
    expect(sans).toContain("PingFang SC");
    expect(sans).toContain("Microsoft YaHei");
    const display = GLOBALS.match(/--font-display:\s*([^;]+);/)?.[1] ?? "";
    expect(display).toBe(sans);
  });

  it("body 使用 --font-sans 且显式 16px / 1.6 行高", () => {
    const body = GLOBALS.slice(GLOBALS.indexOf("body {"), GLOBALS.indexOf("}", GLOBALS.indexOf("body {")) + 1);
    expect(body).toContain("font-family: var(--font-sans)");
    expect(body).toContain("font-size: var(--text-base)");
    expect(body).toContain("line-height: var(--text-base--line-height)");
  });
});

describe("字号 scale（12/14/16/20/24/32/36/48）与行高层级", () => {
  const SCALE: Array<[string, string, string]> = [
    ["--text-xs", "0.75rem", "1.45"],      // 12 caption/badge/表头
    ["--text-sm", "0.875rem", "1.5"],      // 14 正文/表格/按钮
    ["--text-base", "1rem", "1.6"],        // 16 长文
    ["--text-lg", "1.125rem", "1.55"],     // 18
    ["--text-xl", "1.25rem", "1.45"],      // 20
    ["--text-2xl", "1.5rem", "1.3"],       // 24
    ["--text-3xl", "2rem", "1.2"],         // 32（对齐 Semrush scale，非 Tailwind 默认 30）
    ["--text-4xl", "2.25rem", "1.15"],     // 36
    ["--text-5xl", "3rem", "1.08"],        // 48
  ];

  it.each(SCALE)("%s = %s，line-height %s", (token, size, lh) => {
    expect(GLOBALS).toContain(`${token}: ${size};`);
    expect(GLOBALS).toContain(`${token}--line-height: ${lh};`);
  });

  it("语义行高 token 存在（tight 1.2 / normal 1.5 / relaxed 1.625）", () => {
    expect(GLOBALS).toContain("--leading-tight: 1.2;");
    expect(GLOBALS).toContain("--leading-normal: 1.5;");
    expect(GLOBALS).toContain("--leading-relaxed: 1.625;");
  });

  it("≥20px 标题 token 带轻微负 tracking（拉丁标题收紧）", () => {
    expect(GLOBALS).toContain("--text-xl--letter-spacing: -0.01em;");
    expect(GLOBALS).toContain("--text-3xl--letter-spacing: -0.015em;");
    expect(GLOBALS).toContain("--text-5xl--letter-spacing: -0.025em;");
  });

  it("中文标题不做负 tracking（:lang(zh) 覆写恢复自然字距）", () => {
    expect(GLOBALS).toMatch(/:lang\(zh\)\s*:is\(h1,\s*h2,\s*h3,\s*h4\)\s*\{\s*letter-spacing:\s*normal;/);
  });
});

describe("组件最小字号契约", () => {
  it("btn-primary / btn-secondary 文字 ≥14px（0.875rem）", () => {
    const btn = GLOBALS.slice(GLOBALS.indexOf(".btn-primary"), GLOBALS.indexOf(".btn-secondary:hover"));
    expect(btn).toContain("font-size: 0.875rem");
  });

  it("badge 与 micro-label ≥12px（0.75rem），micro-label uppercase 带 tracking", () => {
    expect(GLOBALS).toMatch(/\.badge-warn[^{]*\{[^}]*font-size:\s*0\.75rem/);
    expect(GLOBALS).toMatch(/\.micro-label\s*\{[^}]*font-size:\s*0\.75rem;[^}]*letter-spacing:\s*0\.06em/);
  });
});

describe("全站 weight 层级（600 上限，无 700）", () => {
  it("所有 tsx 组件不再使用 font-bold（标题/指标统一 font-semibold 600）", () => {
    const offenders = collectTsx(join(ROOT, "src"))
      .filter((p) => readFileSync(p, "utf-8").includes("font-bold"))
      .map((p) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });

  it("表格主体单元格不再使用 text-xs（表体 14px，表头/徽章/元信息保留 12px）", () => {
    const offenders = collectTsx(join(ROOT, "src"))
      .filter((p) => /<td[^>]*\btext-xs\b/.test(readFileSync(p, "utf-8")))
      .map((p) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });
});

describe("响应式排版与大屏缩放共存", () => {
  it("根字号大屏缩放断点仍在（120rem→17px / 160rem→18px，rem scale 随之等比放大）", () => {
    expect(GLOBALS).toMatch(/@media \(min-width: 120rem\)\s*\{\s*html \{ font-size: 17px; \}/);
    expect(GLOBALS).toMatch(/@media \(min-width: 160rem\)\s*\{\s*html \{ font-size: 18px; \}/);
  });
});
