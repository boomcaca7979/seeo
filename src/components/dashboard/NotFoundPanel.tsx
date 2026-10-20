// ===== 工作台缺失内容的本地化面板（404 边界与项目详情页共用）=====
//
// 为什么项目详情页不能走 notFound()：notFound() 在 Server Component 里由 Next 自己
// 注入 <meta name="robots" content="noindex"/>（见 node_modules/next/dist/client/
// components/not-found.js 的注释与实现），而 (default) layout 已为 /app 声明
// noindex, follow。站内 RSC 导航命中它时，两条 robots 会同时留在 DOM 里。
//
// 分工：文档请求仍由 proxy 的路由级 404 给出 HTTP 404 + 完整文档 + 唯一 robots
// （见 src/lib/supabase/middleware.ts）；本面板只服务站内导航，输出同一份本地化
// 错误语义并保留工作台外壳。文案与 not-found 边界同源，两条路径不会漂移。

import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFoundPanel() {
  const t = await getTranslations("dashboard.notFound");
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center p-8 text-center">
      <div className="font-mono text-7xl font-semibold text-ink-40">404</div>
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">
        {t("title")}
      </h1>
      <p className="mt-2 font-sans text-sm text-ink-60">{t("subtitle")}</p>
      <Link href="/app" className="btn-primary mt-6">
        {t("back")}
      </Link>
    </div>
  );
}
