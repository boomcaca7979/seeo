import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Create a SeeO Account — SEO Audits & Rank Tracking",
  description:
    "Create a free SeeO account to run technical SEO audits, track keyword rankings daily, research keywords, and monitor competitors and backlinks.",
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
      <Suspense fallback={<div className="min-h-screen bg-paper" />}>
        <AuthForm mode="signup" />
      </Suspense>
    </>
  );
}
