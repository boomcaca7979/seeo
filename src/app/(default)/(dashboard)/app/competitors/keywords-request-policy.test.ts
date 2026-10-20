// ===== 竞品分析页「关键词列表请求策略」契约测试（BUG-21）=====
// 实测根因（1440×900，:3411 真实预览数据）：进入 /app/competitors 一次加载打出 2× GET /api/tracking。
// 链路：loadKeywords 的 useCallback 依赖里带着 selectedKeywordId，而它自己会在取数成功后
// 写入 selectedKeywordId → 回调换引用 → 依赖 [projectDomain, loadKeywords] 的 effect 重跑 →
// 同一份账号级列表再拉一次。约定：回调不得依赖它自己写入的状态，选中项用函数式 setState 补空位。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(process.cwd(), "src/app/(default)/(dashboard)/app/competitors/page.tsx");
const src = readFileSync(PAGE, "utf8");

function region(startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  expect(start, `missing marker: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing marker: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const loadKeywords = region("const loadKeywords = useCallback", "// 拉取 SOV");
const kwEffect = region("// projectDomain 变化时拉取关键词", "// 添加竞品");

describe("BUG-21：一次进页面只取一次关键词列表", () => {
  it("GET /api/tracking 只有一处，且带 no-store", () => {
    const reads = [...src.matchAll(/fetch\("\/api\/tracking"/g)].length;
    expect(reads).toBe(1);
    expect(loadKeywords).toContain('fetch("/api/tracking", { cache: "no-store" })');
  });

  it("loadKeywords 依赖里不得出现它自己写入的 selectedKeywordId", () => {
    expect(loadKeywords).toMatch(/\}, \[projectDomain, show, tc]\);/);
    expect(loadKeywords).not.toMatch(/\[projectDomain, selectedKeywordId/);
  });

  it("选中第一个词改用函数式 setState：只在尚未选中时补位，不读闭包状态", () => {
    expect(loadKeywords).toContain("setSelectedKeywordId((cur) => cur ?? filtered[0].id)");
    expect(loadKeywords).not.toContain("selectedKeywordId === null) {\n          setSelectedKeywordId(filtered[0].id)");
  });

  it("拉词 effect 只由 projectDomain / 回调身份驱动，且回调身份现已稳定", () => {
    expect(kwEffect).toContain("void loadKeywords();");
    expect(kwEffect).toMatch(/\[projectDomain, loadKeywords]\);/);
  });

  it("切项目时仍会清空旧项目关键词与选中项（防串数据）", () => {
    const switchEffect = region("// 项目变化时拉取竞品 + SOV", "// 项目变化时直接拉取项目域名");
    expect(switchEffect).toContain("setKeywords([]);");
    expect(switchEffect).toContain("setSelectedKeywordId(null);");
  });
});
