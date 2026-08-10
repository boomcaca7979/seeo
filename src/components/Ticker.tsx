const items = [
  { label: "关键词研究", value: "搜索量 / 难度 / 意图" },
  { label: "排名追踪", value: "每日自动刷新" },
  { label: "技术审计", value: "20+ 项检查" },
  { label: "竞品分析", value: "SOV 份额" },
  { label: "内容优化", value: "SERP Top10 对比" },
  { label: "外链分析", value: "DataForSEO 接入" },
  { label: "搜索引擎", value: "Google" },
  { label: "数据导出", value: "PDF / Excel" },
];

export default function Ticker() {
  // 复制两份用于无缝循环
  const loop = [...items, ...items];

  return (
    <section className="w-full overflow-hidden border-y border-ink/20 bg-ink py-3">
      <div className="flex w-max animate-ticker">
        {loop.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 px-6">
            <span className="font-mono text-sm font-medium text-gold">
              {item.label}
            </span>
            <span className="font-mono text-sm text-d-text">{item.value}</span>
            <span className="ml-4 text-d-muted">·</span>
          </div>
        ))}
      </div>
    </section>
  );
}
