// ===== 报表中心「生成报告」的项目范围契约（本阶段遗留缺陷）=====
// 根因：生成逻辑把 /api/reports/stats 的账号级 latestAudit.domain 当成当前项目域名，
// 并在缺失时兜底 "example.com"；排名/周报取无 domain 的 /api/tracking 全量列表，
// 项目名再兜底 "—" / "SeeO"。结果：切到没有审计的项目也会生成别的项目的报告。
// 修复：生成与打印入口共用同一个「已确认当前项目域名」，缺域名时禁用 + 提示；
// 取数一律带 ?domain=；健康分改为按该项目最近一次审计读取。
// 本文件守护接线，断言只针对可执行代码（注释里会出现被禁止的写法作为说明）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

const GEN_START = PAGE_SRC.indexOf("const handleGenerate");
const GEN = PAGE_SRC.slice(GEN_START, PAGE_SRC.indexOf("const handleDownloadPdf"));
const GEN_CODE = GEN
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("生成报告只认已确认的当前项目域名", () => {
  it("缺域名时先中止并提示，不进入取数", () => {
    const guard = GEN_CODE.slice(0, GEN_CODE.indexOf("setGenerating(true)"));
    expect(guard).toContain("reportNeedsProject(selectedType)");
    expect(guard).toContain('show(t("needProjectNotice"), "error");');
    expect(guard).toContain("return;");
  });

  it("排名报表按项目域名取数，项目名就是该域名", () => {
    const ranking = GEN_CODE.slice(GEN_CODE.indexOf('selectedType === "ranking"'), GEN_CODE.indexOf('selectedType === "audit"'));
    expect(ranking).toContain("`/api/tracking?domain=${encodeURIComponent(domain)}`");
    expect(ranking).toContain("projectName: domain,");
    expect(ranking).toContain("domain,");
    expect(ranking).not.toContain("keywords[0]?.domain");
    expect(ranking).not.toContain('fetch("/api/tracking"');
  });

  it("审计报表用当前项目域名取数，不再出现 example.com 兜底", () => {
    const audit = GEN_CODE.slice(GEN_CODE.indexOf('selectedType === "audit"'), GEN_CODE.indexOf('selectedType === "content"'));
    expect(audit).toContain("`/api/audit/latest?domain=${encodeURIComponent(domain)}`");
    expect(audit).not.toContain("example.com");
    expect(audit).not.toContain("stats");
  });

  it("周报的关键词、项目名与健康分全部限定在当前项目", () => {
    const weekly = GEN_CODE.slice(GEN_CODE.indexOf('selectedType === "weekly"'));
    expect(weekly).toContain("`/api/tracking?domain=${encodeURIComponent(domain)}`");
    expect(weekly).toContain("`/api/audit/latest?domain=${encodeURIComponent(domain)}`");
    expect(weekly).toContain("avgScore: projectAudit?.healthScore ?? null,");
    expect(weekly).toContain("projectName: domain,");
    expect(weekly).not.toContain("latestAudit");
    expect(weekly).not.toContain('?? "SeeO"');
  });

  it("整段生成逻辑不再读取账号级 stats.latestAudit，也没有任何默认域名兜底", () => {
    expect(GEN_CODE).not.toContain("latestAudit");
    expect(GEN_CODE).not.toContain('?? "example.com"');
    expect(GEN_CODE).not.toContain('?? "—"');
    expect(GEN_CODE).not.toContain('?? "SeeO"');
  });

  it("内容报表仍按被检测 URL 取数，未被强行套上项目域名", () => {
    const content = GEN_CODE.slice(GEN_CODE.indexOf('selectedType === "content"'), GEN_CODE.indexOf('selectedType === "weekly"'));
    expect(content).toContain("fetch(\"/api/content/check?limit=1\"");
    expect(content).toContain("projectName: r.url,");
    expect(content).not.toContain("domain");
  });
});

describe("生成入口的禁用与提示", () => {
  const UI = PAGE_SRC.slice(PAGE_SRC.indexOf("<div className=\"mt-4 flex flex-col items-end gap-2\">"), PAGE_SRC.indexOf("{/* CSV 快速导出 */}"));

  it("按钮在项目未确认时禁用（内容报表除外）", () => {
    expect(UI).toContain("disabled={generating || (reportNeedsProject(selectedType) && !projectDomain)}");
  });

  it("确认无可用项目时给出本地化提示，而不是静默禁用", () => {
    expect(UI).toContain("{reportNeedsProject(selectedType) && projectResolved && !projectDomain && (");
    expect(UI).toContain('{t("needProjectNotice")}');
  });

  it("提示文案在中英文目录都存在（不出现半英半中）", () => {
    const en = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/en.json", import.meta.url)), "utf-8"));
    const zh = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/zh.json", import.meta.url)), "utf-8"));
    expect(en.dashboard.reportsPage.needProjectNotice).toBeTruthy();
    expect(zh.dashboard.reportsPage.needProjectNotice).toBeTruthy();
  });
});

describe("打印入口与生成入口共用同一份项目状态", () => {
  it("只有一个 projectDomain 状态源，未另建第二套项目选择机制", () => {
    expect(PAGE_SRC.match(/useState<string \| null>\(null\)/g)?.length).toBe(1);
    expect(PAGE_SRC).toContain("const printReportHref = buildAuditReportHref(projectDomain)");
    expect(PAGE_SRC).not.toContain("printDomain");
  });

  it("域名解析失败时清除旧值，避免切换项目失败后继续用上一个项目", () => {
    const effect = PAGE_SRC.slice(PAGE_SRC.indexOf("const [projectDomain"), GEN_START);
    const failurePaths = [
      effect.slice(effect.indexOf("if (!json.ok) {"), effect.indexOf("const list =")),
      effect.slice(effect.indexOf("} catch {")),
    ];
    for (const block of failurePaths) {
      expect(block).toContain("setProjectDomain(null);");
    }
  });
});
