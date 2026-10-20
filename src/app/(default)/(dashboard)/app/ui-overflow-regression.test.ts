// ===== 窄屏（390/360）与表格列宽溢出回归 =====
// 浏览器实测：DomainSelect / 原生 select 的固有宽度是「项目名（域名）」整串
// （en 下 390px），在 flex 工具条里既不收缩也没有横向滚动容器，
// 导致「查看」按钮和下拉本身被顶出视口右缘且无法触及。
// 同时覆盖 Action Center「下一步」列：truncate 切掉 CTA 尾词时必须补 title。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const AUDIT = src("./audit/page.tsx");
const COMPETITORS = src("./competitors/page.tsx");
const POSITION = src("./position-tracking/page.tsx");
const CONTENT = src("./content/page.tsx");
const KEYWORD_EXPAND = src("./keyword-expand/page.tsx");
const ACTIONS = src("./actions/page.tsx");

describe("窄屏工具条：下拉框必须可收缩，不允许把控件顶出视口", () => {
  it("audit 域名表单：form 与其 DomainSelect 都是 min-w-0 + max-w-full", () => {
    const form = AUDIT.match(/<form onSubmit=\{handleDomainChange\} className="([^"]+)"/);
    expect(form).toBeTruthy();
    expect(form![1]).toContain("min-w-0");
    expect(form![1]).toContain("max-w-full");
    const ds = AUDIT.match(/<DomainSelect value=\{domain\}[^>]*className="([^"]+)"/);
    expect(ds).toBeTruthy();
    expect(ds![1]).toContain("min-w-0");
    expect(ds![1]).toContain("max-w-full");
  });

  it("competitors 关键词下拉与其分组容器可收缩", () => {
    // label 必须用 htmlFor 关联到 select（BUG-43），正则允许该属性但仍钉住收缩契约
    const group = COMPETITORS.match(/<div className="flex min-w-0 items-center gap-2">\s*<label htmlFor="competitor-keyword-select" className="font-mono text-xs text-ink-40">\{t\("keywordLabel"\)\}<\/label>/);
    expect(group).toBeTruthy();
    const sel = COMPETITORS.match(/className="min-w-0 max-w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm/);
    expect(sel).toBeTruthy();
  });

  it("position-tracking 三个筛选下拉全部 min-w-0 max-w-full", () => {
    const bounded = POSITION.match(/className="min-w-0 max-w-full rounded-md border border-line bg-card/g) ?? [];
    expect(bounded.length).toBeGreaterThanOrEqual(3);
  });

  it("content 历史下拉不再被 flex-shrink-0 容器放大到超出视口", () => {
    const wrap = CONTENT.match(/<div className="flex-shrink-0 min-w-0 max-w-full">/);
    expect(wrap).toBeTruthy();
    const sel = CONTENT.match(/className="min-w-0 max-w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-xs/);
    expect(sel).toBeTruthy();
  });

  it("keyword-expand 目标项目下拉：去掉 min-w-[180px]（只兜下限拦不住溢出），改为可收缩 + 容器上限", () => {
    expect(KEYWORD_EXPAND).not.toMatch(/className="[^"]*min-w-\[180px\]/);
    // 不能用 [^>]* 抓取标签：onChange 里的箭头函数本身带 ">"
    const at = KEYWORD_EXPAND.indexOf("<DomainSelect value={trackDomain}");
    expect(at).toBeGreaterThan(-1);
    const tag = KEYWORD_EXPAND.slice(at, KEYWORD_EXPAND.indexOf("/>", at));
    expect(tag).toContain("min-w-0");
    expect(tag).toContain("max-w-full");
  });
});

describe("Action Center「下一步」列：截断的 CTA 必须留下完整文案", () => {
  it("主操作 Link 带 truncate 时必须同时输出 title", () => {
    const link = ACTIONS.match(/<Link\s+href=\{primary\.href\}[\s\S]{0,400}?className="btn-secondary inline-block max-w-\[10rem\] truncate/);
    expect(link).toBeTruthy();
    expect(link![0]).toContain("title={t(primary.labelKey");
  });
});
