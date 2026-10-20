// ===== BUG-001 回归测试：「快速审计」按钮点击无反应 =====
// 根因：print header 在 audit=null（首次加载、SSR 阶段）渲染 new Date().toISOString() 时间文本，
// 服务端渲染时刻与客户端 hydration 时刻必然不同 → hydration mismatch →
// React 18 生产模式丢弃整棵 SSR 树并客户端重新渲染 → 重渲染窗口内页面事件未挂载，
// 点击「快速审计」无网络请求 / 无 DOM 变化 / 无报错（生产 bundle 大 + 慢网络时窗口可达数秒，稳定复现）。
// 修复：print header <h1> 加 suppressHydrationWarning；按钮禁用态补 title 提示（禁用不再静默）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/zh.json", import.meta.url)), "utf-8"));

describe("BUG-001：audit 页 hydration 安全与快速审计按钮反馈", () => {
  it("print header 的 SSR 动态时间（new Date()）必须带 suppressHydrationWarning，防止整树客户端重渲染导致事件窗口期失活", () => {
    const h1Match = PAGE_SRC.match(/<h1[^>]*suppressHydrationWarning[^>]*>/);
    expect(h1Match).toBeTruthy();
    // 该 h1 内确实渲染动态时间（mismatch 风险源）
    const h1Block = PAGE_SRC.slice(PAGE_SRC.indexOf("suppressHydrationWarning"), PAGE_SRC.indexOf("suppressHydrationWarning") + 400);
    expect(h1Block).toContain("formatTime");
    expect(h1Block).toContain("new Date().toISOString()");
  });

  it("「快速审计」按钮绑定 openConfirm('quick')，disabled 条件为 auditing||starting，且禁用时有 title 提示（不静默）", () => {
    const btnMatch = PAGE_SRC.match(
      /<button\s+onClick=\{\(\) => openConfirm\("quick"\)\}\s+disabled=\{auditing \|\| starting\}\s+title=\{auditing \|\| starting \? t\("auditInProgress"\) : undefined\}/
    );
    expect(btnMatch).toBeTruthy();
  });

  it("auditInProgress 提示文案 en/zh 双语齐备", () => {
    expect(typeof EN.dashboard.audit.auditInProgress).toBe("string");
    expect(typeof ZH.dashboard.audit.auditInProgress).toBe("string");
    expect(ZH.dashboard.audit.auditInProgress.length).toBeGreaterThan(0);
    expect(EN.dashboard.audit.auditInProgress.length).toBeGreaterThan(0);
  });

  it("访客注册 CTA 只在审计结果完成后出现（先看到价值，再理解注册用途；不阻断游客流程）", () => {
    // 价值优先：CTA 条件必须是 isGuest && hasResult，不允许回到常驻横幅
    // （抓取失败/unusable 审计没有可保存的结果，追加 !unusableAudit 排除）
    expect(PAGE_SRC).toMatch(/\{isGuest && hasResult && !unusableAudit && \(/);
    // 注册回传必须保留：signupHref 带当前域名回到同一审计页
    expect(PAGE_SRC).toContain('/signup?redirect=');
    expect(PAGE_SRC).toContain("/app/audit?domain=");
  });

  it("打印页眉：域名未确认时不得输出「· 时间」断头（实测无项目时曾渲染「· 2026/10/18 01:31:50」）", () => {
    // 域名来源仍是「审计结果优先，其次当前域名」，但必须先 trim 再判空
    expect(PAGE_SRC).toContain("const printDomain = (audit?.domain ?? domain).trim();");
    const header = PAGE_SRC.slice(
      PAGE_SRC.indexOf("{printDomain"),
      PAGE_SRC.indexOf("{printDomain") + 400
    );
    // 「· 时间」只允许出现在域名非空的分支里
    expect(header).toContain("`");
    expect(header).toContain("printDomain} · ${");
    expect(header).toContain("t(\"printHeaderNoDomain\")");
    // 旧写法（无条件拼「域名 · 时间」）必须消失
    expect(PAGE_SRC).not.toContain("{audit?.domain ?? domain} · {audit ?");
    // 抑制 hydration mismatch 的契约仍在同一元素上
    expect(PAGE_SRC).toMatch(/<h1[^>]*suppressHydrationWarning[^>]*>\s*\{printDomain/);
  });

  it("printHeaderNoDomain 双语齐备且各自语言正确", () => {
    const en = EN.dashboard.audit.printHeaderNoDomain;
    const zh = ZH.dashboard.audit.printHeaderNoDomain;
    expect(typeof en).toBe("string");
    expect(typeof zh).toBe("string");
    expect(en.length).toBeGreaterThan(0);
    expect(zh.length).toBeGreaterThan(0);
    expect(zh).toMatch(/[\u4e00-\u9fff]/);
    expect(en).not.toMatch(/[\u4e00-\u9fff]/);
    expect(en).not.toBe(zh);
  });
});

describe("「保存到报告」快照：coverage 一并写入（防 0/0 回归）", () => {
  it("handleSaveToReports 的 data_json 同时包含 healthScore / issues / coverage", () => {
    // 与 reports/page.tsx 保存链路口径一致：快照带 coverage，
    // 历史预览无需回退重建（回退按全量检查集，与本次审计深度口径不一致）
    const match = PAGE_SRC.match(
      /data_json: JSON\.stringify\(\{([\s\S]*?)\}\),/
    );
    expect(match).toBeTruthy();
    const fields = match![1];
    for (const field of ["healthScore:", "issues:", "coverage:"]) {
      expect(fields).toContain(field);
    }
  });
});

// ===== BUG-04：Tab 高亮 / ?view= 与正文必须一致 =====
// 旧引擎审计（audit.dashboard 为空）由 LegacyResult 呈现，它完全不读 view。
// 此前 Tab 组无条件渲染：点击后 aria-selected 与 URL 都变了，正文一动不动。
// 这里锁住三件事：Tab 组与真实视图能力绑定、每个 Tab 都有会切换正文的分支、
// 选中态与 URL/正文同源（新引擎七个 Tab 行为保持原样）。

const DASHBOARD_BODY = PAGE_SRC.slice(
  PAGE_SRC.indexOf("function RenderDashboard("),
  PAGE_SRC.indexOf("// ===== 旧引擎审计的降级视图")
);

describe("BUG-04：审计结果 Tab 导航与视图能力绑定", () => {
  it("Tab 组的渲染条件必须包含 hasDashboard（旧引擎结果不再出现点击无效的 Tab）", () => {
    expect(PAGE_SRC).toMatch(
      /\{!loading && hasResult && !unusableAudit && hasDashboard && \(\s*<nav[\s\S]{0,220}?role="tablist"/
    );
  });

  it("旧引擎分支仍渲染 LegacyResult + 提示横幅；新引擎分支渲染带 view 的 Dashboard", () => {
    expect(PAGE_SRC).toMatch(/\{hasDashboard \?\s*\(\s*<RenderDashboard audit=\{audit\} view=\{view\}/);
    expect(PAGE_SRC).toMatch(
      /<LegacyResult\s+audit=\{audit\}\s+activeDepth=\{activeDepth\}\s+locale=\{locale\}\s+linkSearch=\{issuesFilters\.search\}\s+linkIssue=\{selectedIssue \?\? undefined\}\s+onClearLink=\{\(\) => navigate\(\{ search: "", issue: "" \}\)\}\s*\/>/
    );
    expect(PAGE_SRC).toMatch(/\{!hasDashboard && \(\s*<div[^>]*>\s*\{t\("legacyAuditNote"\)\}/);
  });

  it("七个 Tab 的每个 key 都对应 RenderDashboard 中一个真实切换正文的分支", () => {
    const keys = [...PAGE_SRC.matchAll(/\{ key: "(\w+)", label: t\("tab\w+"\) \},/g)].map((m) => m[1]);
    expect(keys).toEqual(["overview", "issues", "pages", "linking", "structured", "ai", "history"]);
    for (const key of keys) {
      if (key === "overview") {
        // overview 是兜底分支（无 view 参数时即概览）
        expect(DASHBOARD_BODY).toMatch(/return <AuditOverview/);
      } else {
        expect(DASHBOARD_BODY).toContain(`if (view === "${key}")`);
      }
    }
  });

  it("选中态、URL view 参数与正文共用同一个 view 来源（不允许各读各的）", () => {
    expect(PAGE_SRC).toMatch(/const view = \(searchParams\.get\("view"\) \?\? "overview"\) as ViewKey;/);
    expect(PAGE_SRC).toMatch(/const active = view === tab\.key;/);
    expect(PAGE_SRC).toMatch(/aria-selected=\{active\}/);
    expect(PAGE_SRC).toMatch(/onClick=\{\(\) => navigate\(\{ view: tab\.key \}\)\}/);
    // navigate 写回同一个 view 参数（URL 与选中态同源，刷新后仍一致）
    expect(PAGE_SRC).toMatch(/router\.replace\(`\/app\/audit\?\$\{next\.toString\(\)\}`/);
  });

  it("七个 Tab 文案、tablist 标签与旧引擎提示 en/zh 双语齐备", () => {
    for (const messages of [EN, ZH]) {
      const a = messages.dashboard.audit;
      for (const key of [
        "tabOverview", "tabIssues", "tabPages", "tabLinking", "tabStructured", "tabAi", "tabHistory",
        "navLabel", "legacyAuditNote", "legacyDetailNote",
        "legacyLinkAppliedPage", "legacyLinkAppliedIssue", "legacyLinkMiss", "legacyLinkShowAll",
      ]) {
        expect(typeof a[key]).toBe("string");
        expect(a[key].length).toBeGreaterThan(0);
      }
    }
  });
});

// ===== BUG-46：待办清单深链在旧引擎报告里被静默丢弃 =====
// 实测（1440×900，/app/audit?domain=acme-example.com&view=pages&search=…/blog/2024-launch-notes）：
// 页面标题、健康分与 35 行清单全部渲染，但 search 参数无人读取——既没有过滤，也没有一句说明，
// 用户从「Open the affected page in the audit」点进来，看到的仍是全量清单。

const LEGACY_BODY = PAGE_SRC.slice(PAGE_SRC.indexOf("function LegacyResult({"));

describe("BUG-46：旧引擎报告必须兑现（或如实说明）深链带来的筛选", () => {
  it("LegacyResult 读取 linkSearch / linkIssue 并对同一份 issues 做过滤", () => {
    expect(LEGACY_BODY).toContain("linkSearch?: string;");
    expect(LEGACY_BODY).toContain("linkIssue?: string;");
    expect(LEGACY_BODY).toMatch(/const matched = audit\.issues\.filter\(/);
    expect(LEGACY_BODY).toContain("i.checkId === linkIssue");
    expect(LEGACY_BODY).toContain("i.urls.some((u) => u.toLowerCase().includes(q))");
    // 过滤结果才是表格数据源，不允许再回到 audit.issues
    expect(LEGACY_BODY).toMatch(/const filtered = matched\.length > 0 \? matched : audit\.issues;/);
    expect(LEGACY_BODY).toContain("{filtered.map((issue) =>");
  });

  it("命中 0 条时回退全量并说明原因（不得把「没匹配」演成「没有问题」）", () => {
    expect(LEGACY_BODY).toContain('t("legacyLinkMiss")');
    // 页面链接与检查项链接是两种来源，文案必须分别说清（实测混用会写成「the page you came from」）
    expect(LEGACY_BODY).toMatch(/t\(linkIssue \? "legacyLinkAppliedIssue" : "legacyLinkAppliedPage"/);
    for (const messages of [EN, ZH]) {
      for (const key of ["legacyLinkAppliedPage", "legacyLinkAppliedIssue"]) {
        expect(messages.dashboard.audit[key]).toContain("{n}");
        expect(messages.dashboard.audit[key]).toContain("{total}");
      }
    }
  });

  it("筛选态必须给出退出入口，且清的是 URL 上的同一批参数", () => {
    expect(LEGACY_BODY).toContain("onClearLink");
    expect(LEGACY_BODY).toMatch(/<button onClick=\{onClearLink\}[^>]*>\s*\{t\("legacyLinkShowAll"\)/);
    expect(PAGE_SRC).toMatch(/onClearLink=\{\(\) => navigate\(\{ search: "", issue: "" \}\)\}/);
  });

  it("无深链参数时一行说明都不出现（不给普通访问者加噪声）", () => {
    expect(LEGACY_BODY).toMatch(/const hasLink = q\.length > 0 \|\| !!linkIssue;/);
    expect(LEGACY_BODY).toMatch(/\{hasLink && \(\s*<div/);
  });
});

describe("BUG-14：/api/audit/latest 一次动作只发一次", () => {
  // 域名 effect 与 ?audit= 历史 effect 都会 loadLatest，两者各自记账 → 进入页面
  // 与点「查看」时同一份数据被取两次（页面头注释声明的「无重复请求」并不成立）。
  // 修复：两个 effect 与 handleDomainChange 共用同一把 "domain|auditParam" key。
  it("两个取数 effect 用同一个 lastLoadKey 记账，不再各留一份 ref", () => {
    expect(PAGE_SRC).toContain("const lastLoadKey = useRef<string | null>(null);");
    const claims = PAGE_SRC.match(/lastLoadKey\.current = /g) ?? [];
    // 域名 effect、历史 effect、显式「查看」三处占位
    expect(claims.length).toBe(3);
    expect(PAGE_SRC).not.toContain("lastLoadedAuditRef");
  });

  it("「查看」在显式取数前先把本次 key 记账掉", () => {
    const h = PAGE_SRC.slice(PAGE_SRC.indexOf("const handleDomainChange"), PAGE_SRC.indexOf("await loadLatest(d);"));
    expect(h).toContain("lastLoadKey.current = loadKeyOf(d, searchParams.get(\"audit\"));");
    expect(h).toContain("lastLoadedDomain.current = d;");
  });
});
