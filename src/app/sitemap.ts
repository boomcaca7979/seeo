// SeeO sitemap.xml
// 仅列出公开营销页（应用工作台与 API 已在 robots.ts 中 disallow）
//
// Phase 5：
//   - EN（无前缀）+ ZH（/zh 前缀）成对收录，canonical URL only
//   - 每条 entry 附 hreflang alternates（en / zh-CN / x-default）
//   - 不收录 /en/*、/app、/payment、/api
//   - /login、/signup 为单语言实用页（cookie 驱动 UI，无 /zh 对应路由），只出 EN canonical

import type { MetadataRoute } from "next";

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
  "/privacy",
  "/terms",
  "/refund",
  "/contact",
];

/** 单语言页（仅 EN canonical，无 ZH 对应路由） */
const enOnlyPaths = ["/login", "/signup"];

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
  for (const path of bilingualPaths) {
    const enPath = path === "/" ? "/" : path;
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

  const enOnly: MetadataRoute.Sitemap = enOnlyPaths.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "yearly" as const,
    priority: 0.3,
  }));

  return [...bilingual, ...enOnly];
}
