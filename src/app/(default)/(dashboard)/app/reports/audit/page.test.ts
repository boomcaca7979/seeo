// ===== BUG-07 回归测试：审计报告页取数契约（第二处根因） =====
// 根因：effect 用 window.setTimeout(…, 0) 调度 setDomain / setNotFound，并在 cleanup 里 clearTimeout。
// 开发模式 StrictMode「挂载→卸载→重挂载」会取消首帧定时器，第二次又被 initRef 短路，
// 于是 URL 带 domain 也永不写入：软导航进入时永久停在骨架屏，空状态文案还错报「尚未选择审计域名」。
// 修复：状态写入与取数改由微任务发起（同步 setState 会命中 react-hooks/set-state-in-effect，
// 定时器版本又会被取消）。取数优先级与参数语义保持原样——
//   URL ?domain= > localStorage（旧入口兼容）；?audit= 仅接受纯数字。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

const EFFECT = PAGE_SRC.slice(
  PAGE_SRC.indexOf("const initRef = useRef"),
  PAGE_SRC.indexOf("const handlePrint")
);
// 注释本身要解释「为什么不再用定时器」，断言只针对可执行代码
const CODE = EFFECT.replace(/^\s*\/\/.*$/gm, "");
const MICROTASK = CODE.slice(CODE.indexOf("queueMicrotask"));

describe("BUG-07：报告页 effect 不再依赖可被取消的定时器", () => {
  it("状态写入改由微任务发起：既无同步 setState，也无 setTimeout / clearTimeout", () => {
    expect(CODE).toContain("queueMicrotask(() => {");
    expect(CODE).not.toContain("setTimeout");
    expect(CODE).not.toContain("clearTimeout");
    expect(CODE).toContain("setNotFound(true);");
    expect(CODE).toContain("setLoading(false);");
  });

  it("取数请求随微任务一起发起，cleanup 无法取消它", () => {
    expect(MICROTASK).toContain("setDomain(effectiveDomain);");
    expect(MICROTASK).toContain("/api/audit/latest");
    expect(EFFECT).not.toMatch(/return \(\) => window\.clearTimeout/);
  });

  it("无可用域名分支立即落到空状态，不会停在骨架屏", () => {
    const emptyBranch = MICROTASK.slice(MICROTASK.indexOf("if (!effectiveDomain)"), MICROTASK.indexOf("setDomain(effectiveDomain);"));
    expect(emptyBranch).toContain("setNotFound(true);");
    expect(emptyBranch).toContain("setLoading(false);");
    expect(emptyBranch).toContain("return;");
  });
});

describe("BUG-07：既有 URL 参数契约保持不变", () => {
  it("域名优先级仍是 URL ?domain= > localStorage", () => {
    expect(CODE).toContain('params.get("domain")');
    expect(CODE).toContain("const effectiveDomain = urlDomain || saved;");
    expect(CODE.indexOf('params.get("domain")')).toBeLessThan(CODE.indexOf("localStorage.getItem"));
  });

  it("?audit= 仍只接受纯数字，并按原语义附加到取数请求", () => {
    expect(CODE).toContain('/^\\d+$/.test(auditParamRaw)');
    expect(CODE).toContain("`&audit=${auditId}`");
    expect(CODE).toContain("/api/audit/latest?domain=${encodeURIComponent(effectiveDomain)}");
  });

  it("非 completed 结果仍按未找到处理，不展示半成品报告", () => {
    expect(CODE).toContain('json.data.status !== "completed"');
  });
});

describe("空状态也有页面级标题（可访问性结构）", () => {
  // 已加载分支的报告头是 <h1>{domain}</h1>；空状态曾把 emptyTitle 写成 <div>，
  // 直接进来看不到报告的读者（含读屏用户）在页面上找不到任何标题。
  it("notFound 分支的 emptyTitle 渲染为 <h1>", () => {
    const empty = PAGE_SRC.slice(PAGE_SRC.indexOf("if (notFound || !audit)"), PAGE_SRC.indexOf("const healthScore ="));
    expect(empty).toContain("<h1");
    expect(empty).toContain('{t("emptyTitle")}');
    expect(empty).not.toContain('<div className="font-display text-lg font-semibold text-ink">\n            {t("emptyTitle")}');
  });
});
