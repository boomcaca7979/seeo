import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// /payment 树无 [locale] 段：UI locale 由 NEXT_LOCALE cookie → Accept-Language → en
// 解析（见 src/i18n/request.ts），metadata 与页面正文必须同源，否则英文界面会拿到
// 中文标题（旧版在此硬编码「支付 · SeeO」）。
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("paymentResult");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    robots: { index: false, follow: false },
  };
}

export default function PaymentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
