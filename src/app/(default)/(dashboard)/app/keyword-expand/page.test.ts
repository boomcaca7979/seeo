// ===== keyword-expand 意图估算测试 =====
// 修复记录：detectIntent 曾在无规则命中时默认「导航型」，"SEO audit tool" 被误分类。
// 现契约：无规则命中 → 「未知」；「导航型」只来自真实导航信号。
// 规则实现单一来源 @/lib/seo/keyword-intent；本页 re-export 保留既有 import 契约
//（历史契约：export detectIntent，表格 intent 使用 detectIntent(q) 而非位置硬编码）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectIntent } from "./page";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const DIRECTION_SOURCE = readFileSync(
  fileURLToPath(new URL("./DirectionExpansion.tsx", import.meta.url)),
  "utf-8"
);
const OVERVIEW_SOURCE = readFileSync(
  fileURLToPath(new URL("../keyword-overview/page.tsx", import.meta.url)),
  "utf-8"
);

function readCatalog(name: "zh" | "en") {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../../../messages/${name}.json`, import.meta.url)), "utf-8")
  );
}

describe("detectIntent（经本页 re-export 的共享实现）", () => {
  it("本轮修复目标用例：无规则命中 → 未知；导航型只来自真实导航信号", () => {
    expect(detectIntent("SEO audit tool")).toBe("未知");
    expect(detectIntent("what is SEO audit")).toBe("信息型");
    expect(detectIntent("best SEO audit tool")).toBe("商业型");
    expect(detectIntent("login")).toBe("导航型");
  });

  it("中文规则不回退", () => {
    expect(detectIntent("seo是什么")).toBe("信息型");
    expect(detectIntent("seo工具推荐")).toBe("商业型");
    expect(detectIntent("semrush 官网")).toBe("导航型");
    expect(detectIntent("建站多少钱")).toBe("商业型");
  });

  it("英文规则不回退", () => {
    expect(detectIntent("how to improve seo")).toBe("信息型");
    expect(detectIntent("semrush vs ahrefs")).toBe("商业型");
    expect(detectIntent("seeo login")).toBe("导航型");
  });

  it("裸品牌词 / 无特征词 / 空串 → 未知（不产生伪确定性）", () => {
    expect(detectIntent("seeo")).toBe("未知");
    expect(detectIntent("toolstep")).toBe("未知");
    expect(detectIntent("")).toBe("未知");
    expect(() => detectIntent("===***###")).not.toThrow();
    expect(detectIntent("===***###")).toBe("未知");
  });

  it("同一关键词每次分类一致（确定性，与行位置无关）", () => {
    for (let i = 0; i < 9; i++) {
      expect(detectIntent("seo是什么")).toBe("信息型");
      expect(detectIntent("SEO audit tool")).toBe("未知");
    }
  });
});

describe("意图实现单一来源（防两页副本漂移）", () => {
  it("两个页面都不再本地定义 detectIntent（无 return 「导航型」兜底）", () => {
    expect(SOURCE).not.toContain('return "导航型";');
    expect(OVERVIEW_SOURCE).not.toContain('return "导航型";');
  });

  it("两页均从 @/lib/seo/keyword-intent 引入", () => {
    expect(SOURCE).toContain('from "@/lib/seo/keyword-intent"');
    expect(OVERVIEW_SOURCE).toContain('from "@/lib/seo/keyword-intent"');
  });
});

describe("相关关键词表格 intent 来源（防回归）", () => {
  it("intent 由 detectIntent(关键词文本) 计算，不再使用 i % 3 位置硬编码", () => {
    expect(SOURCE).toContain("detectIntent(k.keyword)");
    expect(SOURCE).not.toContain("i % 3");
    expect(SOURCE).not.toContain("商业调查型"); // 旧假数据特有的类别名
    // 「交易型」自本轮起是 DataForSEO search_intent_info 的真实类别（PROVIDER_INTENT_MAP），不再视为假数据
  });

  it("表头不再笼统标注「估算」：意图列区分供应商与估算来源（i18n 后文案位于 zh message catalog）", () => {
    expect(SOURCE).toContain('t("colIntent")');
    const zh = readCatalog("zh");
    expect(zh.dashboard.keywords.expand.colIntent).toBe("意图");
    expect(zh.dashboard.keywords.expand.intentNote).toContain("DataForSEO Labs");
  });
});

describe("数据库扩词与发现工作流（防回归）", () => {
  it("表格渲染来源列、种子词指标卡、CSV 导出与加载更多", () => {
    expect(SOURCE).toContain('t("colSource")');
    expect(SOURCE).toContain('t("seedMetricsTitle")');
    expect(SOURCE).toContain('t("exportCsv")');
    expect(SOURCE).toContain('t("loadMore")');
    expect(SOURCE).toContain("t(`source_${r.origins[0]}`)");
  });

  it("行操作提供 SERP 研究与内容优化入口（沿用现有页面，不另建系统）", () => {
    expect(SOURCE).toContain('/app/keyword-overview?keyword=');
    expect(SOURCE).toContain('/app/content?keyword=');
  });

  it("意图徽标区分供应商与估算（title 来源提示）", () => {
    expect(SOURCE).toContain("intentProviderTitle");
    expect(SOURCE).toContain("intentEstimateTitle");
  });

  it("无指标时隐藏指标列并禁用相关排序（缺失不代表 0）", () => {
    expect(SOURCE).toContain("hasAnyMetrics");
    expect(SOURCE).toContain("hasVolumeData");
    expect(SOURCE).toContain("effectiveSort");
    expect(SOURCE).toContain('disabled={!hasVolumeData}');
    expect(SOURCE).toContain("sortUnavailableSuffix");
  });

  it("三态脚注：未配置 / 请求失败 / 正常返回分别有独立文案", () => {
    expect(SOURCE).toContain("metricsNoteUnconfigured");
    expect(SOURCE).toContain("metricsNoteError");
    expect(SOURCE).toContain('discovery?.state === "error"');
  });

  it("新增文案在中英文 catalog 齐全，旧 subTop100 已移除", () => {
    for (const catalog of [readCatalog("zh"), readCatalog("en")]) {
      const expand = catalog.dashboard.keywords.expand;
      for (const key of [
        "colVolume", "colDifficulty", "colCpc", "colCompetition", "colTrend",
        "trendAria", "metricsSourceNote", "metricsNoteUnconfigured", "metricsNoteError",
        "intentUnknown", "intentUnknownReason",
        "intentTransactional", "seedMetricsTitle", "seedMetricsUnavailable", "colSource",
        "source_related", "source_paa", "source_labs_suggestions", "source_labs_ideas", "sourceAll",
        "filterSource", "sortVolume", "sortKd", "exportCsv", "loadMore", "shownCount",
        "contentAction", "intentProviderTitle", "intentEstimateTitle",
        "sortUnavailableHint", "sortUnavailableSuffix",
      ]) {
        expect(expand[key]).toBeTruthy();
      }
      const overview = catalog.dashboard.keywords.overview;
      for (const key of ["subFirstPage", "intentUnknown", "intentUnknownReason", "serpFeaturesLabel", "serpFeaturesEmpty", "featureAiOverview"]) {
        expect(overview[key]).toBeTruthy();
      }
      expect(overview.subTop100).toBeUndefined();
    }
  });
});

describe("GSC 搜索机会区块（独立数据域，防回归）", () => {
  it("GSC 区块独立渲染，与通用关键词发现明确分离；未选项目时如实提示", () => {
    expect(SOURCE).toContain('t("gscTitle")');
    expect(SOURCE).toContain('t("gscSubtitle")');
    expect(SOURCE).toContain('t("gscSourceNote")');
    expect(SOURCE).toContain('aria-label={t("gscTitle")}');
    expect(SOURCE).toContain('t("gscNoProject")');
  });

  it("五种连接/数据状态分别渲染（需登录/未连接/错误/空数据/正常）", () => {
    for (const key of [
      "gscStateNeedsLogin", "gscStateNotConnected", "gscStateError", "gscStateEmpty",
      "gscStateNeedsLoginHint", "gscStateNotConnectedHint", "gscStateEmptyHint",
    ]) {
      // 裸键名断言：部分键带插值参数（如 gscStateEmptyHint），不是无参 t("key") 调用
      expect(SOURCE).toContain(key);
    }
    expect(SOURCE).toContain('phase === "needs-login"');
    expect(SOURCE).toContain('phase === "not-connected"');
    expect(SOURCE).toContain('phase === "error"');
  });

  it("字段映射来自真实 GSC 响应（query+page 双维度），缺失落地页如实显示不可用", () => {
    expect(SOURCE).toContain("row.keys[0]");
    expect(SOURCE).toContain("row.keys.length > 1 ? row.keys[1] : null");
    expect(SOURCE).toContain('t("gscPageUnavailable")');
  });

  it("快捷筛选标注为 SeeO 规则（非 Google 官方标准），复用机会引擎 CTR 基线", () => {
    expect(SOURCE).toContain('from "@/lib/seo/ctr-baseline"');
    expect(SOURCE).toContain("gscQuickLowCtrRule");
    expect(SOURCE).toContain("gscQuickPage2Rule");
    expect(SOURCE).toContain("baseline * 0.5");
  });

  it("行动入口复用既有流程：内容优化（带 url）、追踪、CSV 导出", () => {
    expect(SOURCE).toContain("/app/content?keyword=");
    expect(SOURCE).toContain("&url=");
    expect(SOURCE).toContain("handleTrackFromExpand(r.query)");
    for (const key of ["gscColQuery", "gscColPage", "gscColClicks", "gscColImpressions", "gscColCtr", "gscColPosition"]) {
      expect(SOURCE).toContain(`t("${key}")`);
    }
  });

  it("GSC 新增文案在中英文 catalog 齐全", () => {
    for (const catalog of [readCatalog("zh"), readCatalog("en")]) {
      const expand = catalog.dashboard.keywords.expand;
      for (const key of [
        "gscTitle", "gscSubtitle", "gscLoading", "gscNoProject", "gscConnectedTag",
        "gscStateNeedsLogin", "gscStateNeedsLoginHint", "gscStateNotConnected", "gscStateNotConnectedHint",
        "gscStateError", "gscStateEmpty", "gscStateEmptyHint", "gscSummary", "gscFromCache",
        "gscSortLabel", "gscSortImpressions", "gscSortCtr", "gscSortPosition", "gscSortClicks",
        "gscPositionFilter", "gscPositionAll", "gscPositionTop5", "gscPositionTop10", "gscPositionP11_20", "gscPositionP21_50",
        "gscQuickLowCtr", "gscQuickLowCtrRule", "gscQuickPage2", "gscQuickPage2Rule",
        "gscNoFilteredRows", "gscColQuery", "gscColPage", "gscColClicks", "gscColImpressions", "gscColCtr", "gscColPosition",
        "gscPageUnavailable", "gscContentTitle", "gscSourceNote", "gscQuickRuleNote",
      ]) {
        expect(expand[key]).toBeTruthy();
      }
    }
  });
});

describe("Google 自动补全建议词（用户主动触发，防回归）", () => {
  it("建议词 fetch 仅两处手动处理器（页面 handleFetchSuggestions / DirectionExpansion 子组件），且不在 useEffect 自动触发", () => {
    const matches = SOURCE.match(/fetch\("\/api\/keywords\/suggestions"/g) ?? [];
    const directionMatches = DIRECTION_SOURCE.match(/fetch\("\/api\/keywords\/suggestions"/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(directionMatches).toHaveLength(1);
    expect(SOURCE).toContain('onClick={handleFetchSuggestions}');
    expect(DIRECTION_SOURCE).toContain('onClick={() => handleRunDirection(dir.id)}');
    // fetch 都位于手动处理器内
    const handlerStart = SOURCE.indexOf("const handleFetchSuggestions");
    const fetchStart = SOURCE.indexOf('fetch("/api/keywords/suggestions"');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(fetchStart).toBeGreaterThan(handlerStart);
    // 自动补全不在「分析」主流程中调用：handleAnalyze 只请求 expand
    expect((SOURCE.match(/fetch\("\/api\/keywords\/expand"/g) ?? []).length).toBe(1);
  });

  it("新分析重置建议词/主题/问题词状态（不把旧种子词的建议带到新种子）", () => {
    expect(SOURCE).toContain("setSuggestions([])");
    expect(SOURCE).toContain('setSuggest({ phase: "idle" })');
    expect(SOURCE).toContain('setTopicFilter("all")');
    expect(SOURCE).toContain("setQuestionOnly(false)");
  });

  it("失败/空状态独立渲染，不破坏已有结果；建议词来源标记与已有行合并", () => {
    expect(SOURCE).toContain("suggestEmpty");
    expect(SOURCE).toContain("suggestFailed");
    expect(SOURCE).toContain("suggestErrorHint");
    expect(SOURCE).toContain('origins: ["autocomplete"]');
    expect(SOURCE).toContain('mergeOrigin(key, "autocomplete")');
  });

  it("建议词行不编造指标：合并时指标为 null，无指标列隐藏逻辑保持不变", () => {
    expect(SOURCE).toContain("keyword: suggestion");
    expect(SOURCE).toContain("hasAnyMetrics");
  });
});

describe("主题分组与问题词视图（SeeO 规则型，防回归）", () => {
  it("分组与问题词识别来自共享纯模块（不在页面内另写规则）", () => {
    expect(SOURCE).toContain('from "@/lib/seo/keyword-cluster"');
    expect(SOURCE).toContain("clusterKeywords(keywordRows.map");
    expect(SOURCE).toContain("isQuestionKeyword(row.keyword)");
  });

  it("主题筛选含「其他」兜底组，问题词 = PAA 来源 + 规则识别", () => {
    expect(SOURCE).toContain("CLUSTER_OTHER_ID");
    expect(SOURCE).toContain("row.origins.includes(\"paa\")");
  });
});

describe("本轮新增文案在中英文 catalog 齐全", () => {
  it("建议词 / 主题 / 问题词 / 市场回退文案齐全", () => {
    for (const catalog of [readCatalog("zh"), readCatalog("en")]) {
      const expand = catalog.dashboard.keywords.expand;
      for (const key of [
        "source_autocomplete",
        "suggestButton", "suggestButtonTitle", "suggestLoading", "suggestDone",
        "suggestFromCache", "suggestEmpty", "suggestFailed", "suggestErrorHint",
        "topicFilter", "topicAll", "topicOther", "topicNote",
        "questionOnly", "questionOnlyRule",
        "marketNotice",
      ]) {
        expect(expand[key]).toBeTruthy();
      }
    }
  });

  it("来源筛选选项包含 autocomplete（TABLE_ORIGINS）", () => {
    expect(SOURCE).toContain('"related", "paa", "autocomplete", "labs_suggestions", "labs_ideas"');
  });
});

// ===== P4 关键词研究工作台（Trends / SERP 分析 / 竞争信号 / 竞争与机会入口）=====

const TRENDS_PANEL_SOURCE = readFileSync(
  fileURLToPath(new URL("./TrendsPanel.tsx", import.meta.url)),
  "utf-8"
);
const SERP_SECTION_SOURCE = readFileSync(
  fileURLToPath(new URL("./SerpSection.tsx", import.meta.url)),
  "utf-8"
);

describe("Google Trends 请求策略（P4-C，任务硬约束：绝无自动调用）", () => {
  it("四个 data_type 各自独立按钮，全部由用户点击触发（onClick → handleFetch）", () => {
    for (const dataType of ["TIMESERIES", "GEO_MAP_0", "RELATED_QUERIES", "RELATED_TOPICS"]) {
      expect(TRENDS_PANEL_SOURCE).toContain(dataType);
    }
    expect(TRENDS_PANEL_SOURCE).toContain('onClick={() => handleFetch(dataType)}');
  });

  it("不设「一键全部加载」：每个按钮只发一个 data_type 的请求", () => {
    const matches = TRENDS_PANEL_SOURCE.match(/fetch\("\/api\/keywords\/trends"/g) ?? [];
    expect(matches).toHaveLength(1);
    const handlerStart = TRENDS_PANEL_SOURCE.indexOf("const handleFetch");
    const fetchStart = TRENDS_PANEL_SOURCE.indexOf('fetch("/api/keywords/trends"');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(fetchStart).toBeGreaterThan(handlerStart);
  });

  it("组件无 useEffect：绝不在页面加载/渲染时自动调用 Trends API", () => {
    expect(TRENDS_PANEL_SOURCE).not.toContain("useEffect");
  });

  it("请求体携带 seed / location / dataType / date（用户可选时间范围）", () => {
    expect(TRENDS_PANEL_SOURCE).toContain('body: JSON.stringify({ seed, location, dataType, date: dateRange })');
  });

  it("RELATED_QUERIES 就绪后回调并入统一发现表：top + rising（rising 单独标记）", () => {
    expect(TRENDS_PANEL_SOURCE).toContain('if (dataType === "RELATED_QUERIES" && onQueriesLoaded)');
    expect(TRENDS_PANEL_SOURCE).toContain('rising: false');
    expect(TRENDS_PANEL_SOURCE).toContain('rising: true');
  });

  it("加载中禁止重复点击；失败/就绪状态独立渲染且互不干扰（per-dataType phase）", () => {
    expect(TRENDS_PANEL_SOURCE).toContain('if (current.phase === "loading") return;');
    expect(TRENDS_PANEL_SOURCE).toContain('phase: "loading"');
    expect(TRENDS_PANEL_SOURCE).toContain('phase: "ready"');
    expect(TRENDS_PANEL_SOURCE).toContain('phase: "error"');
  });

  it("口径硬约束：Trends 值标注为相对指数，绝不换算成搜索量", () => {
    expect(TRENDS_PANEL_SOURCE).toContain("trendsScaleNote");
    expect(TRENDS_PANEL_SOURCE).toContain("trendsQueriesNote");
    expect(TRENDS_PANEL_SOURCE).toContain("trendsTopicsNote");
    expect(TRENDS_PANEL_SOURCE).toContain('data.geo ? `geo=${data.geo}` : t("trendsGeoGlobal")');
  });
});

describe("SERP 分析区请求策略（P4-D，加载更多只由用户触发）", () => {
  it("加载更多只在 handleLoadMore 中 fetch，携带 start 偏移", () => {
    const matches = SERP_SECTION_SOURCE.match(/fetch\(\s*`\/api\/seo\/serp/g) ?? [];
    expect(matches).toHaveLength(1);
    const handlerStart = SERP_SECTION_SOURCE.indexOf("const handleLoadMore");
    const fetchStart = SERP_SECTION_SOURCE.indexOf("`/api/seo/serp");
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(fetchStart).toBeGreaterThan(handlerStart);
    expect(SERP_SECTION_SOURCE).toContain("&start=${start}");
    expect(SERP_SECTION_SOURCE).toContain("const start = pagesRequested * PAGE_STEP;");
  });

  it("组件无 useEffect：第一页快照来自「分析」同一次调用，绝无自动请求", () => {
    expect(SERP_SECTION_SOURCE).not.toContain("useEffect");
  });

  it("返回 0 条 = 真实末尾（exhausted，非错误态），不再发请求；不足时如实展示", () => {
    expect(SERP_SECTION_SOURCE).toContain('(data.organic ?? []).length === 0 ? "exhausted" : "idle"');
    expect(SERP_SECTION_SOURCE).toContain('t("serpNoMoreResults")');
    expect(SERP_SECTION_SOURCE).toContain('t("serpNoOrganic")');
  });

  it("跨页按 link 去重（不用 Google 自报总数补齐）", () => {
    expect(SERP_SECTION_SOURCE).toContain("const existingLinks = new Set(rows.map((r) => r.link));");
    expect(SERP_SECTION_SOURCE).toContain("filter((r) => !existingLinks.has(r.link))");
  });

  it("口径三分：实际分析条数 / Google 自报估计总数（title 说明）/ 广告真实计数", () => {
    expect(SERP_SECTION_SOURCE).toContain('t("serpAnalyzedCount"');
    expect(SERP_SECTION_SOURCE).toContain('title={t("serpTotalResultsTitle")}');
    expect(SERP_SECTION_SOURCE).toContain('t("serpAdsCount"');
    expect(SERP_SECTION_SOURCE).toContain('t("serpAdsZero")');
  });

  it("加载更多的成本提示（独立引擎调用，每页独立缓存）", () => {
    expect(SERP_SECTION_SOURCE).toContain('title={t("serpLoadMoreCost")}');
    expect(SERP_SECTION_SOURCE).toContain('t("serpPageLoaded"');
  });
});

describe("种子词概览与 SeeO SERP Competition Signal（P4-B）", () => {
  it("种子 SERP 快照来自 expand 响应（serpSnapshot），与扩词同一次调用", () => {
    expect(SOURCE).toContain("expand.data?.seed && expand.data.serpSnapshot");
    expect(SOURCE).toContain("snapshot={expand.data.serpSnapshot}");
  });

  it("竞争信号来自共享纯模块 computeSerpCompetitionSignal（页面内不另写公式）", () => {
    expect(SOURCE).toContain('from "@/lib/seo/serp-signal"');
    expect(SOURCE).toContain('computeSerpCompetitionSignal(');
    expect(SOURCE).toContain("features: snapshot.features },");
    expect(SOURCE).toContain("expand.data.seed");
  });

  it("信号口径诚实：无快照信号时显示 unavailable 原因，绝不标为 Google KD/搜索量", () => {
    expect(SOURCE).toContain('t("signalLabel")');
    expect(SOURCE).toContain('t("signalUnavailable")');
    expect(SOURCE).toContain('t("signalBasis", {');
    expect(SOURCE).toContain('t("signalFormula")');
    expect(SOURCE).toContain('t("signalLimit")');
    const zh = readCatalog("zh");
    expect(zh.dashboard.keywords.expand.signalLabel).toContain("SeeO");
    expect(zh.dashboard.keywords.expand.signalLabel).not.toContain("KD");
    expect(zh.dashboard.keywords.expand.signalBasis).toContain("第一页");
  });

  it("意图卡为文本规则估算（hintStyle=plain），totalResults 标注为 Google 自报估计", () => {
    expect(SOURCE).toContain('t("seedIntentLabel")');
    expect(SOURCE).toContain('hint={t("intentNote")}');
    expect(SOURCE).toContain('t("cardTotalResultsHint")');
  });

  it("广告状态：0 显示「无广告」而非未捕获；缺失时 unavailable 说明", () => {
    expect(SOURCE).toContain('snapshot.adsCount === 0 ? t("cardAdsZeroHint") : t("cardAdsHint")');
    expect(SOURCE).toContain('unavailableReason={t("cardAdsUnavailable")}');
  });
});

describe("P4 工作台分区与竞争机会入口（A-E 布局）", () => {
  it("Trends 与 SERP 区块仅在研究视图且已有结果时渲染（不随首屏自动请求）", () => {
    expect(SOURCE).toContain('hasResult && expand.data?.seed && resultView === "research"');
    const gate = SOURCE.indexOf('hasResult && expand.data?.seed && resultView === "research"');
    expect(gate).toBeLessThan(SOURCE.indexOf("<TrendsPanel"));
    const serpGate = SOURCE.indexOf("expand.data?.seed && expand.data.serpSnapshot && (\n        <div id=\"kw-serp\"");
    expect(serpGate).toBeGreaterThan(0);
  });

  it("新分析重置 Trends 查询状态（不把旧种子的相关查询带入新种子）", () => {
    expect(SOURCE).toContain("setTrendsQueries([])");
    expect(SOURCE).toContain("const handleTrendsQueriesLoaded");
  });

  it("trends_queries 并入统一发现表：新行指标为 null（不编造），来源合并进 origins", () => {
    expect(SOURCE).toContain('mergeOrigin(key, "trends_queries")');
    expect(SOURCE).toContain('origins: ["trends_queries"]');
    expect(SOURCE).toContain('"labs_ideas", "trends_queries", "serp_content"]');
  });

  it("serp_content 并入统一发现表：从真实 SERP 快照提取，绝不伪装成 Google 推荐词", () => {
    expect(SOURCE).toContain("extractSerpContentKeywords(");
    // 提取输入只来自 expand 响应中已获得的快照（零 API 成本），不另发请求
    expect(SOURCE).toContain("snapshot.organic.map((row) => ({ title: row.title, snippet: row.snippet }))");
    expect(SOURCE).toContain('mergeOrigin(key, "serp_content")');
    expect(SOURCE).toContain('origins: ["serp_content"]');
    // 口径说明独立成行，仅在确有提取词时展示
    expect(SOURCE).toContain('t("serpContentNote", { count: serpExtracted.length })');
    expect(SOURCE).toContain("serpExtracted.length > 0");
  });

  it("E 区竞争与机会入口复用既有页面：竞品差距 / 机会 / 排名追踪", () => {
    expect(SOURCE).toContain('t("nextStepsTitle")');
    expect(SOURCE).toContain('t("entryCompetitors")');
    expect(SOURCE).toContain('t("entryOpportunities")');
    expect(SOURCE).toContain('t("entryTracking")');
    expect(SOURCE).toContain("/app/competitors");
    expect(SOURCE).toContain("/app/opportunities");
    expect(SOURCE).toContain("/app/position-tracking");
  });
});

describe("P4 新增文案在中英文 catalog 齐全（255 键对齐）", () => {
  it("Trends / SERP / 竞争信号 / 入口 / feature 标签键双语齐全", () => {
    const zhKeys = Object.keys(readCatalog("zh").dashboard.keywords.expand);
    for (const catalog of [readCatalog("zh"), readCatalog("en")]) {
      const expand = catalog.dashboard.keywords.expand;
      for (const key of [
        "trendsTitle", "trendsSubtitle", "trendsButtonTitle", "trendsButtonTime", "trendsButtonGeo",
        "trendsButtonQueries", "trendsButtonTopics", "trendsRangeLabel", "trendsRange12m", "trendsRange5y",
        "trendsCostNote", "trendsLoading", "trendsFailed", "trendsEmpty", "trendsFromCache",
        "trendsGeoGlobal", "trendsIotTitle", "trendsIotSub", "trendsIotSeries", "trendsScaleNote",
        "trendsTopLabel", "trendsRisingLabel", "trendsQueriesNote", "trendsTopicsNote", "trendsGeoNote",
        "source_trends_queries", "seedSerpTitle", "seedIntentLabel",
        "cardFirstPage", "cardFirstPageHint", "cardTotalResults", "cardTotalResultsHint",
        "cardAds", "cardAdsHint", "cardAdsZeroHint", "cardAdsUnavailable",
        "signalLabel", "signalShortHint", "signalBasis", "signalFormula", "signalLimit", "signalUnavailable",
        "serpSourceTag", "cachedTag",
        "serpSectionTitle", "serpSectionSub", "serpAnalyzedCount", "serpTotalResultsNote", "serpTotalResultsTitle",
        "serpAdsCount", "serpAdsZero", "serpFeaturesLabel", "serpFeaturesEmpty", "serpDomainSummary",
        "serpNoOrganic", "serpLoadMore", "serpLoadMoreCost", "serpLoadingMore", "serpLoadMoreFailed",
        "serpPageLoaded", "serpNoMoreResults",
        "colRank", "colTitle", "colDomain", "colSnippet",
        "featureFeaturedSnippet", "featureAiOverview", "featureLocalPack", "featureKnowledgeGraph",
        "featureTopStories", "featureVideoResults", "featureImagesResults", "featureShoppingResults",
        "featureTwitter", "featureEvents",
        "nextStepsTitle", "nextStepsSub", "nextStepsNote",
        "entryCompetitors", "entryCompetitorsHint", "entryOpportunities", "entryOpportunitiesHint",
        "entryTracking", "entryTrackingHint",
      ]) {
        expect(expand[key]).toBeTruthy();
      }
    }
    expect(zhKeys.length).toBe(Object.keys(readCatalog("en").dashboard.keywords.expand).length);
  });

  it("SERP feature 标签映射与 keyword-overview 同一份 10 键口径", () => {
    const expected = [
      "featured_snippet", "ai_overview", "local_pack", "knowledge_graph", "top_stories",
      "video_results", "images_results", "shopping_results", "twitter_results", "events_results",
    ];
    for (const featureType of expected) {
      expect(SERP_SECTION_SOURCE).toContain(`${featureType}: "feature`);
    }
  });

  it("P3 补缺：Trends 结果视图展示实际请求的时间范围（未知值原样显示）", () => {
    expect(TRENDS_PANEL_SOURCE).toContain('data.dateRange === "today 12-m" ? t("trendsRange12m")');
    expect(TRENDS_PANEL_SOURCE).toContain('data.dateRange === "today 5-y" ? t("trendsRange5y")');
    expect(TRENDS_PANEL_SOURCE).toContain(": data.dateRange;");
  });

  it("P6 真实数据回归：top 的 value 是字符串（SerpApi 实录 \"100\"），相对热度回落到 extractedValue 显示", () => {
    expect(TRENDS_PANEL_SOURCE).toContain("item.extractedValue ?? null");
  });

  it("P5-T3：SERP 分析区展示已查看范围与已请求页数（不用 Google 自报总数冒充已查看）", () => {
    expect(SERP_SECTION_SOURCE).toContain('t("serpViewedRange", {');
    expect(SERP_SECTION_SOURCE).toContain("pagesRequested");
  });
});

describe("P5 多方向扩词策略（模板≠搜索数据，用户主动触发，成本透明）", () => {
  it("方向模板来自共享纯模块 expand-directions（面板组件内不另写模板）", () => {
    expect(DIRECTION_SOURCE).toContain('from "@/lib/seo/expand-directions"');
    expect(DIRECTION_SOURCE).toContain("EXPAND_DIRECTIONS.map");
    expect(DIRECTION_SOURCE).toContain("composeDirectionQueries(");
    expect(DIRECTION_SOURCE).toContain("directionLanguageForMarket(location)");
  });

  it("父组件以 seed 为 key 重新挂载面板（新种子重置方向状态），并幂等并入返回的建议词", () => {
    expect(SOURCE).toContain("key={expand.data.seed}");
    expect(SOURCE).toContain("onNewSuggestions={handleDirectionSuggestions}");
    expect(SOURCE).toContain("[...suggestions, ...directionSuggestions]");
    expect(SOURCE).toContain("setDirectionSuggestions([])");
  });

  it("只由用户点击触发：面板按钮 onClick 才调用 handleRunDirection，绝无 useEffect 自动请求方向", () => {
    expect(DIRECTION_SOURCE).toContain("onClick={() => handleRunDirection(dir.id)}");
    expect(DIRECTION_SOURCE).not.toContain("useEffect");
  });

  it("不支持的市场明确禁用并说明（不输出错误翻译词）", () => {
    expect(DIRECTION_SOURCE).toContain("directionLang === null ? (");
    expect(DIRECTION_SOURCE).toContain('t("directionsUnsupported", { market: location })');
  });

  it("成本透明：每方向显示请求数/缓存命中；组合数 ≤ MAX_QUERIES_PER_DIRECTION", () => {
    expect(DIRECTION_SOURCE).toContain('t("directionsCostNote", { max: MAX_QUERIES_PER_DIRECTION })');
    expect(DIRECTION_SOURCE).toContain('t("directionCostTitle", { max: queryCount })');
    expect(DIRECTION_SOURCE).toContain("cacheHits");
  });

  it("方向扩词文案键双语齐全", () => {
    for (const catalog of [readCatalog("zh"), readCatalog("en")]) {
      const expand = catalog.dashboard.keywords.expand;
      for (const key of [
        "directionsTitle", "directionsCostNote", "directionsDataNote", "directionsUnsupported",
        "directionCostTitle", "directionLoading", "directionDone", "directionEmpty", "directionError",
        "direction_free_price", "direction_best_alternatives", "direction_tutorial_questions",
        "direction_usecases_audience", "direction_compare_choose",
        "source_serp_content", "serpContentNote",
      ]) {
        expect(expand[key]).toBeTruthy();
      }
    }
  });
});

describe("P5 工作台整合与指标缺口诚实披露（锚点导航 + Semrush 对标缺口）", () => {
  it("流程导航只指向真实存在的分区锚点，且分区未渲染的入口被条件排除", () => {
    for (const anchor of ["kw-overview", "kw-signal", "kw-trends", "kw-discovery", "kw-serp", "kw-gsc"]) {
      expect(SOURCE).toContain(`id="${anchor}"`);
    }
    expect(SOURCE).toContain('href: "#kw-trends"');
    expect(SOURCE).toContain('href: "#kw-serp"');
    // Trends 分区仅在 research 视图渲染，导航入口同条件，避免死锚点
    expect(SOURCE).toContain('...(resultView === "research" ? [{ href: "#kw-trends"');
    expect(SOURCE).toContain('...(expand.data?.serpSnapshot ? [{ href: "#kw-serp"');
    expect(SOURCE).toContain('aria-label={t("flowNavLabel")}');
    expect(SOURCE).toContain("scroll-mt-4");
    // 390px 实测回归：原生 hash 跳转在嵌套滚动容器内落点偏差约 500px，已改为 scrollIntoView 接管
    expect(SOURCE).toContain("scrollIntoView({ block: \"start\" })");
    expect(SOURCE).toContain("e.preventDefault()");
  });

  it("Semrush 对标指标缺口 <details> 披露：五项指标逐项说明，无估算伪装", () => {
    expect(SOURCE).toContain("<details");
    for (const key of [
      "metricsGapTitle", "metricsGapSummary",
      "metricsGapVolume", "metricsGapVolumeByCountry",
      "metricsGapKd", "metricsGapCpc", "metricsGapCompetition",
      "metricsGapPartialTag", "metricsGapMissingTag",
    ]) {
      expect(SOURCE).toContain(`t("${key}")`);
    }
    // 五个指标条目都在（含分国搜索量），不能悄悄删掉任何一项
    expect((SOURCE.match(/metricsGapVolumeByCountry/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("指标缺口文案键双语齐全", () => {
    for (const catalog of [readCatalog("zh"), readCatalog("en")]) {
      const expand = catalog.dashboard.keywords.expand;
      for (const key of [
        "metricsGapTitle", "metricsGapSummary",
        "metricsGapVolume", "metricsGapVolumeByCountry",
        "metricsGapKd", "metricsGapCpc", "metricsGapCompetition",
        "flowNavLabel", "flowNavOverview", "flowNavSignal", "flowNavTrends",
        "flowNavDiscovery", "flowNavSerp", "flowNavGsc",
      ]) {
        expect(expand[key]).toBeTruthy();
      }
    }
  });
});

// ===== P7：完整扩展（多方向一次执行）+ PAA 深度展开 + 方向词及时入表 =====

describe("P7 多方向完整扩展（DirectionExpansion）", () => {
  it("「完整扩展」按模板顺序执行全部方向；单方向与完整扩展共用同一核心执行逻辑", () => {
    expect(DIRECTION_SOURCE).toContain("handleRunAll");
    expect(DIRECTION_SOURCE).toContain("runDirectionCore");
    expect(DIRECTION_SOURCE).toContain("for (const dir of EXPAND_DIRECTIONS)");
  });

  it("error/empty 相位保留已发生的请求与缓存计数（聚合统计不丢账）", () => {
    expect(DIRECTION_SOURCE).toContain(
      '{ phase: "error", message: errorMessage, requests, cacheHits }'
    );
    expect(DIRECTION_SOURCE).toContain(
      '{ phase: "empty", requests: 0, cacheHits: 0 }'
    );
  });

  it("完整扩展聚合行展示真实 requests/cacheHits/added", () => {
    expect(DIRECTION_SOURCE).toContain('t("directionRunAllDone"');
    expect(DIRECTION_SOURCE).toContain("runAll.requests");
    expect(DIRECTION_SOURCE).toContain("runAll.cacheHits");
    expect(DIRECTION_SOURCE).toContain("runAll.added");
  });

  it("完整扩展文案键双语齐全", () => {
    for (const catalog of [readCatalog("zh"), readCatalog("en")]) {
      const expand = catalog.dashboard.keywords.expand;
      for (const key of [
        "directionRunAll", "directionRunAllTitle", "directionRunAllRunning", "directionRunAllDone",
      ]) {
        expect(expand[key]).toBeTruthy();
      }
    }
  });
});

describe("P7 方向扩词结果及时进入统一发现表", () => {
  it("keywordRows memo 依赖包含 directionSuggestions（方向返回的建议词不滞后）", () => {
    expect(SOURCE).toContain("[expand.data, suggestions, directionSuggestions, trendsQueries, paaExpanded, serpExtracted, t, locale]");
  });
});

describe("P7 PAA 深度展开", () => {
  it("token 只来自快照中 provider 真实返回的 nextPageToken；无 token 显示不可继续", () => {
    expect(SOURCE).toContain("paaTokenByQuestion");
    expect(SOURCE).toContain("q.nextPageToken");
    expect(SOURCE).toContain('t("paaDeepUnavailable")');
  });

  it("展开走 /api/keywords/paa；新问题以 paa 来源并入统一表", () => {
    expect(SOURCE).toContain('"/api/keywords/paa"');
    expect(SOURCE).toContain('origins: ["paa"]');
  });

  it("PAA 深度展开文案键双语齐全", () => {
    for (const catalog of [readCatalog("zh"), readCatalog("en")]) {
      const expand = catalog.dashboard.keywords.expand;
      for (const key of [
        "paaDeepNote", "paaDeepButton", "paaDeepLoading", "paaDeepDone",
        "paaDeepCacheHit", "paaDeepEmpty", "paaDeepError", "paaDeepUnavailable", "paaExpandFailed",
      ]) {
        expect(expand[key]).toBeTruthy();
      }
    }
  });
});
