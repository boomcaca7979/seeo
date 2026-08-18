// ===== /llms.txt =====
// 面向 AI crawler 的纯文本站点说明（GEO / AI Search 基础能力）
// 内容只包含可由产品代码验证的真实事实，不编造统计/评分/客户数据

import { SITE_URL } from "@/lib/seo/schema";

export const dynamic = "force-static";

export function GET() {
  const body = `# SeeO

SeeO is an SEO software platform for keyword research, rank tracking, technical SEO audits, competitor analysis, content optimization, and backlink analysis.

## Overview

SeeO is a web-based SEO analytics platform. Users add projects (websites), track keyword rankings, run technical SEO audits, analyze competitors, optimize content, and review backlink data. SeeO does not build its own search index; SERP data comes from SerpApi and backlink data from DataForSEO. Technical audits use SeeO's own crawler.

SeeO does NOT provide: AI citation tracking, LLM rank tracking, GEO scoring, or team collaboration. Only Google search data is supported.

## Core Capabilities

- Technical SEO Audit: ${SITE_URL}/features/seo-audit
  Crawl-based site audit, 20+ technical checks, health score (0-100), prioritized fixes. Quick mode: 1 page; full mode: up to 50 pages.
- Keyword Rank Tracking: ${SITE_URL}/features/rank-tracking
  Daily-refreshed Google rankings per keyword x domain x location x device, history trends, volatility alerts. Data from SerpApi.
- Backlink Analysis: ${SITE_URL}/features/backlink-analysis
  Total backlinks, referring domains, Domain Rank, dofollow ratio, anchors. Data from DataForSEO. Pro plan only, 7-day cache.
- Keyword Research: keyword overview and expansion with volume, difficulty, intent (in-app)
- Competitor Analysis: ranking comparison and share of voice (in-app)
- Content Optimization: content checks against SERP Top 10 (in-app)
- Reporting: PDF / Excel export, email reports (in-app)
- Automation: scheduled daily refresh and alerts (in-app)

## Pricing

Free, Lite, and Pro plans: ${SITE_URL}/pricing

## Public Pages

Marketing pages are bilingual: English (default, no URL prefix) and Chinese (zh, /zh prefix).

- Home: ${SITE_URL}/ · Chinese: ${SITE_URL}/zh
- Pricing: ${SITE_URL}/pricing · Chinese: ${SITE_URL}/zh/pricing
- Docs: ${SITE_URL}/docs · Chinese: ${SITE_URL}/zh/docs
- About: ${SITE_URL}/about · Chinese: ${SITE_URL}/zh/about
- SEO Audit: ${SITE_URL}/features/seo-audit · Chinese: ${SITE_URL}/zh/features/seo-audit
- Rank Tracking: ${SITE_URL}/features/rank-tracking · Chinese: ${SITE_URL}/zh/features/rank-tracking
- Backlink Analysis: ${SITE_URL}/features/backlink-analysis · Chinese: ${SITE_URL}/zh/features/backlink-analysis
- Login: ${SITE_URL}/login
- Signup: ${SITE_URL}/signup
- Privacy Policy: ${SITE_URL}/privacy · Chinese: ${SITE_URL}/zh/privacy
- Terms of Service: ${SITE_URL}/terms · Chinese: ${SITE_URL}/zh/terms
- Refund Policy: ${SITE_URL}/refund · Chinese: ${SITE_URL}/zh/refund

## Important

- SeeO is an SEO software platform. It is not an AI search analytics tool.
- Language: marketing pages are bilingual — English at unprefixed URLs and Chinese under /zh. The product dashboard (/app) supports both English and Chinese UI on the same URL, selected by the NEXT_LOCALE cookie (default: English).
- Some demo pages display sample data labeled as such ("示例数据").
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
