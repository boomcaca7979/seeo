// ===== Reports 页快照 coverage 契约（源码级断言）=====
// 背景 bug：历史报告预览"检查项覆盖（0/0 通过）"。
// 根因：保存快照只存 {healthScore, issues} 丢弃 coverage；预览旧快照时
// coverage 回退空数组。修复：保存时带 coverage；旧快照预览时用
// buildCoverageFromIssues 从 issues（checkId）按当前 locale 重建。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("page.tsx", import.meta.url)),
  "utf-8"
);

describe("保存快照：coverage 一并写入", () => {
  it("audit 类型快照的 dataJson 包含 coverage 字段", () => {
    expect(src).toMatch(/dataJson = JSON\.stringify\(\{[\s\S]*?coverage:/);
  });

  it("快照同时保存 domain / healthScore / issues / coverage", () => {
    const match = src.match(
      /dataJson = JSON\.stringify\(\{([\s\S]*?)\}\);/
    );
    expect(match).toBeTruthy();
    const fields = match![1];
    for (const field of ["domain:", "healthScore:", "issues:", "coverage:"]) {
      expect(fields).toContain(field);
    }
  });
});

describe("预览历史快照：缺失 coverage 时重建", () => {
  it("优先使用快照自带的 coverage（非空数组）", () => {
    expect(src).toContain("Array.isArray(data.coverage) && data.coverage.length > 0");
  });

  it("旧快照回退 buildCoverageFromIssues（按 checkId 与 locale 重建）", () => {
    expect(src).toMatch(/buildCoverageFromIssues\(/);
    expect(src).toMatch(/localizedIssues\.map\(\(i: \{ checkId: string \}\) => i\.checkId\)/);
  });
});

describe("R1：历史快照跨语言预览按当前 locale 重新本地化", () => {
  it("快照自带的 coverage 按 id → checkMetaMap/nonCatalogCheckNames 重新输出当前 locale 名称", () => {
    // 不得原样使用快照 coverage（保存时 locale 的 name）
    expect(src).toContain("checkMetaMap[cid]");
    expect(src).toContain("pickText(meta.name, locale)");
    expect(src).toContain("nonCatalogCheckNames[cid]");
  });

  it("未知 coverage id 回退快照原 name（历史兼容，不返回空白）", () => {
    expect(src).toContain("c.name ?? cid");
  });

  it("issues 补 type（checkId 机器值）：AuditReport 用 type 查 catalog，不回退保存时 checkName", () => {
    expect(src).toContain("type: i.type ?? i.checkId");
    expect(src).toContain("checkId: i.checkId ?? i.type");
  });

  it("detail/suggestion 读取层经 resolver 双向映射（跨语言快照回读）", () => {
    expect(src).toContain("resolveAuditDetail(i.detail ?? \"\", locale)");
    expect(src).toContain("resolveAuditSuggestion(i.suggestion, locale)");
  });
});
