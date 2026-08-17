import Link from "next/link";
import Navbar from "@/components/Navbar";
import JsonLd from "@/components/JsonLd";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import {
  breadcrumbSchema,
  aboutPageSchema,
  faqPageSchema,
} from "@/lib/seo/schema";

// ===== /about 内容组件（en: /about · zh: /zh/about）=====
// 文案全部走 messages（aboutPage / featureShared），metadata 由 [locale] 页面按 locale 生成。
// 只描述真实定位与能力，不虚构公司规模 / 用户量 / 融资 / 客户。

interface WhoItem {
  who: string;
  why: string;
}

interface CapabilityItem {
  name: string;
  desc: string;
  href?: string;
}

interface DataSourceItem {
  name: string;
  scope: string;
}

export default async function AboutPage() {
  const t = await getTranslations("aboutPage");
  const s = await getTranslations("featureShared");
  const locale = (await getLocale()) as "en" | "zh";
  const lpath = localePath(locale, "/about");

  const what = t.raw("what") as string[];
  const who = t.raw("who") as WhoItem[];
  const capabilities = t.raw("capabilities") as CapabilityItem[];
  const dataSources = t.raw("dataSources") as DataSourceItem[];
  const notDoing = t.raw("notDoing") as string[];
  const faqs = t.raw("faqs") as Array<{ q: string; a: string }>;

  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={aboutPageSchema(
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
      <Navbar />

      <div className="mx-auto max-w-4xl px-6 py-16">
        <span className="font-mono text-xs text-brand">{t("eyebrow")}</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink mb-2">
          {t("title")}
        </h1>
        <p className="font-sans text-sm text-ink-60 mb-12">{t("subtitle")}</p>

        {/* What is SeeO */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.what")}</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-4">
            {what.map((p) => (
              <p key={p.slice(0, 24)} className="font-sans text-sm leading-relaxed text-ink-80">
                {p}
              </p>
            ))}
          </div>
        </section>

        {/* Who is it for */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.who")}</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {who.map((item) => (
              <div key={item.who} className="card-a p-4">
                <h3 className="font-mono text-sm font-bold text-ink mb-1">{item.who}</h3>
                <p className="font-sans text-sm text-ink-60">{item.why}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.how")}</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="card-a p-5">
            <div className="space-y-3 font-sans text-sm text-ink-80">
              <div>
                <span className="font-mono text-xs text-brand">{s("labels.input")}</span>
                <p className="mt-1">{t("how.input")}</p>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">{s("labels.process")}</span>
                <p className="mt-1">{t("how.process")}</p>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">{s("labels.output")}</span>
                <p className="mt-1">{t("how.output")}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">04</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.capabilities")}</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {capabilities.map((c) => (
              <div key={c.name} className="card-a p-4">
                {c.href ? (
                  <Link
                    href={localePath(locale, c.href)}
                    className="font-mono text-sm font-bold text-ink hover:text-brand"
                  >
                    {c.name} →
                  </Link>
                ) : (
                  <h3 className="font-mono text-sm font-bold text-ink">{c.name}</h3>
                )}
                <p className="mt-1 font-sans text-sm text-ink-60">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Data sources */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">05</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.dataSources")}</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-2">
            {dataSources.map((item) => (
              <div key={item.name} className="card-a p-3">
                <span className="font-mono text-xs font-bold text-ink">{item.name}</span>
                <span className="ml-3 font-sans text-xs text-ink-60">{item.scope}</span>
              </div>
            ))}
          </div>
        </section>

        {/* What SeeO does NOT do */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">06</span>
            <h2 className="font-mono text-lg font-bold text-ink">{t("sections.notDoing")}</h2>
            <div className="hairline flex-1" />
          </div>
          <p className="mb-4 font-sans text-sm text-ink-60">{t("notDoingIntro")}</p>
          <ul className="space-y-2">
            {notDoing.map((item) => (
              <li key={item} className="flex items-center gap-2 font-sans text-sm text-ink-60">
                <span className="font-mono text-xs text-ink-40">✗</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* FAQ */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">07</span>
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

        {/* CTA */}
        <div className="mt-16 card-a p-6 text-center">
          <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("cta.title")}</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">{t("cta.subtitle")}</p>
          <div className="flex items-center justify-center gap-3">
            <Link href={localePath(locale, "/pricing")} className="btn-primary inline-block px-6 py-2">
              {t("cta.pricing")}
            </Link>
            <Link href={localePath(locale, "/docs")} className="btn-secondary inline-block px-6 py-2">
              {t("cta.docs")}
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto max-w-4xl px-6 py-6 text-center">
          <Link
            href={localePath(locale, "/")}
            className="font-mono text-xs text-ink-40 transition-colors hover:text-ink"
          >
            {s("backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}
