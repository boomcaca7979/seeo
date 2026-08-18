import JsonLd from "@/components/JsonLd";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/seo";
import { breadcrumbSchema } from "@/lib/seo/schema";

// ===== /refund 内容组件（en: /refund · zh: /zh/refund）=====
// 文案走 messages（refundPage），与当前 payment 实际行为对齐：
//   - 退款经耀立退款 API 原路退回，仅限本人 paid 订单（api/payment/yaolipay/refund）
//   - 已移除与实际规则冲突的"消耗超 50 次不退 / 生成超 5 份报告不退"条款
//   - 联系邮箱未定案：以"待公布"占位，不虚构邮箱

export default async function RefundPage() {
  const t = await getTranslations("refundPage");
  const locale = (await getLocale()) as "en" | "zh";
  const lpath = localePath(locale, "/refund");

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
        <h1 className="font-mono text-3xl font-bold text-ink mb-8">{t("title")}</h1>
        <div className="space-y-6 text-ink-60 leading-relaxed">
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.policy")}</h2>
            <p>{t("policy")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.process")}</h2>
            <p>{t("process")}</p>
            <span className="mt-2 inline-block rounded border border-line px-3 py-1 font-mono text-xs text-ink-40">
              {t("processNote")}
            </span>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.after")}</h2>
            <p>{t("after")}</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">{t("sections.banned")}</h2>
            <p>{t("banned")}</p>
          </section>
          <p className="pt-8 border-t border-line text-sm text-ink-40">{t("lastUpdated")}</p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
