import Link from "next/link";
import { useTranslations } from "next-intl";
import UrlAuditBox from "./UrlAuditBox";
import { isAuthEnabled } from "@/lib/auth-config";

export default function Hero() {
  const t = useTranslations("hero");
  // 与 DashboardPreview 同一价值结构（WHAT/WHY/EVIDENCE/ACTION/VERIFY）：
  // 首屏视觉直接表达「审计 → 判断 → 修复 → 验证」闭环，不再使用工具集合演示。
  // 只复用 preview 既有文案，不引入任何演示数据/动画/排名流量数字。
  const tp = useTranslations("preview");
  // 演示模式：主按钮直接进 /app；启用模式：进 /signup
  const primaryHref = isAuthEnabled ? "/signup" : "/app";

  const loopSteps = [
    tp("what.label"),
    tp("why.label"),
    tp("evidence.label"),
    tp("action.label"),
    tp("verify.label"),
  ];

  return (
    <section className="relative overflow-hidden bg-card px-5 pt-16 pb-10 sm:px-8 sm:pt-24 sm:pb-12">
      {/* 背景装饰网格 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(#111827 1px, transparent 1px), linear-gradient(90deg, #111827 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative site-shell">
        {/* 标题 */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 font-mono text-xs text-ink-60">
            <span className="h-1.5 w-1.5 rounded-full bg-pos" />
            {t("badge")}
          </span>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-6xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-ink-60 sm:text-lg">
            {t("subtitle")}
          </p>

          {/* URL 快速审计入口：Hero 区第一互动 CTA（首屏可见，先于按钮与视觉面板） */}
          <UrlAuditBox />

          {/* 次级操作（不再与搜索框争夺主入口视觉） */}
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={primaryHref}
              className="btn-secondary btn-lg w-full sm:w-auto"
            >
              {t("primaryCta")}
            </Link>
            <Link
              href="#features"
              className="btn-secondary btn-lg w-full sm:w-auto"
            >
              {t("secondaryCta")}
            </Link>
          </div>
        </div>

        {/* 价值闭环面板：静态步骤条（复用 preview 结构），取代旧「关键词引力场」工具演示 */}
        <div className="mx-auto mt-14 max-w-5xl">
          <div className="relative rounded-xl bg-ink p-6 sm:p-8">
            <div className="flex items-center justify-between font-mono text-xs text-white/60">
              <span>example.com · SEO audit</span>
              <span>{tp("exampleTag")}</span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {loopSteps.map((label, i) => (
                <div
                  key={label}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-3"
                >
                  <div className="font-mono text-xs text-white/50">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-1 font-sans text-sm font-semibold leading-snug text-white">
                    {label}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center">
              <p className="font-sans text-sm leading-relaxed text-white/70">
                {tp("sectionSubheading")}
              </p>
              <Link
                href="/app/audit"
                className="inline-flex flex-none items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-white/90"
              >
                {tp("verify.cta")}
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
