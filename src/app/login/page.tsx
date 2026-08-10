import { Suspense } from "react";
import AuthForm from "@/components/auth/AuthForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "登录 · SeeO",
  description: "登录 SeeO 一站式 SEO 数据分析平台。",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-station" />}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
