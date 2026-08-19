import { useTranslations } from "next-intl";

type Satellite = {
  id: string;
  kw: string;
  kd: number;
  vol: string;
  // 相对中心的位置（百分比）
  x: number;
  y: number;
  drift: "a" | "b" | "c";
};

// 布局与示例指标（KD/Vol 均为演示数据）；kw 文案走 messages（hero.field.satellites）
const SATELLITE_META = [
  { id: "s1", kd: 28, vol: "12.4K", x: 16, y: 22, drift: "a" },
  { id: "s2", kd: 54, vol: "8.7K", x: 84, y: 20, drift: "b" },
  { id: "s3", kd: 41, vol: "31.2K", x: 10, y: 70, drift: "c" },
  { id: "s4", kd: 67, vol: "5.3K", x: 90, y: 66, drift: "a" },
  { id: "s5", kd: 35, vol: "19.8K", x: 26, y: 88, drift: "b" },
  { id: "s6", kd: 49, vol: "7.1K", x: 74, y: 90, drift: "c" },
  { id: "s7", kd: 22, vol: "4.6K", x: 50, y: 8, drift: "b" },
] as const;

export default function KeywordField() {
  const t = useTranslations("hero.field");
  const labels = t.raw("satellites") as Array<{ kw: string }>;
  const satellites: Satellite[] = SATELLITE_META.map((meta, i) => ({
    ...meta,
    drift: meta.drift as "a" | "b" | "c",
    kw: labels[i]?.kw ?? "",
  }));

  // 中心点百分比
  const cx = 50;
  const cy = 50;

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
      >
        {/* 同心轨道圈 */}
        <circle
          cx={cx}
          cy={cy}
          r="22"
          fill="none"
          stroke="#2a2837"
          strokeWidth="0.2"
        />
        <circle
          cx={cx}
          cy={cy}
          r="34"
          fill="none"
          stroke="#221f2e"
          strokeWidth="0.2"
        />

        {/* 连接线 */}
        {satellites.map((s) => (
          <line
            key={`line-${s.id}`}
            x1={cx}
            y1={cy}
            x2={s.x}
            y2={s.y}
            stroke="url(#lineGrad)"
            strokeWidth="0.25"
            strokeOpacity="0.55"
          />
        ))}

        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6c4cff" />
            <stop offset="50%" stopColor="#2f8cff" />
            <stop offset="100%" stopColor="#ffd400" />
          </linearGradient>
          <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2a2640" />
            <stop offset="100%" stopColor="#14121a" />
          </radialGradient>
          <linearGradient id="satFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f1d2b" />
            <stop offset="100%" stopColor="#16141f" />
          </linearGradient>
        </defs>

        {/* 中心节点 */}
        <g
          className="animate-breathe"
          style={{ transformOrigin: "50% 50%" } as React.CSSProperties}
        >
          <circle
            cx={cx}
            cy={cy}
            r="13"
            fill="url(#centerGrad)"
            stroke="#ffd400"
            strokeWidth="0.4"
            strokeOpacity="0.6"
          />
          <circle cx={cx} cy={cy} r="8" fill="none" stroke="#2f8cff" strokeWidth="0.2" strokeOpacity="0.5" />
        </g>

        {/* 卫星节点 */}
        {satellites.map((s) => (
          <g
            key={s.id}
            className={
              s.drift === "a"
                ? "animate-drift-a"
                : s.drift === "b"
                  ? "animate-drift-b"
                  : "animate-drift-c"
            }
            style={{ transformOrigin: `${s.x}% ${s.y}%` } as React.CSSProperties}
          >
            <circle
              cx={s.x}
              cy={s.y}
              r="5.5"
              fill="url(#satFill)"
              stroke="#3a374a"
              strokeWidth="0.2"
            />
          </g>
        ))}
      </svg>

      {/* 中心节点文字层（HTML 叠加，保证中文清晰） */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="animate-breathe text-center"
          style={{ transformOrigin: "50% 50%" } as React.CSSProperties}
        >
          <div className="font-display text-base font-bold text-d-text sm:text-lg">
            {t("center")}
          </div>
          <div className="mt-0.5 font-mono text-[0.625rem] text-gold sm:text-xs">
            KD 73 · Vol 1.2M
          </div>
        </div>
      </div>

      {/* 卫星节点文字层 */}
      {satellites.map((s) => (
        <div
          key={`label-${s.id}`}
          className="pointer-events-none absolute"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            className={
              s.drift === "a"
                ? "animate-drift-a text-center"
                : s.drift === "b"
                  ? "animate-drift-b text-center"
                  : "animate-drift-c text-center"
            }
          >
            <div className="whitespace-nowrap font-sans text-[0.625rem] font-semibold text-d-text sm:text-xs">
              {s.kw}
            </div>
            <div className="whitespace-nowrap font-mono text-[0.5625rem] text-d-secondary sm:text-[0.625rem]">
              KD {s.kd} · {s.vol}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
