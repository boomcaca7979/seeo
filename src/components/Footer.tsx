import Link from "next/link";

const cols = [
  {
    title: "产品",
    links: [
      { label: "关键词研究", href: "#features" },
      { label: "排名追踪", href: "#features" },
      { label: "技术审计", href: "#features" },
      { label: "外链分析", href: "#features" },
      { label: "竞品分析", href: "#features" },
      { label: "内容优化", href: "#features" },
    ],
  },
  {
    title: "方案",
    links: [
      { label: "入门版", href: "#cta" },
      { label: "专业版", href: "#cta" },
      { label: "团队版", href: "#cta" },
      { label: "企业 / 代理商", href: "#cta" },
    ],
  },
  {
    title: "资源",
    links: [
      { label: "使用文档", href: "#footer" },
      { label: "API 参考", href: "#footer" },
      { label: "SEO 指南", href: "#footer" },
      { label: "更新日志", href: "#footer" },
    ],
  },
  {
    title: "公司",
    links: [
      { label: "关于我们", href: "#footer" },
      { label: "联系方式", href: "#footer" },
      { label: "隐私政策", href: "#footer" },
      { label: "服务条款", href: "#footer" },
    ],
  },
];

export default function Footer() {
  return (
    <footer id="footer" className="bg-ink px-5 py-16 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-6">
          {/* Logo + 简介 */}
          <div className="col-span-2 md:col-span-2">
            <div className="flex items-center gap-1">
              <span className="font-display text-2xl font-bold text-d-text">
                See
              </span>
              <span className="font-display text-2xl font-bold text-gold">
                O
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-d-secondary">
              一站式 SEO 数据分析平台，把搜索流量里的每一个机会都摆到你看得到的地方。
            </p>
            <div className="mt-4 flex items-center gap-2 font-mono text-xs text-d-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" />
              全球数据服务运行中
            </div>
          </div>

          {/* 链接列 */}
          {cols.map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-gold">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="font-sans text-sm text-d-secondary transition-colors hover:text-d-text"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 底栏 */}
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-d-muted/15 pt-6 sm:flex-row sm:items-center">
          <div className="font-mono text-xs text-d-muted">
            © 2026 SeeO. 数据为示例演示。
          </div>
          <div className="flex items-center gap-4 font-mono text-xs text-d-muted">
            <span>ICP 备案号 0000000 号</span>
            <span className="text-d-muted/50">·</span>
            <span>v1.0.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
