// SeeO robots.txt
// - 公开营销页允许抓取（/、/pricing、/docs、/login、/signup、/privacy、/terms、/refund）
// - 应用工作台、API 与支付结果页不应被搜索引擎/AI 抓取
// - 明确允许主流 AI crawler 读取公开产品内容（GEO）
// - 声明 sitemap

import type { MetadataRoute } from "next";

const SITE_URL = "https://www.seeo.asia";

// 公共禁止路径：私有工作台 / API / 支付结果（含订单号）
const DISALLOWED = ["/app", "/api", "/payment"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOWED,
      },
      // 明确的 AI crawler 政策：允许读取公开产品内容，私有区域仍然禁止
      {
        userAgent: "GPTBot",
        allow: "/",
        disallow: DISALLOWED,
      },
      {
        userAgent: "ClaudeBot",
        allow: "/",
        disallow: DISALLOWED,
      },
      {
        userAgent: "PerplexityBot",
        allow: "/",
        disallow: DISALLOWED,
      },
      {
        userAgent: "Google-Extended",
        allow: "/",
        disallow: DISALLOWED,
      },
      {
        userAgent: "Bytespider",
        allow: "/",
        disallow: DISALLOWED,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
