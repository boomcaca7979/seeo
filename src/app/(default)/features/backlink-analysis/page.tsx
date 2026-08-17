import Link from "next/link";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import JsonLd from "@/components/JsonLd";
import {
  breadcrumbSchema,
  webPageSchema,
  faqPageSchema,
} from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "外链分析工具 · SeeO",
  description:
    "SeeO 外链分析：基于 DataForSEO 数据查看外链总数、引荐域名、Domain Rank、dofollow 比例与锚文本分布。专业版可用，7 天数据缓存。",
  alternates: { canonical: "/features/backlink-analysis" },
};

const faqs = [
  {
    q: "外链数据来自哪里？",
    a: "来自 DataForSEO 的外链数据库。SeeO 不自建外链索引，查询结果直接来自该第三方数据服务。",
  },
  {
    q: "哪些套餐可以使用外链分析？",
    a: "外链分析为专业版（Pro）功能，免费版与 Lite 版不可用。详见定价页。",
  },
  {
    q: "多久可以查询一次？",
    a: "同一域名的查询结果缓存 7 天，缓存期内直接返回已有数据；缓存过期后同一域名 1 小时内只允许重新拉取一次。",
  },
  {
    q: "提供哪些指标？",
    a: "外链总数、引荐域名数、Domain Rank、dofollow 链接比例、单条外链的来源页面 / 锚文本 / 目标页面 / 首次发现时间。",
  },
  {
    q: "查询次数有限制吗？",
    a: "有每月查询额度限制，随套餐不同，超出后暂停查询，详见定价页。",
  },
];

export default function BacklinkAnalysisFeaturePage() {
  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={webPageSchema({
          name: "外链分析 · SeeO",
          description:
            "基于 DataForSEO 查看外链总数、引荐域名、Domain Rank 与锚文本分布。",
          url: "/features/backlink-analysis",
        })}
      />
      <JsonLd
        schema={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Backlink Analysis", url: "/features/backlink-analysis" },
        ])}
      />
      <JsonLd schema={faqPageSchema("/features/backlink-analysis", faqs)} />
      <Navbar />

      <div className="mx-auto max-w-4xl px-6 py-16">
        <span className="font-mono text-xs text-brand">FEATURE</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink mb-2">外链分析</h1>
        <p className="font-sans text-sm text-ink-60 mb-12">
          查看指向你网站的外链规模、质量与构成
        </p>

        {/* What it does */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-mono text-lg font-bold text-ink">它做什么</h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80">
            外链分析对指定域名拉取外链概况：外链总数、引荐域名数、Domain Rank
            评分与 dofollow 比例，并提供单条外链明细——来源页面、锚文本、目标页面与首次发现时间。
            数据拉取后缓存 7 天，可跨天对比变化。
          </p>
        </section>

        {/* About this capability */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-mono text-lg font-bold text-ink">工作原理</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="card-a p-5">
            <div className="space-y-4">
              <div>
                <span className="font-mono text-xs text-brand">INPUT</span>
                <p className="mt-1 font-sans text-sm text-ink-80">一个域名（如 example.com）</p>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">PROCESS</span>
                <ul className="mt-1 space-y-1 font-sans text-sm text-ink-80">
                  <li>→ 查询 7 天缓存，命中直接返回（不消耗额度）</li>
                  <li>→ 未命中时调用 DataForSEO 拉取外链数据</li>
                  <li>→ 结果写入数据库并缓存 7 天</li>
                  <li>→ 同域名 1 小时冷却，防止重复拉取</li>
                </ul>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">OUTPUT</span>
                <ul className="mt-1 space-y-1 font-sans text-sm text-ink-80">
                  <li>→ 外链总数 / 引荐域名数 / Domain Rank / dofollow 比例</li>
                  <li>→ 外链明细（来源、锚文本、目标、首次发现）</li>
                  <li>→ 引荐域名与锚文本分布</li>
                </ul>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">DATA SOURCE</span>
                <p className="mt-1 font-sans text-sm text-ink-80">
                  DataForSEO 外链数据库（按调用次数计费，SeeO 内置每月额度控制）
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Who + limits */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-mono text-lg font-bold text-ink">适用与限制</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card-a p-4">
              <h3 className="font-mono text-sm font-bold text-ink mb-2">适合谁</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                <li>· 评估外链建设效果的专业版用户</li>
                <li>· 分析竞争对手外链构成的 SEO 从业者</li>
                <li>· 需要定期监控外链增长 / 流失的人</li>
              </ul>
            </div>
            <div className="card-a p-4">
              <h3 className="font-mono text-sm font-bold text-ink mb-2">真实限制</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                <li>· 专业版（Pro）专属功能</li>
                <li>· 同域名数据 7 天缓存，非实时</li>
                <li>· 每月查询额度随套餐限制</li>
                <li>· 数据覆盖范围取决于 DataForSEO 索引</li>
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">04</span>
            <h2 className="font-mono text-lg font-bold text-ink">常见问题</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {faqs.map((f) => (
              <div key={f.q} className="card-a p-4">
                <h3 className="font-sans text-sm font-medium text-ink mb-1">{f.q}</h3>
                <p className="font-sans text-sm text-ink-60">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Related + CTA */}
        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          <Link href="/features/seo-audit" className="card-a p-4 transition-colors hover:border-brand">
            <span className="font-mono text-xs text-brand">RELATED</span>
            <h3 className="mt-1 font-mono text-sm font-bold text-ink">技术 SEO 审计 →</h3>
            <p className="mt-1 font-sans text-xs text-ink-60">20+ 项技术检查与健康度评分</p>
          </Link>
          <Link href="/features/rank-tracking" className="card-a p-4 transition-colors hover:border-brand">
            <span className="font-mono text-xs text-brand">RELATED</span>
            <h3 className="mt-1 font-mono text-sm font-bold text-ink">关键词排名追踪 →</h3>
            <p className="mt-1 font-sans text-xs text-ink-60">每日监控 Google 排名变化</p>
          </Link>
        </div>

        <div className="mt-8 card-a p-6 text-center">
          <h2 className="font-mono text-lg font-bold text-ink mb-2">使用外链分析</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">外链分析包含在专业版中</p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/pricing" className="btn-primary inline-block px-6 py-2">
              查看定价
            </Link>
            <Link href="/docs" className="btn-secondary inline-block px-6 py-2">
              产品文档
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto max-w-4xl px-6 py-6 text-center">
          <Link href="/" className="font-mono text-xs text-ink-40 transition-colors hover:text-ink">
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
