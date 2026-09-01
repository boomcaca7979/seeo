// ===== Phase 2.3 回归测试（P0-1 / P1-1 ~ P1-7 源码契约） =====
// P0-1：page.tsx 必须读回 rule / pageType，否则 IssuesCenter 的 Rule/PageType 筛选静默失效。
// P1-1：Issue Detail → Pages 携带 issue=<ruleId> 上下文。
// P1-3：Crawled Pages 全部筛选 URL 驱动。
// P1-4：New badge 来自 comparison.newIssues（禁止按时间猜测）。
// P1-5：轮询用 /api/audit/status；完成后无重复 latest 请求。
// P1-6：Header 单一口径。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const ISSUES_SRC = readFileSync(fileURLToPath(new URL("../../../../../components/audit/IssuesCenter.tsx", import.meta.url)), "utf-8");
const PAGES_SRC = readFileSync(fileURLToPath(new URL("../../../../../components/audit/CrawledPages.tsx", import.meta.url)), "utf-8");
const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/zh.json", import.meta.url)), "utf-8"));

describe("P0-1：Issues 页 Rule / PageType 过滤器读回", () => {
  it("page.tsx 的 issuesFilters 提取 rule 与 pageType URL 参数", () => {
    const m = PAGE_SRC.match(/const issuesFilters = \{([\s\S]*?)\};/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('rule: searchParams.get("rule")');
    expect(m![1]).toContain('pageType: searchParams.get("pageType")');
  });

  it("IssuesCenter 的过滤逻辑消费 filters.rule 与 filters.pageType", () => {
    expect(ISSUES_SRC).toContain("filters.rule && r.ruleId !== filters.rule");
    expect(ISSUES_SRC).toContain('if (filters.pageType)');
  });

  it("Clear filters 显式清空 rule / pageType / severity / category / search / sort / group", () => {
    const m = ISSUES_SRC.match(/hasFilters \? \(\s*<button onClick=\{\(\) => onNavigate\((\{[^}]*\})\)\}/);
    expect(m).toBeTruthy();
    for (const k of ["severity", "category", "search", "sort", "group", "rule", "pageType"]) {
      expect(m![1]).toContain(`${k}: ""`);
    }
  });

  it("单选 select 清空时传空值（合并语义下空值删除参数，而非仅切 view）", () => {
    // 修复前：onNavigate(e.target.value ? {..., rule: v} : { view: "issues" }) —— 清空时参数残留
    expect(ISSUES_SRC).toMatch(/onChange=\{\(e\) => onNavigate\(\{ view: "issues", rule: e\.target\.value \}\)\}/);
    expect(ISSUES_SRC).toMatch(/onChange=\{\(e\) => onNavigate\(\{ view: "issues", pageType: e\.target\.value \}\)\}/);
    expect(ISSUES_SRC).toMatch(/onChange=\{\(e\) => onNavigate\(\{ view: "issues", severity: e\.target\.value \}\)\}/);
  });
});

describe("P1-1：Issue → Pages 钻取上下文", () => {
  it("Issue Detail 的 onOpenPages 携带 issue=<ruleId>", () => {
    expect(ISSUES_SRC).toContain('onNavigate({ view: "pages", issue: selected.ruleId })');
  });

  it("CrawledPages 支持按 issue（ruleId）过滤受影响页面，且显示活动 chip 可清除", () => {
    expect(PAGES_SRC).toContain('filters.issue ? snapshot.rules.find((r) => r.ruleId === filters.issue)');
    expect(PAGES_SRC).toContain("snapshot.findings.filter((f) => f.ruleId === filters.issue)");
    expect(PAGES_SRC).toContain('onNavigate({ issue: "" })');
    expect(PAGES_SRC).toContain("issueFilterChip");
  });

  it("pagesFilters 读回 issue 参数", () => {
    const m = PAGE_SRC.match(/const pagesFilters = \{([\s\S]*?)\};/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('issue: searchParams.get("issue")');
  });
});

describe("P1-3：Crawled Pages 筛选状态全 URL 化", () => {
  it("page.tsx pagesFilters 提取 pageType / severity / search / sort / dir", () => {
    const m = PAGE_SRC.match(/const pagesFilters = \{([\s\S]*?)\};/);
    expect(m).toBeTruthy();
    for (const k of ["pageType", "severity", "search", "sort", "dir"]) {
      expect(m![1]).toContain(`${k}: searchParams.get("${k}")`);
    }
  });

  it("CrawledPages 不再使用 initialHealth / initialStatus / initialDepth / initialSdStatus props（URL 单一来源）", () => {
    expect(PAGES_SRC).not.toContain("initialHealth");
    expect(PAGES_SRC).not.toContain("initialStatus");
    expect(PAGES_SRC).not.toContain("initialDepth");
    expect(PAGES_SRC).not.toContain("initialSdStatus");
  });

  it("搜索为本地输入 + debounce 写 URL（非每键一次路由写入选 filter）", () => {
    expect(PAGES_SRC).toContain("SEARCH_DEBOUNCE_MS");
    expect(PAGES_SRC).toMatch(/onNavigate\(\{ search: v \}\)/);
  });
});

describe("P1-4：New issue 行级 badge（仅来自历史对比）", () => {
  it("page.tsx 从 comparison.newIssues 构造 newRuleIds 传入 IssuesCenter", () => {
    expect(PAGE_SRC).toContain("audit.comparison?.newIssues");
    expect(PAGE_SRC).toContain("newRuleIds={newRuleIds}");
  });

  it("IssuesCenter 接收 newRuleIds 并在行级与 Detail 头部渲染 New badge", () => {
    expect(ISSUES_SRC).toContain("newRuleIds?.has(r.ruleId)");
    expect(ISSUES_SRC).toContain("newRuleIds?.has(selected.ruleId)");
    expect(ISSUES_SRC).toContain('t("newIssueBadge")');
  });
});

describe("P1-5：轮询走轻量 status 端点 + 无重复请求", () => {
  it("运行期轮询 /api/audit/status?id= 而非 latest", () => {
    expect(PAGE_SRC).toContain("`/api/audit/status?id=${auditId}`");
    expect(PAGE_SRC).toContain("json.data.auditId");
  });

  it("完成后仅一次 loadLatest，无额外 finalRes 重复 fetch", () => {
    expect(PAGE_SRC).toContain("const finalAudit = await loadLatest(domain);");
    expect(PAGE_SRC).not.toContain("finalRes");
  });
});

describe("P1-6：Header 单一口径", () => {
  it("V2 展示 dashboard.pagesCrawled，legacy 才读 audit.pagesCrawled，不再双字段拼接", () => {
    expect(PAGE_SRC).toContain("audit.dashboard ? audit.dashboard.pagesCrawled : audit.pagesCrawled");
    expect(PAGE_SRC).not.toMatch(/\{audit\.pagesCrawled\}\s*\{audit\.dashboard \? ` \/ \$\{audit\.dashboard\.pagesCrawled\}`/);
  });
});

describe("P1-7：Advanced filters 分层（能力不减、URL 状态保留）", () => {
  it("Rule / PageType / Sort / Group 位于 advancedOpen 面板内，Primary 行保留 Severity / Category / Search", () => {
    expect(ISSUES_SRC).toContain("advancedOpen");
    expect(ISSUES_SRC).toMatch(/const \[advancedOpen, setAdvancedOpen\] = useState/);
  });

  it("advanced 筛选活动时默认展开（用户看得见生效条件）", () => {
    expect(ISSUES_SRC).toContain("useState(!!(filters.rule || filters.pageType))");
  });
});

describe("新增 i18n 键双语齐备", () => {
  const KEYS = [
    "advancedFilters",
    "newIssueBadge",
    "issueFilterChip",
    "clearIssueFilter",
    "pageSummarySection",
    "crawlLinksSection",
    "sdSemanticSection",
  ] as const;
  for (const k of KEYS) {
    it(`dashboard.audit.${k} 存在于 en / zh`, () => {
      expect(typeof EN.dashboard.audit[k]).toBe("string");
      expect(typeof ZH.dashboard.audit[k]).toBe("string");
      expect((EN.dashboard.audit[k] as string).length).toBeGreaterThan(0);
      expect((ZH.dashboard.audit[k] as string).length).toBeGreaterThan(0);
    });
  }
});
