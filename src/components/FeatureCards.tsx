import Link from "next/link";

type Feature = {
  tag: string;
  title: string;
  desc: string;
  bullets: string[];
  metric: { label: string; value: string; trend?: "up" | "down" };
};

const features: Feature[] = [
  {
    tag: "挖词",
    title: "关键词研究",
    desc: "从一个种子词挖出整片相关词，看清搜索量、难度、意图和 CPC，找到能带来流量的长尾机会。",
    bullets: ["相关词 / 短语匹配", "KD 难度评分", "搜索意图识别", "批量导入"],
    metric: { label: "词库总量", value: "28.4B", trend: "up" },
  },
  {
    tag: "追踪",
    title: "排名追踪",
    desc: "按关键词、地区、设备持续监控你的排名变化，波动一发生就提醒你，不用每天手动查。",
    bullets: ["每日自动刷新", "多地区 / 多设备", "排名趋势曲线", "波动预警"],
    metric: { label: "今日追踪", value: "1.2M", trend: "up" },
  },
  {
    tag: "诊断",
    title: "技术 SEO 审计",
    desc: "全站爬取一遍，把 404、重定向链、重复标题、缺 Alt 这些技术问题按优先级排好给你修。",
    bullets: ["健康度评分", "错误 / 警告 / 提示", "Core Web Vitals", "修复优先级"],
    metric: { label: "平均健康分", value: "87/100", trend: "up" },
  },
  {
    tag: "诊断",
    title: "外链分析",
    desc: "看清谁在链接你、锚文本怎么分布、哪些外链在涨哪些在掉，找到值得追的外链来源。",
    bullets: ["外链总览 + DA", "引荐域名分析", "锚文本分布", "增长 / 流失趋势"],
    metric: { label: "外链索引", value: "43.1T", trend: "up" },
  },
  {
    tag: "洞察",
    title: "竞品分析",
    desc: "把竞品的流量、关键词、外链摆在一起对比，看到你们差在哪、机会在哪，别再凭感觉判断。",
    bullets: ["域名概览对比", "流量趋势叠加", "关键词差距", "顶级页面分析"],
    metric: { label: "可对比域名", value: "5", trend: "up" },
  },
  {
    tag: "优化",
    title: "内容优化",
    desc: "输入一个页面和目标关键词，对照 SERP 前 10 给出该写哪些主题词、字数多少、哪里还能改。",
    bullets: ["页面 SEO 检测", "内容评分", "主题词建议", "选题大纲生成"],
    metric: { label: "平均提分", value: "+18", trend: "up" },
  },
];

export default function FeatureCards() {
  return (
    <section id="features" className="bg-station px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-7xl">
        {/* 标题 */}
        <div className="max-w-2xl">
          <span className="font-mono text-sm text-y-secondary">
            06 / 核心模块
          </span>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-y-text sm:text-5xl">
            一张工作台，看懂六个维度
          </h2>
          <p className="mt-4 text-base text-y-secondary sm:text-lg">
            从挖词到内容优化，SEO 工作流的每一步都在 SeeO 里打通，数据在模块之间自动流转，不用反复导入导出。
          </p>
        </div>

        {/* 卡片网格 */}
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.title}
              className="group flex flex-col rounded-2xl bg-ink p-6 ring-1 ring-ink/10 transition-colors hover:ring-gold/40"
            >
              {/* 顶部标签 + 指标 */}
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-gold/15 px-2.5 py-1 font-mono text-xs font-semibold text-gold">
                  {f.tag}
                </span>
                <div className="text-right">
                  <div className="font-mono text-[10px] text-d-muted">
                    {f.metric.label}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <span className="font-mono text-sm font-semibold text-d-text">
                      {f.metric.value}
                    </span>
                    {f.metric.trend === "up" && (
                      <span className="font-mono text-[10px] text-teal">
                        ▲
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 标题 + 描述 */}
              <h3 className="mt-5 font-display text-xl font-bold text-d-text">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-d-secondary">
                {f.desc}
              </p>

              {/* 功能点 */}
              <ul className="mt-5 space-y-2">
                {f.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-center gap-2 font-mono text-xs text-d-secondary"
                  >
                    <span className="h-1 w-1 rounded-full bg-gold" />
                    {b}
                  </li>
                ))}
              </ul>

              {/* 底部链接 */}
              <Link
                href="#cta"
                className="mt-6 inline-flex items-center gap-1.5 font-sans text-sm font-semibold text-gold transition-colors hover:text-aurora-blue"
              >
                试用这个模块
                <span aria-hidden>→</span>
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
