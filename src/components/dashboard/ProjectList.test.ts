// ===== 项目删除安全性测试 =====
// 背景：删除事故（操作方点错卡片越过弹窗校验误删 example.com）。
// 防线：①垃圾桶按钮闭包绑定项目对象 ②弹窗显示 name/domain/完整 UUID
// ③确认按钮把 deleteTarget 显式传给 handleDelete ④canSubmitDelete 发请求前校验。
// 测试框架限制：无 @testing-library/react，按仓库惯例采用「纯函数单测 + 源码契约断言」。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canSubmitDelete } from "@/lib/delete-guard";

const SRC = readFileSync(fileURLToPath(new URL("./ProjectList.tsx", import.meta.url)), "utf-8");

const UUID_A = "0db5a114-adf0-4f24-917a-275ed19b6397"; // www.toolstep.top
const UUID_B = "16ceec1d-77fa-4921-867c-ec58711311c6"; // toolstep.xyz
const UUID_C = "3beb1efb-4592-46c8-afbb-e144b4a09910"; // example.com

describe("canSubmitDelete（发请求前最后一道防线）", () => {
  it("合法 UUID target（A/B/C 三项目）均允许", () => {
    expect(canSubmitDelete({ id: UUID_A, domain: "www.toolstep.top" })).toBe(true);
    expect(canSubmitDelete({ id: UUID_B, domain: "toolstep.xyz" })).toBe(true);
    expect(canSubmitDelete({ id: UUID_C, domain: "example.com" })).toBe(true);
  });

  it("演示模式整数 id（string）允许", () => {
    expect(canSubmitDelete({ id: "3", domain: "example.com" })).toBe(true);
  });

  it("deleteTarget 为 null/undefined/非对象 → 拒绝（不存在 deleteTarget 时不能 DELETE）", () => {
    expect(canSubmitDelete(null)).toBe(false);
    expect(canSubmitDelete(undefined)).toBe(false);
    expect(canSubmitDelete("not-an-object" as unknown as { id?: unknown })).toBe(false);
    expect(canSubmitDelete({})).toBe(false);
  });

  it("id 被篡改为 number（含历史 id=0）→ 拒绝", () => {
    expect(canSubmitDelete({ id: 0, domain: "toolstep.xyz" })).toBe(false);
    expect(canSubmitDelete({ id: 123, domain: "toolstep.xyz" })).toBe(false);
    expect(canSubmitDelete({ id: Number(UUID_B), domain: "toolstep.xyz" })).toBe(false); // NaN
  });

  it("id 格式非法（'0'/空串/乱串/带注入字符）→ 拒绝", () => {
    expect(canSubmitDelete({ id: "0", domain: "toolstep.xyz" })).toBe(false); // 旧遗留值：非 UUID 也非 SQLite 路径合法业务 id，交由列表匹配防线，此处拒绝防直提交
    expect(canSubmitDelete({ id: "", domain: "toolstep.xyz" })).toBe(false);
    expect(canSubmitDelete({ id: "16ceec1d-77fa-4921-867c-ec58711311c6&other=1", domain: "x.com" })).toBe(false);
    expect(canSubmitDelete({ id: "not-a-uuid", domain: "toolstep.xyz" })).toBe(false);
  });

  it("domain 缺失/空串/非 string → 拒绝（domain 与 id 必须同时存在）", () => {
    expect(canSubmitDelete({ id: UUID_B })).toBe(false);
    expect(canSubmitDelete({ id: UUID_B, domain: "" })).toBe(false);
    expect(canSubmitDelete({ id: UUID_B, domain: "   " })).toBe(false);
    expect(canSubmitDelete({ id: UUID_B, domain: 42 })).toBe(false);
  });
});

describe("ProjectList 源码契约（映射/绑定/独立性，防回归）", () => {
  it("① 垃圾桶按钮闭包绑定当前项目：onClick={() => setDeleteTarget(p)}（map 内一一对应，非视觉位置推断）", () => {
    expect(SRC).toContain("onClick={() => setDeleteTarget(p)}");
  });

  it("② React key 使用真实项目 id（UUID），非数组 index", () => {
    expect(SRC).toMatch(/key=\{p\.id\}/);
    expect(SRC).not.toMatch(/key=\{(?:idx|index|i)\}/);
  });

  it("③ 弹窗显示 name + domain + 完整 UUID（UUID 与 DELETE ?id= 同源 deleteTarget）", () => {
    // i18n 后确认文案走 message catalog：deleteConfirm ICU 变量直接绑定 deleteTarget 字段
    expect(SRC).toContain('t("deleteConfirm", { name: deleteTarget?.name ?? "", domain: deleteTarget?.domain ?? "" })');
    expect(SRC).toContain("ID: {deleteTarget?.id}");
    // zh catalog 中 deleteConfirm/deleteId 必须包含 name/domain/id 占位（保证弹窗仍显示完整信息）
    const zh = JSON.parse(readFileSync(fileURLToPath(new URL("../../../messages/zh.json", import.meta.url)), "utf-8"));
    expect(zh.dashboard.projectList.deleteConfirm).toContain("{name}");
    expect(zh.dashboard.projectList.deleteConfirm).toContain("{domain}");
    expect(zh.dashboard.projectList.deleteId).toContain("{id}");
  });

  it("④ 确认按钮显式传 deleteTarget 给 handleDelete（与弹窗显示同一对象）", () => {
    expect(SRC).toContain("onClick={() => deleteTarget && handleDelete(deleteTarget)}");
  });

  it("⑤ handleDelete 参数化接收 target，DELETE 只用 target.id 且经 encodeURIComponent", () => {
    expect(SRC).toMatch(/handleDelete = async \(target: ProjectWithMetrics\)/);
    expect(SRC).toContain("id=${encodeURIComponent(target.id)}");
  });

  it("⑥ 发请求前调用 canSubmitDelete 校验，非法时 toast 报错且不发 DELETE", () => {
    expect(SRC).toContain("if (!canSubmitDelete(target))");
    expect(SRC).toContain('show(t("deleteGuardFailed"), "error")');
  });

  it("⑦ 确认按钮 disabled 条件含 canSubmitDelete(deleteTarget)", () => {
    expect(SRC).toContain("disabled={deleting || !canSubmitDelete(deleteTarget)}");
  });

  it("⑧ selectedProjectId / localStorage 与删除链路完全独立（handleDelete 不引用 selected/存储）", () => {
    const fnBody = SRC.slice(SRC.indexOf("handleDelete = async"), SRC.indexOf("const handleDelete") + 800);
    expect(fnBody).not.toMatch(/selected|localStorage|SELECTED_PROJECT_KEY/);
  });

  it("⑨ 删除成功：清空 deleteTarget + toast（含被删 domain）+ router.refresh()（列表刷新）", () => {
    expect(SRC).toContain("setDeleteTarget(null);");
    expect(SRC).toContain('show(t("deletedToast", { domain: target.domain }), "success")');
    expect(SRC.indexOf("router.refresh()")).toBeGreaterThan(SRC.indexOf("handleDelete = async"));
  });

  it("⑩ 删除失败（!res.ok）：toast 错误 + 不清空/不 refresh（列表保持）", () => {
    const deleteStart = SRC.indexOf("handleDelete = async");
    const failPos = SRC.indexOf("if (!res.ok)", deleteStart);
    const failBranch = SRC.slice(failPos, SRC.indexOf("return;", failPos));
    expect(failBranch).toContain("show(data.error");
    expect(failBranch).not.toContain("router.refresh()");
    expect(failBranch).not.toContain("setDeleteTarget(null)");
  });

  it("⑪ 项目 id 全程 string：ProjectWithMetrics.id 由 @/lib/db 类型保证（string），本文件无 Number()/parseInt()", () => {
    expect(SRC).not.toMatch(/Number\(|parseInt\(/);
  });

  it("⑫ 卡片 Link href 使用 p.id（真实 UUID 进 URL），删除按钮与 Link 为兄弟节点（无嵌套误触发）", () => {
    expect(SRC).toContain('href={`/app/projects/${p.id}`}');
    // 按钮在 Link 之前闭合，二者不存在 <button><Link> 嵌套（i18n 后 aria-label 走 t()）
    const btnPos = SRC.indexOf('aria-label={t("deleteProject")}');
    const linkPos = SRC.indexOf('href={`/app/projects/${p.id}`}');
    expect(btnPos).toBeGreaterThan(-1);
    expect(linkPos).toBeGreaterThan(-1);
  });
});
