// ===== 工作台 404 边界 =====
// /app 树内显式 notFound() 的兜底边界。项目详情页的「确认不存在」分支现在直接渲染
// NotFoundPanel（不经本边界），所以站内导航与这里共用同一份正文，不再有两套文案。
// 未知 /app/xxx 路径不在这里：它匹配不到任何页面，由 global-not-found 输出 404 文档。
// metadata 必须与正文同源：否则 404 顶着 dashboard layout 的功能页标题
// （实测 /app/projects/99999 曾输出「Website overview · SeeO」）。
// /app 无 [locale] 段 → locale 由 NEXT_LOCALE cookie / Accept-Language 解析，
// 与 dashboard layout 的 generateMetadata 同一套规则。

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import NotFoundPanel from "@/components/dashboard/NotFoundPanel";
import { composeDashboardTitle } from "@/lib/dashboard-titles";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard.notFound");
  return {
    title: composeDashboardTitle(t("title")),
    description: t("subtitle"),
  };
}

export default function NotFound() {
  return <NotFoundPanel />;
}
