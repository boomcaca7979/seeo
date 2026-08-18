// ===== [locale] 未知子路径 catch-all =====
// 承接 /zh/<未知路径>、/<无效locale>/<任意子路径> 等不匹配任何 [locale] 子页面的
// 路由（此前它们落入全局静态 /_not-found 壳，永远是英文）。
// 这里进入 [locale] 渲染树后立即 notFound()，由 [locale]/not-found.tsx 按
// params.locale 输出中文/英文 404（zh 有效 → 中文；无效 locale → defaultLocale 英文）。
//
// BUG-004 防回归说明：无效 locale 的动态 fallback 渲染中，request config 已短路
// 为 defaultLocale（不调用 cookies()），不会触发 static-to-dynamic 500。

import { notFound } from "next/navigation";

export default function CatchAllNotFound() {
  notFound();
}
