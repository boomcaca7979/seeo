// ===== 站点结构化数据（JSON-LD）生成器 =====
// 纯函数，供 layout / page 渲染 <script type="application/ld+json"> 使用
//
// 原则：
//   - 只输出可由代码/配置验证的真实字段，不编造公司/账号/评分
//   - 价格唯一来源是 billing.ts 的 PLAN_PRICING（服务端权威价格表）
//   - Organization / WebSite 全站输出；SoftwareApplication 首页输出；
//     BreadcrumbList 公开子页面输出

import { PLAN_PRICING } from "@/lib/billing";

export const SITE_URL = "https://www.seeo.asia";
export const SITE_NAME = "SeeO";

/** Organization：只声明可验证的最小字段（无真实公司注册信息/社交账号，不编造） */
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  };
}

/** WebSite：无站内搜索功能，不加 SearchAction */
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
  };
}

/**
 * SoftwareApplication：SeeO 以 SaaS Web 应用形式呈现
 * offers 与 PLAN_PRICING 保持单一数据源（免费版 ¥0 + Lite/Pro 30 天一次性购买）
 */
export function softwareApplicationSchema() {
  const offers = [
    {
      "@type": "Offer",
      name: "免费版",
      price: "0",
      priceCurrency: "CNY",
      url: `${SITE_URL}/pricing`,
      description: "免费版：适合个人站长和初学者",
    },
    {
      "@type": "Offer",
      name: "Lite 版",
      price: (PLAN_PRICING.lite.amountCents / 100).toFixed(2),
      priceCurrency: PLAN_PRICING.lite.currency,
      url: `${SITE_URL}/pricing`,
      description: `Lite 版：${PLAN_PRICING.lite.periodDays} 天会员，一次性购买`,
    },
    {
      "@type": "Offer",
      name: "专业版",
      price: (PLAN_PRICING.pro.amountCents / 100).toFixed(2),
      priceCurrency: PLAN_PRICING.pro.currency,
      url: `${SITE_URL}/pricing`,
      description: `专业版：${PLAN_PRICING.pro.periodDays} 天会员，一次性购买`,
    },
  ];

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "SeeO 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析。",
    offers,
  };
}

/** BreadcrumbList：items 为 [首页, ...层级页面]，url 传相对路径（以 / 开头） */
export function breadcrumbSchema(
  items: Array<{ name: string; url: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.url}`,
    })),
  };
}

/** AboutPage：品牌实体页（/about） */
export function aboutPageSchema(input: {
  name: string;
  description: string;
  url: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: input.name,
    description: input.description,
    url: `${SITE_URL}${input.url}`,
    mainEntity: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

/** WebPage：功能能力页（/features/*） */
export function webPageSchema(input: {
  name: string;
  description: string;
  url: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.name,
    description: input.description,
    url: `${SITE_URL}${input.url}`,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
  };
}

/**
 * FAQPage：仅当页面实际渲染相同 FAQ 内容时使用。
 * faqs 数据源必须与页面渲染共用同一常量，保证 HTML 内容 = JSON-LD。
 */
export function faqPageSchema(
  url: string,
  faqs: Array<{ q: string; a: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: `${SITE_URL}${url}`,
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
