"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ToastType = "success" | "info" | "error";

export interface ToastState {
  message: string;
  type: ToastType;
}

const COLOR: Record<ToastType, string> = {
  success: "text-pos border-pos",
  error: "text-neg border-neg",
  info: "text-warn border-warn",
};

const GLYPH: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

/** 错误用 alert（assertive）立即打断播报，成功/信息用 status（polite）排队播报。 */
export function isAssertiveToast(type: ToastType): boolean {
  return type === "error";
}

function Bubble({ toast }: { toast: ToastState }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border bg-card px-4 py-3 ${COLOR[toast.type]}`}>
      <span className="font-mono text-sm" aria-hidden="true">
        {GLYPH[toast.type]}
      </span>
      <span className="font-sans text-sm text-ink">{toast.message}</span>
    </div>
  );
}

// 两个 live region 常驻（无消息时为空）：区域先于内容存在，插入内容才能稳定触发播报；
// 消息只会渲染进其中一个，且气泡自身不带 role/aria-live → 一条消息只有一个播报来源。
export function ToastView({
  toast,
  onClose,
}: {
  toast: ToastState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  const assertive = toast !== null && isAssertiveToast(toast.type);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div role="status" aria-live="polite" aria-atomic="true">
        {toast && !assertive ? <Bubble toast={toast} /> : null}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {toast && assertive ? <Bubble toast={toast} /> : null}
      </div>
    </div>
  );
}

/** 由 ToastProvider 提供的共享提示通道；无 Provider 的子树（独立组件测试、(default) 之外的壳）各自兜底 */
interface ToastApi {
  show: (message: string, type?: ToastType) => void;
}

const ToastApiContext = createContext<ToastApi | null>(null);

/** 共享实例已持有唯一一对 live region，这里的 <Toast /> 挂载点保持写法一致但不再新增区域 */
function SharedSlot() {
  return null;
}

/**
 * 每个页面只挂一次：整页共用一份提示状态与一对常驻 live region。
 *
 * 没有它时，同一页上每个 useToast() 各自渲染一对 role=status/role=alert 区域
 * （修复前实测：工作台 = 页面 + CreateProjectProvider 共 4 个区域，/pricing = 2 个组件共 4 个），
 * 既可能把同一条消息播报两次，也会让两个气泡在同一个 fixed 定位上重叠。
 *
 * 幂等：已在某个 Provider 之下再套一层不会开出第二个实例，
 * 所以布局层与页面层各挂一次也只剩一对区域。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const parent = useContext(ToastApiContext);
  if (parent) return <>{children}</>;
  return <ToastProviderInner>{children}</ToastProviderInner>;
}

function ToastProviderInner({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const show = useCallback((message: string, type: ToastType = "success") => {
    setToast({ message, type });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastApiContext.Provider value={api}>
      {children}
      <ToastView toast={toast} onClose={dismiss} />
    </ToastApiContext.Provider>
  );
}

export function useToast() {
  const shared = useContext(ToastApiContext);
  const [toast, setToast] = useState<ToastState | null>(null);

  // 稳定身份：调用方常把 show 放进 useCallback/useEffect 依赖，
  // 若每次渲染都是新函数会引发无限 refetch 循环。
  const show = useCallback((message: string, type: ToastType = "success") => {
    setToast({ message, type });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  const Toast = useMemo(
    () =>
      function Toast() {
        return <ToastView toast={toast} onClose={dismiss} />;
      },
    [toast, dismiss]
  );

  // 页面已有唯一实例：只借用它的 show，自己的 <Toast /> 挂载点留空，
  // 否则同一页会出现两对 live region（重复播报 + 气泡重叠）。
  if (shared) return { show: shared.show, Toast: SharedSlot };

  return { show, Toast };
}
