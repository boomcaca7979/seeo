const items = [
  { label: "关键词库", value: "28.4B" },
  { label: "外链索引", value: "43.1T" },
  { label: "今日追踪排名", value: "1,204,331 条" },
  { label: "活跃项目", value: "82,914" },
  { label: "覆盖国家", value: "189" },
  { label: "搜索引擎", value: "Google / Bing / 百度" },
  { label: "数据更新", value: "实时" },
  { label: "审计页面", value: "6.7 亿" },
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
