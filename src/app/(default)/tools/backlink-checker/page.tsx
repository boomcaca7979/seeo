import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import BacklinkChecker from "@/components/BacklinkChecker";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import {
  breadcrumbSchema,
  webPageSchema,
  faqPageSchema,
  webApplicationSchema,
} from "@/lib/seo/schema";
import { BACKLINK_CHECKER_ENABLED, BACKLINK_CHECKER_PATH } from "@/lib/seo/public-tools";

// ===== /tools/backlink-checker 内容组件（en / zh）=====
// 定位：公开的免费外链预览工具（Transactional / utility intent）。
//   - 工具本身是页面核心：输入域名即可拿到真实结果，不做「输入框 → 只有 Sign up」的空壳
//   - 免费结果 = 域名维度汇总指标 + 来源权重最高的 5 条外链样本（真实数据，非 demo）
//   - 完整能力（留存 100 条记录、筛选排序、竞品对比）留在 /features/backlink-analysis（Commercial intent）
//   - 方法论留在 /guides/how-to-analyze-backlinks（Informational intent）
// 三者构成 Guide ↔ Tool ↔ Feature 的主题集群，意图不重叠。
//
// ⚠️ 当前状态：暂缓上线（开关见 src/lib/seo/public-tools.ts）
//   DataForSEO 未充值 / 未配置生产凭据 → 工具拿不到任何真实外链数据。
//   因此默认渲染「暂未开放」的如实状态：不渲染输入表单、不展示任何数据、
//   不使用演示数据充数；长内容区块与 FAQ 一并停用，避免形成「内容很多但功能是死的」页面。
//   功能代码（组件 / 服务层 / API / 缓存 / 限流 / 测试）全部保留；开关打开后本页自动恢复原状。
//
// JSON-LD（启用时）：WebPage + BreadcrumbList + FAQPage + WebApplication。
//   停用时只保留 WebPage + BreadcrumbList —— 不为一个不可用的工具声明 WebApplication / FAQPage。
// FAQPage 的 faqs 与页面 DOM 共用同一 messages 常量，保证 HTML 内容与 schema 完全一致。

type NamedItem = { name: string; body: string };
type RelatedItem = { path: string; title: string; desc: string };

export default async function BacklinkCheckerToolPage() {
  const t = await getTranslations("backlinkChecker");
  const locale = (await getLocale()) as "en" | "zh";
  const path = BACKLINK_CHECKER_PATH;
  const lpath = localePath(locale, path);
  const enabled = BACKLINK_CHECKER_ENABLED;

  // 停用时不再读取长文案，页面只剩最小、如实的不可用态
  const metricItems = enabled ? (t.raw("metrics.items") as NamedItem[]) : [];
  const readingItems = enabled ? (t.raw("reading.items") as NamedItem[]) : [];
  const included = enabled ? (t.raw("scope.included") as string[]) : [];
  const excluded = enabled ? (t.raw("scope.excluded") as string[]) : [];
  const fullItems = enabled ? (t.raw("full.items") as string[]) : [];
  const faqs = enabled ? (t.raw("faqs") as Array<{ q: string; a: string }>) : [];
  const related = enabled ? (t.raw("related.items") as RelatedItem[]) : [];

  const homeLabel = locale === "zh" ? "首页" : "Home";

  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={webPageSchema(
          {
            name: enabled ? t("title") : t("unavailable.heading"),
            description: enabled ? t("subtitle") : t("unavailable.body"),
            url: lpath,
          },
          locale
        )}
      />
      <JsonLd
        schema={breadcrumbSchema(
          [
            { name: homeLabel, url: localePath(locale, "/") },
            { name: enabled ? t("title") : t("unavailable.heading"), url: lpath },
          ],
          locale
        )}
      />
      {/* 工具不可用时不为它声明 WebApplication / FAQPage */}
      {enabled && (
        <JsonLd
          schema={webApplicationSchema(
            { name: t("title"), description: t("subtitle"), url: lpath },
            locale
          )}
        />
      )}
      {enabled && faqs.length > 0 && <JsonLd schema={faqPageSchema(lpath, faqs, locale)} />}
      <Navbar />

      <div className="doc-shell px-6 py-16">
        {/* ---------- Hero + 工具 ---------- */}
        <section className="mb-14">
          <span className="font-mono text-xs text-brand">
            {enabled ? t("eyebrow") : t("unavailable.badge")}
          </span>
          <h1 className="mt-3 mb-2 font-display text-3xl font-semibold text-ink">
            {enabled ? t("title") : t("unavailable.heading")}
          </h1>
          <p className="mb-8 max-w-3xl font-sans text-sm leading-relaxed text-ink-60">
            {enabled ? t("subtitle") : t("unavailable.body")}
          </p>

          {enabled ? (
            <BacklinkChecker />
          ) : (
            /* 暂未开放：不渲染任何输入表单，避免让访客以为可以查到真实数据 */
            <div className="card-a mx-auto max-w-2xl p-6 text-center">
              <p className="font-mono text-xs text-ink-40">{t("unavailable.status")}</p>
              <p className="mt-3 font-sans text-sm text-ink-60">{t("unavailable.explain")}</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={localePath(locale, "/features/backlink-analysis")}
                  className="btn-secondary inline-block px-6 py-2"
                >
                  {t("unavailable.cta")}
                </Link>
              </div>
            </div>
          )}

          {enabled && (
            <p className="mt-6 text-center font-mono text-xs text-ink-40">{t("dataNote")}</p>
          )}
        </section>

        {enabled && (
          <>
            {/* ---------- 01 指标解读 ---------- */}
            <section className="mb-14">
              <div className="mb-6 flex items-center gap-3">
                <span className="font-mono text-sm text-brand">01</span>
                <h2 className="font-display text-lg font-semibold text-ink">{t("metrics.title")}</h2>
                <div className="hairline flex-1" />
              </div>
              <p className="mb-4 max-w-3xl font-sans text-sm leading-relaxed text-ink-80">
                {t("metrics.intro")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {metricItems.map((item) => (
                  <div key={item.name} className="card-a p-4">
                    <h3 className="font-display text-sm font-semibold text-ink">{item.name}</h3>
                    <p className="mt-1 font-sans text-sm text-ink-60">{item.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* ---------- 02 阅读方法 ---------- */}
            <section className="mb-14">
              <div className="mb-6 flex items-center gap-3">
                <span className="font-mono text-sm text-brand">02</span>
                <h2 className="font-display text-lg font-semibold text-ink">{t("reading.title")}</h2>
                <div className="hairline flex-1" />
              </div>
              <p className="mb-4 max-w-3xl font-sans text-sm leading-relaxed text-ink-80">
                {t("reading.intro")}
              </p>
              <div className="space-y-3">
                {readingItems.map((item) => (
                  <div key={item.name} className="card-a p-4">
                    <h3 className="font-display text-sm font-semibold text-ink">{item.name}</h3>
                    <p className="mt-1 font-sans text-sm text-ink-60">{item.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* ---------- 03 能力范围（包含 / 不包含） ---------- */}
            <section className="mb-14">
              <div className="mb-6 flex items-center gap-3">
                <span className="font-mono text-sm text-brand">03</span>
                <h2 className="font-display text-lg font-semibold text-ink">{t("scope.title")}</h2>
                <div className="hairline flex-1" />
              </div>
              <p className="mb-4 max-w-3xl font-sans text-sm leading-relaxed text-ink-80">
                {t("scope.intro")}
              </p>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="card-a p-5">
                  <h3 className="font-display text-sm font-semibold text-ink">
                    {t("scope.includedTitle")}
                  </h3>
                  <ul className="mt-3 space-y-2 font-sans text-sm text-ink-60">
                    {included.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 font-mono text-xs text-brand">+</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card-a p-5">
                  <h3 className="font-display text-sm font-semibold text-ink">
                    {t("scope.excludedTitle")}
                  </h3>
                  <ul className="mt-3 space-y-2 font-sans text-sm text-ink-60">
                    {excluded.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 font-mono text-xs text-ink-40">−</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {/* ---------- 04 完整分析 ---------- */}
            <section className="mb-14">
              <div className="mb-6 flex items-center gap-3">
                <span className="font-mono text-sm text-brand">04</span>
                <h2 className="font-display text-lg font-semibold text-ink">{t("full.title")}</h2>
                <div className="hairline flex-1" />
              </div>
              <p className="mb-4 max-w-3xl font-sans text-sm leading-relaxed text-ink-80">
                {t("full.intro")}
              </p>
              <ul className="space-y-2 font-sans text-sm text-ink-60">
                {fullItems.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
              <div className="mt-5">
                <Link
                  href={localePath(locale, "/features/backlink-analysis")}
                  className="btn-secondary inline-block px-6 py-2"
                >
                  {t("full.cta")}
                </Link>
              </div>
            </section>

            {/* ---------- 05 FAQ（DOM 与 FAQPage JSON-LD 同源） ---------- */}
            <section className="mb-14">
              <div className="mb-6 flex items-center gap-3">
                <span className="font-mono text-sm text-brand">05</span>
                <h2 className="font-display text-lg font-semibold text-ink">
                  {locale === "zh" ? "常见问题" : "FAQ"}
                </h2>
                <div className="hairline flex-1" />
              </div>
              <div className="space-y-3">
                {faqs.map((faq) => (
                  <div key={faq.q} className="card-a p-4">
                    <h3 className="mb-1 font-sans text-sm font-medium text-ink">{faq.q}</h3>
                    <p className="font-sans text-sm text-ink-60">{faq.a}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* ---------- Related（Guide ↔ Tool ↔ Feature 集群） ---------- */}
            <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((item) => (
                <Link
                  key={item.path}
                  href={localePath(locale, item.path)}
                  className="card-a p-4 transition-colors hover:border-brand"
                >
                  <span className="font-mono text-xs text-brand">{t("related.eyebrow")}</span>
                  <h3 className="mt-1 font-display text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1 font-sans text-xs text-ink-60">{item.desc}</p>
                </Link>
              ))}
            </div>

            {/* ---------- CTA ---------- */}
            <div className="mt-8 card-a p-6 text-center">
              <h2 className="mb-2 font-display text-lg font-semibold text-ink">{t("cta.title")}</h2>
              <p className="mb-4 font-sans text-sm text-ink-60">{t("cta.subtitle")}</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={localePath(locale, "/features/backlink-analysis")}
                  className="btn-primary inline-block px-6 py-2"
                >
                  {t("cta.primary")}
                </Link>
                <Link href="/signup" className="btn-secondary inline-block px-6 py-2">
                  {t("cta.secondary")}
                </Link>
              </div>
            </div>
          </>
        )}
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
