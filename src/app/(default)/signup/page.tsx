import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { localeToOgLocale, type Locale } from "@/i18n/config";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";

// 与 /login 同源：无 [locale] 段，metadata 在服务端按 cookie/header 解析的
// UI locale 输出，保证中文界面拿到中文标题、英文界面拿到英文标题。
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("authPage");
  const title = t("signupTitle");
  const description = t("signupDescription");
  return {
    title,
    description,
    alternates: { canonical: "/signup" },
    openGraph: {
      type: "website",
      url: "https://www.seeo.asia/signup",
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

export default function SignupPage() {
  return (
    <>
      {/* JsonLd 必须在 Suspense 外：AuthForm 的 useSearchParams 会触发 CSR bailout，
          Suspense 子树不进入静态 SSR 输出 */}
      <JsonLd
        schema={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Sign Up", url: "/signup" },
        ])}
      />
      <Suspense fallback={<div className="min-h-screen bg-paper" />}>
        <AuthForm mode="signup" />
      </Suspense>
    </>
  );
}
