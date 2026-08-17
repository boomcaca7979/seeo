import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import { LOCALE_ROUTED_PATHS } from "@/i18n/locale-routed-paths";

// 链接定义：href 为逻辑路径，渲染时 locale-routed 路径按 locale 加 /zh 前缀
// async RSC：用 getTranslations/getLocale（server API），避免 async 组件中调用 hook
export default async function Footer() {
  const t = await getTranslations("footer");
  const locale = await getLocale();

  // locale-routed 路径（/、/pricing、/docs、/features/seo-audit）按 locale 生成；
  // 其余 legacy 页面路径保持原样
  const href = (path: string) =>
    LOCALE_ROUTED_PATHS.has(path) ? localePath(locale as "en" | "zh", path) : path;

  const cols = [
    {
      title: t("colProduct"),
      links: [
        { label: t("colProductLinks.seoAudit"), href: href("/features/seo-audit") },
        { label: t("colProductLinks.rankTracking"), href: "/features/rank-tracking" },
        { label: t("colProductLinks.backlinks"), href: "/features/backlink-analysis" },
        { label: t("colProductLinks.allFeatures"), href: "#features" },
      ],
    },
    {
      title: t("colPlans"),
      links: [
        { label: t("colPlansLinks.pricing"), href: href("/pricing") },
      ],
    },
    {
      title: t("colResources"),
      links: [
        { label: t("colResourcesLinks.docs"), href: href("/docs") },
      ],
    },
    {
      title: t("colCompany"),
      links: [
        { label: t("colCompanyLinks.about"), href: "/about" },
        { label: t("colCompanyLinks.privacy"), href: "/privacy" },
        { label: t("colCompanyLinks.terms"), href: "/terms" },
        { label: t("colCompanyLinks.refund"), href: "/refund" },
      ],
    },
  ];

  // ICP 占位（假号）：仅中文版保留展示，英文版不带出；
  // 真实备案信息待 Phase 2 法务清理决策，不在本阶段编造
  const icp = t("icp");

  return (
    <footer id="footer" className="bg-ink px-5 py-16 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-6">
          {/* Logo + 简介 */}
          <div className="col-span-2 md:col-span-2">
            <div className="flex items-center gap-1">
              <span className="font-display text-2xl font-bold text-d-text">
                See
              </span>
              <span className="font-display text-2xl font-bold text-gold">
                O
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-d-secondary">
              {t("tagline")}
            </p>
            <div className="mt-4 flex items-center gap-2 font-mono text-xs text-d-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" />
              {t("dataSource")}
            </div>
          </div>

          {/* 链接列 */}
          {cols.map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-gold">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="font-sans text-sm text-d-secondary transition-colors hover:text-d-text"
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
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-d-muted/15 pt-6 sm:flex-row sm:items-center">
          <div className="font-mono text-xs text-d-muted">
            {t("copyright")}
          </div>
          <div className="flex items-center gap-4 font-mono text-xs text-d-muted">
            {icp && (
              <>
                <span>{icp}</span>
                <span className="text-d-muted/50">·</span>
              </>
            )}
            <span>v1.0.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
