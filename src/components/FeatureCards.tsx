import Link from "next/link";
import { useTranslations } from "next-intl";

export default function FeatureCards() {
  const t = useTranslations("features");
  const features = t.raw("cards") as Array<{
    tag: string;
    title: string;
    desc: string;
    bullets: string[];
    metricLabel?: string;
    metricValue?: string;
    href?: string;
    link?: string;
  }>;

  return (
    <section id="features" className="bg-paper px-5 py-10 sm:px-8 sm:py-12">
      <div className="site-shell">
        {/* 标题（U2：删除 06/核心模块 eyebrow，仅保留 sectionTitle） */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
            {t("sectionTitle")}
          </h2>
          <p className="mt-4 text-base text-ink-60 sm:text-lg">
            {t("sectionSubtitle")}
          </p>
        </div>

        {/* 卡片网格 */}
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.title}
              className="group flex flex-col card-a p-6 transition-colors hover:border-ink-25"
            >
              {/* 顶部标签（+ 可选指标，产品总览卡不再展示步骤号） */}
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-accent/10 px-3 py-1 font-mono text-xs font-semibold text-accent">
                  {f.tag}
                </span>
                {f.metricLabel && f.metricValue ? (
                  <div className="text-right">
                    <div className="font-mono text-xs text-ink-40">
                      {f.metricLabel}
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <span className="font-mono text-sm font-semibold text-ink">
                        {f.metricValue}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 标题 + 描述 */}
              <h3 className="mt-5 font-display text-xl font-semibold text-ink">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-60">
                {f.desc}
              </p>

              {/* 功能点 */}
              <ul className="mt-5 space-y-2">
                {f.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-center gap-2 font-mono text-xs text-ink-60"
                  >
                    <span className="h-1 w-1 rounded-full bg-accent" />
                    {b}
                  </li>
                ))}
              </ul>

              {/* 底部链接（指向各功能独立页，强化内部链接；每卡独立文案，避免误导） */}
              <Link
                href={f.href ?? "/app"}
                className="mt-6 inline-flex items-center gap-2 font-sans text-sm font-semibold text-accent transition-colors hover:text-ink"
              >
                {f.link ?? t("cardLink")}
                <span aria-hidden>→</span>
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
