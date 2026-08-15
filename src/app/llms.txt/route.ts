// ===== /llms.txt =====
// 面向 AI crawler 的纯文本站点说明（GEO / AI Search 基础能力）
// 内容只包含可由产品代码验证的真实事实，不编造统计/评分/客户数据

import { SITE_URL } from "@/lib/seo/schema";

export const dynamic = "force-static";

export function GET() {
  const body = `# SeeO

SeeO is an SEO software platform for keyword research, rank tracking, technical SEO audits, competitor analysis, content optimization, and backlink analysis.

## Product

SeeO is a web-based SEO analytics platform. Users add projects (websites), track keyword rankings, run technical SEO audits, analyze competitors, optimize content, and review backlink data. Data is provided through SerpApi and DataForSEO services.

## Capabilities

- Technical SEO Audit: crawl-based site audit with health scoring
- Keyword Research: keyword overview and keyword expansion tools
- Rank Tracking: daily keyword position tracking with history
- Competitor Analysis: competitor ranking comparison and share of voice
- Content Optimization: content quality checks against SEO checklist
- Backlinks: backlink profile overview
- Reporting: PDF and Excel report export, email reports
- Automation: scheduled daily refresh and alerts
- Project Management: multi-project management with usage limits

## Pricing

Pricing plans (Free, Lite, Pro) are listed at ${SITE_URL}/pricing

## Public Pages

- Home: ${SITE_URL}/
- Pricing: ${SITE_URL}/pricing
- Docs: ${SITE_URL}/docs
- Login: ${SITE_URL}/login
- Signup: ${SITE_URL}/signup
- Privacy Policy: ${SITE_URL}/privacy
- Terms of Service: ${SITE_URL}/terms
- Refund Policy: ${SITE_URL}/refund

## Important

- SeeO is an SEO software platform. It is not an AI search analytics tool.
- Language: the product interface is in Chinese (zh-CN); this file is in English for AI systems.
- Some demo pages display sample data labeled as such ("示例数据").
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
