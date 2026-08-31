"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

// ===== 支付结果页（支付系统迁移中） =====
// 原支付渠道已下线；新支付渠道接入前，此页仅展示迁移提示，
// 不再发起订单查询或任何支付流程。
export default function PaymentResultPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Navbar />

      <div className="mx-auto max-w-2xl px-6 pt-16 pb-16">
        <div className="card-a p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warn/10">
            <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-warn">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 8v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
            </svg>
          </div>

          <h1 className="mt-5 font-mono text-xl font-semibold text-ink">支付功能正在迁移中</h1>
          <p className="mt-2 font-sans text-sm text-ink-60">
            我们正在升级支付系统，暂时无法发起新的支付。
            已完成的历史订单与会员权益不受影响。
          </p>

          <div className="mt-6 flex gap-3">
            <Link href="/pricing" className="btn-primary flex-1 text-center">
              返回定价页
            </Link>
            <Link href="/app" className="btn-secondary flex-1 text-center">
              进入控制台
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
