"use client";

// ===== 弹层无障碍语义（共享） =====
// 弹层只要能被鼠标关闭不算可用：读屏需要 dialog/aria-modal/aria-labelledby，键盘需要
// 焦点进入弹层、Tab 在弹层内循环、关闭后回到触发元素。缺了任一条，键盘用户会在遮层
// 背后迷路，读屏则完全听不到"弹层已打开"。
// role / aria-modal / aria-labelledby 由调用方写在弹层面板 JSX 上，本 hook 只管焦点与按键。
//
// 弹层会叠（报告预览 → 邮件弹窗 → 升级弹窗），所以按键只交给**最上层**那一个处理；
// 否则一次 Escape 会连带关掉下层的预览，两层 Tab 循环也会互相抢焦点。

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

type Dialog = { panel: HTMLElement | null; onClose: () => void };
const stack: Dialog[] = [];

/** @returns 挂到弹层面板（不是遮层）上的 ref */
export function useDialogA11y(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose 常是父组件的内联箭头函数：直接进依赖会让 effect 在每次父级重渲染时重跑，
  // 于是焦点被抢回弹层第一个可聚焦元素（正在输入的框会被打断）。用 ref 读最新值。
  const closeRef = useRef(onClose);
  // 渲染期写 ref 会被 react-compiler 规则拦下（也确实是错的：render 可能被丢弃），
  // 放在无依赖 effect 里：每次提交后同步，按键回调读到的一定是最新 onClose。
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const entry: Dialog = { panel, onClose: () => closeRef.current() };
    stack.push(entry);
    const opener = document.activeElement as HTMLElement | null;
    const isTop = () => stack[stack.length - 1] === entry;

    const items = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    if (isTop()) (items()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === "Escape") {
        entry.onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const current = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? current <= 0
          ? list.length - 1
          : current - 1
        : current === list.length - 1
          ? 0
          : current + 1;
      e.preventDefault();
      list[next].focus();
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const idx = stack.indexOf(entry);
      if (idx >= 0) stack.splice(idx, 1);
      // 归还焦点：弹层是从哪个控件打开的，关掉后就应该回到哪里
      if (opener && opener !== document.body) opener.focus();
    };
  }, [open]);

  return panelRef;
}
