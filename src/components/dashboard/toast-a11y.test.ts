// ===== 共享 Toast 播报语义回归测试（BUG-013）=====
// 断言 renderToStaticMarkup 出的真实 DOM 语义（不是源码字符串搜索）：
//   · success/info → 常驻 role="status"（polite）
//   · error        → 常驻 role="alert"（assertive）
//   · 一条消息只有一个 live region 来源：aria-live 恰好 2 个（两个常驻区域），
//     气泡自身不带 role/aria-live，也不再嵌一份 sr-only 重复文本
//   · 图标字形 aria-hidden：播报文本 == 消息文本
//   · 无消息时两个区域仍常驻（先于内容存在，插入内容才会稳定触发播报）
//   · 页面级唯一实例：ToastProvider 下多个 useToast() 消费者不得各自再挂一对区域

import { createElement } from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ToastProvider,
  ToastView,
  isAssertiveToast,
  useToast,
  type ToastState,
  type ToastType,
} from "./Toast";

const SRC = readFileSync(fileURLToPath(new URL("./Toast.tsx", import.meta.url)), "utf-8");

const MSG = "已保存关键词 ranking";
const toast = (type: ToastType): ToastState => ({ message: MSG, type });

function render(state: ToastState | null) {
  return renderToStaticMarkup(createElement(ToastView, { toast: state, onClose: () => {} }));
}

/** 取某个 role 区域的纯文本（去掉标签后的内容） */
function regionText(html: string, role: "status" | "alert"): string {
  const open = `<div role="${role}"`;
  const start = html.indexOf(open);
  expect(start, `区域 role=${role} 应存在`).toBeGreaterThanOrEqual(0);
  const rest = html.slice(start);
  // 区域只包一层气泡 div：数到深度归零的闭合标签
  let depth = 0;
  let i = 0;
  for (;;) {
    const nextOpen = rest.indexOf("<div", i + 1);
    const nextClose = rest.indexOf("</div>", i + 1);
    if (nextClose === -1) throw new Error("unbalanced markup");
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
      continue;
    }
    i = nextClose;
    if (depth === 0) break;
    depth -= 1;
  }
  return rest
    .slice(0, i + 6)
    // 屏幕阅读器跳过 aria-hidden 子树（图标字形），播报文本 = 剩余可见文本
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

describe("Toast：类型 → 播报语义", () => {
  it("success → status(polite)，alert 区域为空", () => {
    const html = render(toast("success"));
    expect(html).toContain('<div role="status" aria-live="polite" aria-atomic="true"');
    expect(regionText(html, "status")).toBe(MSG);
    expect(regionText(html, "alert")).toBe("");
    expect(isAssertiveToast("success")).toBe(false);
  });

  it("info → status(polite)，alert 区域为空", () => {
    const html = render(toast("info"));
    expect(regionText(html, "status")).toBe(MSG);
    expect(regionText(html, "alert")).toBe("");
    expect(isAssertiveToast("info")).toBe(false);
  });

  it("error → alert(assertive)，status 区域为空", () => {
    const html = render(toast("error"));
    expect(html).toContain('<div role="alert" aria-live="assertive" aria-atomic="true"');
    expect(regionText(html, "alert")).toBe(MSG);
    expect(regionText(html, "status")).toBe("");
    expect(isAssertiveToast("error")).toBe(true);
  });
});

describe("Toast：单一播报来源，不叠加 live region", () => {
  for (const type of ["success", "info", "error"] as ToastType[]) {
    it(`${type}：消息在 DOM 中只出现一次，aria-live 恰好 2 个，role 恰好 2 个`, () => {
      const html = render(toast(type));
      expect(html.split(MSG).length - 1).toBe(1);
      expect(html.match(/aria-live/g)).toHaveLength(2);
      expect(html.match(/role="/g)).toHaveLength(2);
    });

    it(`${type}：图标字形不进播报（aria-hidden），播报文本就是消息本身`, () => {
      const html = render(toast(type));
      const active = type === "error" ? "alert" : "status";
      expect(regionText(html, active)).toBe(MSG);
      expect(html).toContain('aria-hidden="true"');
    });
  }

  it("无消息时两个 live region 仍常驻（区域先于内容存在）", () => {
    const html = render(null);
    expect(html.match(/role="/g)).toHaveLength(2);
    expect(regionText(html, "status")).toBe("");
    expect(regionText(html, "alert")).toBe("");
  });
});

describe("Toast：生命周期保持既有行为", () => {
  it("3 秒自动关闭，且卸载时清理定时器", () => {
    expect(SRC).toContain("setTimeout(onClose, 3000)");
    expect(SRC).toContain("return () => clearTimeout(t)");
  });

  it("dismiss 清空消息 → 区域保留但不再携带文本", () => {
    const shown = render(toast("error"));
    const dismissed = render(null);
    expect(regionText(shown, "alert")).toBe(MSG);
    expect(dismissed).not.toContain(MSG);
    expect(dismissed).toContain('<div role="alert"');
  });

  it("show() 复用同一状态槽：新消息替换旧消息（渲染结果只含最新文本）", () => {
    const html = render({ message: "后来的消息", type: "info" });
    expect(html).toContain("后来的消息");
    expect(html).not.toContain(MSG);
  });
});

describe("Toast：视觉与站点其余 live region 不冲突", () => {
  it("共享 Toast 不再往气泡里塞第二份 sr-only 文本（旧实现的重复播报来源）", () => {
    expect(SRC).not.toContain("sr-only");
  });

  it("位置与层级未变（右下角浮层）", () => {
    expect(render(toast("success"))).toContain("fixed bottom-6 right-6 z-50");
  });
});

// 页面级唯一实例：(default)/layout 挂一次 ToastProvider，同页多个 useToast() 消费者
// 不能再各挂一对 live region（修复前实测工作台 /pricing 各 4 个区域）。
describe("ToastProvider：同一页只有一对 live region", () => {
  const slots: unknown[] = [];
  const shows: unknown[] = [];

  function Sink() {
    const { show, Toast } = useToast();
    slots.push(Toast);
    shows.push(show);
    return null;
  }

  function TwoConsumers() {
    return createElement(
      "div",
      null,
      createElement(Sink),
      createElement(Sink)
    );
  }

  function drain() {
    const out = {
      markup: slots.map((C) => renderToStaticMarkup(createElement(C as () => null))),
      show: [...shows],
    };
    slots.length = 0;
    shows.length = 0;
    return out;
  }

  it("无 Provider（兜底路径）：两个消费者各自一对区域 —— 修复前的工作台形态", () => {
    renderToStaticMarkup(createElement(TwoConsumers));
    const { markup } = drain();
    expect(markup.join("").match(/role="/g)).toHaveLength(4);
    expect(markup.every((m) => m.includes('role="status"') && m.includes('role="alert"'))).toBe(
      true
    );
  });

  it("有 Provider：页面总共只有 2 个区域，消费者的 <Toast /> 不再输出区域", () => {
    const page = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(TwoConsumers))
    );
    // Provider 自己那一对
    expect(page.match(/role="/g)).toHaveLength(2);
    expect(page).toContain('<div role="status" aria-live="polite" aria-atomic="true"');
    expect(page).toContain('<div role="alert" aria-live="assertive" aria-atomic="true"');

    const { markup, show } = drain();
    expect(markup).toEqual(["", ""]);
    // 两个消费者拿到同一个 show（同一状态槽），且身份稳定 → 调用方放进依赖不会循环
    expect(show).toHaveLength(2);
    expect(show[0]).toBe(show[1]);
    expect(typeof show[0]).toBe("function");
  });

  it("区域由 Provider 常驻持有：消费者挂载点为空不影响区域存在", () => {
    const withConsumers = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(Sink))
    );
    drain();
    const bare = renderToStaticMarkup(createElement(ToastProvider, null, "text"));
    expect((withConsumers.match(/role="/g) ?? []).length).toBe(2);
    expect((bare.match(/role="/g) ?? []).length).toBe(2);
  });

  it("Provider 幂等：布局与页面各挂一次仍只有一对区域", () => {
    const page = renderToStaticMarkup(
      createElement(
        ToastProvider,
        null,
        createElement(ToastProvider, null, createElement(TwoConsumers))
      )
    );
    expect(page.match(/role="/g)).toHaveLength(2);
    const { markup, show } = drain();
    expect(markup).toEqual(["", ""]);
    expect(show[0]).toBe(show[1]);
  });
});
