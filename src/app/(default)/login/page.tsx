import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { localeToOgLocale, type Locale } from "@/i18n/config";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";

// /login 不做双 URL：同一 URL 按 NEXT_LOCALE cookie → Accept-Language → en 输出界面，
// 因此 metadata 必须在服务端按同一 locale 解析（旧版是静态英文 metadata，
// 中文界面拿到英文标题）。canonical 保持无前缀：/login 只有一个规范地址。
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("authPage");
  const title = t("loginTitle");
  const description = t("loginDescription");
  return {
    title,
    description,
    alternates: { canonical: "/login" },
    openGraph: {
      type: "website",
      url: "https://www.seeo.asia/login",
      siteName: "SeeO",
      locale: localeToOgLocale[locale],
      title,
      description,
      images: [
        {
          url: "/og.jpg",
          width: 1200,
          height: 630,
          alt: t("ogAlt"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.jpg"],
    },
    // robots 继承 (default) layout 的 noindex,follow（认证工具页，不进 sitemap）
  };
}

export default function LoginPage() {
  return (
    <>
      {/* JsonLd 必须在 Suspense 外：AuthForm 的 useSearchParams 会触发 CSR bailout，
          Suspense 子树不进入静态 SSR 输出 */}
      <JsonLd
        schema={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Login", url: "/login" },
        ])}
      />
      <Suspense fallback={<div className="min-h-screen bg-paper" />}>
        <AuthForm mode="login" />
      </Suspense>
    </>
  );
}
