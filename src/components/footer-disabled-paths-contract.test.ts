// ===== Footer「暂缓上线」路径下线契约（GSC Excluded by noindex 修复）=====
//
// 背景：/features/backlink-analysis 与 /tools/backlink-checker 在 DataForSEO
// 未配置期间输出 noindex（src/lib/seo/public-tools.ts），但 Footer 曾无条件渲染
// 指向它们的内链——全站每页一条，是爬虫持续发现这些「Excluded by noindex」
// 页面的主要来源，违反该文件「公开 contextual 内链入口下线」的契约。
//
// 架构约束（本测试钉住，防止回退）：
//   1. 开关只在服务端可读（BACKLINK_CHECKER_ENABLED 非 NEXT_PUBLIC_*），
//      client bundle 内联 env 会造成 SSR/hydration 判定不一致 → Footer 禁止
//      import public-tools 或读 process.env，只能经 PublicPathsProvider 消费。
//   2. 两个 root layout（[locale] 与 (default)）都必须注入真实 DISABLED_PUBLIC_PATHS。
//   3. Footer 按**逻辑路径**过滤（locale 前缀在渲染期才加），过滤发生在 href 计算前。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readSrc = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

// 断言只看代码形态，不看注释（注释会点名被禁写法）
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const footer = strip(readSrc("./Footer.tsx"));
const provider = strip(readSrc("./PublicPathsProvider.tsx"));
const localeLayout = strip(readSrc("../app/[locale]/layout.tsx"));
const defaultLayout = strip(readSrc("../app/(default)/layout.tsx"));

describe("Footer 暂缓路径过滤（noindex 页不收内链）", () => {
  it("Footer 经 context 消费开关，不读环境变量", () => {
    expect(footer).toContain("useDisabledPublicPaths()");
    expect(footer).not.toContain("public-tools");
    expect(footer).not.toContain("process.env");
  });

  it("Footer 在计算 href 前按逻辑路径过滤", () => {
    expect(footer).toContain("disabledPaths.includes(l.path)");
    // 链接定义保留逻辑路径字段（不是预先算好的 href）
    expect(footer).toContain('path: "/features/backlink-analysis"');
    expect(footer).not.toContain('href: href("/features/backlink-analysis")');
  });

  it("Provider 是 client 通道：只透传 props，不做 env 判定", () => {
    expect(provider).toContain('"use client"');
    expect(provider).toContain("PublicPathsContext.Provider");
    expect(provider).not.toContain("process.env");
  });

  it("两个 root layout 都注入服务端读取的 DISABLED_PUBLIC_PATHS", () => {
    for (const [name, src] of [
      ["[locale]/layout.tsx", localeLayout],
      ["(default)/layout.tsx", defaultLayout],
    ] as const) {
      expect(src, name).toContain("PublicPathsProvider");
      expect(src, name).toContain("disabledPaths={DISABLED_PUBLIC_PATHS}");
    }
  });
});
