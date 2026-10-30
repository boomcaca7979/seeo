// ===== 排名追踪页「SERP 特征记录」契约测试（第二阶段）=====
// 严格规则：只展示各日期快照实际存储的 feature_types；历史没有某特征时不能断言它当时不存在；
// 未知特征类型原样显示原始值；不为了补齐历史向 Google 发起新请求（展示层零新请求）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(process.cwd(), "src/app/(default)/(dashboard)/app/position-tracking/page.tsx");
const src = readFileSync(PAGE, "utf8");
const SERPAPI = join(process.cwd(), "src/lib/seo/serpapi.ts");
const serpapiSrc = readFileSync(SERPAPI, "utf8");

function positionTrackingNs(file: string): Record<string, string> {
  const json = JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as {
    dashboard: { positionTracking: Record<string, string> };
  };
  return json.dashboard.positionTracking;
}

describe("feature_types 数据链路", () => {
  it("RankHistoryPoint 声明 featureTypes 字段（/api/tracking/history 已返回该字段，UI 补齐消费）", () => {
    expect(src).toContain("interface RankHistoryPoint { date: string; position: number | null; url: string | null; featureTypes: string[]; }");
  });

  it("已知特征词表与 serpapi.ts extractFeatures 的候选完全一致（不引入私词表漂移）", () => {
    const pageList = src.slice(src.indexOf("const KNOWN_FEATURE_TYPES"), src.indexOf("] as const;"));
    const providerList = serpapiSrc.slice(serpapiSrc.indexOf("const candidates"), serpapiSrc.indexOf("];", serpapiSrc.indexOf("const candidates")));
    const pageTypes = [...pageList.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    const providerTypes = [...providerList.matchAll(/\["([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(pageTypes).toEqual(providerTypes);
    expect(pageTypes.length).toBe(10);
  });
});

describe("展示语义：只展示已存值，不从缺失推断", () => {
  it("特征徽章以 featureTypes.length > 0 为门槛；空记录日显示「未记录到特征数据」，不断言特征不存在", () => {
    expect(src).toContain("h.featureTypes.length > 0 ? (");
    expect(src).toContain('t("featureDayEmpty")');
    // 展示区不得出现「当时没有/不存在某特征」式的推断文案键
    expect(src).not.toContain("featureAbsent");
    expect(src).not.toContain("notPresent");
  });

  it("未知特征类型原样显示原始值（不猜含义、不隐藏）", () => {
    expect(src).toContain("? t(`featureType_${type}`) : type;");
  });

  it("特征历史只在真实历史加载成功且有记录时渲染（失败走既有 LoadErrorState，不冒充空态）", () => {
    const gate = src.slice(src.indexOf("data-testid=\"serp-feature-history\"") - 200, src.indexOf("data-testid=\"serp-feature-history\""));
    expect(gate).toContain("!historyLoading && !historyError && historyPoints > 0");
  });

  it("展示上限只截断显示，不伪造更多记录", () => {
    expect(src).toContain("FEATURE_HISTORY_MAX = 14");
    expect(src).toContain('t("featureHistoryLimit"');
  });

  it("历史展示零新增请求：特征区复用既有 loadHistory 的一次 GET /api/tracking/history", () => {
    const reads = [...src.matchAll(/fetch\(`\/api\/tracking\/history/g)].length;
    expect(reads).toBe(2); // 单词趋势 + 多词趋势，两条既有链路，无第三处
  });
});

describe("feature i18n 目录完整性（zh + en）", () => {
  const keys = new Set<string>();
  for (const m of src.matchAll(/t\("(featureType_[a-z_]+|featureHistory[A-Za-z]*|featureDayEmpty)"\)/g)) keys.add(m[1]);
  if (src.includes("t(`featureType_${type}`)")) {
    for (const ft of [
      "featured_snippet", "ai_overview", "local_pack", "knowledge_graph", "top_stories",
      "video_results", "images_results", "shopping_results", "twitter_results", "events_results",
    ]) {
      keys.add(`featureType_${ft}`);
    }
  }

  it("页面用到的 feature 键非空", () => {
    expect(keys.size).toBeGreaterThanOrEqual(13);
  });

  for (const [file, label] of [["messages/zh.json", "zh"], ["messages/en.json", "en"]] as const) {
    it(`${label} 命名空间覆盖全部用到的键`, () => {
      const ns = positionTrackingNs(file);
      const missing = [...keys].filter((k) => !(k in ns));
      expect(missing, `${label} missing: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
