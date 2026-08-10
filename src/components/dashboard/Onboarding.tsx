"use client";

import Link from "next/link";

interface OnboardingProps {
  displayName: string;
}

const STEPS = [
  {
    n: "01",
    title: "输入网站域名",
    desc: "添加你要分析的网站，建立第一个 SEO 监控项目。",
  },
  {
    n: "02",
    title: "一键运行 SEO Audit",
    desc: "3 秒内拿到健康分与 20+ 项技术检查结果，发现影响排名的问题。",
  },
  {
    n: "03",
    title: "查看问题并开始优化",
    desc: "按严重程度排序的检查清单 + 修复建议，直接指导下一步动作。",
  },
];

export default function Onboarding({ displayName }: OnboardingProps) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
      {/* eyebrow 行 */}
      <div className="flex items-center justify-between font-sans text-[11px] text-ink-40">
        <span>欢迎来到 SeeO</span>
        <span>数据更新时间 · 演示模式</span>
      </div>

      {/* 主标题 */}
      <div className="mt-3">
        <h1
          className="font-display font-bold tracking-tight text-ink"
          style={{ fontSize: 32, lineHeight: 1.2 }}
        >
          你好，{displayName}
        </h1>
        <p className="mt-1.5 font-sans text-sm text-ink-60">
          还没有项目。按下面 3 步完成首次 SEO 审计，看看你的网站表现如何。
        </p>
      </div>

      {/* Onboarding 区块 */}
      <section className="mt-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-40">01</span>
          <h2 className="font-display text-base font-bold text-ink">开始使用</h2>
          <div className="hairline flex-1" />
        </div>

        <div className="mt-4 card-a p-8 sm:p-10">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="flex flex-col">
                <span className="font-mono text-xs text-brand">{s.n}</span>
                <div className="mt-1.5 font-display text-base font-bold text-ink">
                  {s.title}
                </div>
                <p className="mt-1.5 font-sans text-sm text-ink-60 leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>

          {/* 主 CTA */}
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link href="/app/audit" className="btn-primary px-8 py-3 text-base">
              开始免费审计 →
            </Link>
            <p className="font-mono text-[10px] text-ink-40">
              无需信用卡 · free 套餐每日 3 次审计
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
