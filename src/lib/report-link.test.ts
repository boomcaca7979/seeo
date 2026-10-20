// ===== BUG-07 回归测试：打印版报告链接的域名确认与构建 =====
// 覆盖实际链接生成条件（不只是字符串存在）：
//   已确认当前项目 → 携带该项目的 domain；
//   项目切换 → 采用切换后的项目，而不是列表第一个；
//   未确认 / id 未命中 / 域名空白 / 列表缺失 → null，链接保持无参数，绝不拼造域名。

import { describe, it, expect } from "vitest";
import {
  AUDIT_REPORT_PATH,
  buildAuditReportHref,
  reportNeedsProject,
  resolveProjectDomain,
  type ProjectDomainRef,
} from "./report-link";

const PROJECTS: ProjectDomainRef[] = [
  { id: "13", domain: "acme-example.com" },
  { id: "15", domain: "www.toolstep.top" },
  { id: "17", domain: "example.com" },
];

describe("BUG-07：resolveProjectDomain 按 id 命中当前项目域名", () => {
  it("命中的是选中 id 对应的域名，而不是列表第一项", () => {
    expect(resolveProjectDomain(PROJECTS, "15")).toBe("www.toolstep.top");
    expect(resolveProjectDomain(PROJECTS, "13")).toBe("acme-example.com");
  });

  it("项目切换后返回切换后的项目域名（两阶段：13 → 17）", () => {
    const before = resolveProjectDomain(PROJECTS, "13");
    const after = resolveProjectDomain(PROJECTS, "17");
    expect(before).toBe("acme-example.com");
    expect(after).toBe("example.com");
    expect(after).not.toBe(before);
  });

  it("id 未命中（已删除 / 跨账号残留 / 过期 localStorage）返回 null，不回退列表第一个", () => {
    expect(resolveProjectDomain(PROJECTS, "9999")).toBeNull();
  });

  it("没有选中项目或 id 为空返回 null", () => {
    expect(resolveProjectDomain(PROJECTS, null)).toBeNull();
    expect(resolveProjectDomain(PROJECTS, "")).toBeNull();
  });

  it("列表缺失（拉取失败）或域名空白返回 null", () => {
    expect(resolveProjectDomain(null, "13")).toBeNull();
    expect(resolveProjectDomain(undefined, "13")).toBeNull();
    expect(resolveProjectDomain([], "13")).toBeNull();
    expect(resolveProjectDomain([{ id: "13", domain: "   " }], "13")).toBeNull();
    expect(resolveProjectDomain([{ id: "13", domain: "" }], "13")).toBeNull();
  });

  it("域名两侧空白被清理后再采用", () => {
    expect(resolveProjectDomain([{ id: "13", domain: "  acme-example.com  " }], "13")).toBe("acme-example.com");
  });
});

describe("BUG-07：buildAuditReportHref 仅在域名已确认时追加 ?domain=", () => {
  it("已确认域名 → 携带该域名的报告页链接", () => {
    expect(buildAuditReportHref("acme-example.com")).toBe(`${AUDIT_REPORT_PATH}?domain=acme-example.com`);
  });

  it("未确认域名 → 保持无参数链接，不拼造任何默认域名", () => {
    const href = buildAuditReportHref(null);
    expect(href).toBe("/app/reports/audit");
    expect(href).not.toContain("domain=");
    expect(href).not.toMatch(/seeo\.asia|example\.com|toolstep|localhost/);
  });

  it("空白域名同样视为未确认", () => {
    expect(buildAuditReportHref("   ")).toBe(AUDIT_REPORT_PATH);
  });

  it("域名经 URL 编码，避免注入额外查询参数", () => {
    expect(buildAuditReportHref("a&b.com")).toBe(`${AUDIT_REPORT_PATH}?domain=a%26b.com`);
    expect(buildAuditReportHref("中文.测试")).toBe(`${AUDIT_REPORT_PATH}?domain=${encodeURIComponent("中文.测试")}`);
  });
});

describe("BUG-07：从项目上下文到链接的端到端条件", () => {
  it("命中项目：解析结果直接进入链接且只出现一次 domain 参数", () => {
    const href = buildAuditReportHref(resolveProjectDomain(PROJECTS, "15"));
    expect(href).toBe("/app/reports/audit?domain=www.toolstep.top");
    const search = new URL(`http://localhost${href}`).searchParams;
    expect(search.get("domain")).toBe("www.toolstep.top");
    expect([...search.keys()]).toEqual(["domain"]);
  });

  it("未命中项目：链接不含 domain，交由报告页既有优先级处理", () => {
    const href = buildAuditReportHref(resolveProjectDomain(PROJECTS, "9999"));
    expect(new URL(`http://localhost${href}`).searchParams.get("domain")).toBeNull();
  });
});

describe("报表类型是否需要「当前项目」", () => {
  it("排名 / 审计 / 周报按项目取数，内容报表按被检测 URL", () => {
    expect(reportNeedsProject("ranking")).toBe(true);
    expect(reportNeedsProject("audit")).toBe(true);
    expect(reportNeedsProject("weekly")).toBe(true);
    expect(reportNeedsProject("content")).toBe(false);
  });

  it("需要项目的报表在没有已确认域名时拼不出任何域名参数", () => {
    for (const unusable of [null, "", "   "]) {
      expect(buildAuditReportHref(unusable)).toBe(AUDIT_REPORT_PATH);
    }
    expect(buildAuditReportHref(resolveProjectDomain(PROJECTS, null))).toBe(AUDIT_REPORT_PATH);
  });
});
