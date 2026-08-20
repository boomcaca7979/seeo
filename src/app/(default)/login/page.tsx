import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Log In to SeeO — SEO Audits & Rank Tracking",
  description:
    "Log in to SeeO to run technical SEO audits, track keyword rankings daily, research keywords, and monitor competitors and backlinks from one dashboard.",
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
      <Suspense fallback={<div className="min-h-screen bg-paper" />}>
        <AuthForm mode="login" />
      </Suspense>
    </>
  );
}
