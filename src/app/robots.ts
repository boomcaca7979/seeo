// SeeO robots.txt
// - 公开营销页允许抓取（/、/pricing、/docs、/login、/signup、/privacy、/terms、/refund）
// - 应用工作台与 API 不应被搜索引擎索引
// - 声明 sitemap

import type { MetadataRoute } from "next";

const SITE_URL = "https://seeo-five.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
