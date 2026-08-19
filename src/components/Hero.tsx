import Link from "next/link";
import { useTranslations } from "next-intl";
import KeywordField from "./KeywordField";
import UrlAuditBox from "./UrlAuditBox";
import { isAuthEnabled } from "@/lib/auth-config";

export default function Hero() {
  const t = useTranslations("hero");
  // 演示模式：主按钮直接进 /app；启用模式：进 /signup
  const primaryHref = isAuthEnabled ? "/signup" : "/app";

  return (
    <section className="relative overflow-hidden bg-card px-5 py-16 sm:px-8 sm:py-24">
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
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={primaryHref}
              className="btn-primary btn-lg w-full sm:w-auto"
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

          {/* URL 快速审计入口 */}
          <UrlAuditBox />
        </div>

        {/* 深色面板 - 引力场 */}
        <div className="mx-auto mt-14 max-w-5xl">
          <div className="relative rounded-xl bg-ink p-2 sm:p-3">
            {/* 面板顶部条 */}
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              </div>
              <div className="font-mono text-xs text-white/40 sm:text-xs">
                seeo.asia / keyword-gravity-field
              </div>
              <div className="font-mono text-xs text-white/40 sm:text-xs">
                ● {t("panel.sample")}
              </div>
            </div>

            {/* 引力场画布 */}
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-black sm:aspect-[16/9]">
              <KeywordField />

              {/* 面板角标信息 */}
              <div className="absolute left-3 top-3 hidden font-mono text-xs text-white/40 sm:block">
                <div>NODES: 8</div>
                <div>EDGES: 7</div>
              </div>
              <div className="absolute right-3 top-3 hidden font-mono text-xs text-white/40 sm:block">
                <div>{t("panel.sampleNote")}</div>
              </div>
              <div className="absolute bottom-3 left-3 hidden font-mono text-xs text-white/60 sm:block">
                {t("panel.caption")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
