// ===== 关键词扩展页「GSC 交叉匹配」契约测试（第三阶段：研究 × GSC × 机会工作流）=====
// 数据来源约束：
// - GSC 数据沿用既有 /api/gsc/connection + /api/gsc/performance 调用（参数不变 → 缓存键复用，零新上游请求）；
// - 匹配是客户端纯函数（gsc-match），归一化后仅精确匹配；
// - 机会只读懒加载（GET /api/opportunities 一次），本页绝不创建机会（无 scan POST）；
// - 未匹配/缺失字段的 CSV 与界面均为空（缺失不冒充 0）；
// - 口径免责：GSC 曝光≠市场搜索量、平均位置≠关键词难度、低 CTR 是 SeeO 规则非 Google 官方。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(process.cwd(), "src/app/(default)/(dashboard)/app/keyword-expand/page.tsx");
const src = readFileSync(PAGE, "utf8");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
}

function expandNs(file: string): Record<string, string> {
  const json = readJson(file) as { dashboard: { keywords: { expand: Record<string, string> } } };
  return json.dashboard.keywords.expand;
}

const MATCH_KEYS = [
  "matchViewToggleLabel",
  "viewToggleResearch",
  "viewToggleGscMatch",
  "matchFilterLabel",
  "matchFilterMatchedOnly",
  "matchFilterAll",
  "matchSummaryLine",
  "matchCoverageNote",
  "matchScopeNote",
  "matchOppLoading",
  "matchOppError",
  "matchNoMatches",
  "matchNoMatchesHint",
  "matchColStatus",
  "matchColOpp",
  "matchStatusClicked",
  "matchStatusExposed",
  "matchStatusUnmatched",
  "matchSeeoLowCtr",
  "matchSeeoLowCtrRule",
  "matchOppBadge",
  "matchOppDetailTitle",
  "matchOppNoneHint",
  "matchOppAction",
  "matchOppActionTitle",
  "matchRuleNote",
];

describe("GSC 数据请求策略（零新增上游请求）", () => {
  it("gsc/performance 只有一处调用，参数保持 query,page + last_28_days + row_limit=200（与既有缓存键一致）", () => {
    const calls = [...src.matchAll(/fetch\(\s*`\/api\/gsc\/performance[^`]*`/g)].map((m) => m[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("dimensions=query,page");
    expect(calls[0]).toContain("date_range=last_28_days");
    expect(calls[0]).toContain("row_limit=200");
  });

  it("gsc/connection 只有一处调用", () => {
    const calls = [...src.matchAll(/fetch\(`\/api\/gsc\/connection[^`]*`/g)].map((m) => m[0]);
    expect(calls).toHaveLength(1);
  });

  it("匹配是客户端纯计算：matchRows 不发起任何请求（由 useMemo 派生）", () => {
    const memoStart = src.indexOf("const matchRows = useMemo(");
    const memoEnd = src.indexOf("const visibleMatchRows");
    const memoBody = src.slice(memoStart, memoEnd);
    expect(memoBody).not.toContain("fetch(");
    expect(src).toContain("buildGscQueryIndex(");
    expect(src).toContain("matchKeywordsToGsc(");
  });
});

describe("机会入口策略（只读复用，不创建）", () => {
  it("本页没有任何机会创建/扫描调用（scan POST 只允许存在于机会页）", () => {
    // /api/opportunities 全部引用只有机会列表 GET 这一处（POST 的既有入口在本页只用于追踪关键词）
    expect([...src.matchAll(/\/api\/opportunities/g)]).toHaveLength(1);
    expect(src).not.toContain("/api/opportunities/scan");
  });

  it("机会列表只读懒加载：仅一处 GET /api/opportunities，且由 resultView === \"gsc-match\" 触发，ref 守卫避免重复请求", () => {
    const calls = [...src.matchAll(/fetch\(\s*`\/api\/opportunities\?[^`]*`/g)].map((m) => m[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("limit=200");
    expect(src).toContain('limit=200`, { cache: "no-store" });');
    const effectStart = src.indexOf('if (resultView !== "gsc-match"');
    expect(effectStart).toBeGreaterThan(-1);
    const effectBody = src.slice(effectStart, src.indexOf("}, [resultView, activeId, tc])"));
    expect(effectBody).toContain("/api/opportunities?");
    expect(src).toContain("oppFetchRef.current === activeId");
    expect(src).toContain("oppFetchRef.current = null");
  });

  it("已有机会展示链接到既有机会页（复用既有入口，不新造路由）", () => {
    expect(src).toContain('href="/app/opportunities"');
  });
});

describe("匹配规则呈现", () => {
  it("视图切换控件存在（aria-pressed 双态）", () => {
    expect(src).toContain('aria-pressed={resultView === "research"}');
    expect(src).toContain('aria-pressed={resultView === "gsc-match"}');
  });

  it("匹配视图沿用 GSC 五态渲染（需登录/未连接/错误/空数据/正常），不伪造数据", () => {
    for (const phase of ['gscState.phase === "needs-login"', 'gscState.phase === "not-connected"', 'gscState.phase === "error"']) {
      // 既有 GSC 机会区 + 匹配视图各渲染一次
      expect(src.split(phase).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it("多落地页全部保留；唯一落地页才带 url 深链（不挑代表页）", () => {
    expect(src).toContain("distinctPages.length === 1 ? distinctPages[0] : null");
    expect(src).toContain('[...new Set(m.pages.map((p) => p.page)');
  });

  it("内容优化深链复用既有 content 路由（keyword + 可选 url）", () => {
    expect(src).toContain("/app/content?keyword=${encodeURIComponent(r.keyword)}${contentUrl ? `&url=${encodeURIComponent(contentUrl)}` : \"\"}");
  });

  it("追踪复用既有 handleTrackFromExpand（真实追踪入口，不新造）", () => {
    expect(src).toContain("onClick={() => handleTrackFromExpand(r.keyword)}");
  });

  it("CSV 与当前筛选一致（导出 matchRows），缺失值为空串不写 0", () => {
    expect(src).toContain("const rows = matchRows.map((r) => {");
    expect(src).toContain('m && m.ctr !== null ? (m.ctr * 100).toFixed(2) : ""');
    expect(src).toContain('m && m.position !== null ? m.position.toFixed(1) : ""');
    expect(src).toContain('m ? m.pages.map((p) => p.page ?? "").filter(Boolean).join(" ; ") : ""');
  });

  it("界面渲染层同样缺失即「—」（不冒充 0）", () => {
    expect(src).toContain('{m ? formatNumber(m.clicks, locale) : "—"}');
    expect(src).toContain('{m && m.ctr !== null ? fmtCtrPct(m.ctr) : "—"}');
    expect(src).toContain('{m && m.position !== null ? fmtPosition(m.position) : "—"}');
  });

  it("SeeO 低 CTR 规则与机会引擎同一基线，且标注非 Google 官方", () => {
    expect(src).toContain("expectedCtrForPosition(Math.ceil(m.position))");
    expect(src).toContain('title={t("matchSeeoLowCtrRule")}');
  });
});

describe("i18n（中英文文案齐全）", () => {
  it("页面用到的 match* 键在 zh/en 两个语言包中都存在且非空", () => {
    for (const file of ["messages/zh.json", "messages/en.json"]) {
      const ns = expandNs(file);
      for (const key of MATCH_KEYS) {
        expect(ns[key], `${file} 缺少 ${key}`).toBeTruthy();
      }
    }
  });

  it("zh/en 键集合一致", () => {
    const zh = expandNs("messages/zh.json");
    const en = expandNs("messages/en.json");
    const zhKeys = Object.keys(zh).filter((k) => k.startsWith("match") || k.startsWith("viewToggle"));
    const enKeys = Object.keys(en).filter((k) => k.startsWith("match") || k.startsWith("viewToggle"));
    expect(new Set(zhKeys)).toEqual(new Set(enKeys));
  });

  it("口径免责文案明确：曝光≠搜索量、位置≠难度、SeeO 规则非 Google 官方", () => {
    const zh = expandNs("messages/zh.json");
    expect(zh.matchScopeNote).toContain("不等于市场搜索量");
    expect(zh.matchScopeNote).toContain("不等于关键词难度");
    expect(zh.matchSeeoLowCtrRule).toContain("非 Google 官方");
    const en = expandNs("messages/en.json");
    expect(en.matchScopeNote).toContain("not market search volume");
    expect(en.matchScopeNote).toContain("not keyword difficulty");
    expect(en.matchSeeoLowCtrRule).toContain("not official Google advice");
  });
});
