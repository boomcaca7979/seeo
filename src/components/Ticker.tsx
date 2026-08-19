import { useTranslations } from "next-intl";

export default function Ticker() {
  const t = useTranslations("ticker");
  const items = t.raw("items") as Array<{ label: string; value: string }>;

  // 复制两份用于无缝循环
  const loop = [...items, ...items];

  return (
    <section className="w-full overflow-hidden border-y border-line bg-card py-3">
      <div className="flex w-max animate-ticker">
        {loop.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 px-6">
            <span className="font-mono text-sm font-medium text-ink-60">
              {item.label}
            </span>
            <span className="font-mono text-sm text-ink">{item.value}</span>
            <span className="ml-4 text-ink-25">·</span>
          </div>
        ))}
      </div>
    </section>
  );
}
