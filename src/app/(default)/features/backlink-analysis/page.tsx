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
import { BACKLINK_CHECKER_ENABLED } from "@/lib/seo/public-tools";

// ===== /features/backlink-analysis 内容组件（en: /features/backlink-analysis · zh: /zh/features/backlink-analysis）=====
// 文案全部走 messages（backlinks / featureShared），metadata 由 [locale] 页面按 locale 生成。
// 结构：定位 → 工作方式 → 数据字段 → 概况解读 → 工作流 → 与免费即时工具的差异 → 适用与限制 → FAQ
// 与 rank-tracking（持续测量）区分：本页是「外链概况的读取与跨时间对比」。
// 定位必须诚实：免费预览由 /tools/backlink-checker 承担（免登录、可拿到真实结果），
// 本页承担的是完整分析工作台（留存记录、筛选、竞品对比），需要账号与 Pro 计划。
//
// ⚠️ 免费工具当前暂缓上线（见 src/lib/seo/public-tools.ts）：
//   本页不得再声明「已有免登录免费预览」——相关入口与话术按开关下线，
//   等工具真正可用时自动恢复。不虚构可用状态，也不改成假 demo。

type NamedItem = { name: string; body: string };
type Step = { n: string; title: string; body: string };

export default async function BacklinkAnalysisFeaturePage() {
  const t = await getTranslations("backlinks");
  const s = await getTranslations("featureShared");
  const locale = (await getLocale()) as "en" | "zh";
  const path = "/features/backlink-analysis";
  const lpath = localePath(locale, path);

  const faqs = t.raw("faqs") as Array<{ q: string; a: string }>;
  const who = t.raw("who") as string[];
  const limits = t.raw("limits") as string[];
  const processItems = t.raw("how.process") as string[];
  const outputItems = t.raw("how.output") as string[];
  const summaryMetrics = t.raw("metrics.summary") as NamedItem[];
  const linkMetrics = t.raw("metrics.linkLevel") as NamedItem[];
  const reading = t.raw("reading.items") as NamedItem[];
  const workflow = t.raw("workflow.steps") as Step[];
  const positioningRaw = t.raw("positioning.items") as NamedItem[];
  // 免费工具暂缓上线时，「免登录即可跑免费预览」不再成立 → 用如实的现状说明替换该条
  const positioning: NamedItem[] = BACKLINK_CHECKER_ENABLED
    ? positioningRaw
    : positioningRaw.map((item, index) =>
        index === 0
          ? {
              name: t("positioning.unavailableFirst.name"),
              body: t("positioning.unavailableFirst.body"),
            }
          : item
      );

  const relatedMap: Array<[string, string]> = [
    ["seo-audit", "seoAudit"],
    ["rank-tracking", "rankTracking"],
    ["competitor-analysis", "competitorAnalysis"],
  ];

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
      <JsonLd schema={featureAppSchema("backlinks", lpath, locale)} />
      <Navbar />

      <div className="doc-shell px-6 py-16">
        <span className="font-mono text-xs text-brand">{s("eyebrow")}</span>
        <h1 className="mt-3 font-display text-3xl font-semibold text-ink mb-2">
          {t("title")}
        </h1>
        <p className="font-sans text-sm text-ink-60 mb-12">{t("subtitle")}</p>

        {/* 01 What it does */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {s("sections.whatItDoes")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80">{t("whatItDoes")}</p>
        </section>

        {/* 02 How it works */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-display text-lg font-semibold text-ink">
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

        {/* 03 What the link data includes */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {t("sections.metrics")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80 mb-4">
            {t("metrics.intro")}
          </p>
          <p className="mb-3 font-mono text-xs text-brand">
            {locale === "zh" ? "汇总指标" : "SUMMARY METRICS"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {summaryMetrics.map((item) => (
              <div key={item.name} className="card-a p-4">
                <h3 className="font-display text-sm font-semibold text-ink mb-1">{item.name}</h3>
                <p className="font-sans text-sm text-ink-60">{item.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 mb-3 font-mono text-xs text-brand">
            {locale === "zh" ? "逐条链接字段" : "PER-LINK FIELDS"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {linkMetrics.map((item) => (
              <div key={item.name} className="card-a p-4">
                <h3 className="font-display text-sm font-semibold text-ink mb-1">{item.name}</h3>
                <p className="font-sans text-sm text-ink-60">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 04 How to read a link profile */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">04</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {t("sections.reading")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80 mb-4">
            {t("reading.intro")}
          </p>
          <div className="space-y-3">
            {reading.map((item) => (
              <div key={item.name} className="card-a p-4">
                <h3 className="font-display text-sm font-semibold text-ink mb-1">{item.name}</h3>
                <p className="font-sans text-sm text-ink-60">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 05 Workflow */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">05</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {t("sections.workflow")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80 mb-4">
            {t("workflow.intro")}
          </p>
          <div className="space-y-3">
            {workflow.map((step) => (
              <div key={step.n} className="card-a p-4">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-brand">{step.n}</span>
                  <h3 className="font-display text-sm font-semibold text-ink">{step.title}</h3>
                </div>
                <p className="mt-1 font-sans text-sm text-ink-60">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 06 Positioning vs free instant checkers */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">06</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {t("sections.positioning")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80 mb-4">
            {t("positioning.intro")}
          </p>
          {/* 免费工具入口：正面回应「搜索者期待免费 checker，而完整分析需要账号」这一落差。
              工具暂缓上线期间不对外导流（避免把访客带到不可用的页面）。 */}
          {BACKLINK_CHECKER_ENABLED && (
            <p className="mb-4 font-mono text-xs text-ink-40">
              {s("toolCard")}{" · "}
              <Link
                href={localePath(locale, "/tools/backlink-checker")}
                className="text-brand underline-offset-2 hover:underline"
              >
                {t("freeTool.cta")}
              </Link>
            </p>
          )}
          <div className="space-y-3">
            {positioning.map((item) => (
              <div key={item.name} className="card-a p-4">
                <h3 className="font-display text-sm font-semibold text-ink mb-1">{item.name}</h3>
                <p className="font-sans text-sm text-ink-60">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 07 Fit & limits */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">07</span>
            <h2 className="font-display text-lg font-semibold text-ink">
              {s("sections.fitAndLimits")}
            </h2>
            <div className="hairline flex-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card-a p-4">
              <h3 className="font-display text-sm font-semibold text-ink mb-2">{s("fitTitle")}</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                {who.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
            <div className="card-a p-4">
              <h3 className="font-display text-sm font-semibold text-ink mb-2">{s("limitsTitle")}</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                {limits.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* 08 FAQ */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">08</span>
            <h2 className="font-display text-lg font-semibold text-ink">{s("sections.faq")}</h2>
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

        {/* Related capabilities */}
        <div className="mt-12 grid gap-3 sm:grid-cols-3">
          {relatedMap.map(([slug, key]) => (
            <Link
              key={slug}
              href={localePath(locale, `/features/${slug}`)}
              className="card-a p-4 transition-colors hover:border-brand"
            >
              <span className="font-mono text-xs text-brand">{s("related")}</span>
              <h3 className="mt-1 font-display text-sm font-semibold text-ink">
                {t(`related.${key}.title`)}
              </h3>
              <p className="mt-1 font-sans text-xs text-ink-60">{t(`related.${key}.desc`)}</p>
            </Link>
          ))}
        </div>

        {/* Free tool + supporting guide（Tool ↔ Feature ↔ Guide 主题集群的内链出口）
            工具暂缓上线期间只保留 Guide 出口，恢复开关后自动回到双卡布局。 */}
        <div className={BACKLINK_CHECKER_ENABLED ? "mt-4 grid gap-3 sm:grid-cols-2" : "mt-4"}>
          {BACKLINK_CHECKER_ENABLED && (
            <Link
              href={localePath(locale, "/tools/backlink-checker")}
              className="card-a block p-4 transition-colors hover:border-brand"
            >
              <span className="font-mono text-xs text-brand">{s("toolCard")}</span>
              <h3 className="mt-1 font-display text-sm font-semibold text-ink">
                {t("freeTool.title")}
              </h3>
              <p className="mt-1 font-sans text-xs text-ink-60">{t("freeTool.desc")}</p>
            </Link>
          )}
          <Link
            href={localePath(locale, "/guides/how-to-analyze-backlinks")}
            className="card-a block p-4 transition-colors hover:border-brand"
          >
            <span className="font-mono text-xs text-brand">{s("guideCard")}</span>
            <h3 className="mt-1 font-display text-sm font-semibold text-ink">{t("guide.title")}</h3>
            <p className="mt-1 font-sans text-xs text-ink-60">{t("guide.desc")}</p>
          </Link>
        </div>

        <div className="mt-8 card-a p-6 text-center">
          <h2 className="font-display text-lg font-semibold text-ink mb-2">{t("cta.title")}</h2>
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
