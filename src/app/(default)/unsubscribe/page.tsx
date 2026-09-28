import type { Metadata } from "next";
import Link from "next/link";

// ===== /unsubscribe —— 营销邮件退订确认页 =====
// 从邮件底部 Unsubscribe 链接 302 而来（token 在 /api/email/unsubscribe 处理）。
// noindex：工具页，不进搜索引擎。

export const metadata: Metadata = {
  title: "Unsubscribed — SeeO",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  const title =
    status === "done"
      ? "You're unsubscribed"
      : status === "already"
        ? "You were already unsubscribed"
        : status === "invalid"
          ? "This unsubscribe link is not valid"
          : "Unsubscribe";

  const body =
    status === "done"
      ? "You will no longer receive marketing and lifecycle emails from SeeO. Account and security emails (like sign-in) are not affected."
      : status === "already"
        ? "Marketing emails were already turned off for this address."
        : status === "invalid"
          ? "The link seems broken or incomplete. If you keep receiving marketing emails, contact support@seeo.asia."
          : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="card-a p-8 text-center">
          <div className="flex items-center justify-center gap-1">
            <span className="font-display text-2xl font-semibold text-ink">See</span>
            <span className="font-display text-2xl font-semibold text-accent">O</span>
          </div>
          <h1 className="mt-6 font-display text-xl font-semibold text-ink">{title}</h1>
          {body && <p className="mt-3 font-sans text-sm leading-relaxed text-ink-60">{body}</p>}
          <Link href="/" className="btn-secondary mt-6 inline-block px-6 py-2 text-sm">
            Back to SeeO
          </Link>
        </div>
      </div>
    </div>
  );
}
