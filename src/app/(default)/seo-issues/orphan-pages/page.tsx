// ===== /seo-issues/orphan-pages（EN 无前缀 · ZH 前缀由 i18n 体系追加）=====
// 内容与结构化数据都在 IssueLandingPage / landing-pages.ts 中，本文件只做路由接线。
// 定位：症状诊断型搜索入口 —— 与 /features/*（功能说明）刻意分工，不重复其内容。

import IssueLandingPage from "@/components/seo-issues/IssueLandingPage";

export default function Page() {
  return <IssueLandingPage pageId="seo_issues_orphan_pages" />;
}
