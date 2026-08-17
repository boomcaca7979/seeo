"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

interface PlaceholderPageProps {
  title: string;
  description: string;
  phase: string;
  metrics: { label: string; value: string; hint: string }[];
  features: { name: string; desc: string }[];
}

export default function PlaceholderPage({
  title,
  description,
  phase,
  metrics,
  features,
}: PlaceholderPageProps) {
  const t = useTranslations("dashboard.shared.placeholder");

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* 标题 */}
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {title}
            </h1>
            <span className="badge-warn">{phase}</span>
          </div>
          <p className="mt-1.5 font-sans text-sm text-ink-60">
            {description}
          </p>
        </div>
      </div>

      {/* 指标骨架 */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="card-a p-5"
          >
            <div className="font-sans text-xs text-ink-40">{m.label}</div>
            <div className="mt-2 font-display text-2xl font-bold text-ink">
              {m.value}
            </div>
            <div className="mt-2 h-8 rounded-lg bg-line-soft" />
            <div className="mt-2 font-sans text-[10px] text-ink-40">
              {m.hint}
            </div>
          </div>
        ))}
      </div>

      {/* 功能预览 */}
      <div className="mt-10">
        <h2 className="font-display text-lg font-bold text-ink">
          {t("plannedTitle")}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.name}
              className="card-a p-5"
            >
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                <h3 className="font-sans text-sm font-semibold text-ink">
                  {f.name}
                </h3>
              </div>
              <p className="mt-2 font-sans text-xs leading-relaxed text-ink-60">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 提示条 */}
      <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-xl border border-dashed border-brand/30 bg-brand/5 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand/30 bg-brand/15 font-mono text-sm text-ink">
            ⏱
          </span>
          <div>
            <div className="font-sans text-sm font-medium text-ink">
              {t("phaseDelivery", { phase })}
            </div>
            <div className="mt-0.5 font-sans text-xs text-ink-40">
              {t("phaseHint")}
            </div>
          </div>
        </div>
        <Link
          href="/app"
          className="font-sans text-sm font-medium text-ink-60 transition-colors hover:text-ink"
        >
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}
