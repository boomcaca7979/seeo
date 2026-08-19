import Link from "next/link";
import { useTranslations } from "next-intl";

export default function FeatureCards() {
  const t = useTranslations("features");
  const features = t.raw("cards") as Array<{
    tag: string;
    title: string;
    desc: string;
    bullets: string[];
    metricLabel: string;
    metricValue: string;
  }>;

  return (
    <section id="features" className="bg-paper px-5 py-20 sm:px-8 sm:py-28">
      <div className="site-shell">
        {/* 标题 */}
        <div className="max-w-2xl">
          <span className="font-mono text-sm text-ink-40">
            {t("sectionTag")}
          </span>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
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
              {/* 顶部标签 + 指标 */}
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-accent/10 px-3 py-1 font-mono text-xs font-semibold text-accent">
                  {f.tag}
                </span>
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

              {/* 底部链接 */}
              <Link
                href="/app"
                className="mt-6 inline-flex items-center gap-2 font-sans text-sm font-semibold text-accent transition-colors hover:text-ink"
              >
                {t("cardLink")}
                <span aria-hidden>→</span>
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
