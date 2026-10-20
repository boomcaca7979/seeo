// ===== BUG-34：排名历史请求失败不得伪装成「还没有历史」 =====
// 实测根因（:3411，同一页面只换 /api/tracking/history 的响应，其余一致）：
//   i14b-empty（200 + data:[]）与 i14b-fail（429 配额错误）的趋势卡文案完全相同
//   ——「No history yet — click "Refresh rankings now" to start recording」，
//   errStates=0、retryBtns=[]、svgInMain 从 3 掉到 2（多关键词趋势静默变成空图）。
//   原实现 `if (res.ok) setHistory(...)` 没有 else：失败既不清旧曲线也不报错。
// 约定：失败必须清掉上一个关键词的曲线、显示错误态 + 重试；部分失败要有可见提示。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PAGE = readFileSync(join(ROOT, "src/app/(default)/(dashboard)/app/position-tracking/page.tsx"), "utf8");
const EN = JSON.parse(readFileSync(join(ROOT, "messages/en.json"), "utf8")).dashboard.positionTracking;
const ZH = JSON.parse(readFileSync(join(ROOT, "messages/zh.json"), "utf8")).dashboard.positionTracking;

describe("单关键词趋势卡", () => {
  const load = PAGE.slice(PAGE.indexOf("const loadHistory = useCallback"), PAGE.indexOf("const historyFetchRef"));

  it("请求失败先清空历史再置错误位，保留上一个词的曲线就是张冠李戴", () => {
    expect(load).toContain("if (res.ok) {");
    expect(load).toContain("setHistoryError(false);");
    expect(load).toMatch(/else \{\s*setHistory\(\[\]\);\s*setHistoryError\(true\);/);
    expect(load).toMatch(/catch \{\s*setHistory\(\[\]\);\s*setHistoryError\(true\);/);
  });

  it("错误时不再走「没历史」空态，而是 LoadErrorState + 重试", () => {
    expect(PAGE).toContain("isEmpty={!historyLoading && !historyError && historyPoints === 0}");
    expect(PAGE).toContain("historyError ? (");
    expect(PAGE).toContain('title={t("trendLoadErrorTitle")}');
    expect(PAGE).toContain("historyFetchRef.current = null;");
  });

  it("清空选中词时错误位一起复位", () => {
    const eff = PAGE.slice(PAGE.indexOf("const historyFetchRef"), PAGE.indexOf("// 单关键词趋势始终来自当前范围"));
    // 复位排在宏任务里（effect 同步体 setState 会触发级联渲染），但曲线与错误位必须一起清
    expect(eff).toMatch(
      /if \(selectedId === null\) \{\s*const id = window\.setTimeout\(\(\) => \{\s*setHistory\(\[\]\);\s*setHistoryError\(false\);/
    );
    expect(eff).toContain("return () => window.clearTimeout(id);");
  });
});

describe("多关键词趋势卡", () => {
  const eff = PAGE.slice(PAGE.indexOf("const [multiSeries, setMultiSeries]"), PAGE.indexOf("const handleAdd = async"));

  it("逐条统计失败数并写入 multiFailed", () => {
    expect(eff).toContain("let failed = 0;");
    expect(eff).toContain("if (!res.ok) {");
    expect(eff).toContain("failed += 1;");
    expect(eff).toContain("setMultiFailed(failed);");
  });

  it("全部失败 → 错误态；部分失败 → 图上给出可见提示与重试", () => {
    expect(PAGE).toContain("multiSeries.length > 0 && multiFailed === multiSeries.length");
    expect(PAGE).toContain('title={t("trendLoadErrorTitle")}');
    expect(PAGE).toContain('t("partialHistoryFailed", { count: multiFailed })');
  });
});

describe("错误文案双语齐备", () => {
  for (const key of ["trendLoadErrorTitle", "trendLoadErrorHint", "partialHistoryFailed"]) {
    it(`${key} 在 en/zh 都存在`, () => {
      expect(typeof EN[key]).toBe("string");
      expect(typeof ZH[key]).toBe("string");
    });
  }

  it("错误提示明确区分「请求失败」与「真的没数据」", () => {
    expect(EN.trendLoadErrorHint).toContain('not "no history yet"');
    expect(ZH.trendLoadErrorHint).toContain("这不是「还没有历史」");
  });
});
