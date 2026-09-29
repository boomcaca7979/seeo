// ===== H｜问题型落地页渲染（en / zh 共用）=====
// 结构：Hero → 用户问题 → 由哪些检查暴露 → 例子 → FAQ → CTA → 相关页
// 内容全部来自 src/lib/seo/landing-pages.ts（单一来源），本组件不含任何文案常量。
// 结构化数据只放与页面真实内容一致的三类：WebPage / BreadcrumbList / FAQPage。

import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { getLocale } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import { breadcrumbSchema, faqPageSchema, webPageSchema } from "@/lib/seo/schema";
import { landingCopy, landingPageById } from "@/lib/seo/landing-pages";

export default async function IssueLandingPage({ pageId }: { pageId: string }) {
  const page = landingPageById(pageId);
  if (!page) throw new Error(`[landing-pages] 未定义的 pageId: ${pageId}`);

  const locale = (await getLocale()) as "en" | "zh";
  const copy = landingCopy(page, locale);
  const lpath = localePath(locale, page.path);
  const homeLabel = locale === "zh" ? "首页" : "Home";
  const issuesLabel = locale === "zh" ? "SEO 问题" : "SEO issues";

  const relatedItems = page.internalLinks.map((p) => ({
    href: localePath(locale, p),
    label: p === "/seo-issues" ? issuesLabel : p,
  }));
  const ctaHref = localePath(locale, page.ctaHref);

  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={webPageSchema({ name: copy.h1, description: copy.metaDescription, url: lpath }, locale)}
      />
      <JsonLd
        schema={breadcrumbSchema(
          [
            { name: homeLabel, url: localePath(locale, "/") },
            { name: issuesLabel, url: localePath(locale, "/seo-issues") },
            { name: copy.h1, url: lpath },
          ],
          locale
        )}
      />
      <JsonLd schema={faqPageSchema(lpath, copy.faqs, locale)} />

      <Navbar />

      <main className="doc-shell px-6 py-16">
        <span className="font-mono text-xs text-brand">{issuesLabel.toUpperCase()}</span>
        <h1 className="mt-3 font-display text-3xl font-semibold text-ink">{copy.h1}</h1>
        <p className="mt-4 max-w-3xl font-sans text-base leading-relaxed text-ink-60">{copy.lead}</p>

        {/* 由哪些检查暴露 */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-ink">
            {locale === "zh" ? "这个现象由哪些检查暴露" : "Which checks surface this"}
          </h2>
          <ul className="mt-4 space-y-3">
            {copy.detectedBy.map((item) => (
              <li key={item} className="font-sans text-sm leading-relaxed text-ink-60">
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 font-mono text-xs text-ink-40">
            {locale === "zh" ? "对应检查项：" : "Check ids: "}
            {page.relatedChecks.join(" · ")}
          </p>
        </section>

        {/* 例子 */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-ink">
            {locale === "zh" ? "一个具体例子" : "A concrete example"}
          </h2>
          <p className="mt-4 max-w-3xl font-sans text-sm leading-relaxed text-ink-60">{copy.example}</p>
        </section>

        {/* FAQ */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-ink">FAQ</h2>
          <dl className="mt-4 space-y-6">
            {copy.faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-sans text-sm font-semibold text-ink">{f.q}</dt>
                <dd className="mt-2 max-w-3xl font-sans text-sm leading-relaxed text-ink-60">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* CTA（指向真实的免费审计 / 关联功能） */}
        <section className="mt-12">
          <Link href={ctaHref} className="btn-primary inline-block px-6 py-3 text-sm">
            {copy.ctaLabel}
          </Link>
        </section>

        {/* 相关页（防孤岛） */}
        <section className="mt-14 border-t border-line pt-8">
          <h2 className="font-mono text-xs text-ink-40">{locale === "zh" ? "相关页面" : "RELATED"}</h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {relatedItems.map((r) => (
              <li key={r.href}>
                <Link href={r.href} className="font-sans text-sm text-accent hover:underline">
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <Footer />
    </div>
  );
}
