import JsonLd from "@/components/JsonLd";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import { breadcrumbSchema } from "@/lib/seo/schema";

// ===== /privacy 内容组件（en: /privacy · zh: /zh/privacy）=====
// 文案走 messages（privacyPage）。联系方式未定案：以"待公布"占位，不虚构邮箱。

export default async function PrivacyPage() {
  const t = await getTranslations("privacyPage");
  const locale = (await getLocale()) as "en" | "zh";
  const lpath = localePath(locale, "/privacy");

  const collectItems = t.raw("collectItems") as string[];

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <JsonLd
        schema={breadcrumbSchema(
          [
            { name: t("title"), url: lpath },
          ],
          locale
        )}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-mono text-3xl font-semibold text-ink mb-8">{t("title")}</h1>
        <div className="space-y-6 text-ink-60 leading-relaxed">
          <section>
            <h2 className="font-mono text-lg font-semibold text-ink mb-2">{t("sections.collect")}</h2>
            <p>{t("collectIntro")}</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {collectItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="font-mono text-lg font-semibold text-ink mb-2">{t("sections.use")}</h2>
            <p>{t("use")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-semibold text-ink mb-2">{t("sections.storage")}</h2>
            <p>{t("storage")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-semibold text-ink mb-2">{t("sections.cookies")}</h2>
            <p>{t("cookies")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-semibold text-ink mb-2">{t("sections.contact")}</h2>
            <p>{t("contact")}</p>
            <span className="mt-2 inline-block rounded border border-line px-3 py-1 font-mono text-xs text-ink-40">
              {t("contactNote")}
            </span>
          </section>
          <p className="pt-8 border-t border-line text-sm text-ink-40">{t("lastUpdated")}</p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
