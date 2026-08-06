"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth-config";

export default function CTA() {
  const router = useRouter();
  // 演示模式：直接进 /app；启用模式：进 /signup
  const primaryHref = isAuthEnabled ? "/signup" : "/app";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(primaryHref);
  };

  return (
    <section id="cta" className="bg-station px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-2xl bg-ink p-8 sm:p-14">
          {/* 背景极光装饰 */}
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-20 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, #6c4cff 0%, transparent 70%)",
            }}
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full opacity-20 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, #2f8cff 0%, transparent 70%)",
            }}
          />

          <div className="relative text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-mono text-xs text-gold">
              7 天免费试用 · 无需信用卡
            </span>
            <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-d-text sm:text-5xl">
              看清你的搜索流量，从今天开始
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-d-secondary sm:text-lg">
              输入一个域名，5 分钟内拿到第一份审计报告和关键词机会。先用起来，再决定要不要付费。
            </p>

            {/* 域名输入框 */}
            <form
              className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row"
              onSubmit={handleSubmit}
            >
              <input
                type="text"
                placeholder="输入你的网站域名 example.com"
                className="w-full rounded-lg border border-d-muted/30 bg-ink-elevated px-4 py-3 font-sans text-sm text-d-text placeholder:text-d-muted focus:border-gold focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-gold px-6 py-3 font-sans text-sm font-semibold text-ink transition-opacity hover:opacity-90"
              >
                开始分析
              </button>
            </form>

            {/* 次级按钮 */}
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="#features"
                className="font-sans text-sm font-medium text-d-secondary transition-colors hover:text-d-text"
              >
                浏览全部功能 →
              </Link>
              <span className="hidden font-mono text-xs text-d-muted sm:inline">
                ·
              </span>
              <Link
                href="#footer"
                className="font-sans text-sm font-medium text-d-secondary transition-colors hover:text-d-text"
              >
                查看定价方案
              </Link>
            </div>

            {/* 信任标识 */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-xs text-d-muted">
              <span>● 数据实时同步</span>
              <span>● 支持 Google / Bing / 百度</span>
              <span>● 团队协作</span>
              <span>● 可随时取消</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
