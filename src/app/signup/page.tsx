import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "注册 · SeeO",
  description: "注册 SeeO 一站式 SEO 数据分析平台，开始追踪关键词排名与技术审计。",
  alternates: { canonical: "/signup" },
};

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
      <Suspense fallback={<div className="min-h-screen bg-station" />}>
        <AuthForm mode="signup" />
      </Suspense>
    </>
  );
}
