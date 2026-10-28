// ===== Footer × PublicPathsProvider 行为测试（真实渲染）=====
//
// footer-disabled-paths-contract.test.ts 钉的是源码形态；本文件用
// react-dom/server 真实渲染，验证运行时行为：
//   1. 开关开启（disabledPaths 空）→ 原有功能链接全部恢复
//   2. 开关关闭（生产默认）→ 暂缓页链接被过滤，其余栏目链接不受影响
//   3. 过滤按路径逐条生效（未来扩展 DISABLED_PUBLIC_PATHS 不会误伤其他链接）
//   4. 过滤发生在 locale 前缀计算之前（ZH 渲染同样按逻辑路径过滤）
//
// Footer 依赖 next-intl hooks 与 next/link，node 环境按本仓库既有做法 mock
// 这两个模块；PublicPathsProvider / localePath / LOCALE_ROUTED_PATHS 用真实实现。

import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";

let mockedLocale = "en";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => mockedLocale,
}));

vi.mock("next/link", () => ({
  default: (props: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href: props.href }, props.children),
}));

import Footer from "./Footer";
import { PublicPathsProvider } from "./PublicPathsProvider";

function renderFooter(disabledPaths: readonly string[], locale: "en" | "zh" = "en"): string {
  mockedLocale = locale;
  // children 走 createElement 变参（react/no-children-prop）；Provider 的 props
  // 类型要求 children 字段存在，故对 attrs 做 ComponentProps 断言（运行时等价）
  const providerProps = { disabledPaths } as ComponentProps<typeof PublicPathsProvider>;
  return renderToString(
    createElement(PublicPathsProvider, providerProps, createElement(Footer))
  );
}

const TOOL = "/tools/backlink-checker";
const FEATURE = "/features/backlink-analysis";

describe("Footer 内链过滤（真实渲染行为）", () => {
  it("开关开启（disabledPaths=[]）：暂缓页链接与其余链接全部渲染", () => {
    const html = renderFooter([]);
    expect(html).toContain(`href="${FEATURE}"`);
    // 注：/tools/backlink-checker 从来不是 Footer 链接（只在 feature/guide 页内链，
    // 且那两处原本就按 BACKLINK_CHECKER_ENABLED gated），Footer 只需验证 FEATURE。
    expect(html).toContain('href="/features/seo-audit"');
    expect(html).toContain('href="/pricing"');
  });

  it("开关关闭（生产默认）：暂缓页链接被过滤，其余栏目链接完好", () => {
    const html = renderFooter([TOOL, FEATURE]);
    expect(html).not.toContain(`href="${FEATURE}"`);
    // 其余栏目逐项保留（Product / Plans / Resources / Company）
    expect(html).toContain('href="/features/seo-audit"');
    expect(html).toContain('href="/features/rank-tracking"');
    expect(html).toContain('href="/features/keyword-research"');
    expect(html).toContain('href="/features/competitor-analysis"');
    expect(html).toContain('href="/features/content-optimization"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/docs"');
    expect(html).toContain('href="/changelog"');
    expect(html).toContain('href="/seo-issues"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/refund"');
  });

  it("过滤按路径逐条生效：只禁用的路径消失，其余不受影响", () => {
    const html = renderFooter(["/docs"]);
    expect(html).not.toContain('href="/docs"');
    expect(html).toContain(`href="${FEATURE}"`);
    expect(html).toContain('href="/pricing"');
  });

  it("ZH 渲染同样按逻辑路径过滤（先过滤、后加 /zh 前缀）", () => {
    const html = renderFooter([TOOL, FEATURE], "zh");
    expect(html).not.toContain(`href="/zh${FEATURE}"`);
    expect(html).toContain('href="/zh/pricing"');
    expect(html).toContain('href="/zh/features/seo-audit"');
  });
});
