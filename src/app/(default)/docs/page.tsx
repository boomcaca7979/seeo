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
} from "@/lib/seo/schema";

// ===== /docs 内容组件（en: /docs · zh: /zh/docs）=====
// 文案全部走 messages（docsPage），metadata 由 [locale] 页面按 locale 生成。
// 注意：免费/付费额度不在文案中硬编码，统一指向定价页（billing 单一数据源）。

interface FeatureDoc {
  id: string;
  name: string;
  desc: string;
  capabilities: string[];
}

interface DataSourceDoc {
  name: string;
  scope: string;
  note: string;
}

export default async function DocsPage() {
  const t = await getTranslations("docsPage");
  const s = await getTranslations("featureShared");
  const locale = (await getLocale()) as "en" | "zh";
  const lpath = localePath(locale, "/docs");

  const intro = t.raw("intro") as string[];
  const features = t.raw("features") as FeatureDoc[];
  const dataSources = t.raw("dataSources") as DataSourceDoc[];
  const faqs = t.raw("faqs") as Array<{ q: string; a: string }>;

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
            { name: t("title"), url: lpath },
          ],
          locale
        )}
      />
      <JsonLd schema={faqPageSchema(lpath, faqs, locale)} />
      <Navbar />

      <div className="doc-shell px-6 py-16">
        <span className="font-mono text-xs text-brand">{t("eyebrow")}</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink mb-2">{t("title")}</h1>
        <p className="font-sans text-sm text-ink-60 mb-12">{t("subtitle")}</p>

        {/* 产品介绍 */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.intro")}</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-4">
            {intro.map((p) => (
              <p key={p.slice(0, 24)} className="font-sans text-sm leading-relaxed text-ink-80">
                {p}
              </p>
            ))}
          </div>
        </section>

        {/* 功能说明 */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.features")}</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-4">
            {features.map((f) => (
              <div key={f.id} className="card-a p-5">
                <h3 className="font-mono text-sm font-bold text-ink mb-2">{f.name}</h3>
                <p className="font-sans text-sm text-ink-60 mb-3">{f.desc}</p>
                <div className="flex flex-wrap gap-2">
                  {f.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded border border-line bg-paper px-2 py-0.5 font-mono text-[0.625rem] text-ink-60"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 数据来源 */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.dataSources")}</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {dataSources.map((s) => (
              <div key={s.name} className="card-a p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-mono text-sm font-bold text-ink">{s.name}</h3>
                </div>
                <p className="font-sans text-sm text-ink-60 mb-1">{s.scope}</p>
                <p className="font-sans text-xs text-ink-40">{s.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 常见问题 */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">04</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.faq")}</h2>
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

        <div className="mt-16 card-a p-6 text-center">
          <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("contact.title")}</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">{t("contact.body")}</p>
          <span className="inline-block rounded border border-line px-3 py-1 font-mono text-xs text-ink-40">
            {t("contact.note")}
          </span>
        </div>
      </div>

      {/* 返回首页 */}
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
