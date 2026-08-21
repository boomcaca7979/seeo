import { useTranslations } from "next-intl";

// 排名趋势图（accent 面积线）
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
        <linearGradient id="rankArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 网格 */}
      {[25, 50, 75].map((y) => (
        <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#e5e7eb" strokeWidth="0.3" />
      ))}
      <path d={area} fill="url(#rankArea)" />
      <path d={path} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* 末端节点 */}
      <circle cx="100" cy="22" r="2.5" fill="#2563eb" />
      <circle cx="100" cy="22" r="4" fill="none" stroke="#2563eb" strokeWidth="0.4" strokeOpacity="0.5" />
    </svg>
  );
}

// 健康度评分环（示例展示）
function HealthRing({ scoreNote }: { scoreNote: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c - (75 / 100) * c;

  return (
    <div className="relative flex items-center justify-center">
      <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#2563eb"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-semibold text-ink">75</div>
        <div className="font-mono text-xs text-ink-40">{scoreNote}</div>
      </div>
    </div>
  );
}

// 流量柱状图
function TrafficBars() {
  const bars = [42, 55, 38, 67, 49, 78, 58, 72, 63, 85, 74, 92];
  return (
    <div className="flex h-full items-end gap-2">
      {bars.map((h, i) => (
        <div key={i} className="flex flex-1 flex-col justify-end">
          <div
            className="w-full rounded-t bg-accent/80"
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
    <div className="card-a p-3">
      <div className="font-mono text-xs text-ink-40">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-lg font-semibold text-ink">
          {value}
        </span>
        <span
          className={
            trend === "up"
              ? "font-mono text-xs text-pos"
              : "font-mono text-xs text-neg"
          }
        >
          {trend === "up" ? "▲" : "▼"} 12%
        </span>
      </div>
    </div>
  );
}

export default function DashboardPreview() {
  const t = useTranslations("preview");

  return (
    <section id="dashboard" className="bg-paper px-5 py-10 sm:px-8 sm:py-12">
      <div className="site-shell">
        {/* 标题（U3：「工作台预览」升级为主 H2，副标题 L2 20-28px，正文 L3 14-16px） */}
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
              {t("sectionHeading")}
            </h2>
            <p className="mt-3 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {t("sectionSubheading")}
            </p>
            <p className="mt-4 text-sm text-ink-60 sm:text-base">
              {t("sectionSubtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2 card-a px-3 py-2 font-mono text-xs text-ink-60">
            <span className="h-2 w-2 rounded-full bg-pos" />
            {t("demoBadge")}
          </div>
        </div>

        {/* 仪表盘矩阵 */}
        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* 排名趋势 - 大卡 */}
          <div className="card-a p-6 lg:col-span-8">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold text-ink">
                  {t("rankTrend.title")}
                </h3>
                <p className="mt-0.5 font-mono text-xs text-ink-40">
                  {t("rankTrend.subtitle")}
                </p>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-semibold text-ink">
                  #22
                </div>
                <div className="font-mono text-xs text-pos">{t("trendIllustration")}</div>
              </div>
            </div>
            <div className="mt-6 h-44">
              <RankTrendChart />
            </div>
            <div className="mt-3 flex justify-between font-mono text-xs text-ink-40">
              <span>{t("rankTrend.from")}</span>
              <span>{t("rankTrend.to")}</span>
            </div>
          </div>

          {/* 健康度环 - 小卡 */}
          <div className="card-a p-6 lg:col-span-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-ink">
                {t("health.title")}
              </h3>
              <span className="rounded bg-pos/10 px-2 py-0.5 font-mono text-xs text-pos">
                {t("sample")}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-xs text-ink-40">
              {t("health.subtitle")}
            </p>
            <div className="mt-4 flex flex-col items-center">
              <HealthRing scoreNote={t("health.scoreNote")} />
              <div className="mt-3 grid w-full grid-cols-3 gap-2 text-center">
                <div>
                  <div className="font-mono text-sm font-semibold text-neg">
                    {t("sample")}
                  </div>
                  <div className="font-mono text-xs text-ink-40">{t("health.errors")}</div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-warn">
                    {t("sample")}
                  </div>
                  <div className="font-mono text-xs text-ink-40">{t("health.warnings")}</div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-ink-60">
                    {t("sample")}
                  </div>
                  <div className="font-mono text-xs text-ink-40">{t("health.notices")}</div>
                </div>
              </div>
            </div>
          </div>

          {/* 流量柱状图 */}
          <div className="card-a p-6 lg:col-span-7">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold text-ink">
                  {t("traffic.title")}
                </h3>
                <p className="mt-0.5 font-mono text-xs text-ink-40">
                  {t("traffic.subtitle")}
                </p>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-semibold text-ink">
                  {t("sample")}
                </div>
                <div className="font-mono text-xs text-pos">{t("trendIllustration")}</div>
              </div>
            </div>
            <div className="mt-6 h-40">
              <TrafficBars />
            </div>
            <div className="mt-2 flex justify-between font-mono text-xs text-ink-40">
              <span>{t("traffic.jan")}</span>
              <span>{t("traffic.jun")}</span>
              <span>{t("traffic.dec")}</span>
            </div>
          </div>

          {/* 指标卡片堆 */}
          <div className="grid grid-cols-2 gap-4 lg:col-span-5">
            <div className="card-a p-5">
              <div className="font-mono text-xs text-ink-40">{t("metrics.trackedKeywords")}</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-ink">
                {t("sample")}
              </div>
              <div className="mt-1 font-mono text-xs text-pos">
                {t("trendIllustration")}
              </div>
              <div className="mt-4 flex gap-1">
                {[60, 75, 45, 88, 70, 92, 80].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-accent/70"
                    style={{ height: `${h * 0.3}px` }}
                  />
                ))}
              </div>
            </div>
            <div className="card-a p-5">
              <div className="font-mono text-xs text-ink-40">{t("metrics.referringDomains")}</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-ink">
                {t("sample")}
              </div>
              <div className="mt-1 font-mono text-xs text-neg">
                {t("trendIllustration")}
              </div>
              <div className="mt-4 flex gap-1">
                {[70, 65, 80, 72, 68, 60, 55].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-neg/60"
                    style={{ height: `${h * 0.3}px` }}
                  />
                ))}
              </div>
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-4">
              <MetricPill label={t("metrics.top3")} value={t("sample")} trend="up" />
              <MetricPill label={t("metrics.top10")} value={t("sample")} trend="up" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
