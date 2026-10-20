// ===== BUG-07 回归测试：报告中心「浏览器打印版报告」入口的域名来源 =====
// 根因：入口写成 <Link href="/app/reports/audit">，不带当前项目域名，
// 报告页按「URL ?domain= > localStorage > 空状态」优先级取数时拿不到可信域名 → 无报告内容。
// 修复：从 Topbar 同源的项目上下文（localStorage 选中 id + 同 tab 切换事件）取 id，
// 在 /api/projects 结果中命中域名后交由 @/lib/report-link 构建链接；未确认则保持无参数。
// 本文件守护「接线」：链接必须由上下文解析结果生成，且不得使用用户级数据或硬编码域名。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

const EFFECT = PAGE_SRC.slice(
  PAGE_SRC.indexOf("const [projectDomain"),
  PAGE_SRC.indexOf("const handleDownloadCsv")
);

describe("BUG-07：报告中心入口链接的构建接线", () => {
  it("打印版报告入口使用受上下文控制的变量，而不是无参数的硬编码 href", () => {
    expect(EFFECT).toContain("const printReportHref = buildAuditReportHref(projectDomain)");
    const link = PAGE_SRC.slice(
      PAGE_SRC.indexOf("{t(\"metaPrintView\")}") - 400,
      PAGE_SRC.indexOf("{t(\"metaPrintView\")}") + 60
    );
    expect(link).toContain("href={printReportHref}");
    expect(link).not.toContain('href="/app/reports/audit"');
  });

  it("当前项目取自 Topbar 同源机制：共享常量与事件解析，禁止重复声明 key/事件名", () => {
    expect(PAGE_SRC).toContain('from "@/lib/project-selector"');
    expect(EFFECT).toContain("SELECTED_PROJECT_KEY");
    expect(EFFECT).toContain("PROJECT_CHANGED_EVENT");
    expect(EFFECT).toContain("projectChangedDetail(e)");
    expect(EFFECT).toContain('window.addEventListener("storage"');
    expect(EFFECT).not.toContain('"seeo:selected-project-id"');
    expect(EFFECT).not.toContain('"seeo:project-changed"');
  });

  it("域名必须按选中 id 在项目列表中命中后才写入链接（未确认保持 null）", () => {
    expect(EFFECT).toContain("setProjectDomain(resolveProjectDomain(");
    expect(EFFECT).toContain("loadProjectList()");
    expect(EFFECT).toContain("useState<string | null>(null)");
    // 过期响应与已卸载实例的结果都不写状态
    expect(EFFECT).toContain("if (cancelled || my !== seq) return;");
    expect(EFFECT).not.toMatch(/setProjectDomain\(\s*"/);
  });

  it("拉取失败不得保留上一个项目的域名（切换项目时避免串数据）", () => {
    const failurePaths = [
      EFFECT.slice(EFFECT.indexOf("if (!json.ok) {"), EFFECT.indexOf("const list =")),
      EFFECT.slice(EFFECT.indexOf("} catch {")),
    ];
    for (const block of failurePaths) {
      expect(block).toContain("setProjectDomain(null);");
      expect(block).not.toContain("resolveProjectDomain(list");
    }
  });

  it("禁止把用户级最近审计或硬编码域名当作当前项目数据源", () => {
    // stats.latestAudit 是用户范围（getGlobalLatestAudit），不代表当前项目
    expect(EFFECT).not.toContain("latestAudit");
    // 生成逻辑同样只认已确认域名（注释会解释「为什么不用 latestAudit」，故只查可执行代码）
    const generate = PAGE_SRC
      .slice(PAGE_SRC.indexOf("const handleGenerate"), PAGE_SRC.indexOf("const handleDownloadPdf"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(generate).not.toContain("latestAudit");
    expect(generate).not.toContain("stats");
    expect(EFFECT).not.toMatch(/seeo\.asia|acme-example\.com|toolstep/);
    expect(EFFECT).not.toContain('localStorage.getItem("seeo:last-audit-domain")');
  });

  it("保留既有导出与打印能力入口，未被本次修复改写", () => {
    expect(PAGE_SRC).toContain('fetch(`/api/reports/${type}`');
    expect(PAGE_SRC).toContain("handleDownloadCsv");
  });
});
