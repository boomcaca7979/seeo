interface ChangeBadgeProps {
  value: number;
  suffix?: string;
}

export function ChangeBadge({ value, suffix = "" }: ChangeBadgeProps) {
  if (value === 0) {
    return <span className="font-mono text-sm text-ink-40">—</span>;
  }
  const positive = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-sm font-semibold ${
        positive ? "text-pos" : "text-neg"
      }`}
    >
      {positive ? "▲" : "▼"} {Math.abs(value)}
      {suffix}
    </span>
  );
}

export function RankBadge({ rank }: { rank: number }) {
  let color = "text-ink-60";
  let bg = "bg-line-soft";
  if (rank <= 3) {
    color = "text-pos";
    bg = "bg-pos/15";
  } else if (rank <= 10) {
    color = "text-warn";
    bg = "bg-warn/15";
  }
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${bg} ${color}`}>
      #{rank}
    </span>
  );
}

export function SerpFeatureBadge({ feature }: { feature: string }) {
  const icons: Record<string, string> = {
    精选摘要: "★",
    PAA: "?",
    视频轮播: "▶",
    知识面板: "▣",
    图片包: "▦",
    本地包: "⌖",
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-line-soft px-1.5 py-0.5 font-sans text-[0.625rem] text-ink-60"
      title={feature}
    >
      <span className="text-warn">{icons[feature] ?? "•"}</span>
      {feature}
    </span>
  );
}
