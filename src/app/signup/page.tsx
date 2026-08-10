import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "注册 · SeeO",
  description: "注册 SeeO 一站式 SEO 数据分析平台，开始追踪关键词排名与技术审计。",
  alternates: { canonical: "/signup" },
};

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-station" />}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
