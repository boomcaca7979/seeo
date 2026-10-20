"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface OnboardingProps {
  displayName: string;
  /** demo = 演示模式（无账号）；live = 真实账号。演示标识只应在 demo 模式出现 */
  mode?: "demo" | "live";
}

/** 游客审计 → 注册后的承接 key：audit 页在审计启动时写入（既有机制，非本轮新增） */
const LAST_AUDIT_DOMAIN_KEY = "seeo:last-audit-domain";

export default function Onboarding({ displayName, mode = "demo" }: OnboardingProps) {
  const t = useTranslations("dashboard.shared.onboarding");

  // 游客审计承接：注册后若 localStorage 记录了刚刚审计的域名，
  // 显示「你的审计已就绪」卡直达该结果（认领由 signup 时的 claim 链路完成），
  // 避免用户重新输入域名、重跑审计。无记录则保持原有 3 步引导。
  // 仅 client 挂载后读取（SSR 无法访问 localStorage，避免 hydration mismatch）。
  const [lastAuditDomain, setLastAuditDomain] = useState<string | null>(null);
  useEffect(() => {
    // 与 audit 页同款 IIFE 初始化模式（同步 effect 体不直接 setState）
    (async () => {
      try {
        const d = window.localStorage.getItem(LAST_AUDIT_DOMAIN_KEY)?.trim() ?? "";
        if (d) setLastAuditDomain(d);
      } catch {
        // localStorage 不可用：静默回退到通用 onboarding
      }
    })();
  }, []);

  const STEPS = [
    {
      n: "01",
      title: t("step1Title"),
      desc: t("step1Desc"),
    },
    {
      n: "02",
      title: t("step2Title"),
      desc: t("step2Desc"),
    },
    {
      n: "03",
      title: t("step3Title"),
      desc: t("step3Desc"),
    },
  ];

  return (
    <div className="dash-container px-6 py-8 sm:px-8">
      {/* eyebrow 行 */}
      <div className="flex items-center justify-between font-sans text-xs text-ink-40">
        <span>{t("eyebrowWelcome")}</span>
        <span>{mode === "demo" ? t("eyebrowUpdated") : t("eyebrowUpdatedLive")}</span>
      </div>

      {/* 主标题 */}
      <div className="mt-3">
        <h1
          className="font-display font-semibold tracking-tight text-ink"
          style={{ fontSize: 32, lineHeight: 1.2 }}
        >
          {t("greeting", { name: displayName })}
        </h1>
        <p className="mt-2 font-sans text-sm text-ink-60">
          {t("subtitle")}
        </p>
      </div>

      {/* Onboarding 区块 */}
      <section className="mt-10">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg font-semibold text-ink">{t("sectionTitle")}</h2>
          <div className="hairline flex-1" />
        </div>

        {/* 游客审计承接卡：刚刚完成游客审计并注册的用户直达原结果，不重新开始 */}
        {lastAuditDomain && (
          <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-lg border border-brand/30 bg-card px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-sans text-sm font-semibold text-ink">
                <span className="h-2 w-2 flex-none rounded-full bg-pos" aria-hidden />
                {t("auditReadyTitle")}
              </div>
              <p className="mt-1 font-sans text-xs leading-relaxed text-ink-60">
                {t("auditReadyDesc", { domain: lastAuditDomain })}
              </p>
            </div>
            <Link
              href={`/app/audit?domain=${encodeURIComponent(lastAuditDomain)}`}
              className="btn-primary flex-none"
            >
              {t("auditReadyCta")}
            </Link>
          </div>
        )}

        <div className="mt-4 card-a p-8 sm:p-10">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="flex flex-col">
                <span className="font-mono text-xs text-brand">{s.n}</span>
                <div className="mt-2 font-display text-base font-semibold text-ink">
                  {s.title}
                </div>
                <p className="mt-2 font-sans text-sm text-ink-60 leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>

          {/* 主 CTA */}
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link href="/app/audit" className="btn-primary px-8 py-3 text-base">
              {t("cta")}
            </Link>
            <p className="font-mono text-xs text-ink-40">
              {t("ctaNote")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
