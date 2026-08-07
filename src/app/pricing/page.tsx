import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "定价 · SeeO",
  description: "SeeO 定价方案：免费版、专业版、团队版。按需选择关键词追踪、技术审计与竞品分析功能。",
  alternates: { canonical: "/pricing" },
};

const freeFeatures = [
  { text: "最多 10 个关键词追踪", included: true },
  { text: "每日排名刷新", included: true },
  { text: "技术审计（首页）", included: true },
  { text: "关键词研究（估算数据）", included: true },
  { text: "PDF 报告导出", included: false },
  { text: "竞品分析", included: false },
  { text: "邮件报告", included: false },
];

const proFeatures = [
  { text: "无限关键词追踪", included: true },
  { text: "每日排名刷新 + 每小时刷新", included: true },
  { text: "技术审计（50 页深度）", included: true },
  { text: "关键词研究（估算数据）", included: true },
  { text: "PDF 报告导出（白标）", included: true },
  { text: "竞品分析 + SOV 计算", included: true },
  { text: "邮件报告（自动发送）", included: true },
  { text: "多项目管理", included: true },
];

const faqs = [
  {
    q: "免费版有使用期限吗？",
    a: "没有。免费版永久可用，但功能有限制。",
  },
  {
    q: "可以随时取消订阅吗？",
    a: "可以。随时在设置中取消，取消后当月剩余时间仍可继续使用。",
  },
  {
    q: "支持退款吗？",
    a: "支持。7 天内无理由退款，详见退款政策。",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部导航条 */}
      <header className="border-b border-line bg-card">
        <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-1.5">
            <span className="font-mono text-lg font-bold text-ink">See</span>
            <span className="font-mono text-lg font-bold text-brand">O</span>
          </Link>
          <div className="flex items-center gap-4 font-mono text-xs">
            <Link href="/docs" className="text-ink-60 transition-colors hover:text-ink">
              文档
            </Link>
            <Link href="/app" className="text-brand transition-colors hover:text-brand-deep">
              进入工作台 →
            </Link>
          </div>
        </nav>
      </header>

      {/* 页头 */}
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-8 text-center">
        <span className="font-mono text-xs text-brand">PRICING</span>
        <h1 className="mt-3 font-mono text-3xl font-bold text-ink">选择适合你的方案</h1>
        <p className="mt-3 font-sans text-sm text-ink-60 max-w-xl mx-auto">
          从免费开始，随时升级。所有方案均包含核心 SEO 功能。
        </p>
      </div>

      {/* 定价卡 */}
      <div className="mx-auto max-w-5xl px-6 pb-16 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 免费版 */}
        <div className="card-a p-8">
          <div className="mb-6">
            <h2 className="font-mono text-xl font-bold text-ink mb-1">免费版</h2>
            <p className="font-sans text-sm text-ink-40">适合个人站长和初学者</p>
          </div>
          <div className="mb-6">
            <span className="font-mono text-4xl font-bold text-ink">¥0</span>
            <span className="font-sans text-sm text-ink-40">/月</span>
          </div>
          <ul className="space-y-3 mb-8">
            {freeFeatures.map((f) => (
              <li key={f.text} className="flex items-start gap-2 font-sans text-sm text-ink-60">
                {f.included ? (
                  <span className="text-pos mt-0.5">✓</span>
                ) : (
                  <span className="text-ink-40 mt-0.5">—</span>
                )}
                <span className={f.included ? "" : "text-ink-40"}>{f.text}</span>
              </li>
            ))}
          </ul>
          <Link href="/app" className="block w-full btn-secondary text-center py-3">
            免费开始
          </Link>
        </div>

        {/* Pro 版 */}
        <div className="card-a p-8 border-brand relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="badge-warn text-xs px-3 py-1 bg-card">推荐</span>
          </div>
          <div className="mb-6">
            <h2 className="font-mono text-xl font-bold text-ink mb-1">Pro 版</h2>
            <p className="font-sans text-sm text-ink-40">适合专业 SEO 从业者和团队</p>
          </div>
          <div className="mb-6">
            <span className="font-mono text-4xl font-bold text-ink">¥69</span>
            <span className="font-sans text-sm text-ink-40">/月</span>
          </div>
          <ul className="space-y-3 mb-8">
            {proFeatures.map((f) => (
              <li key={f.text} className="flex items-start gap-2 font-sans text-sm text-ink-60">
                <span className="text-pos mt-0.5">✓</span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
          <button className="w-full btn-primary py-3" disabled>
            即将上线
          </button>
          <p className="mt-2 text-center font-mono text-xs text-ink-40">支付系统开发中</p>
        </div>
      </div>

      {/* FAQ */}
      <div className="mx-auto max-w-3xl px-6 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <span className="font-mono text-xs text-brand">FAQ</span>
          <h2 className="font-mono text-xl font-bold text-ink">常见问题</h2>
          <div className="hairline flex-1" />
        </div>
        <div className="space-y-4">
          {faqs.map((item) => (
            <div key={item.q} className="card-a p-4">
              <h3 className="font-sans text-sm font-medium text-ink mb-1">{item.q}</h3>
              <p className="font-sans text-sm text-ink-60">{item.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 返回首页 */}
      <div className="border-t border-line">
        <div className="mx-auto max-w-5xl px-6 py-6 text-center">
          <Link href="/" className="font-mono text-xs text-ink-40 transition-colors hover:text-ink">
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
