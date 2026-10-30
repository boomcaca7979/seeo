"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { localePath } from "@/i18n/seo";
import { LOCALE_ROUTED_PATHS } from "@/i18n/locale-routed-paths";
import { useDisabledPublicPaths } from "@/components/PublicPathsProvider";

// 链接定义：path 为逻辑路径，渲染时 locale-routed 路径按 locale 加 /zh 前缀；
// 「暂缓上线」的公开路径（见 src/lib/seo/public-tools.ts，由 layout 经 context 注入）
// 不渲染内链——它们输出 noindex，站内持续导流会让爬虫反复抓到被排除的页面。
// client 组件：可同时嵌入 server 营销页与 client 页面（如 /pricing），
// 文案/locale 由 (default)/[locale] layout 的 NextIntlClientProvider 提供
export default function Footer() {
  const t = useTranslations("footer");
  const locale = useLocale();
  const disabledPaths = useDisabledPublicPaths();

  // locale-routed 路径（/、/pricing、/docs、/features/seo-audit）按 locale 生成；
  // 其余 legacy 页面路径保持原样
  const href = (path: string) =>
    LOCALE_ROUTED_PATHS.has(path) ? localePath(locale as "en" | "zh", path) : path;

  const cols = [
    {
      title: t("colProduct"),
      links: [
        { label: t("colProductLinks.seoAudit"), path: "/features/seo-audit" },
        { label: t("colProductLinks.rankTracking"), path: "/features/rank-tracking" },
        { label: t("colProductLinks.keywordResearch"), path: "/features/keyword-research" },
        { label: t("colProductLinks.competitorAnalysis"), path: "/features/competitor-analysis" },
        { label: t("colProductLinks.contentOptimization"), path: "/features/content-optimization" },
        { label: t("colProductLinks.backlinkAnalysis"), path: "/features/backlink-analysis" },
      ],
    },
    {
      title: t("colPlans"),
      links: [
        { label: t("colPlansLinks.pricing"), path: "/pricing" },
      ],
    },
    {
      title: t("colResources"),
      links: [
        { label: t("colResourcesLinks.docs"), path: "/docs" },
        { label: t("colResourcesLinks.changelog"), path: "/changelog" },
        { label: t("colResourcesLinks.seoIssues"), path: "/seo-issues" },
      ],
    },
    {
      title: t("colCompany"),
      links: [
        { label: t("colCompanyLinks.about"), path: "/about" },
        { label: t("colCompanyLinks.contact"), path: "/contact" },
        { label: t("colCompanyLinks.privacy"), path: "/privacy" },
        { label: t("colCompanyLinks.terms"), path: "/terms" },
        { label: t("colCompanyLinks.refund"), path: "/refund" },
      ],
    },
  ];

  // ICP 占位（假号）：仅中文版保留展示，英文版不带出；
  // 真实备案信息待 Phase 2 法务清理决策，不在本阶段编造
  const icp = t("icp");

  return (
    <footer id="footer" className="border-t border-line bg-paper px-5 py-16 sm:px-8">
      <div className="site-shell">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-6">
          {/* Logo + 简介 */}
          <div className="col-span-2 md:col-span-2">
            <div className="flex items-center gap-1">
              <span className="font-display text-2xl font-semibold text-ink">
                See
              </span>
              <span className="font-display text-2xl font-semibold text-accent">
                O
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-60">
              {t("tagline")}
            </p>
            <div className="mt-4 flex items-center gap-2 font-mono text-xs text-ink-40">
              <span className="h-1.5 w-1.5 rounded-full bg-pos" />
              {t("dataSource")}
            </div>
            <a
              href="mailto:support@seeo.asia"
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-ink-60 transition-colors hover:text-ink"
            >
              <span>{t("support")}:</span>
              <span className="underline decoration-line underline-offset-4">support@seeo.asia</span>
            </a>
          </div>

          {/* 链接列 */}
          {cols.map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-40">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-3">
                {col.links
                  .filter((l) => !disabledPaths.includes(l.path))
                  .map((l) => (
                    <li key={l.label}>
                      <Link
                        href={href(l.path)}
                        className="font-sans text-sm text-ink-60 transition-colors hover:text-ink"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 底栏 */}
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-line pt-6 sm:flex-row sm:items-center">
          <div className="font-mono text-xs text-ink-40">
            {t("copyright")}
          </div>
          <div className="flex items-center gap-4 font-mono text-xs text-ink-40">
            {icp && (
              <>
                <span>{icp}</span>
                <span className="text-ink-25">·</span>
              </>
            )}
            <span>v0.1.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
