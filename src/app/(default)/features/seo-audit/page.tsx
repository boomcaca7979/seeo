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
  title: "技术 SEO 审计工具 · SeeO",
  description:
    "SeeO 技术 SEO 审计：自建爬虫抓取页面，执行 20+ 项技术检查，输出健康度评分与按优先级排序的修复建议。支持单页快检与全站深度审计。",
  alternates: { canonical: "/features/seo-audit" },
};

const faqs = [
  {
    q: "审计一个网站需要账号吗？",
    a: "首页提供免登录的单页快速审计入口，输入 URL 即可立即查看基础检查结果。保存审计历史、全站深度审计与历史对比需要注册账号。",
  },
  {
    q: "审计会检查哪些项目？",
    a: "共 20+ 项技术 SEO 检查，覆盖标题标签、meta 描述、H1 层级、图片 alt 文本、canonical、SSL 证书、robots.txt、sitemap、移动端适配与页面性能等类别。",
  },
  {
    q: "支持多大的审计深度？",
    a: "两种深度：quick 模式审计 1 个页面；full 模式基于 sitemap 深度爬取，最多 50 个页面。",
  },
  {
    q: "审计结果如何呈现？",
    a: "每次审计输出 0-100 的健康度评分（按检查项权重加权）、按优先级排序的问题列表与修复建议，并支持与历史审计结果对比。",
  },
  {
    q: "审计报告可以导出吗？",
    a: "可以。支持导出 PDF 与 Excel 格式的审计报告。",
  },
  {
    q: "审计频率有限制吗？",
    a: "有每日审计次数限制，限额随套餐不同，详见定价页。",
  },
];

const checks = [
  { cat: "页面基础", items: "标题标签、meta 描述、H1 层级结构、图片 alt 文本" },
  { cat: "可收录性", items: "canonical、robots.txt、sitemap、noindex 检测" },
  { cat: "安全与性能", items: "SSL 证书、页面加载、移动端适配" },
  { cat: "链接结构", items: "内链结构、失效链接检测" },
];

export default function SeoAuditFeaturePage() {
  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={webPageSchema({
          name: "技术 SEO 审计 · SeeO",
          description:
            "自建爬虫抓取页面，执行 20+ 项技术 SEO 检查，输出健康度评分与修复建议。",
          url: "/features/seo-audit",
        })}
      />
      <JsonLd
        schema={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "SEO Audit", url: "/features/seo-audit" },
        ])}
      />
      <JsonLd schema={faqPageSchema("/features/seo-audit", faqs)} />
      <Navbar />

      <div className="mx-auto max-w-4xl px-6 py-16">
        <span className="font-mono text-xs text-brand">FEATURE</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink mb-2">
          技术 SEO 审计
        </h1>
        <p className="font-sans text-sm text-ink-60 mb-12">
          抓取你的网站，逐页执行技术检查，用评分和优先级告诉你先修什么
        </p>

        {/* What it does */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-mono text-lg font-bold text-ink">它做什么</h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80">
            技术 SEO 审计对指定网站执行自动化爬取，对每个页面运行 20+ 项技术
            SEO 检查，将结果汇总为健康度评分（0-100），并按优先级列出问题与对应的修复建议。
            支持保存审计历史，对比两次审计之间的评分变化与问题增减。
          </p>
        </section>

        {/* About this capability (AI citation-friendly) */}
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
                <p className="mt-1 font-sans text-sm text-ink-80">网站 URL（一个域名）</p>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">PROCESS</span>
                <ul className="mt-1 space-y-1 font-sans text-sm text-ink-80">
                  <li>→ 自建爬虫（基于 cheerio 的服务端抓取）抓取页面 HTML</li>
                  <li>→ 对每个页面执行 20+ 项规则检查</li>
                  <li>→ 按检查项权重计算健康度评分</li>
                  <li>→ 按影响程度对问题排序</li>
                </ul>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">OUTPUT</span>
                <ul className="mt-1 space-y-1 font-sans text-sm text-ink-80">
                  <li>→ 健康度评分（0-100）</li>
                  <li>→ 问题列表与修复建议</li>
                  <li>→ 历史审计对比</li>
                  <li>→ PDF / Excel 审计报告</li>
                </ul>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">DATA SOURCE</span>
                <p className="mt-1 font-sans text-sm text-ink-80">
                  自建爬虫直接抓取目标网站，不依赖第三方数据 API
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Check categories */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-mono text-lg font-bold text-ink">检查覆盖</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {checks.map((c) => (
              <div key={c.cat} className="card-a p-4">
                <h3 className="font-mono text-sm font-bold text-ink">{c.cat}</h3>
                <p className="mt-1 font-sans text-sm text-ink-60">{c.items}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Who + limits */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">04</span>
            <h2 className="font-mono text-lg font-bold text-ink">适用与限制</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card-a p-4">
              <h3 className="font-mono text-sm font-bold text-ink mb-2">适合谁</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                <li>· 需要定期体检网站技术健康的站长</li>
                <li>· 改版 / 迁移后需要验证无回归的团队</li>
                <li>· 接手新站点需要快速摸底的人</li>
              </ul>
            </div>
            <div className="card-a p-4">
              <h3 className="font-mono text-sm font-bold text-ink mb-2">真实限制</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                <li>· 全站审计单次最多爬取 50 个页面</li>
                <li>· 每日审计次数有套餐限额</li>
                <li>· 检查为规则驱动的静态分析，不含人工诊断</li>
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">05</span>
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
          <Link href="/features/rank-tracking" className="card-a p-4 transition-colors hover:border-brand">
            <span className="font-mono text-xs text-brand">RELATED</span>
            <h3 className="mt-1 font-mono text-sm font-bold text-ink">关键词排名追踪 →</h3>
            <p className="mt-1 font-sans text-xs text-ink-60">每日监控 Google 排名变化</p>
          </Link>
          <Link href="/features/backlink-analysis" className="card-a p-4 transition-colors hover:border-brand">
            <span className="font-mono text-xs text-brand">RELATED</span>
            <h3 className="mt-1 font-mono text-sm font-bold text-ink">外链分析 →</h3>
            <p className="mt-1 font-sans text-xs text-ink-60">查看外链总数与引荐域名</p>
          </Link>
        </div>

        <div className="mt-8 card-a p-6 text-center">
          <h2 className="font-mono text-lg font-bold text-ink mb-2">开始审计你的网站</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">免费版即可使用单页快速审计</p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/signup" className="btn-primary inline-block px-6 py-2">
              免费注册
            </Link>
            <Link href="/pricing" className="btn-secondary inline-block px-6 py-2">
              查看定价
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
