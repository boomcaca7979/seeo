"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { planLabel, featureLabel } from "@/lib/plan-labels";
import { formatNumber } from "@/lib/ui-locale";

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

const PLAN_ORDER: string[] = ["free", "lite", "pro"];

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
  const t = useTranslations("dashboard.upgrade");
  const tc = useTranslations("dashboard.common");
  const locale = useLocale() as "en" | "zh";
  const { open, currentPlan, requiredPlan, reason, feature, limit, used } = state;
  const recommendPlan = requiredPlan ?? getNextPlan(currentPlan);
  const recommendLabel = recommendPlan ? planLabel(recommendPlan, locale) : null;
  const currentPlanLabel = planLabel(currentPlan, locale);
  const featureLabelText = feature ? featureLabel(feature, locale) : null;
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
            <h3 className="font-display text-lg font-semibold text-ink">
              {isTopPlan ? t("topTitle") : t("title")}
            </h3>
            <p className="mt-1 font-mono text-xs text-ink-40">
              {t("current", { plan: currentPlanLabel })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-40 hover:bg-line-soft hover:text-ink"
            aria-label={tc("close")}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 限制原因 */}
        <div className="mb-5 rounded-lg border border-line-soft bg-paper p-4">
          {featureLabelText && (
            <p className="font-sans text-sm text-ink">
              <span className="text-ink-40">{t("requiredFeature")}</span>
              {featureLabelText}
            </p>
          )}
          {reason && (
            <p className="font-sans text-sm text-ink">
              <span className="text-ink-40">{t("reason")}</span>
              {reason}
            </p>
          )}
          {typeof used === "number" && typeof limit === "number" && (
            <p className="mt-1 font-mono text-xs text-ink-60">
              {t("usage", { used: formatNumber(used, locale), limit: formatNumber(limit, locale) })}
            </p>
          )}
        </div>

        {/* 推荐套餐（仅在存在可升级套餐时显示） */}
        {recommendLabel && (
          <div className="mb-5 rounded-lg border border-brand bg-brand/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-xs text-brand">{t("recommended")}</div>
                <div className="mt-1 font-display text-xl font-semibold text-ink">
                  {recommendLabel}
                </div>
              </div>
              <span className="badge-warn px-2.5 py-1 text-xs">{t("recommendedBadge")}</span>
            </div>
            <p className="mt-2 font-sans text-xs text-ink-60">
              {t("recommendDesc")}
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 btn-secondary py-2.5 text-sm"
          >
            {t("later")}
          </button>
          <Link
            href="/pricing"
            onClick={onClose}
            className="flex-1 btn-primary py-2.5 text-center text-sm"
          >
            {isTopPlan ? t("viewDetails") : t("viewPlans")}
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
