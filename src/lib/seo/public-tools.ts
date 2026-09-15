// ===== 公开工具的启用开关（单一事实来源）=====
//
// 背景：公开外链检查器（/tools/backlink-checker）的「真实结果」完全依赖 DataForSEO。
// 当前 DataForSEO 未充值 / 未配置生产凭据，工具无法返回任何真实数据，
// 因此这里把该工具标记为「暂缓上线」：默认停用（ENABLED = false）。
//
// 停用时（默认）：
//   - 不进入 sitemap（src/app/sitemap.ts 过滤）
//   - 页面输出 noindex（[locale] metadata）
//   - 公开 contextual 内链入口下线（feature / guide 页按开关渲染）
//   - 页面渲染「暂未开放」状态，不伪造可用、不假装能给真实数据
//
// 功能实现**全部保留、不删除**：服务层（public-backlink-service）、
// 匿名 API（/api/tools/backlink-checker）、UI 组件（BacklinkChecker）、
// 缓存与额度控制（7 天快照 / 冷却 / 单 IP 与全站每日闸门）、
// 测试（public-backlink-service.test.ts）均按原样存在。
//
// 重新启用（DataForSEO 充值并配置好生产凭据后）：
//   1) 在部署环境设置 BACKLINK_CHECKER_ENABLED=true（Vercel → Production 环境变量）
//   2) 重新部署（sitemap 与页面为构建期产物，需重新构建）
//   即可同时恢复：sitemap 收录、indexable、contextual links、真实 API —— 无需重新设计工具。
//
// 说明：刻意不用 NEXT_PUBLIC_ 前缀 —— 该开关只在服务端（构建期 sitemap 与 RSC 页面）使用，
// 不需要、也不应该进入客户端 bundle。

/** 公开外链检查器的路由路径（EN 无前缀；ZH 前缀由 i18n 体系追加） */
export const BACKLINK_CHECKER_PATH = "/tools/backlink-checker";

/** 是否启用公开外链检查器。默认 false（停用）；仅在显式设为 "true" 时启用。 */
export const BACKLINK_CHECKER_ENABLED = process.env.BACKLINK_CHECKER_ENABLED === "true";

/** 当前处于「暂缓上线」状态的公开路径（不收录、noindex、不对外导流） */
export const DISABLED_PUBLIC_PATHS: readonly string[] = BACKLINK_CHECKER_ENABLED
  ? []
  : [BACKLINK_CHECKER_PATH];

/** 某条公开路径当前是否应作为正式 SEO 落地页对外收录 */
export function isPublicPathEnabled(path: string): boolean {
  return !DISABLED_PUBLIC_PATHS.includes(path);
}
