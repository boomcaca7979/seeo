// ===== Typography contract（Montserrat + 阿里巴巴普惠体 双语体系）=====
// 覆盖：字体注册（next/font Montserrat 变量字体 + JetBrains Mono）、
// 中文自托管 webfont（Alibaba PuHuiTi 3.0 官方分片）、
// 字体栈（拉丁 Montserrat + CJK PuHuiTi + 系统回退）、
// 字号 scale（12/14/16/20/24/32/36/48）、行高层级（小字 1.45–1.5 / 正文 1.5–1.6 / 标题 1.08–1.3）、
// 大标题负 tracking + 中文覆写、按钮/徽章最小字号、全站 weight 统一 600 层级（无 700）、
// 文字颜色三级层级（ink/ink-60/ink-40 高对比深色体系）。

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GLOBALS = readFileSync(join(ROOT, "src/app/globals.css"), "utf-8");
const DEFAULT_LAYOUT = readFileSync(join(ROOT, "src/app/(default)/layout.tsx"), "utf-8");
const LOCALE_LAYOUT = readFileSync(join(ROOT, "src/app/[locale]/layout.tsx"), "utf-8");
const PUHUITI_CSS = readFileSync(join(ROOT, "src/app/fonts/alibaba-puhuiti.css"), "utf-8");

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

describe("字体注册（next/font/google Montserrat + JetBrains Mono）", () => {
  it("两个 root layout 均以 next/font/google 注册 Montserrat 变量字体（--font-montserrat，display swap，单实例）", () => {
    for (const src of [DEFAULT_LAYOUT, LOCALE_LAYOUT]) {
      expect(src).toContain("Montserrat");
      expect(src).toMatch(/Montserrat\(\s*\{[\s\S]*?variable:\s*"--font-montserrat"/);
      expect(src).toMatch(/Montserrat\(\s*\{[\s\S]*?display:\s*"swap"/);
    }
  });

  it("不再加载 Inter（英文主字体已由 Montserrat 取代）与 Space Grotesk", () => {
    for (const src of [DEFAULT_LAYOUT, LOCALE_LAYOUT]) {
      expect(src).not.toMatch(/\bInter\b/);
      expect(src).not.toContain("Space_Grotesk");
    }
    expect(GLOBALS).not.toContain("var(--font-inter)");
    expect(GLOBALS).not.toContain("space-grotesk");
  });

  it("两个 root layout 均注册 JetBrains Mono（--font-jetbrains-mono，技术字段等宽）", () => {
    for (const src of [DEFAULT_LAYOUT, LOCALE_LAYOUT]) {
      expect(src).toMatch(/JetBrains_Mono\(\s*\{[\s\S]*?variable:\s*"--font-jetbrains-mono"/);
    }
  });
});

describe("中文 webfont（阿里巴巴普惠体 3.0 官方分片自托管）", () => {
  it("globals.css 引入 alibaba-puhuiti.css", () => {
    expect(GLOBALS).toContain('@import "./fonts/alibaba-puhuiti.css"');
  });

  it("普惠体声明 400/500/600 三个字重且 font-family 统一为 Alibaba PuHuiTi", () => {
    expect(PUHUITI_CSS).toMatch(/font-family:\s*"Alibaba PuHuiTi"/);
    expect(PUHUITI_CSS).toMatch(/font-weight:\s*400/);
    expect(PUHUITI_CSS).toMatch(/font-weight:\s*500/);
    expect(PUHUITI_CSS).toMatch(/font-weight:\s*600/);
    expect(PUHUITI_CSS).not.toMatch(/font-weight:\s*700/);
  });

  it("每个字重的 woff2 分片文件均存在（55→400 / 65→500 / 75→600）", () => {
    const urls = [...PUHUITI_CSS.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(18);
    for (const u of urls) {
      // css 中为 "/fonts/puhuiti/..." 站点绝对路径 → public/ 下
      expect(existsSync(join(ROOT, "public", u.replace(/^\//, "")))).toBe(true);
    }
  });

  it("分片带 unicode-range（CJK 按需懒加载）且 font-display swap", () => {
    expect(PUHUITI_CSS).toMatch(/unicode-range:/);
    expect(PUHUITI_CSS).toMatch(/font-display:\s*swap/);
  });
});

describe("字体栈（拉丁 Montserrat + CJK Alibaba PuHuiTi + 系统回退）", () => {
  it("--font-sans / --font-display 均为 Montserrat+PuHuiTi 栈且含 PingFang SC 与 Microsoft YaHei 回退", () => {
    const sans = GLOBALS.match(/--font-sans:\s*([^;]+);/)?.[1] ?? "";
    expect(sans).toContain("var(--font-montserrat)");
    expect(sans).toContain('"Alibaba PuHuiTi"');
    expect(sans).toContain("system-ui");
    expect(sans).toContain("PingFang SC");
    expect(sans).toContain("Microsoft YaHei");
    const display = GLOBALS.match(/--font-display:\s*([^;]+);/)?.[1] ?? "";
    expect(display).toBe(sans);
    // Montserrat 在 PuHuiTi 之前：拉丁/数字走 Montserrat，CJK 回退 PuHuiTi（中英各用其主字体）
    expect(sans.indexOf("var(--font-montserrat)")).toBeLessThan(sans.indexOf('"Alibaba PuHuiTi"'));
  });

  it("--font-mono 为 JetBrains Mono 栈（URL / code / 技术数字等宽）", () => {
    const mono = GLOBALS.match(/--font-mono:\s*([^;]+);/)?.[1] ?? "";
    expect(mono).toContain("var(--font-jetbrains-mono)");
  });

  it("body 使用 --font-sans 且显式 16px / 1.6 行高", () => {
    const body = GLOBALS.slice(GLOBALS.indexOf("body {"), GLOBALS.indexOf("}", GLOBALS.indexOf("body {")) + 1);
    expect(body).toContain("font-family: var(--font-sans)");
    expect(body).toContain("font-size: var(--text-base)");
    expect(body).toContain("line-height: var(--text-base--line-height)");
  });
});

describe("文字颜色三级层级（高对比深色体系，无浅灰正文）", () => {
  it("ink / ink-60 / ink-40 / ink-25 token 值符合契约", () => {
    expect(GLOBALS).toContain("--color-ink: #111827;");
    expect(GLOBALS).toContain("--color-ink-60: #374151;");
    expect(GLOBALS).toContain("--color-ink-40: #4b5563;");
    expect(GLOBALS).toContain("--color-ink-25: #6b7280;");
  });

  it("禁止的极浅灰 token 不存在于设计系统（#9ca3af / #94a3b8 / #9aa0a6）", () => {
    expect(GLOBALS).not.toContain("#9ca3af");
    expect(GLOBALS).not.toContain("#94a3b8");
    expect(GLOBALS).not.toContain("#9aa0a6");
  });

  it("全站 tsx 不使用 text-gray/slate/zinc/neutral/stone-400|500 类作为文字颜色", () => {
    const offenders = collectTsx(join(ROOT, "src"))
      .filter((p) => /text-(gray|slate|zinc|neutral|stone)-(400|500)/.test(readFileSync(p, "utf-8")))
      .map((p) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });

  it("ink-25 不作为正文文字色使用（仅边框/focus 描边/装饰性符号）", () => {
    // 允许的例外：分隔符 "·"、装饰性 404 大数字等纯符号场景
    const offenders = collectTsx(join(ROOT, "src"))
      .map((p) => {
        const src = readFileSync(p, "utf-8");
        const hits = [...src.matchAll(/<[^>]*\btext-ink-25\b[^>]*>([^<]*)</g)].map((m) => m[1].trim());
        const realText = hits.filter((h) => h.length > 0 && !"·●|—".includes(h));
        return realText.length > 0 ? p.replace(ROOT + "/", "") : null;
      })
      .filter((p): p is string => p !== null);
    expect(offenders).toEqual([]);
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
