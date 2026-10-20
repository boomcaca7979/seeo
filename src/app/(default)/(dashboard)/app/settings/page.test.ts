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

// ===== BUG-06：订阅状态显示名（同一页面，另起一组）=====
describe("BUG-06：Settings 用量卡片不再回显原始枚举", () => {
  it("状态文案必须经 subscriptionStatusLabel(locale) 映射，禁止把 usageData.subscriptionStatus 直接插进句子", () => {
    expect(PAGE_SRC).toContain("subscriptionStatusLabel(usageData.subscriptionStatus, locale)");
    expect(PAGE_SRC).toContain('t("currentStatusLine", { plan: currentPlanName, status: currentStatusName })');
    expect(PAGE_SRC).not.toMatch(/status: usageData\.subscriptionStatus\s*\}/);
  });

  it("套餐名与用量口径未受影响：仍用 planLabel 与 API 原始 usage 字段", () => {
    expect(PAGE_SRC).toContain("planLabel(usageData.plan, locale)");
    expect(PAGE_SRC).toContain('const currentStatusName = subscriptionStatusLabel(usageData.subscriptionStatus, locale);');
    // 用量进度条仍逐项读 API 返回值，没有被状态改动波及
    expect(PAGE_SRC).toContain("usageData.usage[item.key]");
    for (const key of ["serpapi", "dataforseo", "content_check", "audit"]) {
      expect(PAGE_SRC).toContain(`key: "${key}" as const`);
    }
  });

  it("四个既有标签（账号/套餐/用量/自动化）保持完整，状态行仍只在用量卡片出现一次", () => {
    for (const key of ["tabAccount", "tabPlan", "tabUsage", "tabAutomation"]) {
      expect(PAGE_SRC).toContain(`t("${key}")`);
    }
    expect(PAGE_SRC.match(/currentStatusLine/g)?.length).toBe(1);
  });

  it("currentStatusLine 双语都保留 {plan} 与 {status} 占位，不硬编码状态词", () => {
    for (const msg of [EN, ZH]) {
      const line = msg.dashboard.settings.currentStatusLine;
      expect(line).toContain("{plan}");
      expect(line).toContain("{status}");
      expect(line).not.toMatch(/inactive|past_due|trialing/);
    }
  });
});

// ===== BUG-36：Settings 四个标签缺可访问的「标签页」语义（同一页面，另起一组）=====
// 实测：/app/settings 的账号/套餐/用量/自动化四个标签此前只是普通 <button>，
// 屏幕阅读器读不出「当前在第几个标签、共几个」，也无法从标签跳到内容区。
// 审计页（audit/page.tsx）早已使用 role=tablist + role=tab + aria-selected，
// 本次把同一套语义补齐到设置页，并补全 aria-controls / role=tabpanel 闭环。
describe("BUG-36：Settings 标签页语义", () => {
  const tablist = PAGE_SRC.slice(
    PAGE_SRC.indexOf('{/* 左侧 Tab */}'),
    PAGE_SRC.indexOf("{/* 右侧内容 */}")
  );

  it("标签容器是 tablist，列表项不抢语义角色", () => {
    expect(tablist).toContain("<nav className=\"lg:col-span-3\" aria-label={t(\"title\")}>");
    expect(tablist).toContain('role="tablist"');
    expect(tablist).toContain('role="presentation"');
  });

  it("每个标签都是 role=tab，带 aria-selected 与 aria-controls，id 可被面板引用", () => {
    expect(tablist).toContain('role="tab"');
    expect(tablist).toContain("id={`settings-tab-${t.key}`}");
    expect(tablist).toContain("aria-selected={tab === t.key}");
    expect(tablist).toContain('aria-controls="settings-panel"');
  });

  it("内容区是唯一的 tabpanel，aria-labelledby 跟随当前选中 tab", () => {
    const panel = PAGE_SRC.slice(
      PAGE_SRC.indexOf("{/* 右侧内容 */}"),
      PAGE_SRC.indexOf("{/* 账号信息 */}")
    );
    expect(panel).toContain('id="settings-panel"');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain("aria-labelledby={`settings-tab-${tab}`}");
  });

  it("切换标签仍走同一个 setTab（语义补齐没有改变交互）", () => {
    expect(tablist).toContain("onClick={() => setTab(t.key)}");
    expect(PAGE_SRC.match(/setTab\(/g)?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

// ===== BUG-37：自动化面板控件没有可访问名称（同一页面，另起一组）=====
// 实测（:3411 / :3412 /app/settings → 自动化，1440 与 390/360 一致）：
//   switches: [{checked:"true", ariaLabel:null, text:""}, {checked:"true", ariaLabel:null, text:""}]
//   ctrls:    2× input[type=time] + 1× select 全部 labels:0 / id:null / ariaLabel:null
// 屏幕阅读器只能读到「switch, on」与一个空白时间框，用户无法知道开关属于哪一项任务。
describe("BUG-37：自动化开关与时间/星期控件的可访问名称", () => {
  const auto = PAGE_SRC.slice(
    PAGE_SRC.indexOf("// ===== 自动化面板 ====="),
    PAGE_SRC.indexOf("// ===== 缓存管理组件 =====")
  );

  it("Toggle 必须接收 label 并输出 aria-label（role=switch 本身无文本）", () => {
    expect(PAGE_SRC).toContain("function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string })");
    const toggle = PAGE_SRC.slice(PAGE_SRC.indexOf("function Toggle("));
    expect(toggle.slice(0, 500)).toContain("aria-label={label}");
  });

  it("两个开关分别以所属任务标题命名", () => {
    expect(auto).toContain('<Toggle checked={dailyEnabled} onChange={setDailyEnabled} label={t("dailyTitle")} />');
    expect(auto).toContain('<Toggle checked={weeklyEnabled} onChange={setWeeklyEnabled} label={t("weeklyTitle")} />');
  });

  it("时间/星期控件与 label 建立 htmlFor ↔ id 关联（三对，无遗漏）", () => {
    for (const id of ["daily-refresh-time", "weekly-run-day", "weekly-run-time"]) {
      expect(auto).toContain(`htmlFor="${id}"`);
      expect(auto).toContain(`id="${id}"`);
    }
    // 不允许再出现「有 label 但没 htmlFor」的裸标签
    expect(auto.match(/<label className=/g) ?? []).toHaveLength(0);
  });
});

// ===== BUG-39：缓存管理卡片窄屏挤压（同一页面，另起一组）=====
// 实测 360×800（t11/i17-m360）：卡片三段内容（文案 / 条目数 / 按钮）挤在一行，
//   clipped: H2「Cache Management」clientWidth=16px、P「SerpApi result cache…」clientWidth=16px，
//   截图中「10」直接压在描述文字上（重叠，不只是换行难看）。
describe("BUG-39：缓存管理卡片小屏纵向堆叠", () => {
  const cache = PAGE_SRC.slice(
    PAGE_SRC.indexOf("// ===== 缓存管理组件 ====="),
    PAGE_SRC.indexOf("// ===== Usage Dashboard 组件")
  );

  it("外层从纵向堆叠开始，sm 以上才回到一行两端对齐", () => {
    expect(cache).toContain('className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"');
    // 旧写法：一上来就 justify-between，把文案列压成 16px
    expect(cache).not.toContain('className="flex items-center justify-between gap-4"');
  });

  it("数字与按钮自成一行，小屏两端对齐、sm 起贴右", () => {
    expect(cache).toContain('className="flex items-center justify-between gap-4 sm:flex-shrink-0"');
    expect(cache).toContain('<div className="min-w-0">');
  });

  it("文案列仍是标题 + 说明两段，未被删减", () => {
    expect(cache).toContain('{t("cacheTitle")}');
    expect(cache).toContain('{t("cacheDesc")}');
    expect(cache).toContain('{t("cacheEntries")}');
  });
});
