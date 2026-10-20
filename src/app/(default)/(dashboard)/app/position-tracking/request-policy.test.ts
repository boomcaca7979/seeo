// ===== 排名追踪页「请求策略」契约测试（BUG-20）=====
// 实测根因（1440×900，:3411 真实预览数据）：进入 /app/position-tracking 一次加载打出
//   2× GET /api/tracking + 2× 每个趋势关键词的 GET /api/tracking/history（5 个词 = 10 次）。
// 链路：市场兜底 effect 会自动改写 country/device → 「地区变化」effect 把它当成用户切市场，
// 又调了一次 loadList()；GET /api/tracking 是账号级全量、市场/设备筛选全在前端做，
// 第二次拿到的是同一份载荷，却换了 tracked 数组引用 → 趋势图 effect 重跑 → 每个词的历史再取一遍。
// 约定：地区变化只重置选中词；列表刷新只允许出现在初始化与增删改/手动刷新之后。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(process.cwd(), "src/app/(default)/(dashboard)/app/position-tracking/page.tsx");
const src = readFileSync(PAGE, "utf8");

function region(startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  expect(start, `missing marker: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing marker: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const regionEffect = region("const lastRegionKeyRef = useRef", "const handleCreateGroup");
const initEffect = region("const didInitRef = useRef", "if (groupMenuId === null) return;");
const loadListFn = region("const loadList = useCallback", "const loadGroups = useCallback");

describe("BUG-20：一次进页面只取一次列表", () => {
  it("GET /api/tracking 只有一处（loadList 内），页面没有第二个读取点", () => {
    const reads = [...src.matchAll(/fetch\("\/api\/tracking"(?!,)/g)].length;
    expect(reads).toBe(1);
    expect(loadListFn).toContain('const res = await fetch("/api/tracking")');
  });

  it("地区变化 effect 不再重新取列表（列表非市场维度，重复请求拿到的是同一份载荷）", () => {
    expect(regionEffect).toContain("setSelectedId(null);");
    // 只看可执行语句：说明性注释里出现 loadList 不算调用
    expect(regionEffect).not.toMatch(/(void|await) loadList\(\)/);
    expect(regionEffect).toMatch(/\[country, device]\);/);
  });

  it("去重守卫仍在：同一 country|device 不重复执行", () => {
    expect(regionEffect).toContain("if (key === lastRegionKeyRef.current) return;");
    expect(regionEffect).toContain("lastRegionKeyRef.current = key;");
  });

  it("loadList 的自动触发点只剩初始化 effect（其余都是用户动作后的显式刷新）", () => {
    expect(initEffect).toContain("void loadList();");
    const autoCalls = [...src.matchAll(/void loadList\(\);/g)].length;
    // 初始化 + 地区变化以外的 void 调用会重新引入首屏重复请求
    expect(autoCalls).toBe(1);
    const awaited = [...src.matchAll(/await loadList\(\);/g)].length;
    expect(awaited).toBeGreaterThanOrEqual(4); // 分组增删/加词/删词/刷新
  });
});

describe("BUG-20 后续：列表引用稳定后趋势图只取一轮历史", () => {
  it("趋势历史请求按关键词 id 逐条发起，且只在 filteredTracked 变化或用户点重试时执行", () => {
    const trend = region("const [multiSeries, setMultiSeries]", "const handleAdd = async");
    expect(trend).toContain("/api/tracking/history?id=${row.id}&days=${TREND_DAYS}");
    // BUG-34 追加 trendNonce：唯一的额外触发源是「重试」按钮，不是渲染抖动
    expect(trend).toMatch(/\[filteredTracked, trendNonce]\);/);
    // 取消守卫必须活在 effect 作用域，否则切筛选后旧 Promise 会覆盖新结果
    expect(trend).toContain("let cancelled = false;");
    expect(trend).toContain("if (!cancelled) {");
    // trendNonce 只能由用户重试动作递增
    // trendNonce 只能由用户重试动作递增（onClick 按钮 / LoadErrorState 的 onRetry）
    expect(src.match(/setTrendNonce\(\(n\) => n \+ 1\)/g)).toHaveLength(2);
    for (const bump of src.split("\n").filter((l) => l.includes("setTrendNonce((n) => n + 1)"))) {
      expect(bump).toMatch(/onClick|onRetry/);
    }
  });

  it("单关键词详情历史仍按选中词去重（selectedId 未变不重复请求）", () => {
    const sel = region("const historyFetchRef = useRef", "const selectedKeyword = filteredTracked.find");
    expect(sel).toContain("if (historyFetchRef.current === selectedId) return;");
    expect(sel).toContain("void loadHistory(selectedId);");
  });
});
