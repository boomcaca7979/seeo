"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// ===== 升级引导 Modal =====
// 由全局 BillingEventBus 触发，或由各页面手动 open
// 数据来自 /api/account/usage（不硬编码套餐）

export interface UpgradeModalState {
  open: boolean;
  currentPlan: string;
  requiredPlan?: string;
  reason?: string;
  feature?: string;
  limit?: number;
  used?: number;
}

const PLAN_LABELS: Record<string, string> = {
  free: "免费版",
  lite: "Lite 版",
  pro: "专业版",
};

const PLAN_ORDER: string[] = ["free", "lite", "pro"];

const FEATURE_LABELS: Record<string, string> = {
  pdf_export: "PDF 导出",
  excel_export: "Excel 导出",
  full_audit: "完整审计",
  backlinks: "外链分析",
  email_report: "邮件报告",
};

function getNextPlan(currentPlan: string): string | null {
  const idx = PLAN_ORDER.indexOf(currentPlan);
  if (idx === -1 || idx >= PLAN_ORDER.length - 1) return null;
  return PLAN_ORDER[idx + 1];
}

interface UpgradeModalProps {
  state: UpgradeModalState;
  onClose: () => void;
}

export default function UpgradeModal({ state, onClose }: UpgradeModalProps) {
  const { open, currentPlan, requiredPlan, reason, feature, limit, used } = state;
  const recommendPlan = requiredPlan ?? getNextPlan(currentPlan);
  const recommendLabel = recommendPlan ? (PLAN_LABELS[recommendPlan] ?? recommendPlan) : null;
  const currentLabel = PLAN_LABELS[currentPlan] ?? currentPlan;
  const featureLabel = feature ? FEATURE_LABELS[feature] ?? feature : null;
  const isTopPlan = !recommendPlan;

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-line bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">
              {isTopPlan ? "已达最高套餐" : "升级套餐"}
            </h3>
            <p className="mt-1 font-mono text-xs text-ink-40">
              当前：{currentLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-40 hover:bg-line-soft hover:text-ink"
            aria-label="关闭"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 限制原因 */}
        <div className="mb-5 rounded-lg border border-line-soft bg-paper p-4">
          {featureLabel && (
            <p className="font-sans text-sm text-ink">
              <span className="text-ink-40">所需功能：</span>
              {featureLabel}
            </p>
          )}
          {reason && (
            <p className="font-sans text-sm text-ink">
              <span className="text-ink-40">原因：</span>
              {reason}
            </p>
          )}
          {typeof used === "number" && typeof limit === "number" && (
            <p className="mt-1 font-mono text-xs text-ink-60">
              用量：{used.toLocaleString()} / {limit.toLocaleString()}
            </p>
          )}
        </div>

        {/* 推荐套餐（仅在存在可升级套餐时显示） */}
        {recommendLabel && (
          <div className="mb-5 rounded-lg border border-brand bg-brand/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-xs text-brand">推荐升级</div>
                <div className="mt-1 font-display text-xl font-bold text-ink">
                  {recommendLabel}
                </div>
              </div>
              <span className="badge-warn px-2.5 py-1 text-xs">推荐</span>
            </div>
            <p className="mt-2 font-sans text-xs text-ink-60">
              升级后立即解锁更多功能与更高额度
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 btn-secondary py-2.5 text-sm"
          >
            稍后再说
          </button>
          <Link
            href="/pricing"
            onClick={onClose}
            className="flex-1 btn-primary py-2.5 text-center text-sm"
          >
            {isTopPlan ? "查看套餐详情" : "查看定价方案"}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ===== 全局事件总线（用于跨组件触发升级弹窗） =====

let listener: ((state: UpgradeModalState) => void) | null = null;

export function setUpgradeModalListener(fn: ((state: UpgradeModalState) => void) | null) {
  listener = fn;
}

export function triggerUpgradeModal(params: {
  currentPlan: string;
  requiredPlan?: string;
  reason?: string;
  feature?: string;
  limit?: number;
  used?: number;
}) {
  if (listener) {
    listener({ open: true, ...params });
  }
}

// ===== Provider Hook：在根布局使用，监听并渲染 Modal =====

export function useUpgradeModalProvider(currentPlan: string) {
  const [modalState, setModalState] = useState<UpgradeModalState>({
    open: false,
    currentPlan,
  });

  useEffect(() => {
    setUpgradeModalListener((state) => setModalState({ ...state, currentPlan: state.currentPlan || currentPlan }));
    return () => setUpgradeModalListener(null);
  }, [currentPlan]);

  const modal = <UpgradeModal state={modalState} onClose={() => setModalState((s) => ({ ...s, open: false }))} />;

  return { modal, setModalState };
}
