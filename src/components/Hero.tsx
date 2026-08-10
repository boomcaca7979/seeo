import Link from "next/link";
import KeywordField from "./KeywordField";
import UrlAuditBox from "./UrlAuditBox";
import { isAuthEnabled } from "@/lib/auth-config";

export default function Hero() {
  // 演示模式：主按钮直接进 /app；启用模式：进 /signup
  const primaryHref = isAuthEnabled ? "/signup" : "/app";

  return (
    <section className="relative overflow-hidden bg-station px-5 py-16 sm:px-8 sm:py-24">
      {/* 背景装饰网格 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(#14121a 1px, transparent 1px), linear-gradient(90deg, #14121a 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative mx-auto max-w-7xl">
        {/* 标题 */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-y-muted/40 bg-station-deep/60 px-3 py-1 font-mono text-xs text-y-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-yellow" />
            每日追踪 · 持续监控
          </span>
          <h1 className="mt-5 font-display text-4xl font-bold leading-tight tracking-tight text-y-text sm:text-6xl">
            看清搜索流量的走向
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-y-secondary sm:text-lg">
            把关键词、排名、外链、技术审计、竞品和内容优化放在同一张工作台上。SeeO 帮你从一堆搜索数据里，看出下一步该做什么。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={primaryHref}
              className="w-full rounded-lg bg-ink px-6 py-3 text-center text-sm font-semibold text-d-text transition-opacity hover:opacity-90 sm:w-auto"
            >
              开始分析你的网站
            </Link>
            <Link
              href="#features"
              className="w-full rounded-lg border border-ink/40 bg-transparent px-6 py-3 text-center text-sm font-semibold text-y-text transition-colors hover:bg-ink/5 sm:w-auto"
            >
              看看能做什么
            </Link>
          </div>

          {/* URL 快速审计入口 */}
          <UrlAuditBox />
        </div>

        {/* 深色面板 - 引力场 */}
        <div className="mx-auto mt-14 max-w-5xl">
          <div className="relative rounded-2xl bg-ink p-2 ring-1 ring-ink/20 sm:p-3">
            {/* 面板顶部条 */}
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-coral/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-gold/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-teal/70" />
              </div>
              <div className="font-mono text-[10px] text-d-muted sm:text-xs">
                seeo.app / keyword-gravity-field
              </div>
              <div className="font-mono text-[10px] text-teal sm:text-xs">
                ● LIVE
              </div>
            </div>

            {/* 引力场画布 */}
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-ink-elevated sm:aspect-[16/9]">
              <KeywordField />

              {/* 面板角标信息 */}
              <div className="absolute left-3 top-3 hidden font-mono text-[10px] text-d-muted sm:block">
                <div>NODES: 8</div>
                <div>EDGES: 7</div>
              </div>
              <div className="absolute right-3 top-3 hidden font-mono text-[10px] text-d-muted sm:block">
                <div>UPDATED: 2 min ago</div>
              </div>
              <div className="absolute bottom-3 left-3 hidden font-mono text-[10px] text-d-secondary sm:block">
                引力场示意 · 数据为示例
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
