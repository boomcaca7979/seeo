import JsonLd from "@/components/JsonLd";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import { breadcrumbSchema } from "@/lib/seo/schema";

// ===== /terms 内容组件（en: /terms · zh: /zh/terms）=====
// 文案走 messages（termsPage）。争议解决沿用既有中文条款表述（中华人民共和国法律 +
// 服务提供所在地人民法院），未新增任何公司主体 / 注册地址 / 司法管辖事实；
// 主体与管辖最终确认列为待产品决策项。

export default async function TermsPage() {
  const t = await getTranslations("termsPage");
  const locale = (await getLocale()) as "en" | "zh";
  const lpath = localePath(locale, "/terms");

  const responsibilities = t.raw("responsibilities") as string[];

  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={breadcrumbSchema(
          [
            { name: t("title"), url: lpath },
          ],
          locale
        )}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-mono text-3xl font-bold text-ink mb-8">{t("title")}</h1>
        <div className="space-y-6 text-ink-60 leading-relaxed">
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.service")}</h2>
            <p>{t("service")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.responsibilities")}</h2>
            <p>{t("responsibilitiesIntro")}</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {responsibilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.disclaimer")}</h2>
            <p>{t("disclaimer")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.changes")}</h2>
            <p>{t("changes")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.disputes")}</h2>
            <p>{t("disputes")}</p>
          </section>
          <p className="pt-8 border-t border-line text-sm text-ink-40">{t("lastUpdated")}</p>
        </div>
      </div>
    </div>
  );
}
