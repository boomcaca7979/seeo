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
    <section id="features" className="bg-station px-5 py-20 sm:px-8 sm:py-28">
      <div className="site-shell">
        {/* 标题 */}
        <div className="max-w-2xl">
          <span className="font-mono text-sm text-y-secondary">
            {t("sectionTag")}
          </span>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-y-text sm:text-5xl">
            {t("sectionTitle")}
          </h2>
          <p className="mt-4 text-base text-y-secondary sm:text-lg">
            {t("sectionSubtitle")}
          </p>
        </div>

        {/* 卡片网格 */}
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.title}
              className="group flex flex-col rounded-2xl bg-ink p-6 ring-1 ring-ink/10 transition-colors hover:ring-gold/40"
            >
              {/* 顶部标签 + 指标 */}
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-gold/15 px-2.5 py-1 font-mono text-xs font-semibold text-gold">
                  {f.tag}
                </span>
                <div className="text-right">
                  <div className="font-mono text-[0.625rem] text-d-muted">
                    {f.metricLabel}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <span className="font-mono text-sm font-semibold text-d-text">
                      {f.metricValue}
                    </span>
                  </div>
                </div>
              </div>

              {/* 标题 + 描述 */}
              <h3 className="mt-5 font-display text-xl font-semibold text-d-text">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-d-secondary">
                {f.desc}
              </p>

              {/* 功能点 */}
              <ul className="mt-5 space-y-2">
                {f.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-center gap-2 font-mono text-xs text-d-secondary"
                  >
                    <span className="h-1 w-1 rounded-full bg-gold" />
                    {b}
                  </li>
                ))}
              </ul>

              {/* 底部链接 */}
              <Link
                href="#cta"
                className="mt-6 inline-flex items-center gap-1.5 font-sans text-sm font-semibold text-gold transition-colors hover:text-aurora-blue"
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
