// ===== 竞品分析页「关键词差距」契约测试（第二阶段：Competitor Keyword Gap Web UI）=====
// 数据来源约束：/api/competitors/gap 不带 refresh 参数（纯读已存数据，不产生上游 SerpApi 请求）；
// 加载仅由用户显式点击触发；缺失指标显示「—」且 CSV 导出不写 0；行内动作只用真实存在的路由。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(process.cwd(), "src/app/(default)/(dashboard)/app/competitors/page.tsx");
const src = readFileSync(PAGE, "utf8");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
}

function competitorsNs(file: string): Record<string, string> {
  const json = readJson(file) as { dashboard: { competitors: Record<string, string> } };
  return json.dashboard.competitors;
}

// 从页面源码提取 t("gapXxx") / t(`gapCat_${c}`) 用到的所有 gap 相关键
function usedGapKeys(): Set<string> {
  const keys = new Set<string>();
  for (const m of src.matchAll(/t\("((?:gap|errNoCompetitors)[A-Za-z_]*)"\)/g)) {
    keys.add(m[1]);
  }
  if (src.includes("t(`gapCat_${c}`)")) {
    for (const cat of ["shared", "weaklyOwned", "competitorOnly", "projectOnly"]) {
      keys.add(`gapCat_${cat}`);
    }
  }
  return keys;
}

describe("gap 数据请求策略", () => {
  it("GET /api/competitors/gap 只有一处，带 no-store，且不带 refresh 参数", () => {
    const calls = [...src.matchAll(/fetch\(`\/api\/competitors\/gap[^`]*`[^)]*/g)].map((m) => m[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("cache: \"no-store\"");
    expect(calls[0]).not.toContain("refresh");
  });

  it("加载只由用户显式点击触发（onClick=handleLoadGap），不随页面 effect 自动发起", () => {
    expect(src).toContain("onClick={handleLoadGap}");
    // loadGap 的调用点只允许出现在 handleLoadGap / retryGap 两个显式处理器里
    const callSites = [...src.matchAll(/void loadGap\(/g)].length;
    expect(callSites).toBe(2);
    // 不存在 useEffect 直接调用 loadGap
    const effectRegions = src.split("useEffect(").slice(1);
    for (const region of effectRegions) {
      expect(region.split("}, [")[0]).not.toContain("loadGap(");
    }
  });

  it("切换项目时重置差距状态（防串数据）", () => {
    const switchEffect = src.slice(
      src.indexOf("// 项目变化时拉取竞品 + SOV"),
      src.indexOf("// 项目变化时直接拉取项目域名")
    );
    expect(switchEffect).toContain("setGapData(null);");
    expect(switchEffect).toContain("setGapCompetitorId(null);");
    expect(switchEffect).toContain("setGapError(null);");
  });
});

describe("gap 展示与导出语义", () => {
  it("缺失值显示「—」：搜索量/难度/差距均按 null 分支渲染，不写 0", () => {
    expect(src).toContain('r.searchVolume === null ? <span className="text-ink-40">—</span>');
    expect(src).toContain('r.difficulty === null ? <span className="text-ink-40">—</span>');
    expect(src).toContain("r.rankGap === null ? (");
  });

  it("CSV 缺失值导出为空串（esc 把 null/undefined 变为 \"\"），绝不写 0", () => {
    expect(src).toContain('value === null || value === undefined ? "" : String(value)');
    // 排名与 URL 列都进 CSV，缺失时不经 formatNumber 直接落空
    const csvHandler = src.slice(src.indexOf("const handleGapCsv"), src.indexOf("downloadCsvFile(`seeo-gap-"));
    expect(csvHandler).toContain("r.projectRank,");
    expect(csvHandler).toContain("r.projectUrl,");
    expect(csvHandler).toContain("r.competitorRank,");
    expect(csvHandler).toContain("r.competitorUrl,");
  });

  it("CSV 列与表格语义一致（含分类/差距/搜索量/难度/CPC）", () => {
    const csvHandler = src.slice(src.indexOf("const handleGapCsv"), src.indexOf("const safeDomain"));
    for (const col of [
      "gapColKeyword", "gapColLocation", "gapColDevice", "gapColCategory",
      "gapColProjectRank", "gapColProjectUrl", "gapColCompetitorRank", "gapColCompetitorUrl",
      "gapColGap", "gapColVolume", "gapColKd", "gapColCpc",
    ]) {
      expect(csvHandler).toContain(`t("${col}")`);
    }
  });

  it("行内动作只链接真实存在的路由：/app/position-tracking 深链（既有路由，不自动提交）", () => {
    expect(src).toContain("/app/position-tracking?keyword=${encodeURIComponent(r.keyword)}&domain=${encodeURIComponent(projectDomain)}");
  });

  it("范围披露与刷新口径文案在页面上渲染", () => {
    expect(src).toContain('t("gapScopeNote")');
    expect(src).toContain('t("gapRefreshNote")');
    expect(src).toContain('t("gapSummaryLine"');
  });

  it("null 排序护栏：排序比较器把 null 排最后，不当作 0", () => {
    const memo = src.slice(src.indexOf("const gapRows = useMemo"), src.indexOf("}, [gapData, gapCategory, gapSortMode, t]);"));
    expect(memo).toContain("if (av === null) return 1;");
    expect(memo).toContain("if (bv === null) return -1;");
  });
});

describe("gap i18n 目录完整性（zh + en）", () => {
  const keys = usedGapKeys();
  it("页面用到的 gap 键非空", () => {
    expect(keys.size).toBeGreaterThan(30);
  });
  for (const [file, label] of [["messages/zh.json", "zh"], ["messages/en.json", "en"]] as const) {
    it(`${label} 命名空间覆盖全部用到的键`, () => {
      const ns = competitorsNs(file);
      const missing = [...keys].filter((k) => !(k in ns));
      expect(missing, `${label} missing: ${missing.join(", ")}`).toEqual([]);
    });
  }
  it("四个分类的动态键在两个语言包中都存在", () => {
    for (const ns of [competitorsNs("messages/zh.json"), competitorsNs("messages/en.json")]) {
      for (const cat of ["gapCat_shared", "gapCat_weaklyOwned", "gapCat_competitorOnly", "gapCat_projectOnly"]) {
        expect(typeof ns[cat]).toBe("string");
      }
    }
  });
});
