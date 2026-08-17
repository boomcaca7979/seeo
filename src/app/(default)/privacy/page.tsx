import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "隐私政策 · SeeO",
  description: "SeeO 隐私政策：我们如何收集、使用与保护您的个人信息。",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Privacy Policy", url: "/privacy" },
        ])}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-mono text-3xl font-bold text-ink mb-8">隐私政策</h1>
        <div className="space-y-6 text-ink-60 leading-relaxed">
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">01 数据收集</h2>
            <p>SeeO 收集以下信息以提供服务：</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>邮箱地址（用于账号注册和登录）</li>
              <li>您输入的域名和关键词（用于 SEO 分析）</li>
              <li>SerpApi 调用记录（用于用量监控）</li>
            </ul>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">02 数据使用</h2>
            <p>您的数据仅用于提供 SEO 分析服务，不会出售给第三方。</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">03 数据存储</h2>
            <p>用户认证数据由 Supabase 托管，业务数据存储于 Turso 云数据库，两者均为第三方基础设施服务。</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">04 Cookie</h2>
            <p>我们使用必要的 Cookie 来维持登录状态。使用第三方分析工具时会征求您的同意。</p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">05 联系方式</h2>
            <p>如有隐私相关问题，请联系：privacy@seeo.local</p>
          </section>
          <p className="pt-8 border-t border-line text-sm text-ink-40">最后更新：2026年8月</p>
        </div>
      </div>
    </div>
  );
}
