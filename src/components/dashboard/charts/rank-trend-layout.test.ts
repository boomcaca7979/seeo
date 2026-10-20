// ===== 位置追踪线图排版契约（第十五阶段）=====
// 源码级锁住"这次改好的东西别再改回去"：
// 1. 排名轴量程必须由真实数据推出（rankAxisScale），不许再回到固定 1..100 把曲线压扁
// 2. 横轴靠 interval + minTickGap 控密度：不旋转、不整体隐藏，也不删数据点
// 3. 记录数 ≤ SPARSE_TREND_MAX 时必须走稀疏列表，不能把两点连成"趋势"
// 4. 系列颜色按传入顺序固定，隐藏某条不能让其余曲线换色（图例就必须与曲线对应）
// 5. 共享 token（RK_XAXIS_PROPS 等）本身不得被改动——keyword-expand 等页面也在用

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../${p}`, import.meta.url)), "utf-8");

/** 只取本契约用到的两层 */
type LocaleDict = {
  dashboard: {
    shared: { charts: Record<string, string> };
    positionTracking: Record<string, string>;
  };
};

const MULTI = read("src/components/dashboard/charts/MultiRankTrend.tsx");
const SINGLE = read("src/components/dashboard/charts/RankTrendChart.tsx");
const THEME = read("src/components/viz/rank-theme.ts");
const PAGE = read("src/app/(default)/(dashboard)/app/position-tracking/page.tsx");
const ZH: LocaleDict = JSON.parse(read("messages/zh.json"));
const EN: LocaleDict = JSON.parse(read("messages/en.json"));

describe("排名轴量程来自真实数据", () => {
  for (const [name, src] of [["MultiRankTrend", MULTI], ["RankTrendChart", SINGLE]] as const) {
    it(`${name}：YAxis 必须同时覆盖 domain 与 ticks`, () => {
      expect(src).toMatch(/rankAxisScale\(/);
      const yAxis = src.match(/<YAxis[^>]*>/)?.[0] ?? "";
      expect(yAxis).toContain("domain={domain}");
      expect(yAxis).toContain("ticks={ticks}");
      expect(src).not.toMatch(/domain=\{\[1,\s*100\]\}/);
    });
  }

  it("反向轴语义保持：第 1 名在最上方", () => {
    expect(THEME).toMatch(/RK_RANK_YAXIS_PROPS\s*=\s*\{[^}]*reversed:\s*true/);
    for (const src of [MULTI, SINGLE]) expect(src).toContain("RK_RANK_YAXIS_PROPS");
  });
});

describe("横轴刻度密度", () => {
  it("两个线图都用 interval + minTickGap 控制密度", () => {
    for (const src of [MULTI, SINGLE]) {
      const xAxis = src.match(/<XAxis[^>]*>/)?.[0] ?? "";
      expect(xAxis).toContain('interval="preserveStartEnd"');
      expect(xAxis).toContain("minTickGap=");
      expect(xAxis).toContain("tickMargin=");
      // 不接受"旋转 90 度"或"藏掉坐标轴"这两种掩盖做法
      expect(xAxis).not.toMatch(/angle=/);
      expect(xAxis).not.toMatch(/\bhide\b/);
    }
  });

  it("日期标签只留月-日，完整日期仍在数据里", () => {
    for (const src of [MULTI, SINGLE]) expect(src).toContain("shortDateLabel(");
  });
});

describe("稀疏数据不画假趋势", () => {
  it("两个线图都有 SPARSE_TREND_MAX 分支", () => {
    for (const src of [MULTI, SINGLE]) {
      expect(src).toContain("SPARSE_TREND_MAX");
      expect(src).toContain("sparseTrendHint");
    }
  });

  it("线图页不再自带『只有一次记录』的特殊分支（统一交给图表组件）", () => {
    expect(PAGE).not.toContain("trendData");
    expect(PAGE).toContain("<RankTrendChart");
    expect(PAGE).not.toMatch(/<LineChart/);
  });
});

describe("图例与曲线一一对应", () => {
  it("颜色按传入顺序确定，早于显隐过滤", () => {
    const colorAt = MULTI.indexOf("const colored = top.map");
    const visibleAt = MULTI.indexOf("const visible = colored.filter");
    expect(colorAt).toBeGreaterThan(-1);
    expect(visibleAt).toBeGreaterThan(-1);
    expect(visibleAt).toBeGreaterThan(colorAt);
    expect(MULTI).toMatch(/seriesColor\(i\)/);
  });

  it("数据点可见（dot={false} 会让稀疏数据读成一条无信息直线）", () => {
    for (const src of [SINGLE, MULTI]) {
      const lineJsx = src.match(/<Line\s[\s\S]*?\/>/)?.[0] ?? "";
      expect(lineJsx).toContain("dot={{");
      expect(lineJsx).not.toContain("dot={false}");
    }
  });

  it("多词图例改为 HTML chip，不再用会挤压换行的 SVG <Legend>", () => {
    const rechartsImport = MULTI.match(/import \{[\s\S]*?\} from "recharts";/)?.[0] ?? "";
    expect(rechartsImport).not.toContain("Legend");
    expect(MULTI).toContain("SeriesLegend");
  });
});

describe("共享 token 未被就地修改", () => {
  it("RK_XAXIS_PROPS 仍是不带 density/angle 的基础配置", () => {
    const block = THEME.match(/RK_XAXIS_PROPS\s*=\s*\{[\s\S]*?\} as const/)?.[0] ?? "";
    expect(block).toMatch(/tickLine:\s*false/);
    expect(block).not.toMatch(/angle|minTickGap|interval/);
  });

  it("卡片高度由内容决定：线图卡片不再写死 chartHeight", () => {
    const trendCard = PAGE.slice(
      PAGE.indexOf('title={t("chartTrend")}'),
      PAGE.indexOf('title={t("chartChanges")}')
    );
    expect(trendCard).not.toBe("");
    expect(trendCard).not.toContain("chartHeight");
  });
});

describe("新增文案双语齐全", () => {
  it("charts 组里稀疏与量程提示都存在", () => {
    for (const [locale, dict] of [["zh", ZH], ["en", EN]] as const) {
      const charts = dict.dashboard.shared.charts;
      for (const key of ["sparseTrendHint", "rankAxisHint", "rankSemantics", "rankSeriesLabel"]) {
        expect(typeof charts[key], `${locale}.${key}`).toBe("string");
      }
      expect(charts.sparseTrendHint).toContain("{days}");
      expect(charts.rankAxisHint).toContain("{worst}");
    }
  });

  it("旧的图例提示与 trendHint 已随实现一起删除，不留死文案", () => {
    for (const dict of [ZH, EN]) {
      expect(dict.dashboard.shared.charts.hiddenLabel).toBeUndefined();
      expect(dict.dashboard.shared.charts.legendHint).toBeUndefined();
      expect(dict.dashboard.positionTracking.trendHint).toBeUndefined();
    }
  });
});
