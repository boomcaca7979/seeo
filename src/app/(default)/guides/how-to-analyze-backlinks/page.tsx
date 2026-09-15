import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import {
  breadcrumbSchema,
  webPageSchema,
  articleSchema,
} from "@/lib/seo/schema";
import { BACKLINK_CHECKER_ENABLED } from "@/lib/seo/public-tools";

// ===== /guides/how-to-analyze-backlinks 内容组件（en / zh）=====
// 信息型指南（Informational intent）：外链分析 / 外链概况解读的可复用流程 + FAQ。
// FAQ 仅渲染于 DOM，不输出 FAQPage JSON-LD。
// 文案走 messages（guideBacklinkAnalysis），metadata 由 [locale] 页面按 locale 生成。
// JSON-LD：WebPage + BreadcrumbList + Article（无 FAQPage）。
// 注：Guide → Tool 的免费工具入口在工具暂缓上线期间下线（见 src/lib/seo/public-tools.ts）。

type GuideStep = { n: string; title: string; body: string; why: string };

export default async function GuideBacklinkAnalysisPage() {
  const t = await getTranslations("guideBacklinkAnalysis");
  const tb = await getTranslations("backlinkChecker");
  const locale = (await getLocale()) as "en" | "zh";
  const path = "/guides/how-to-analyze-backlinks";
  const lpath = localePath(locale, path);

  const steps = t.raw("steps") as GuideStep[];
  const faqs = t.raw("faqs") as Array<{ q: string; a: string }>;
  const caveats = t.raw("caveats.items") as string[];

  const relatedSlugs = ["backlink-analysis", "competitor-analysis", "rank-tracking"];
  const relatedKeys: Record<string, string> = {
    "backlink-analysis": "backlinkAnalysis",
    "competitor-analysis": "competitorAnalysis",
    "rank-tracking": "rankTracking",
  };

  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={webPageSchema(
          { name: t("title"), description: t("subtitle"), url: lpath },
          locale
        )}
      />
      <JsonLd
        schema={breadcrumbSchema(
          [
            { name: locale === "zh" ? "首页" : "Home", url: localePath(locale, "/") },
            { name: t("title"), url: lpath },
          ],
          locale
        )}
      />
      <JsonLd
        schema={articleSchema(
          { name: t("title"), description: t("subtitle"), url: lpath },
          locale
        )}
      />
      <Navbar />

      <div className="doc-shell px-6 py-16">
        <span className="font-mono text-xs text-brand">
          {locale === "zh" ? "指南" : "GUIDE"}
        </span>
        <h1 className="mt-3 font-display text-3xl font-semibold text-ink mb-2">
          {t("title")}
        </h1>
        <p className="font-sans text-sm text-ink-60 mb-12">{t("subtitle")}</p>

        {/* Intro */}
        <section className="mb-14">
          <p className="font-sans text-sm leading-relaxed text-ink-80">{t("intro")}</p>
        </section>

        {/* Steps */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {locale === "zh" ? "分步流程" : "Step-by-step"}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {steps.map((s) => (
              <div key={s.n} className="card-a p-4">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-brand">{s.n}</span>
                  <h3 className="font-display text-sm font-semibold text-ink">{s.title}</h3>
                </div>
                <p className="mt-1 font-sans text-sm text-ink-60">{s.body}</p>
                <p className="mt-2 font-sans text-xs text-ink-40">
                  <span className="font-mono">
                    {locale === "zh" ? "为什么重要" : "WHY IT MATTERS"}
                  </span>{" "}
                  · {s.why}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Caveats */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {t("caveats.title")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80 mb-4">
            {t("caveats.intro")}
          </p>
          <ul className="space-y-2 font-sans text-sm text-ink-60">
            {caveats.map((c) => (
              <li key={c}>· {c}</li>
            ))}
          </ul>
        </section>

        {/* FAQ (DOM only — no FAQPage schema) */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {locale === "zh" ? "常见问题" : "FAQ"}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {faqs.map((f) => (
              <div key={f.q} className="card-a p-4">
                <h3 className="font-sans text-sm font-medium text-ink mb-1">{f.q}</h3>
                <p className="font-sans text-sm text-ink-60">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Related SeeO features */}
        <div className="mt-12 grid gap-3 sm:grid-cols-3">
          {relatedSlugs.map((slug) => (
            <Link
              key={slug}
              href={localePath(locale, `/features/${slug}`)}
              className="card-a p-4 transition-colors hover:border-brand"
            >
              <span className="font-mono text-xs text-brand">SeeO</span>
              <h3 className="mt-1 font-display text-sm font-semibold text-ink">
                {t(`related.${relatedKeys[slug]}.title`)}
              </h3>
              <p className="mt-1 font-sans text-xs text-ink-60">
                {t(`related.${relatedKeys[slug]}.desc`)}
              </p>
            </Link>
          ))}
        </div>

        {/* Free tool（Guide → Tool 内链，Guide ↔ Tool ↔ Feature 集群的一部分）
            工具暂缓上线期间下线该入口，恢复开关后自动回到集群内链。 */}
        {BACKLINK_CHECKER_ENABLED && (
          <div className="mt-4">
            <Link
              href={localePath(locale, "/tools/backlink-checker")}
              className="card-a block p-4 transition-colors hover:border-brand"
            >
              <span className="font-mono text-xs text-brand">{tb("linkCard.eyebrow")}</span>
              <h3 className="mt-1 font-display text-sm font-semibold text-ink">
                {tb("linkCard.title")}
              </h3>
              <p className="mt-1 font-sans text-xs text-ink-60">{tb("linkCard.desc")}</p>
            </Link>
          </div>
        )}

        {/* CTA */}
        <div className="mt-8 card-a p-6 text-center">
          <h2 className="font-display text-lg font-semibold text-ink mb-2">{t("cta.title")}</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">{t("cta.subtitle")}</p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/signup" className="btn-primary inline-block px-6 py-2">
              {locale === "zh" ? "免费注册" : "Start free"}
            </Link>
            <Link
              href={localePath(locale, "/features/backlink-analysis")}
              className="btn-secondary inline-block px-6 py-2"
            >
              {locale === "zh" ? "查看外链分析工具" : "See the backlink tool"}
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="doc-shell px-6 py-6 text-center">
          <Link
            href={localePath(locale, "/")}
            className="font-mono text-xs text-ink-40 transition-colors hover:text-ink"
          >
            {locale === "zh" ? "← 返回首页" : "← Back to home"}
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}
