import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "登录 · SeeO",
  description: "登录 SeeO 一站式 SEO 数据分析平台。",
  alternates: { canonical: "/login" },
};

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
      <Suspense fallback={<div className="min-h-screen bg-station" />}>
        <AuthForm mode="login" />
      </Suspense>
    </>
  );
}
