// SeeO sitemap.xml
// 仅列出公开营销页（应用工作台与 API 已在 robots.ts 中 disallow）

import type { MetadataRoute } from "next";

const SITE_URL = "https://seeo-five.vercel.app";

const publicPaths = [
  "/",
  "/pricing",
  "/docs",
  "/login",
  "/signup",
  "/privacy",
  "/terms",
  "/refund",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return publicPaths.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1.0 : 0.7,
  }));
}
