import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import { breadcrumbSchema } from "@/lib/seo/schema";

// ===== /changelog 内容组件（en: /changelog · zh: /zh/changelog）=====
// 文案走 messages（changelogPage）。只记录真实发生的产品变化；
// 已发布与本地完成待部署分开标注，日期来自真实提交/交付记录。

export default async function ChangelogPage() {
  const t = await getTranslations("changelogPage");
  const locale = (await getLocale()) as "en" | "zh";
  const lpath = localePath(locale, "/changelog");

  const entries = t.raw("entries") as Array<{
    date: string;
    status: string;
    title: string;
    changes: string[];
  }>;

  const statusBadge = (status: string) =>
    status === "shipped"
      ? "badge-pos"
      : status === "localOnly"
        ? "badge-warn"
        : "badge-info";

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <JsonLd
        schema={breadcrumbSchema([{ name: t("title"), url: lpath }], locale)}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-mono text-3xl font-semibold text-ink mb-2">{t("title")}</h1>
        <p className="font-sans text-sm text-ink-60 mb-6">{t("subtitle")}</p>

        <div className="card-a p-4 mb-10">
          <p className="font-sans text-sm leading-relaxed text-ink-60">{t("localNote")}</p>
        </div>

        <div className="space-y-4">
          {entries.map((e) => (
            <article key={`${e.date}-${e.title}`} className="card-a p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-ink-40">{e.date}</span>
                <span className={statusBadge(e.status)}>
                  {t(`status.${e.status}` as "status.shipped")}
                </span>
                <h2 className="font-sans text-base font-semibold text-ink">{e.title}</h2>
              </div>
              <ul className="mt-3 space-y-2">
                {e.changes.map((c) => (
                  <li key={c.slice(0, 30)} className="flex items-start gap-2 font-sans text-sm leading-relaxed text-ink-60">
                    <span aria-hidden className="mt-1 font-mono text-xs text-brand">·</span>
                    {c}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="mt-10 border-t border-line pt-6">
          <p className="font-sans text-sm text-ink-40">{t("internalNote")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4 font-mono text-xs">
            <Link href={localePath(locale, "/contact")} className="text-brand hover:underline">
              {locale === "zh" ? "联系与反馈 →" : "Contact →"}
            </Link>
            <Link href={localePath(locale, "/pricing")} className="text-brand hover:underline">
              {locale === "zh" ? "套餐与额度 →" : "Plans & quotas →"}
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
