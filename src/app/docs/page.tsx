import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "文档 · SeeO",
  description: "SeeO 使用文档：关键词追踪、技术审计、竞品分析、内容优化与报告导出的操作指南。",
  alternates: { canonical: "/docs" },
};

interface DocItem {
  title: string;
  desc: string;
}

interface DocSection {
  id: string;
  title: string;
  items: DocItem[];
}

const sections: DocSection[] = [
  {
    id: "01",
    title: "快速开始",
    items: [
      { title: "创建第一个项目", desc: "输入域名，开始 SEO 监控之旅" },
      { title: "添加关键词追踪", desc: "追踪核心关键词的排名变化" },
      { title: "执行技术审计", desc: "发现网站的 SEO 技术问题" },
    ],
  },
  {
    id: "02",
    title: "核心功能",
    items: [
      { title: "关键词研究", desc: "分析搜索量趋势、SERP 结果和拓词建议" },
      { title: "排名追踪", desc: "每日自动刷新，掌握排名动态" },
      { title: "技术审计", desc: "20+ 项检查，全面诊断网站健康度" },
      { title: "竞品分析", desc: "监控竞品排名，计算 SOV 份额" },
      { title: "内容优化", desc: "分析页面内容质量、可读性和关键词密度" },
    ],
  },
  {
    id: "03",
    title: "自动化",
    items: [
      { title: "每日刷新", desc: "定时自动刷新所有关键词排名" },
      { title: "每周报告", desc: "自动生成并发送 SEO 周报" },
      { title: "预警系统", desc: "排名大幅波动时自动通知" },
    ],
  },
  {
    id: "04",
    title: "常见问题",
    items: [
      { title: "SerpApi 额度是什么？", desc: "每月 100 次免费查询，用于关键词排名和拓词" },
      { title: "数据存储在哪里？", desc: "本地 SQLite（开发）或 Turso 云数据库（生产）" },
      { title: "如何导出报告？", desc: "在报表中心生成 PDF 或 CSV 报告" },
      { title: "支持哪些搜索引擎？", desc: "目前支持 Google（通过 SerpApi）" },
    ],
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
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink mb-2">帮助中心</h1>
        <p className="font-sans text-sm text-ink-60 mb-12">
          了解 SeeO 的所有功能和使用方法
        </p>

        <div className="space-y-12">
          {sections.map((section) => (
            <div key={section.id}>
              <div className="flex items-center gap-3 mb-4">
                <span className="font-mono text-sm text-brand">{section.id}</span>
                <h2 className="font-mono text-lg font-bold text-ink">{section.title}</h2>
                <div className="hairline flex-1" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {section.items.map((item) => (
                  <div
                    key={item.title}
                    className="card-a p-4 transition-colors duration-150 hover:bg-[#FBFAF4] cursor-pointer"
                  >
                    <h3 className="font-sans text-sm font-medium text-ink mb-1">{item.title}</h3>
                    <p className="font-sans text-sm text-ink-60">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

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
