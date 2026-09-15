// SeeO sitemap.xml
// 仅列出公开营销页（应用工作台与 API 已在 robots.ts 中 disallow）
//
// Phase 5：
//   - EN（无前缀）+ ZH（/zh 前缀）成对收录，canonical URL only
//   - 每条 entry 附 hreflang alternates（en / zh-CN / x-default）
//   - 不收录 /en/*、/app、/payment、/api
//   - 不收录 /login、/signup：认证工具页（noindex），对搜索无价值
//   - 不收录「暂缓上线」的公开工具页（见 src/lib/seo/public-tools.ts）：
//     provider 未配置时工具拿不到真实结果，不应作为正式 SEO 落地页对外收录；
//     启用后自动恢复收录，无需改动本文件结构。
//   - URL canonical 形式统一不带尾部斜杠（EN 首页 = SITE_URL 本身）

import type { MetadataRoute } from "next";
import { DISABLED_PUBLIC_PATHS } from "@/lib/seo/public-tools";

const SITE_URL = "https://www.seeo.asia";

/** 参与双语 locale 路由的营销路径（与 src/i18n/locale-routed-paths.ts 保持一致） */
const bilingualPaths = [
  "/",
  "/pricing",
  "/docs",
  "/about",
  "/features/seo-audit",
  "/features/rank-tracking",
  "/features/backlink-analysis",
  "/features/keyword-research",
  "/features/competitor-analysis",
  "/features/content-optimization",
  "/alternatives/semrush",
  "/alternatives/ahrefs",
  "/guides/how-to-do-a-technical-seo-audit",
  "/guides/how-to-track-keyword-rankings",
  "/guides/how-to-analyze-backlinks",
  "/tools/backlink-checker",
  "/privacy",
  "/terms",
  "/refund",
  "/contact",
];

/** 实际收录进 sitemap 的路径：排除当前暂缓上线的公开工具页 */
const sitemapPaths = bilingualPaths.filter((p) => !DISABLED_PUBLIC_PATHS.includes(p));

function alternatesFor(path: string): MetadataRoute.Sitemap[number]["alternates"] {
  return {
    languages: {
      en: `${SITE_URL}${path === "/" ? "" : path}`,
      "zh-CN": `${SITE_URL}${path === "/" ? "/zh" : `/zh${path}`}`,
      "x-default": `${SITE_URL}${path === "/" ? "" : path}`,
    },
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const bilingual: MetadataRoute.Sitemap = [];
  for (const path of sitemapPaths) {
    const enPath = path === "/" ? "" : path;
    const zhPath = path === "/" ? "/zh" : `/zh${path}`;
    const priority = path === "/" ? 1.0 : 0.7;
    const changeFrequency = path === "/" ? "weekly" : "monthly";
    // EN canonical（无前缀）
    bilingual.push({
      url: `${SITE_URL}${enPath}`,
      lastModified: now,
      changeFrequency,
      priority,
      alternates: alternatesFor(path),
    });
    // ZH canonical（/zh 前缀）
    bilingual.push({
      url: `${SITE_URL}${zhPath}`,
      lastModified: now,
      changeFrequency,
      priority,
      alternates: alternatesFor(path),
    });
  }

  return bilingual;
}
