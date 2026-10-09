// ===== /admin 布局：Owner Console 访问控制（唯一入口）=====
//
// 授权完全复用现有 Supabase Auth 会话 + ADMIN_EMAILS 白名单（见 src/lib/admin/auth.ts）。
// fail-closed：未配置白名单 / 未登录 / 非白名单 —— 一律不渲染任何经营数据。

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import { checkAdmin, ADMIN_EMAILS_ENV } from "@/lib/admin/auth";

// 始终动态渲染（读取会话 + 数据库）
export const dynamic = "force-dynamic";

// Owner Console 绝不进入搜索引擎
export const metadata: Metadata = {
  title: "SeeO Owner Console",
  description: "Internal owner console.",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const guard = await checkAdmin();

  if (!guard.ok) {
    // 未登录 → 走既有登录页（携带 redirect），登录后自动回到 /admin
    if (guard.code === "AUTH_REQUIRED") {
      redirect(`/login?redirect=${encodeURIComponent("/admin")}`);
    }
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-6">
        <div className="rounded-lg border border-line bg-card p-6">
          <h1 className="text-base font-semibold text-ink">Owner Console 不可用</h1>
          <p className="mt-2 text-sm text-ink-60">{guard.error}</p>
          {guard.code === "ADMIN_NOT_CONFIGURED" ? (
            <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-line-soft px-3 py-2 text-xs text-ink-60">
{`# 配置 owner 白名单（逗号分隔）
${ADMIN_EMAILS_ENV}=you@example.com`}
            </pre>
          ) : null}
        </div>
      </div>
    );
  }

  return <AdminShell email={guard.identity.email}>{children}</AdminShell>;
}
