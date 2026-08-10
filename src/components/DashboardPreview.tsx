// 排名趋势图（极光渐变面积线）
function RankTrendChart() {
  const points = [
    [0, 68], [10, 62], [20, 58], [30, 64], [40, 51],
    [50, 47], [60, 39], [70, 42], [80, 33], [90, 28], [100, 22],
  ];
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
    .join(" ");
  const area = `${path} L 100 100 L 0 100 Z`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="rankLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6c4cff" />
          <stop offset="50%" stopColor="#2f8cff" />
          <stop offset="100%" stopColor="#ffd400" />
        </linearGradient>
        <linearGradient id="rankArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f8cff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2f8cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 网格 */}
      {[25, 50, 75].map((y) => (
        <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#2a2837" strokeWidth="0.3" />
      ))}
      <path d={area} fill="url(#rankArea)" />
      <path d={path} fill="none" stroke="url(#rankLine)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* 末端节点 */}
      <circle cx="100" cy="22" r="2.5" fill="#ffd400" />
      <circle cx="100" cy="22" r="4" fill="none" stroke="#ffd400" strokeWidth="0.4" strokeOpacity="0.5" />
    </svg>
  );
}

// 健康度评分环（示例展示）
function HealthRing() {
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c - (75 / 100) * c;

  return (
    <div className="relative flex items-center justify-center">
      <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6c4cff" />
            <stop offset="50%" stopColor="#2f8cff" />
            <stop offset="100%" stopColor="#ffd400" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#2a2837" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-bold text-d-text">示例</div>
        <div className="font-mono text-[10px] text-d-muted">评分示意</div>
      </div>
    </div>
  );
}

// 流量柱状图
function TrafficBars() {
  const bars = [42, 55, 38, 67, 49, 78, 58, 72, 63, 85, 74, 92];
  return (
    <div className="flex h-full items-end gap-1.5">
      {bars.map((h, i) => (
        <div key={i} className="flex flex-1 flex-col justify-end">
          <div
            className="w-full rounded-t bg-aurora"
            style={{ height: `${h}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function MetricPill({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: "up" | "down";
}) {
  return (
    <div className="rounded-lg bg-ink-elevated p-3">
      <div className="font-mono text-[10px] text-d-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-lg font-semibold text-d-text">
          {value}
        </span>
        <span
          className={
            trend === "up"
              ? "font-mono text-xs text-teal"
              : "font-mono text-xs text-coral"
          }
        >
          {trend === "up" ? "▲" : "▼"} 12%
        </span>
      </div>
    </div>
  );
}

export default function DashboardPreview() {
  return (
    <section id="dashboard" className="bg-station-deep px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        {/* 标题 */}
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <span className="font-mono text-sm text-y-secondary">
              工作台预览
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-y-text sm:text-5xl">
              看到每一天的变化
            </h2>
            <p className="mt-4 text-base text-y-secondary sm:text-lg">
              所有项目的核心指标汇总在一个仪表盘里，排名涨了还是掉了、健康度有没有回升、流量从哪来，一眼看完。
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-ink/10 px-3 py-2 font-mono text-xs text-y-secondary">
            <span className="h-2 w-2 rounded-full bg-teal-yellow" />
            示例数据 · 演示用
          </div>
        </div>

        {/* 仪表盘矩阵 */}
        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* 排名趋势 - 大卡 */}
          <div className="rounded-2xl bg-ink p-6 lg:col-span-8">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-d-text">
                  排名趋势
                </h3>
                <p className="mt-0.5 font-mono text-xs text-d-muted">
                  示例项目 · 近 30 天 · 移动端
                </p>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-bold text-d-text">
                  示例
                </div>
                <div className="font-mono text-xs text-teal">趋势示意</div>
              </div>
            </div>
            <div className="mt-6 h-44">
              <RankTrendChart />
            </div>
            <div className="mt-3 flex justify-between font-mono text-[10px] text-d-muted">
              <span>30 天前</span>
              <span>今天</span>
            </div>
          </div>

          {/* 健康度环 - 小卡 */}
          <div className="rounded-2xl bg-ink p-6 lg:col-span-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-d-text">
                健康度
              </h3>
              <span className="rounded bg-teal/15 px-2 py-0.5 font-mono text-[10px] text-teal">
                示例
              </span>
            </div>
            <p className="mt-0.5 font-mono text-xs text-d-muted">
              技术 SEO 审计综合分
            </p>
            <div className="mt-4 flex flex-col items-center">
              <HealthRing />
              <div className="mt-3 grid w-full grid-cols-3 gap-2 text-center">
                <div>
                  <div className="font-mono text-sm font-semibold text-coral">
                    示例
                  </div>
                  <div className="font-mono text-[9px] text-d-muted">错误</div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-gold">
                    示例
                  </div>
                  <div className="font-mono text-[9px] text-d-muted">警告</div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-d-secondary">
                    示例
                  </div>
                  <div className="font-mono text-[9px] text-d-muted">提示</div>
                </div>
              </div>
            </div>
          </div>

          {/* 流量柱状图 */}
          <div className="rounded-2xl bg-ink p-6 lg:col-span-7">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-d-text">
                  自然流量
                </h3>
                <p className="mt-0.5 font-mono text-xs text-d-muted">
                  月度访问量趋势 · 示例
                </p>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-bold text-d-text">
                  示例
                </div>
                <div className="font-mono text-xs text-teal">趋势示意</div>
              </div>
            </div>
            <div className="mt-6 h-40">
              <TrafficBars />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-d-muted">
              <span>1月</span>
              <span>6月</span>
              <span>12月</span>
            </div>
          </div>

          {/* 指标卡片堆 */}
          <div className="grid grid-cols-2 gap-4 lg:col-span-5">
            <div className="rounded-2xl bg-ink p-5">
              <div className="font-mono text-[10px] text-d-muted">追踪关键词</div>
              <div className="mt-2 font-mono text-2xl font-bold text-d-text">
                示例
              </div>
              <div className="mt-1 font-mono text-xs text-teal">
                趋势示意
              </div>
              <div className="mt-4 flex gap-1">
                {[60, 75, 45, 88, 70, 92, 80].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-aurora"
                    style={{ height: `${h * 0.3}px` }}
                  />
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-ink p-5">
              <div className="font-mono text-[10px] text-d-muted">外链域名</div>
              <div className="mt-2 font-mono text-2xl font-bold text-d-text">
                示例
              </div>
              <div className="mt-1 font-mono text-xs text-coral">
                趋势示意
              </div>
              <div className="mt-4 flex gap-1">
                {[70, 65, 80, 72, 68, 60, 55].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-coral/70"
                    style={{ height: `${h * 0.3}px` }}
                  />
                ))}
              </div>
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-4">
              <MetricPill label="TOP3 关键词" value="示例" trend="up" />
              <MetricPill label="TOP10 关键词" value="示例" trend="up" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
