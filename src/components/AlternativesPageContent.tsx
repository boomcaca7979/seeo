import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import { breadcrumbSchema, webPageSchema } from "@/lib/seo/schema";

// ===== Alternatives / 对比页 通用内容组件 =====
// 客观对比 SeeO 与第三方工具：对比表 + 各自适用场景 + FAQ（FAQ 仅渲染于 DOM，
// 不输出 FAQPage JSON-LD，避免被判定为 doorway / thin content）。
// 文案走 messages（alternativesSemrush / alternativesAhrefs），metadata 由 [locale] 页面生成。

type AltNamespace = "alternativesSemrush" | "alternativesAhrefs";

export default async function AlternativesPageContent({
  namespace,
  path,
  competitor,
}: {
  namespace: AltNamespace;
  path: string;
  competitor: string;
}) {
  const t = await getTranslations(namespace);
  const locale = (await getLocale()) as "en" | "zh";
  const lpath = localePath(locale, path);

  const faqs = t.raw("faqs") as Array<{ q: string; a: string }>;
  const comparison = t.raw("comparison") as Array<{
    dim: string;
    seeo: string;
    other: string;
  }>;
  const seeoFits = t.raw("seeoFits") as string[];
  const otherFits = t.raw("otherFits") as string[];
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
      <Navbar />

      <div className="doc-shell px-6 py-16">
        <span className="font-mono text-xs text-brand">
          {locale === "zh" ? "对比" : "ALTERNATIVES"}
        </span>
        <h1 className="mt-3 font-display text-3xl font-semibold text-ink mb-2">
          {t("title")}
        </h1>
        <p className="font-sans text-sm text-ink-60 mb-12">{t("subtitle")}</p>

        {/* Intro */}
        <section className="mb-14">
          <p className="font-sans text-sm leading-relaxed text-ink-80">{t("intro")}</p>
        </section>

        {/* Comparison table */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {locale === "zh" ? "逐项对比" : "Side-by-side comparison"}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <div className="card-a overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-4 py-3 text-left font-mono text-xs text-ink-40">
                    {locale === "zh" ? "维度" : "DIMENSION"}
                  </th>
                  <th className="px-4 py-3 text-left font-display text-sm text-ink">SeeO</th>
                  <th className="px-4 py-3 text-left font-display text-sm text-ink">
                    {competitor}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.dim} className="border-b border-line last:border-0 align-top">
                    <td className="px-4 py-3 font-medium text-ink">{r.dim}</td>
                    <td className="px-4 py-3 text-ink-60">{r.seeo}</td>
                    <td className="px-4 py-3 text-ink-60">{r.other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* When each fits */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {locale === "zh" ? "各自适合谁" : "Which one fits"}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card-a p-4">
              <h3 className="font-display text-sm font-semibold text-ink mb-2">SeeO</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                {seeoFits.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
            <div className="card-a p-4">
              <h3 className="font-display text-sm font-semibold text-ink mb-2">{competitor}</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                {otherFits.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
          </div>
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

        {/* Explore more (internal linking to guide + the other alternative) */}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={localePath(locale, "/guides/how-to-do-a-technical-seo-audit")}
            className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 font-sans text-xs text-ink-60 transition-colors hover:border-brand hover:text-ink"
          >
            {locale === "zh" ? "技术 SEO 审计指南 →" : "Technical SEO audit guide →"}
          </Link>
          <Link
            href={localePath(
              locale,
              competitor === "Semrush"
                ? "/alternatives/ahrefs"
                : "/alternatives/semrush"
            )}
            className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 font-sans text-xs text-ink-60 transition-colors hover:border-brand hover:text-ink"
          >
            {competitor === "Semrush"
              ? locale === "zh"
                ? "对比 SeeO 与 Ahrefs →"
                : "Compare SeeO vs Ahrefs →"
              : locale === "zh"
                ? "对比 SeeO 与 Semrush →"
                : "Compare SeeO vs Semrush →"}
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
            <Link href={localePath(locale, "/pricing")} className="btn-secondary inline-block px-6 py-2">
              {locale === "zh" ? "查看定价" : "View pricing"}
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
