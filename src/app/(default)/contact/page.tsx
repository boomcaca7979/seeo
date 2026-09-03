import JsonLd from "@/components/JsonLd";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import { breadcrumbSchema } from "@/lib/seo/schema";

// ===== /contact 内容组件（en: /contact · zh: /zh/contact）=====
// 文案走 messages（contactPage）。支持邮箱 support@seeo.asia 已由 Creem 合规审核确认。

export default async function ContactPage() {
  const t = await getTranslations("contactPage");
  const locale = (await getLocale()) as "en" | "zh";
  const lpath = localePath(locale, "/contact");

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
            <p>{t("intro")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-semibold text-ink mb-2">{t("sections.email")}</h2>
            <p>
              <span className="font-semibold text-ink">{t("emailLabel")}: </span>
              <a
                href="mailto:support@seeo.asia"
                className="font-mono text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
              >
                support@seeo.asia
              </a>
            </p>
            <p className="mt-2">{t("emailNote")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-semibold text-ink mb-2">{t("sections.response")}</h2>
            <p>{t("response")}</p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}
