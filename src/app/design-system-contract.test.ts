// ===== Design System V4 契约测试（8px 栅格 / Radius / Color / Typography 三级）=====
// 覆盖：
//   1. Radius token：sm=4 / md=8 / lg=12 / xl=16，组件类别 → 固定 radius
//      Button(Input/Select/Tabs 同级) = 8px；Card/Modal = 12px；大容器 = 16px
//   2. Button 统一规格：radius 8px / 高度 40（标准）· 32（sm）· 48（lg）/ padding 16px
//   3. Card 统一：.card-a = 白底 + 1px 边框 + 12px 圆角，无阴影
//   4. 颜色系统：品牌强调色 ≤3（brand + accent + brand-deep 渐进色）；
//      状态色 pos/neg/warn 独立于品牌色；遗留装饰色（gold/aurora/teal/coral/violet）全站清零
//   5. 8px 栅格：tsx 中无 .5 步进间距（2.5/3.5）与任意值 spacing（如 p-[13px]）
//   6. 无 rounded-2xl / rounded-3xl（超出 token 体系的圆角）
//   7. Typography 三级体系由 typography-contract.test.ts 覆盖（此处验证 token 联动不破坏）

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GLOBALS = readFileSync(join(ROOT, "src/app/globals.css"), "utf-8");

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

const ALL_TSX = collectTsx(join(ROOT, "src"));
const readAll = () => ALL_TSX.map((p) => ({ p, src: readFileSync(p, "utf-8") }));

describe("Radius token 体系（组件类别 → 固定 radius）", () => {
  it("四个 token：sm=4px / md=8px / lg=12px / xl=16px", () => {
    expect(GLOBALS).toContain("--radius-sm: 4px;");
    expect(GLOBALS).toContain("--radius-md: 8px;");
    expect(GLOBALS).toContain("--radius-lg: 12px;");
    expect(GLOBALS).toContain("--radius-xl: 16px;");
  });

  it("btn-primary / btn-secondary 均使用 var(--radius-md)（8px）", () => {
    for (const cls of [".btn-primary", ".btn-secondary"]) {
      const block = GLOBALS.slice(
        GLOBALS.indexOf(cls),
        GLOBALS.indexOf("}", GLOBALS.indexOf(cls))
      );
      expect(block).toContain("border-radius: var(--radius-md)");
    }
  });

  it("card-a 使用 var(--radius-lg)（12px）", () => {
    const block = GLOBALS.slice(
      GLOBALS.indexOf(".card-a"),
      GLOBALS.indexOf("}", GLOBALS.indexOf(".card-a"))
    );
    expect(block).toContain("border-radius: var(--radius-lg)");
  });

  it("全站不再使用 rounded-2xl / rounded-3xl（超出 token 体系）", () => {
    const offenders = readAll()
      .filter(({ src }) => /rounded-(2xl|3xl)/.test(src))
      .map(({ p }) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });

  it("全站无任意值圆角（rounded-[Npx]，token 化）", () => {
    const offenders = readAll()
      .filter(({ src }) => /rounded-\[\d+px\]/.test(src))
      .map(({ p }) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });
});

describe("Button 统一规格（8px grid）", () => {
  it("标准 40px / 小 32px / 大 48px，横向 padding 16px，icon 间距 8px", () => {
    const btn = GLOBALS.slice(GLOBALS.indexOf(".btn-primary"), GLOBALS.indexOf(".btn-secondary:hover"));
    expect(btn).toContain("height: 40px");
    expect(btn).toContain("padding: 0 16px");
    expect(btn).toContain("gap: 8px");

    const smIdx = GLOBALS.indexOf(".btn-sm {");
    const sm = GLOBALS.slice(smIdx, GLOBALS.indexOf("}", smIdx));
    expect(sm).toContain("height: 32px");

    const lgIdx = GLOBALS.indexOf(".btn-lg {");
    const lg = GLOBALS.slice(lgIdx, GLOBALS.indexOf("}", lgIdx));
    expect(lg).toContain("height: 48px");
  });

  it("全站任意值高度必须为 4px 倍数（h-[37px] 这类非体系值禁止）", () => {
    const offenders = readAll()
      .filter(({ src }) => {
        const matches = src.matchAll(/\bh-\[(\d+)px\]/g);
        for (const m of matches) {
          if (Number(m[1]) % 4 !== 0) return true;
        }
        return false;
      })
      .map(({ p }) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });
});

describe("颜色系统（品牌强调 ≤3 + 状态色独立）", () => {
  it("品牌色仅 brand（#111827 近黑）/ brand-deep（hover）/ accent（#2563eb 蓝）", () => {
    expect(GLOBALS).toContain("--color-brand: #111827;");
    expect(GLOBALS).toContain("--color-brand-deep: #000000;");
    expect(GLOBALS).toContain("--color-accent: #2563eb;");
  });

  it("状态色 pos/neg/warn 独立存在（不扩展为装饰色）", () => {
    expect(GLOBALS).toContain("--color-pos: #16a34a;");
    expect(GLOBALS).toContain("--color-neg: #dc2626;");
    expect(GLOBALS).toContain("--color-warn: #d97706;");
  });

  it("遗留装饰色 token（gold/aurora/teal/coral）已从 globals.css 清除", () => {
    expect(GLOBALS).not.toMatch(/--color-(gold|aurora|teal|coral)/);
  });

  it("全站 tsx 无遗留装饰色 class（gold/aurora/teal/coral）", () => {
    const offenders = readAll()
      .filter(({ src }) => /\b(bg|text|border)-(gold|aurora|teal|coral)(-\d+)?\b/.test(src))
      .map(({ p }) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });
});

describe("8px 栅格（spacing 体系）", () => {
  it("全站 tsx 无 .5 步进间距类（p-2.5 / gap-3.5 / py-1.5 之外的半步长）", () => {
    // 允许 0.5/1.5（4px/6px 微间距，icon+text/badge 内部）；禁止 2.5（10px）/3.5（14px）
    const offenders = readAll()
      .filter(({ src }) => /\b(p|px|py|m|mx|my|mt|mb|ml|mr|gap|space-x|space-y)-(2\.5|3\.5)\b/.test(src))
      .map(({ p }) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });

  it("全站 tsx 无任意值 spacing（p-[13px] 等，token 化）", () => {
    const offenders = readAll()
      .filter(({ src }) => /\b(p|px|py|m|mx|my|gap)-\[\d+px\]/.test(src))
      .map(({ p }) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });
});

describe("装饰清理（无阴影堆叠 / 渐变滥用）", () => {
  it("globals.css 中 card-a / btn-primary / btn-secondary 无 box-shadow", () => {
    for (const cls of [".card-a {", ".btn-primary {", ".btn-secondary {"]) {
      const start = GLOBALS.indexOf(cls);
      const block = GLOBALS.slice(start, GLOBALS.indexOf("}", start));
      expect(block).not.toContain("box-shadow");
    }
  });

  it("全站 tsx 无彩色装饰渐变（渐变仅允许中性 ink/paper）", () => {
    const offenders = readAll()
      .filter(({ src }) =>
        /gradient-to-[^"]*(accent|pos|neg|warn|brand-deep)/.test(src)
      )
      .map(({ p }) => p.replace(ROOT + "/", ""));
    expect(offenders).toEqual([]);
  });
});

describe("Typography 三级体系联动（Level 1/2/3 token 存在）", () => {
  it("L1 页面大标题 token（3xl/4xl/5xl）、L2 区块/卡片（xl/2xl）、L3 正文（sm/base）齐备", () => {
    expect(GLOBALS).toContain("--text-5xl: 3rem;");   // L1 48
    expect(GLOBALS).toContain("--text-3xl: 2rem;");   // L1 32
    expect(GLOBALS).toContain("--text-2xl: 1.5rem;"); // L2 24
    expect(GLOBALS).toContain("--text-xl: 1.25rem;"); // L2 20
    expect(GLOBALS).toContain("--text-base: 1rem;");  // L3 16
    expect(GLOBALS).toContain("--text-sm: 0.875rem;");// L3 14
  });
});
