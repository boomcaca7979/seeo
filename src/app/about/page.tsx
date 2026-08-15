import Link from "next/link";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import JsonLd from "@/components/JsonLd";
import {
  breadcrumbSchema,
  aboutPageSchema,
  faqPageSchema,
} from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "关于 SeeO · SEO 数据分析平台",
  description:
    "SeeO 是什么：面向网站站长与 SEO 从业者的一站式 SEO 数据分析平台。了解 SeeO 的定位、真实功能、数据来源、适用人群与当前不提供的能力。",
  alternates: { canonical: "/about" },
};

// FAQ 数据源：页面渲染与 FAQPage JSON-LD 共用同一常量，保证 HTML = Schema
const faqs = [
  {
    q: "SeeO 是 AI 工具吗？",
    a: "不是。SeeO 是数据驱动的 SEO 分析平台，通过 SerpApi、DataForSEO 等第三方数据 API 与自建爬虫获取真实数据。SeeO 目前不提供 AI 引用追踪、LLM 排名监测或 GEO 评分功能。",
  },
  {
    q: "SeeO 支持哪些搜索引擎？",
    a: "目前支持 Google 搜索（通过 SerpApi 获取数据）。暂不支持 Bing、百度等其他搜索引擎。",
  },
  {
    q: "使用 SeeO 需要下载安装吗？",
    a: "不需要。SeeO 是网页应用，注册账号后即可在浏览器中使用全部功能。",
  },
  {
    q: "SeeO 的数据存储在哪里？",
    a: "生产环境使用 Turso 云数据库存储业务数据，用户鉴权由 Supabase Auth 提供。",
  },
  {
    q: "数据多久刷新一次？",
    a: "排名数据每日自动刷新一次，也可手动触发即时刷新。审计按需触发，支持单页与全站两种深度。",
  },
];

const capabilities = [
  { name: "技术 SEO 审计", desc: "自建爬虫抓取页面，执行 20+ 项技术检查并输出健康度评分", href: "/features/seo-audit" },
  { name: "关键词排名追踪", desc: "按关键词、地区、设备监控 Google 排名，每日自动刷新", href: "/features/rank-tracking" },
  { name: "外链分析", desc: "基于 DataForSEO 查看外链总数、引荐域名与锚文本分布", href: "/features/backlink-analysis" },
  { name: "关键词研究", desc: "种子词扩展相关关键词，查看搜索量、难度与搜索意图" },
  { name: "竞品分析", desc: "对比竞品关键词排名与 SOV 份额，识别差距与机会" },
  { name: "内容优化", desc: "对照 SERP Top10 分析页面内容覆盖与优化空间" },
];

const dataSources = [
  { name: "SerpApi", scope: "关键词搜索量、排名查询、SERP 结果、相关词扩展" },
  { name: "DataForSEO", scope: "外链数据、引荐域名、域名权重" },
  { name: "自建爬虫", scope: "页面 HTML 解析、技术 SEO 检查、内容分析（基于 cheerio）" },
  { name: "Supabase Auth", scope: "用户注册、登录与会话管理" },
  { name: "Turso", scope: "生产环境业务数据存储" },
];

const notDoing = [
  "AI 引用追踪（AI citation tracking）",
  "LLM 排名监测与 GEO 评分",
  "团队协作（Team Collaboration）",
  "Bing、百度等非 Google 搜索引擎数据",
  "自建搜索索引（数据来自第三方 API）",
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={aboutPageSchema({
          name: "关于 SeeO",
          description:
            "SeeO 是面向网站站长与 SEO 从业者的一站式 SEO 数据分析平台，整合关键词研究、排名追踪、技术审计、竞品分析、外链分析与内容优化。",
          url: "/about",
        })}
      />
      <JsonLd
        schema={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "About", url: "/about" },
        ])}
      />
      <JsonLd schema={faqPageSchema("/about", faqs)} />
      <Navbar />

      <div className="mx-auto max-w-4xl px-6 py-16">
        <span className="font-mono text-xs text-brand">ABOUT</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink mb-2">
          关于 SeeO
        </h1>
        <p className="font-sans text-sm text-ink-60 mb-12">
          SeeO 是什么，为谁服务，如何工作，以及当前不提供什么
        </p>

        {/* What is SeeO */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-mono text-lg font-bold text-ink">SeeO 是什么</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-4">
            <p className="font-sans text-sm leading-relaxed text-ink-80">
              SeeO 是一个 SEO 数据分析平台（SEO software platform），帮助网站站长与
              SEO 从业者基于真实数据做出搜索优化决策。
            </p>
            <p className="font-sans text-sm leading-relaxed text-ink-80">
              SeeO 解决的核心问题：将分散在多个工具中的 SEO 工作流——关键词研究、排名追踪、技术审计、竞品分析、外链分析、内容优化——整合到同一张工作台。数据在模块之间自动流转，不需要在多个工具间反复导入导出。
            </p>
            <p className="font-sans text-sm leading-relaxed text-ink-80">
              与传统多工具组合的工作方式相比，SeeO 用一个账号、一张工作台覆盖完整的
              SEO 数据工作流，并以统一的项目（网站）维度组织数据。
            </p>
          </div>
        </section>

        {/* Who is it for */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-mono text-lg font-bold text-ink">适合谁使用</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {[
              { who: "独立站长", why: "需要用数据判断哪些页面和关键词值得投入，而不是凭感觉优化" },
              { who: "SEO 从业者", why: "需要在统一工作台完成审计、追踪、竞品对比，减少工具切换成本" },
              { who: "内容团队", why: "需要基于 SERP 真实结果对照检查内容覆盖，而不是主观评估" },
            ].map((item) => (
              <div key={item.who} className="card-a p-4">
                <h3 className="font-mono text-sm font-bold text-ink mb-1">{item.who}</h3>
                <p className="font-sans text-sm text-ink-60">{item.why}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-mono text-lg font-bold text-ink">工作方式</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="card-a p-5">
            <div className="space-y-3 font-sans text-sm text-ink-80">
              <div>
                <span className="font-mono text-xs text-brand">INPUT</span>
                <p className="mt-1">用户创建项目并添加网站域名与关键词列表</p>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">PROCESS</span>
                <p className="mt-1">
                  自建爬虫抓取页面执行技术检查；SerpApi 查询关键词排名；DataForSEO
                  拉取外链数据；定时任务每日自动刷新排名并生成波动预警
                </p>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">OUTPUT</span>
                <p className="mt-1">
                  健康度评分与修复建议、排名趋势曲线、竞品对比、内容优化建议、可导出的
                  PDF / Excel 报告
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">04</span>
            <h2 className="font-mono text-lg font-bold text-ink">核心能力</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {capabilities.map((c) => (
              <div key={c.name} className="card-a p-4">
                {c.href ? (
                  <Link href={c.href} className="font-mono text-sm font-bold text-ink hover:text-brand">
                    {c.name} →
                  </Link>
                ) : (
                  <h3 className="font-mono text-sm font-bold text-ink">{c.name}</h3>
                )}
                <p className="mt-1 font-sans text-sm text-ink-60">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Data sources */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">05</span>
            <h2 className="font-mono text-lg font-bold text-ink">数据来源</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-2">
            {dataSources.map((s) => (
              <div key={s.name} className="card-a p-3">
                <span className="font-mono text-xs font-bold text-ink">{s.name}</span>
                <span className="ml-3 font-sans text-xs text-ink-60">{s.scope}</span>
              </div>
            ))}
          </div>
        </section>

        {/* What SeeO does NOT do */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">06</span>
            <h2 className="font-mono text-lg font-bold text-ink">SeeO 当前不提供</h2>
            <div className="hairline flex-1" />
          </div>
          <p className="mb-4 font-sans text-sm text-ink-60">
            为避免误解，以下是 SeeO 明确不提供（或尚未提供）的能力：
          </p>
          <ul className="space-y-2">
            {notDoing.map((item) => (
              <li key={item} className="flex items-center gap-2 font-sans text-sm text-ink-60">
                <span className="font-mono text-xs text-ink-40">✗</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* FAQ */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">07</span>
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

        {/* CTA */}
        <div className="mt-16 card-a p-6 text-center">
          <h2 className="font-mono text-lg font-bold text-ink mb-2">查看定价方案</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">
            免费版、Lite 版与专业版，按需选择
          </p>
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
