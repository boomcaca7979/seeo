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

// SoftwareApplication 按 locale 输出的文案（en 面向英文 SaaS 市场，zh 保持原中文）
const APP_TEXT = {
  en: {
    description:
      "SeeO is an all-in-one SEO analytics platform: keyword research, rank tracking, technical SEO audits, competitor analysis, content optimization, and backlink analysis.",
    offers: [
      { key: "free", name: "Free", description: "Free plan: for personal site owners and beginners" },
      { key: "lite", name: "Lite", description: "Lite plan: 30-day membership, one-time purchase" },
      { key: "pro", name: "Pro", description: "Pro plan: 30-day membership, one-time purchase" },
    ] as const,
  },
  zh: {
    description:
      "SeeO 是一站式 SEO 数据分析平台，提供关键词研究、排名追踪、技术审计、竞品分析、内容优化与外链分析。",
    offers: [
      { key: "free", name: "免费版", description: "免费版：适合个人站长和初学者" },
      { key: "lite", name: "Lite 版", description: "Lite 版：30 天会员，一次性购买" },
      { key: "pro", name: "专业版", description: "专业版：30 天会员，一次性购买" },
    ] as const,
  },
} as const;

/** Organization：只声明可验证的最小字段（无真实公司注册信息/社交账号，不编造） */
export function organizationSchema(locale?: "en" | "zh") {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    ...(locale ? { inLanguage: locale === "zh" ? "zh-CN" : "en" } : {}),
  };
}

/** WebSite：无站内搜索功能，不加 SearchAction */
export function websiteSchema(locale?: "en" | "zh") {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    ...(locale ? { inLanguage: locale === "zh" ? "zh-CN" : "en" } : {}),
  };
}

/**
 * SoftwareApplication：SeeO 以 SaaS Web 应用形式呈现
 * offers 与 PLAN_PRICING 保持单一数据源（免费版 ¥0 + Lite/Pro 30 天一次性购买）
 * locale：en/zh 输出对应语言的 name/description（价格仍来自 PLAN_PRICING）
 */
export function softwareApplicationSchema(locale: "en" | "zh" = "zh") {
  const text = APP_TEXT[locale];
  const priceOf = (key: "free" | "lite" | "pro") =>
    key === "free"
      ? { price: "0", priceCurrency: "CNY" }
      : {
          price: (PLAN_PRICING[key].amountCents / 100).toFixed(2),
          priceCurrency: PLAN_PRICING[key].currency,
        };
  const pricingUrl = locale === "zh" ? `${SITE_URL}/zh/pricing` : `${SITE_URL}/pricing`;

  const offers = text.offers.map((o) => ({
    "@type": "Offer",
    name: o.name,
    ...priceOf(o.key),
    url: pricingUrl,
    description: o.description,
  }));

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: text.description,
    inLanguage: locale === "zh" ? "zh-CN" : "en",
    offers,
  };
}

// SoftwareApplication 按 feature 页输出的文案（en/zh 双语，文案硬编码与 APP_TEXT 同源管理）
const FEATURE_APP_TEXT = {
  seoAudit: {
    en: {
      name: "SeeO SEO Audit Tool",
      description:
        "AI SEO audit tool that crawls your site, runs 20+ technical checks, and generates a prioritized SEO audit report with a 0-100 health score.",
    },
    zh: {
      name: "SeeO SEO 审计工具",
      description:
        "SeeO SEO 审计工具：自动抓取网站、运行 20+ 项技术检查，生成带 0-100 健康分与优先级修复建议的 SEO 审计报告。",
    },
  },
  rankTracking: {
    en: {
      name: "SeeO Rank Tracker",
      description:
        "SEO rank tracker with daily keyword rank tracking by keyword, location, and device — SERP positions, ranking history, and volatility alerts.",
    },
    zh: {
      name: "SeeO 排名追踪器",
      description:
        "SeeO 排名追踪器：按关键词、地区与设备每日追踪 Google 排名，记录排名历史并在排名波动时自动提醒。",
    },
  },
  backlinks: {
    en: {
      name: "SeeO Backlink Analysis Tool",
      description:
        "Backlink analysis tool and SEO backlink checker: total backlinks, referring domains, Domain Rank, dofollow ratio, and anchor text analysis.",
    },
    zh: {
      name: "SeeO 外链分析工具",
      description:
        "SeeO 外链分析工具：查询总外链、引用域、Domain Rank、dofollow 比例与锚文本分布，评估外链质量。",
    },
  },
} as const;

export type FeatureAppKey = keyof typeof FEATURE_APP_TEXT;

/**
 * SoftwareApplication（feature 能力页）：每个 /features/* 页输出对应模块的 SoftwareApplication，
 * 与 WebPage / BreadcrumbList / FAQPage 并存。url 传 locale 相对路径（含 /zh 前缀）。
 */
export function featureAppSchema(
  page: FeatureAppKey,
  url: string,
  locale: "en" | "zh"
) {
  const text = FEATURE_APP_TEXT[page][locale];
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: text.name,
    url: `${SITE_URL}${url}`,
    applicationCategory: "SEO Software",
    operatingSystem: "Web",
    description: text.description,
    inLanguage: locale === "zh" ? "zh-CN" : "en",
  };
}

/** BreadcrumbList：items 为 [首页, ...层级页面]，url 传相对路径（以 / 开头） */
export function breadcrumbSchema(
  items: Array<{ name: string; url: string }>,
  locale?: "en" | "zh"
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    ...(locale ? { inLanguage: locale === "zh" ? "zh-CN" : "en" } : {}),
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.url}`,
    })),
  };
}

/** AboutPage：品牌实体页（/about） */
export function aboutPageSchema(
  input: {
    name: string;
    description: string;
    url: string;
  },
  locale?: "en" | "zh"
) {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: input.name,
    description: input.description,
    url: `${SITE_URL}${input.url}`,
    ...(locale ? { inLanguage: locale === "zh" ? "zh-CN" : "en" } : {}),
    mainEntity: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

/** WebPage：功能能力页（/features/*） */
export function webPageSchema(
  input: {
    name: string;
    description: string;
    url: string;
  },
  locale?: "en" | "zh"
) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.name,
    description: input.description,
    url: `${SITE_URL}${input.url}`,
    ...(locale ? { inLanguage: locale === "zh" ? "zh-CN" : "en" } : {}),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
  };
}

/**
 * FAQPage：仅当页面实际渲染相同 FAQ 内容时使用。
 * faqs 数据源必须与页面渲染共用同一常量，保证 HTML 内容 = JSON-LD。
 */
export function faqPageSchema(
  url: string,
  faqs: Array<{ q: string; a: string }>,
  locale?: "en" | "zh"
) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: `${SITE_URL}${url}`,
    ...(locale ? { inLanguage: locale === "zh" ? "zh-CN" : "en" } : {}),
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
