import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "退款政策 · SeeO",
  description: "SeeO 退款政策：订阅服务的退款条件与流程说明。",
  alternates: { canonical: "/refund" },
};

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-mono text-3xl font-bold text-ink mb-8">退款政策</h1>
        <div className="space-y-6 text-ink-60 leading-relaxed">
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">01 退款政策</h2>
            <p>
              SeeO 提供 7 天内无理由退款保障。自订阅成功之日起 7 个自然日内，如您对服务不满意，可申请全额退款。
            </p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">02 退款流程</h2>
            <p>
              发送退款申请邮件至 support@seeo.local，邮件中请注明：注册邮箱、订阅订单号、退款原因。我们将在 3 个工作日内处理并原路退回。
            </p>
          </section>
          <section>
            <h2 className="font-mono text-lg font-bold text-ink mb-2">03 不适用退款的情况</h2>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>已消耗 SerpApi 额度超过 50 次</li>
              <li>已生成超过 5 份 PDF/邮件报告</li>
              <li>订阅超过 7 天</li>
              <li>因违反服务条款被封禁的账号</li>
            </ul>
          </section>
          <p className="pt-8 border-t border-line text-sm text-ink-40">最后更新：2026年8月</p>
        </div>
      </div>
    </div>
  );
}
