"use client";

import { useState } from "react";
import { useToast } from "@/components/dashboard/Toast";

// 即将上线的降级页：外链数据需要接入专业数据源，正在筹备

const plannedFeatures = [
  {
    name: "外链明细",
    desc: "查看每条外链的来源页面、锚文本、目标页面、权威度和发现时间",
  },
  {
    name: "引荐域名分析",
    desc: "按域名维度聚合外链，识别高权重来源和行业分布",
  },
  {
    name: "锚文本分布",
    desc: "分析锚文本的优化比例，避免过度优化或品牌词占比失衡",
  },
  {
    name: "增长趋势",
    desc: "90 天外链新增与流失曲线，发现增长异常和负面信号",
  },
];

export default function BacklinksPage() {
  const { show, Toast } = useToast();
  const [email, setEmail] = useState("");

  const handleNotify = (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      show("请输入有效邮箱", "error");
      return;
    }
    show("已记录，上线后通知你", "success");
    setEmail("");
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      {/* 页头：编号 + 标题 + 发丝线 + 即将上线标 */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-ink-40">04</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          外链分析
        </h1>
        <span className="badge-warn">即将上线</span>
        <div className="hairline flex-1" />
      </div>
      <p className="mt-1.5 font-sans text-sm text-ink-60">
        外链数据需要接入专业数据源（如 Ahrefs / Majestic / DataForSEO），正在筹备中。
      </p>

      {/* 灰态指标骨架 */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "外链总数", value: "—" },
          { label: "引荐域名", value: "—" },
          { label: "权威度", value: "—" },
          { label: "DoFollow 占比", value: "—" },
        ].map((m) => (
          <div
            key={m.label}
            className="card-a opacity-60 p-5"
          >
            <div className="font-sans text-xs text-ink-40">{m.label}</div>
            <div className="mt-1 font-display text-2xl font-bold text-ink-40">
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* 计划能力清单 */}
      <div className="mt-10">
        <h2 className="font-display text-lg font-bold text-ink">
          上线后你能看到
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plannedFeatures.map((f) => (
            <div
              key={f.name}
              className="card-a p-5"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="font-sans text-sm font-semibold text-ink">
                  {f.name}
                </span>
              </div>
              <p className="mt-2.5 font-sans text-xs leading-relaxed text-ink-60">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 上线通知 */}
      <div className="card-a mt-10 overflow-hidden border-brand/20">
        <div className="p-6 sm:p-8">
          <h3 className="font-display text-base font-bold text-ink">
            上线时通知我
          </h3>
          <p className="mt-1.5 font-sans text-xs text-ink-60">
            留下邮箱，外链分析模块上线后第一时间通知你。
          </p>
          <form
            onSubmit={handleNotify}
            className="mt-4 flex flex-col gap-3 sm:flex-row"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="flex-1 rounded-lg border border-line bg-card px-4 py-2.5 font-mono text-sm text-ink placeholder:text-ink-40 focus:border-ink-25 focus:outline-none"
            />
            <button type="submit" className="btn-primary">
              通知我
            </button>
          </form>
        </div>
      </div>

      <Toast />
    </div>
  );
}
