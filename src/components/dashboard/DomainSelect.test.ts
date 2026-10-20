// ===== DomainSelect 包裹层收缩回归 =====
// 调用方把 min-w-0/max-w-full 传给 select/input，但组件外面还套着一层无类名 div：
// 它才是 flex 工具条里的真正 flex item，min-width:auto + 无 max-width
// → 宽度取 select 固有宽度（「项目名（域名）」整串，en 实测 390px），
// 在 360/390 屏顶穿容器，右侧控件既看不见也滚不到。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("./DomainSelect.tsx", import.meta.url)), "utf-8");
const MSG_EN = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../messages/en.json", import.meta.url)), "utf-8")
) as { dashboard: { shared: { domainSelect: Record<string, string> } } };
const MSG_ZH = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../messages/zh.json", import.meta.url)), "utf-8")
) as { dashboard: { shared: { domainSelect: Record<string, string> } } };

describe("DomainSelect：三种渲染分支都不能撑破容器", () => {
  it("select 分支与手动输入分支的包裹 div 都带 min-w-0 max-w-full", () => {
    const wrappers = SRC.match(/<div className="min-w-0 max-w-full">/g) ?? [];
    expect(wrappers.length).toBeGreaterThanOrEqual(2);
  });

  it("组件内不再残留无类名的裸 div 包裹", () => {
    expect(SRC).not.toMatch(/return \(\s*<div>\s*<(select|input)/);
  });
});

// ===== BUG-17：/api/projects 加载失败不得被说成「暂无项目」 =====
// Topbar 同类问题（BUG-16）之外，DomainSelect 是 6 个 dashboard 页面共用的域名入口：
// 之前 500 / 网络异常 / 超时都静默 setManual(true)，界面只剩「暂无项目，可直接输入域名开始」。
// 有项目的用户看到的是「我的项目没了」，而且不知道可以重试——虽然手动输入仍可用（降级正确），
// 但提示语义是假的。

describe("BUG-17 DomainSelect：失败降级必须与空项目区分", () => {
  it("存在独立的 failed 状态", () => {
    expect(SRC).toMatch(/const \[failed, setFailed\] = useState\(false\)/);
  });

  it("非 200 / 结构异常分支与 catch 分支都置 failed", () => {
    const elseBranch = SRC.match(/else \{\s*\/\/ 非 200 [\s\S]*?setFailed\(true\);/);
    expect(elseBranch).not.toBeNull();
    const catchBranch = SRC.match(/catch \{[\s\S]*?setFailed\(true\);/);
    expect(catchBranch).not.toBeNull();
  });

  it("成功分支先清掉 failed，重试成功后不会残留错误提示", () => {
    // 复位必须在响应回来后、分支判定之前（effect 同步体里 setState 会触发级联渲染）
    expect(SRC).toMatch(
      /try \{[\s\S]{0,1200}setFailed\(false\);\s*if \(json\.ok && Array\.isArray\(json\.data\)\)/
    );
  });

  it("「暂无项目」提示以 !failed 为前置条件，失败分支单独渲染错误提示", () => {
    expect(SRC).toMatch(/projects\.length === 0 && !failed && \(\s*<p[\s\S]*?\{t\("noProjectsHint"\)\}/);
    expect(SRC).toMatch(/failed && \(\s*<p[\s\S]*?t\("loadFailedHint"\)/);
  });

  it("失败提示里给出可用的重试入口，且重试走同一个取数回调", () => {
    expect(SRC).toMatch(/onClick=\{\(\) => void loadProjects\(\)\}/);
  });

  it("取数回调不依赖 onChange：父级重渲染不得再触发一次 /api/projects", () => {
    expect(SRC).toMatch(/const loadProjects = useCallback\(async \(\) => \{[\s\S]*?\}, \[\]\);/);
    expect(SRC).toMatch(/onChangeRef\.current\(fallback\)/);
  });

  it("默认值优先取「顶部当前项目」，没有才回落第一个项目（不再固定选最早创建的项目）", () => {
    // 根因：旧逻辑 `if (!valueRef.current) onChange(json.data[0].domain)` 让每个页面
    // 都默认选「最早创建的項目」，与顶部当前选择无关。
    expect(SRC).toMatch(/const fallback = ctxRef\.current\?\.activeDomain \?\? \(json\.data\[0\] as Project \| undefined\)\?\.domain \?\? ""/);
    expect(SRC).not.toMatch(/if \(!valueRef\.current && json\.data\.length > 0\) \{\s*onChangeRef\.current\(\(json\.data\[0\] as Project\)\.domain\);/);
  });

  it("控制台内直接用共享列表：Provider 有项目时不再单独请求 /api/projects", () => {
    expect(SRC).toContain("useActiveProjectOptional()");
    expect(SRC).toMatch(/if \(shared && shared\.projects\.length > 0\) \{/);
    expect(SRC).toContain("const json = await loadProjectList();");
    // 独立渲染（无 Provider）时走共享取数入口，并发调用合并为一次
    expect(SRC).not.toContain('fetch("/api/projects"');
  });

  it("en/zh 都提供失败提示与重试文案，且语义不同于空项目文案", () => {
    for (const msg of [MSG_EN, MSG_ZH]) {
      const d = msg.dashboard.shared.domainSelect;
      expect(typeof d.loadFailedHint).toBe("string");
      expect(typeof d.retry).toBe("string");
      expect(d.loadFailedHint).not.toBe(d.noProjectsHint);
      expect(d.loadFailedHint).not.toMatch(/暂无项目|No projects yet/);
    }
  });
});
