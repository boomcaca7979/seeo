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
  title: "关键词排名追踪工具 · SeeO",
  description:
    "SeeO 关键词排名追踪：按关键词、地区、设备监控 Google 排名，每日自动刷新并记录历史趋势，排名波动自动预警。数据来自 SerpApi。",
  alternates: { canonical: "/features/rank-tracking" },
};

const faqs = [
  {
    q: "排名数据来自哪里？",
    a: "来自 SerpApi 提供的 Google 搜索结果数据。SeeO 目前不支持 Bing、百度等其他搜索引擎。",
  },
  {
    q: "排名多久刷新一次？",
    a: "每日通过定时任务自动刷新一次；也可在排名追踪页手动触发即时刷新，单次请求最多处理 20 个关键词。",
  },
  {
    q: "支持按地区和设备区分排名吗？",
    a: "支持。每个关键词可指定地区与设备（PC / 移动端），排名按维度分别记录。",
  },
  {
    q: "相同关键词重复查询会重复消耗额度吗？",
    a: "不会。相同参数（关键词 + 域名 + 地区 + 设备）的查询结果在 24 小时内复用缓存，不重复调用 SerpApi。",
  },
  {
    q: "排名变化会有通知吗？",
    a: "会。排名刷新后，排名波动会自动生成预警通知，可在站内查看。",
  },
  {
    q: "使用排名追踪需要账号吗？",
    a: "需要。排名追踪涉及持续的历史数据记录，需注册账号后添加项目与关键词使用。",
  },
];

export default function RankTrackingFeaturePage() {
  return (
    <div className="min-h-screen bg-paper">
      <JsonLd
        schema={webPageSchema({
          name: "关键词排名追踪 · SeeO",
          description:
            "按关键词、地区、设备监控 Google 排名，每日自动刷新并记录历史趋势，数据来自 SerpApi。",
          url: "/features/rank-tracking",
        })}
      />
      <JsonLd
        schema={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Rank Tracking", url: "/features/rank-tracking" },
        ])}
      />
      <JsonLd schema={faqPageSchema("/features/rank-tracking", faqs)} />
      <Navbar />

      <div className="mx-auto max-w-4xl px-6 py-16">
        <span className="font-mono text-xs text-brand">FEATURE</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink mb-2">
          关键词排名追踪
        </h1>
        <p className="font-sans text-sm text-ink-60 mb-12">
          每天自动记录你的关键词在 Google 的真实位置，波动立刻知道
        </p>

        {/* What it does */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="font-mono text-sm text-brand">01</span>
            <h2 className="font-mono text-lg font-bold text-ink">它做什么</h2>
            <div className="hairline flex-1" />
          </div>
          <p className="font-sans text-sm leading-relaxed text-ink-80">
            排名追踪按「关键词 × 域名 × 地区 × 设备」四个维度持续监控 Google
            搜索排名。系统每日自动刷新一次排名并写入历史记录，你可以查看每个关键词的排名趋势曲线，
            排名出现波动时自动生成预警。
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
                <p className="mt-1 font-sans text-sm text-ink-80">
                  关键词列表 + 目标域名 + 地区 + 设备（PC / 移动端）
                </p>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">PROCESS</span>
                <ul className="mt-1 space-y-1 font-sans text-sm text-ink-80">
                  <li>→ 每日定时任务自动查询排名（并发受控）</li>
                  <li>→ 相同参数结果缓存 24 小时，避免重复调用</li>
                  <li>→ 与上次记录对比，计算排名变化</li>
                  <li>→ 波动超过阈值时生成预警</li>
                </ul>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">OUTPUT</span>
                <ul className="mt-1 space-y-1 font-sans text-sm text-ink-80">
                  <li>→ 每日排名记录与历史趋势曲线</li>
                  <li>→ 排名变化量（上升 / 下降 / 持平）</li>
                  <li>→ 波动预警通知</li>
                  <li>→ 排名报告（可导出）</li>
                </ul>
              </div>
              <div>
                <span className="font-mono text-xs text-brand">DATA SOURCE</span>
                <p className="mt-1 font-sans text-sm text-ink-80">
                  SerpApi（Google SERP 数据，按调用次数计费，SeeO 内置用量计数与熔断机制）
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
                <li>· 需要用日级数据判断优化效果的站长</li>
                <li>· 管理多地区 / 多设备排名的 SEO 从业者</li>
                <li>· 需要向客户汇报排名趋势的服务商</li>
              </ul>
            </div>
            <div className="card-a p-4">
              <h3 className="font-mono text-sm font-bold text-ink mb-2">真实限制</h3>
              <ul className="space-y-1 font-sans text-sm text-ink-60">
                <li>· 仅支持 Google（暂不支持 Bing / 百度）</li>
                <li>· 手动刷新单次最多 20 个关键词</li>
                <li>· 可追踪关键词数量随套餐限额</li>
                <li>· SerpApi 调用有系统级熔断保护</li>
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
          <Link href="/features/backlink-analysis" className="card-a p-4 transition-colors hover:border-brand">
            <span className="font-mono text-xs text-brand">RELATED</span>
            <h3 className="mt-1 font-mono text-sm font-bold text-ink">外链分析 →</h3>
            <p className="mt-1 font-sans text-xs text-ink-60">查看外链总数与引荐域名</p>
          </Link>
        </div>

        <div className="mt-8 card-a p-6 text-center">
          <h2 className="font-mono text-lg font-bold text-ink mb-2">开始追踪你的关键词</h2>
          <p className="font-sans text-sm text-ink-60 mb-4">注册后添加项目与关键词即可使用</p>
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
