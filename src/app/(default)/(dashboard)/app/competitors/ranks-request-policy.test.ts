// ===== 竞品分析页「排名请求策略」契约测试（BUG-01）=====
// 页面级防线（node 环境无 RTL，按本仓库既有 source-contract 约定断言）：
//   1. 被动读取只能走 GET，且带 AbortController —— 切换项目/关键词时旧请求不得覆盖新状态
//   2. 上游查询（POST）只允许出现在用户显式点击的刷新处理函数里
//   3. effect 重跑 / StrictMode 双挂载 / 回调身份变化都不得造成重复读取或重复刷新
//   4. 只读失败走 resolveApiErrorMessage（不弹升级窗）；主动刷新失败才走 handleBillingError
//   5. 数据状态文案（缓存 / 实时 / 过期 / 无缓存 / 数据时间）必须双语齐备，且没有 ranksError 这种
//      "把任何异常都渲染成加载失败" 的布尔态残留

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import zh from "../../../../../../messages/zh.json";
import en from "../../../../../../messages/en.json";

const PAGE = join(process.cwd(), "src/app/(default)/(dashboard)/app/competitors/page.tsx");
const src = readFileSync(PAGE, "utf8");

function region(startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  expect(start, `missing marker: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing marker: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const readRegion = region("const loadRanks = useCallback", "const ranksFetchRef");
const refreshRegion = region("const handleRefreshRanks", "const ranksAbortRef");
const effectRegion = region("const ranksFetchRef = useRef", "const retryRanks");
const footerRegion = region("表格底部统计", "SOV 概览卡");

describe("1. 只读路径：GET + 可取消", () => {
  it("读取用 GET 携带 keyword_id，且请求带 signal 与 no-store", () => {
    expect(readRegion).toContain("/api/competitors/ranks?keyword_id=${keywordId}");
    expect(readRegion).toContain("signal: controller.signal");
    expect(readRegion).toContain('cache: "no-store"');
    expect(readRegion).not.toContain('method: "POST"');
  });

  it("每次新读取先取消在途请求，响应回来后再检查 aborted（旧结果不得覆盖新状态）", () => {
    expect(readRegion).toContain("ranksAbortRef.current?.abort();");
    expect(readRegion.match(/if \(controller\.signal\.aborted\) return;/g)).toHaveLength(2);
  });

  it("读取失败显示按 code 解析的真实原因，不走升级弹窗", () => {
    expect(readRegion).toContain("resolveApiErrorMessage(json, readUiLocale(), t(\"ranksLoadFailed\"))");
    expect(readRegion).not.toContain("handleBillingError(");
    expect(refreshRegion).toContain("handleBillingError(");
  });
});

describe("2. 上游请求只属于显式点击", () => {
  it("ranks 端点只有一处 POST 调用，且位于刷新处理函数内", () => {
    expect(src.match(/\/api\/competitors\/ranks",\s*\{\s*method: "POST"/g)).toHaveLength(1);
    expect(refreshRegion).toContain('method: "POST"');
    expect(readRegion).not.toContain('method: "POST"');
  });

  it("刷新函数只被声明与点击回调引用（没有 effect 自动触发）", () => {
    const refs = [...src.matchAll(/.{0,20}handleRefreshRanks/g)].map((m) => m[0]);
    expect(refs.length).toBeGreaterThanOrEqual(3);
    for (const r of refs) {
      expect(r, `unexpected reference: ${r}`).toMatch(/(const handleRefreshRanks|onClick=\{handleRefreshRanks|: handleRefreshRanks)/);
    }
    expect(effectRegion).not.toContain("handleRefreshRanks");
  });

  it("刷新进行中直接返回：ref 挡同一 tick 连点，disabled 挡渲染后连点", () => {
    expect(refreshRegion).toContain("if (ranksLoading || ranksRefreshRef.current) return;");
    expect(refreshRegion).toContain("ranksRefreshRef.current = true;");
    expect(refreshRegion).toMatch(/finally \{\s*ranksRefreshRef\.current = false;/);
  });

  it("刷新失败保留旧数据：不再有清空 results 的降级写法", () => {
    expect(refreshRegion).not.toContain("results: []");
    expect(refreshRegion).toContain("setRanksNotice({ kind: \"refresh\", message })");
  });
});

describe("3. 生命周期：一次挂载只读一次", () => {
  it("同一关键词的重复 effect 被去重", () => {
    expect(effectRegion).toContain("if (ranksFetchRef.current === selectedKeywordId) return;");
  });

  it("cleanup 清 timer 并释放去重标记（StrictMode 真正重挂载仍能读到数据）", () => {
    expect(effectRegion).toContain("window.clearTimeout(tid)");
    expect(effectRegion).toContain("ranksFetchRef.current = null");
  });

  it("切项目/清空关键词时取消在途读取并重置展示状态", () => {
    expect(effectRegion).toContain("ranksAbortRef.current?.abort();");
    expect(effectRegion).toContain("setRanksNotice(null);");
  });

  it("重试按钮复用同一只读函数，不会变成刷新", () => {
    expect(src.slice(src.indexOf("const retryRanks"))).toMatch(/const retryRanks = \(\) => \{\s*if \(selectedKeywordId === null\) return;\s*void loadRanks\(selectedKeywordId\);/);
  });
});

describe("4. 布尔态 ranksError 已彻底移除", () => {
  it("源码不再出现 ranksError", () => {
    expect(src).not.toContain("ranksError");
    expect(src).toContain("ranksNotice");
  });

  it("失败提示常驻且带 aria-live，读取/刷新分别给出对应动作", () => {
    expect(src).toContain('role="status"');
    expect(src).toContain('ranksNotice.kind === "read" ? retryRanks : handleRefreshRanks');
  });
});

describe("5. 数据状态文案：只统计有数据时的口径", () => {
  it("底部状态行仅在 results 非空时渲染（无缓存不得自称实时数据）", () => {
    expect(footerRegion).toContain("ranks.results.length > 0");
    expect(footerRegion).toContain("ranks.stale ? t(\"staleHint\") : ranks.fromCache ? t(\"cachedHint\") : t(\"liveHint\")");
    expect(footerRegion).toContain('t("checkedAtHint"');
  });

  it("空态区分「无缓存」与其它准备状态", () => {
    expect(src).toContain('ranks?.needsRefresh ? (');
    expect(src).toContain('t("noCacheHint")');
  });

  it("新增 key 双语齐备（缺失会渲染成空文案）", () => {
    const keys = ["staleHint", "noCacheHint", "checkedAtHint", "ranksLoadFailed", "retryBtn"];
    type Nodes = Record<string, Record<string, string | undefined>>;
    const zhNode = (zh as unknown as { dashboard: Nodes }).dashboard.competitors;
    const enNode = (en as unknown as { dashboard: Nodes }).dashboard.competitors;
    for (const k of keys) {
      expect(zhNode[k], `zh missing ${k}`).toBeTruthy();
      expect(enNode[k], `en missing ${k}`).toBeTruthy();
    }
  });
});
