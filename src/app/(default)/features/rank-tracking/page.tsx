import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import {
  breadcrumbSchema,
  webPageSchema,
  faqPageSchema,
  featureAppSchema,
} from "@/lib/seo/schema";

// ===== /features/rank-tracking 内容组件（en: /features/rank-tracking · zh: /zh/features/rank-tracking）=====
// 文案全部走 messages（rankTracking / featureShared），metadata 由 [locale] 页面按 locale 生成。

export default async function RankTrackingFeaturePage() {
  const t = await getTranslations("rankTracking");
  const s = await getTranslations("featureShared");
  const locale = (await getLocale()) as "en" | "zh";
  const path = "/features/rank-tracking";
  const lpath = localePath(locale, path);

  const faqs = t.raw("faqs") as Array<{ q: string; a: string }>;
  const who = t.raw("who") as string[];
  const limits = t.raw("limits") as string[];
  const processItems = t.raw("how.process") as string[];
  const outputItems = t.raw("how.output") as string[];

  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={webPageSchema(
          {
            name: t("title"),
            description: t("subtitle"),
            url: lpath,
          },
          locale
        )}
      />
      <JsonLd
        schema={breadcrumbSchema(
          [
            { name: s("backHome").replace("← ", ""), url: localePath(locale, "/") },
            { name: t("title"), url: lpath },
          ],
          locale
        )}
      />
      <JsonLd schema={faqPageSchema(lpath, faqs, locale)} />
      <JsonLd schema={featureAppSchema("rankTracking", lpath, locale)} />
      <Navbar />

      <div className="doc-shell px-6 py-16">
        <span className="font-mono text-xs text-brand">{s("eyebrow")}</span>
        <h1 className="mt-3 font-mono text-3xl font-semibold text-ink mb-2">
          {t("title")}
        </h1>
        <p className="font-sans text-sm text-ink-60 mb-12">{t("subtitle")}</p>

        {/* What it does */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-mono text-lg font-semibold text-ink">
              {s("sections.whatItDoes")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80">
            {t("whatItDoes")}
          </p>
        </section>

        {/* About this capability */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-mono text-lg font-semibold text-ink">
              {s("sections.howItWorks")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <div className="card-a p-5">
            <div className="space-y-4">
              <div>
                <span className="font-mono text-xs text-brand">{s("labels.input")}</span>
                <p className="mt-1 font-sans text-sm text-ink-80">{t("how.input")}</p>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">{s("labels.process")}</span>
                <ul className="mt-1 space-y-1 font-sans text-sm text-ink-80">
                  {processItems.map((item) => (
                    <li key={item}>→ {item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">{s("labels.output")}</span>
                <ul className="mt-1 space-y-1 font-sans text-sm text-ink-80">
                  {outputItems.map((item) => (
                    <li key={item}>→ {item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">{s("labels.dataSource")}</span>
                <p className="mt-1 font-sans text-sm text-ink-80">{t("how.dataSource")}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Who + limits */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-mono text-lg font-semibold text-ink">
              {s("sections.fitAndLimits")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card-a p-4">
              <h3 className="font-mono text-sm font-semibold text-ink mb-2">{s("fitTitle")}</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                {who.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
            <div className="card-a p-4">
              <h3 className="font-mono text-sm font-semibold text-ink mb-2">{s("limitsTitle")}</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                {limits.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">04</span>
            <h2 className="font-mono text-lg font-semibold text-ink">{s("sections.faq")}</h2>
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

        {/* Related + CTA */}
        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          <Link
            href={localePath(locale, "/features/seo-audit")}
            className="card-a p-4 transition-colors hover:border-brand"
          >
            <span className="font-mono text-xs text-brand">{s("related")}</span>
            <h3 className="mt-1 font-mono text-sm font-semibold text-ink">
              {t("related.seoAudit.title")}
            </h3>
            <p className="mt-1 font-sans text-xs text-ink-60">{t("related.seoAudit.desc")}</p>
          </Link>
          <Link
            href={localePath(locale, "/features/backlink-analysis")}
            className="card-a p-4 transition-colors hover:border-brand"
          >
            <span className="font-mono text-xs text-brand">{s("related")}</span>
            <h3 className="mt-1 font-mono text-sm font-semibold text-ink">
              {t("related.backlinks.title")}
            </h3>
            <p className="mt-1 font-sans text-xs text-ink-60">{t("related.backlinks.desc")}</p>
          </Link>
        </div>

        <div className="mt-8 card-a p-6 text-center">
          <h2 className="font-mono text-lg font-semibold text-ink mb-2">{t("cta.title")}</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">{t("cta.subtitle")}</p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/signup" className="btn-primary inline-block px-6 py-2">
              {s("cta.signup")}
            </Link>
            <Link href={localePath(locale, "/pricing")} className="btn-secondary inline-block px-6 py-2">
              {s("cta.pricing")}
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
            {s("backHome")}
          </Link>
        </div>
      </div>
        <Footer />
    </div>
  );
}
