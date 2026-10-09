// ===== Owner Console 页面级守卫提示（server component）=====
//
// 为什么页面也要自行鉴权（除 layout 外）：
// Next.js App Router 中 layout 与 page **并行渲染**，layout 正常 return
// 无法阻止 page 的 RSC payload 被流式序列化进响应（官方 authentication 指南
// 明确 layout-only 授权 "not recommended"）。因此每个 admin 页面必须在
// 取数之前调用 checkAdmin()，未通过时只返回本组件（不含任何经营数据）。

import { Badge, Card } from "@/components/admin/ui";
import { ADMIN_EMAILS_ENV } from "@/lib/admin/auth";

export default function AdminGuardMessage({
  code,
  error,
}: {
  code: string;
  error: string;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-6">
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Badge tone="warn">{code}</Badge>
          <h1 className="text-base font-semibold text-ink">Owner Console 不可用</h1>
        </div>
        <p className="mt-2 text-sm text-ink-60">{error}</p>
        {code === "ADMIN_NOT_CONFIGURED" ? (
          <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-line-soft px-3 py-2 text-xs text-ink-60">
{`# 配置 owner 白名单（逗号分隔）
${ADMIN_EMAILS_ENV}=you@example.com`}
          </pre>
        ) : null}
      </Card>
    </div>
  );
}
