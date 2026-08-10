import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "文档 · SeeO",
  description: "SeeO 产品文档：了解 SeeO 是什么、核心功能、数据来源与使用方法。",
  alternates: { canonical: "/docs" },
};

interface FeatureDoc {
  id: string;
  name: string;
  desc: string;
  capabilities: string[];
}

const features: FeatureDoc[] = [
  {
    id: "audit",
    name: "SEO Audit",
    desc: "全站爬取并执行 20+ 项技术 SEO 检查，输出健康度评分与按优先级排序的修复建议。",
    capabilities: ["单页/多页深度爬取", "20+ 项技术检查", "健康度评分", "历史审计对比"],
  },
  {
    id: "keyword-research",
    name: "Keyword Research",
    desc: "基于种子词扩展相关关键词，查看搜索量、难度、CPC 与搜索意图。",
    capabilities: ["关键词概览", "相关词扩展", "搜索意图识别", "KD 难度评分"],
  },
  {
    id: "rank-tracking",
    name: "Rank Tracking",
    desc: "按关键词、地区、设备持续监控 Google 排名，每日自动刷新并记录历史趋势。",
    capabilities: ["每日自动刷新", "多设备/地区", "排名趋势曲线", "波动预警"],
  },
  {
    id: "competitor-analysis",
    name: "Competitor Analysis",
    desc: "对比竞品的关键词排名与 SOV（Share of Voice）份额，识别差距与机会。",
    capabilities: ["域名对比", "SOV 份额计算", "排名差距分析", "历史趋势叠加"],
  },
  {
    id: "backlink-analysis",
    name: "Backlink Analysis",
    desc: "查看外链总数、引荐域名、锚文本分布与增长/流失趋势。",
    capabilities: ["外链总览", "引荐域名分析", "锚文本分布", "增长/流失趋势"],
  },
  {
    id: "content-optimization",
    name: "Content Optimization",
    desc: "对照 SERP Top10 分析页面内容，给出主题词覆盖、内容评分与优化建议。",
    capabilities: ["内容评分", "主题词覆盖分析", "SERP Top10 对比", "SEO 检查清单"],
  },
];

const dataSources = [
  {
    name: "SerpApi",
    scope: "关键词搜索量、排名查询、SERP 结果、相关词扩展",
    note: "第三方 API，按调用次数计费，SeeO 内置用量计数与熔断机制",
  },
  {
    name: "DataForSEO",
    scope: "外链数据、引荐域名、域名权重",
    note: "第三方 API，用于外链分析模块",
  },
  {
    name: "自建爬虫",
    scope: "页面 HTML 解析、技术 SEO 检查、内容分析",
    note: "基于 cheerio 的服务端爬取，不依赖第三方",
  },
];

const faqs = [
  {
    q: "SeeO 支持哪些搜索引擎？",
    a: "目前支持 Google 搜索（通过 SerpApi 获取数据）。暂不支持 Bing、百度等其他搜索引擎。",
  },
  {
    q: "数据多久刷新一次？",
    a: "排名数据每日自动刷新一次（通过 cron 定时任务）。审计按需手动触发，支持 quick（1 页）和 full（最多 50 页）两种深度。",
  },
  {
    q: "SerpApi 额度是什么？",
    a: "SerpApi 是第三方 SERP 数据 API，按调用次数计费。SeeO 内置用量计数（每月 100 次免费额度）与 80 次熔断机制，超出后暂停相关功能。",
  },
  {
    q: "数据存储在哪里？",
    a: "开发环境使用本地 SQLite，生产环境使用 Turso 云数据库。用户鉴权由 Supabase Auth 提供。",
  },
  {
    q: "如何导出报告？",
    a: "在报表中心支持生成 PDF 和 Excel（CSV）格式的审计报告与排名报告。",
  },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部导航条 */}
      <header className="border-b border-line bg-card">
        <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-1.5">
            <span className="font-mono text-lg font-bold text-ink">See</span>
            <span className="font-mono text-lg font-bold text-brand">O</span>
          </Link>
          <div className="flex items-center gap-4 font-mono text-xs">
            <Link href="/pricing" className="text-ink-60 transition-colors hover:text-ink">
              定价
            </Link>
            <Link href="/app" className="text-brand transition-colors hover:text-brand-deep">
              进入工作台 →
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-16">
        <span className="font-mono text-xs text-brand">DOCS</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink mb-2">产品文档</h1>
        <p className="font-sans text-sm text-ink-60 mb-12">
          了解 SeeO 的产品定位、核心功能与数据来源
        </p>

        {/* 产品介绍 */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-mono text-lg font-bold text-ink">产品介绍</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-4">
            <p className="font-sans text-sm leading-relaxed text-ink-80">
              SeeO 是一个 SEO 数据分析平台，帮助网站站长与 SEO 从业者基于真实数据做出搜索优化决策。
            </p>
            <p className="font-sans text-sm leading-relaxed text-ink-80">
              SeeO 解决的核心问题：将分散在多个工具中的 SEO 工作流（关键词研究、排名追踪、技术审计、竞品分析、外链分析、内容优化）整合到同一张工作台，数据在模块之间自动流转，避免反复导入导出。
            </p>
            <p className="font-sans text-sm leading-relaxed text-ink-80">
              SeeO 不自建搜索索引，而是通过 SerpApi 和 DataForSEO 等第三方数据 API 获取实时 SERP 数据，结合自建爬虫执行技术审计与内容分析。
            </p>
          </div>
        </section>

        {/* 功能说明 */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">02</span>
            <h2 className="font-mono text-lg font-bold text-ink">核心功能</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-4">
            {features.map((f) => (
              <div key={f.id} className="card-a p-5">
                <h3 className="font-mono text-sm font-bold text-ink mb-2">{f.name}</h3>
                <p className="font-sans text-sm text-ink-60 mb-3">{f.desc}</p>
                <div className="flex flex-wrap gap-2">
                  {f.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded border border-line bg-paper px-2 py-0.5 font-mono text-[10px] text-ink-60"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 数据来源 */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">03</span>
            <h2 className="font-mono text-lg font-bold text-ink">数据来源</h2>
            <div className="hairline flex-1" />
          </div>
          <div className="space-y-3">
            {dataSources.map((s) => (
              <div key={s.name} className="card-a p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-mono text-sm font-bold text-ink">{s.name}</h3>
                </div>
                <p className="font-sans text-sm text-ink-60 mb-1">覆盖范围：{s.scope}</p>
                <p className="font-sans text-xs text-ink-40">{s.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 常见问题 */}
        <section className="mb-16">
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

        <div className="mt-16 card-a p-6 text-center">
          <h2 className="font-mono text-lg font-bold text-ink mb-2">还有问题？</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">
            发送邮件至 support@seeo.local，我们将在 24 小时内回复
          </p>
          <a
            href="mailto:support@seeo.local"
            className="btn-secondary inline-block px-6 py-2"
          >
            联系我们
          </a>
        </div>
      </div>

      {/* 返回首页 */}
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
