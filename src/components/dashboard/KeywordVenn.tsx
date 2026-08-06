interface VennProps {
  selfOnly: number;
  compOnly: number;
  common: number;
}

export default function KeywordVenn({ selfOnly, compOnly, common }: VennProps) {
  // 三圆位置（SVG viewBox 200x160）
  const c1 = { cx: 65, cy: 65, r: 52, label: "我的独有", value: selfOnly, color: "#ffd400" };
  const c2 = { cx: 135, cy: 65, r: 52, label: "竞品独有", value: compOnly, color: "#1e9e6a" };
  const c3 = { cx: 100, cy: 110, r: 52, label: "共同", value: common, color: "#c98a0a" };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 170" className="h-56 w-full max-w-xs">
        {/* 三圆（半透明填充 + 描边） */}
        {[c1, c2, c3].map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill={c.color}
            fillOpacity={0.18}
            stroke={c.color}
            strokeWidth={1.2}
            strokeOpacity={0.7}
          />
        ))}

        {/* 各区数字 */}
        {/* 我的独有（左上区域） */}
        <text x="35" y="58" fill="#ffd400" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="monospace">
          {selfOnly}
        </text>
        {/* 竞品独有（右上区域） */}
        <text x="165" y="58" fill="#1e9e6a" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="monospace">
          {compOnly}
        </text>
        {/* 共同（中下方） */}
        <text x="100" y="135" fill="#c98a0a" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="monospace">
          {common}
        </text>
        {/* 三圆交集中心 */}
        <text x="100" y="80" fill="#14121a" fontSize="9" textAnchor="middle" fontFamily="monospace" opacity="0.6">
          交集
        </text>
      </svg>

      {/* 图例 */}
      <div className="mt-3 flex flex-wrap justify-center gap-3 font-mono text-[10px]">
        <span className="flex items-center gap-1 text-ink-60">
          <span className="h-2 w-2 rounded-full" style={{ background: c1.color }} /> 我的独有
        </span>
        <span className="flex items-center gap-1 text-ink-60">
          <span className="h-2 w-2 rounded-full" style={{ background: c2.color }} /> 竞品独有
        </span>
        <span className="flex items-center gap-1 text-ink-60">
          <span className="h-2 w-2 rounded-full" style={{ background: c3.color }} /> 共同
        </span>
      </div>
    </div>
  );
}
