// ===== BUG-002 回归测试：Settings「编辑」按钮在生产 auth-enabled 环境误显演示模式提示 =====
// 根因：编辑按钮无条件调用 show(t("editDemoToast"))，生产真实用户点击后看到
//「当前为演示模式，编辑功能将在接入后端后开放」，且无任何真实编辑能力。
// 修复：按 isAuthEnabled 分支——
//   auth-enabled：进入真实编辑流程（Supabase Auth updateUser 持久化 user_metadata.display_name，
//                 即页面 displayName 的数据源，非伪造 API）；
//   demo / auth-disabled：保留原 editDemoToast 提示（demo 兼容不变）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/zh.json", import.meta.url)), "utf-8"));

describe("BUG-002：Settings 编辑按钮 auth/demo 分支", () => {
  it("editDemoToast 只允许出现在 !isAuthEnabled（demo）分支内，禁止无条件绑定到编辑按钮", () => {
    // 旧的 BUG 写法：onClick={() => show(t("editDemoToast"), "info")} 直接绑定按钮
    expect(PAGE_SRC).not.toContain('onClick={() => show(t("editDemoToast"), "info")}');

    // demo 提示必须位于 startEditAccount 的 !isAuthEnabled 守卫内
    const handler = PAGE_SRC.slice(
      PAGE_SRC.indexOf("const startEditAccount"),
      PAGE_SRC.indexOf("const saveDisplayName")
    );
    expect(handler).toContain("if (!isAuthEnabled)");
    expect(handler).toContain('show(t("editDemoToast"), "info")');
    expect(handler).toContain("return;");
    // auth-enabled 分支进入编辑模式
    expect(handler).toContain("setEditingAccount(true)");
  });

  it("auth-enabled 环境实现真实编辑：调用 Supabase Auth updateUser 持久化 display_name（非伪造 API）", () => {
    const save = PAGE_SRC.slice(
      PAGE_SRC.indexOf("const saveDisplayName"),
      PAGE_SRC.indexOf("// P3：从 /api/account/usage")
    );
    expect(save).toContain("supabase.auth.updateUser");
    expect(save).toContain("display_name: name");
    // 成功后同步本地状态并退出编辑
    expect(save).toContain("setAccount({ ...account, displayName: name })");
    expect(save).toContain('show(t("editSaved"), "success")');
    // 空名称禁止保存（按钮 disabled + handler 双保险）
    expect(save).toContain("if (!name || !account) return;");
    expect(PAGE_SRC).toContain("disabled={!editName.trim() || savingName}");
    // 取消按钮存在且受 savingName 保护
    expect(PAGE_SRC).toMatch(/onClick=\{\(\) => setEditingAccount\(false\)\}\s+disabled=\{savingName\}/);
  });

  it("i18n：editSave / editSaved 双语齐备，editDemoToast 保留（demo 兼容）", () => {
    for (const msg of [EN, ZH]) {
      const s = msg.dashboard.settings;
      expect(typeof s.editSave).toBe("string");
      expect(s.editSave.length).toBeGreaterThan(0);
      expect(typeof s.editSaved).toBe("string");
      expect(s.editSaved.length).toBeGreaterThan(0);
      expect(typeof s.editDemoToast).toBe("string"); // demo 模式文案不删除
      expect(typeof s.edit).toBe("string");
    }
  });
});
