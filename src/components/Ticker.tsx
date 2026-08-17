import { useTranslations } from "next-intl";

export default function Ticker() {
  const t = useTranslations("ticker");
  const items = t.raw("items") as Array<{ label: string; value: string }>;

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
