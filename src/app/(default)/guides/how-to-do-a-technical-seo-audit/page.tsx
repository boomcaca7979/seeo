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

// ===== /guides/how-to-do-a-technical-seo-audit 内容组件（en / zh）=====
// 信息型指南（Informational intent）：真实可复用的审计步骤 + FAQ（FAQ 仅渲染于 DOM，
// 不输出 FAQPage JSON-LD，避免被判定为 doorway / thin content）。
// 文案走 messages（guideTechnicalSeoAudit），metadata 由 [locale] 页面按 locale 生成。
// JSON-LD：WebPage + BreadcrumbList + Article（无 FAQPage）。

export default async function GuideTechnicalSeoAuditPage() {
  const t = await getTranslations("guideTechnicalSeoAudit");
  const locale = (await getLocale()) as "en" | "zh";
  const path = "/guides/how-to-do-a-technical-seo-audit";
  const lpath = localePath(locale, path);

  const steps = t.raw("steps") as Array<{ n: string; title: string; body: string }>;
  const faqs = t.raw("faqs") as Array<{ q: string; a: string }>;
  const related = t.raw("related") as Record<
    string,
    { title: string; desc: string }
  >;

  const relatedLinks = Object.entries(related).map(([slug, r]) => ({
    href: localePath(locale, `/features/${slug}`),
    title: r.title,
    desc: r.desc,
  }));

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
              </div>
            ))}
          </div>
        </section>

        {/* FAQ (DOM only — no FAQPage schema) */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
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
          {relatedLinks.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="card-a p-4 transition-colors hover:border-brand"
            >
              <span className="font-mono text-xs text-brand">SeeO</span>
              <h3 className="mt-1 font-display text-sm font-semibold text-ink">{r.title}</h3>
              <p className="mt-1 font-sans text-xs text-ink-60">{r.desc}</p>
            </Link>
          ))}
        </div>

        {/* Explore more (internal linking to both alternatives) */}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={localePath(locale, "/alternatives/semrush")}
            className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 font-sans text-xs text-ink-60 transition-colors hover:border-brand hover:text-ink"
          >
            {locale === "zh" ? "对比 SeeO 与 Semrush →" : "Compare SeeO vs Semrush →"}
          </Link>
          <Link
            href={localePath(locale, "/alternatives/ahrefs")}
            className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 font-sans text-xs text-ink-60 transition-colors hover:border-brand hover:text-ink"
          >
            {locale === "zh" ? "对比 SeeO 与 Ahrefs →" : "Compare SeeO vs Ahrefs →"}
          </Link>
        </div>

        {/* CTA */}
        <div className="mt-8 card-a p-6 text-center">
          <h2 className="font-display text-lg font-semibold text-ink mb-2">{t("cta.title")}</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">{t("cta.subtitle")}</p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/signup" className="btn-primary inline-block px-6 py-2">
              {locale === "zh" ? "免费注册" : "Start free"}
            </Link>
            <Link
              href={localePath(locale, "/features/seo-audit")}
              className="btn-secondary inline-block px-6 py-2"
            >
              {locale === "zh" ? "查看审计工具" : "See the audit tool"}
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
