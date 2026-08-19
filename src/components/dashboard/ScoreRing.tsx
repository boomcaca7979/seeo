interface ScoreRingProps {
  score: number;
  size?: number;
  thickness?: number;
  showLabel?: boolean;
}

/** 浅色版：轨道 #ECE9DD，进度按分数纯色 ≥80 绿 / 60-79 橙 / <60 红 */
export default function ScoreRing({
  score,
  size = 96,
  thickness = 8,
  showLabel = true,
}: ScoreRingProps) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;

  const color = score >= 80 ? "#1E9E6A" : score >= 60 ? "#C98A0A" : "#E14B4B";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#ECE9DD"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-display font-semibold text-ink ${size >= 120 ? "text-3xl" : "text-xl"}`}>
            {score}
          </span>
          <span className="font-mono text-[0.5625rem] text-ink-40">/ 100</span>
        </div>
      )}
    </div>
  );
}
