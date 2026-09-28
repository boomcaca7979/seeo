// ===== Lead 字段归一化 =====
// 目的：让 www.example.com / example.com / HTTPS://Example.com/ 与
// Foo@Bar.com / foo@bar.com 在去重时被视为同一条，避免每天手工判断。

/**
 * 归一化域名：去协议、去 www、去端口、去末尾斜杠、小写、去空格。
 * 保留路径之外的主机名（含子域名，如 blog.example.com 视为不同站点）。
 */
export function normalizeDomain(input: string): string {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return "";
  let s = raw;
  // 去掉协议
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // 去掉用户信息、端口、路径、查询、锚点
  s = s.split("/")[0] ?? "";
  s = s.split("?")[0] ?? "";
  s = s.split("#")[0] ?? "";
  s = s.replace(/^[^@]+@/, "");
  s = s.replace(/:\d+$/, "");
  // 去掉首尾点与 www.
  s = s.replace(/^\.+/, "").replace(/\.+$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  return s;
}

/** 归一化邮箱：去空格、小写（大小写不应造成重复） */
export function normalizeEmail(input: string): string {
  return (input ?? "").trim().toLowerCase();
}

/** Lead 的业务主键：域名 + 邮箱 */
export interface LeadKey {
  domain: string;
  email: string;
}

export function leadKeyOf(website: string, email: string): LeadKey {
  return { domain: normalizeDomain(website), email: normalizeEmail(email) };
}

export function sameLeadKey(a: LeadKey, b: LeadKey): boolean {
  return a.domain === b.domain && a.email === b.email;
}

/**
 * Lead 类型归一化：把日常随手写法收敛到标准值。
 * 例："saas" / "SaaS company" / "software" → "SaaS"。
 * 无法识别的输入返回 null —— 由调用方要求人工选择，绝不猜测成 "Other" 而污染数据。
 */
const LEAD_TYPE_ALIASES: Record<string, string> = {
  saas: "SaaS",
  "saas company": "SaaS",
  "saas product": "SaaS",
  software: "SaaS",
  "software company": "SaaS",
  "b2b saas": "SaaS",
  agency: "Agency",
  "seo agency": "Agency",
  "marketing agency": "Agency",
  "digital agency": "Agency",
  "seo freelancer": "SEO Freelancer",
  freelancer: "SEO Freelancer",
  consultant: "SEO Freelancer",
  "seo consultant": "SEO Freelancer",
  blog: "Blog",
  blogger: "Blog",
  "personal blog": "Blog",
  affiliate: "Affiliate",
  "affiliate site": "Affiliate",
  "affiliate marketer": "Affiliate",
  ecommerce: "Ecommerce",
  "e-commerce": "Ecommerce",
  shop: "Ecommerce",
  store: "Ecommerce",
  "online store": "Ecommerce",
  "content site": "Content Site",
  "content website": "Content Site",
  "media site": "Content Site",
  publisher: "Content Site",
  startup: "Startup",
  "early stage startup": "Startup",
  other: "Other",
  unknown: "Other",
};

export function normalizeLeadType(input: string): string | null {
  const key = (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  if (LEAD_TYPE_ALIASES[key]) return LEAD_TYPE_ALIASES[key];
  // 已经是标准值（忽略大小写）也直接接受
  const exact = ["SaaS", "Agency", "SEO Freelancer", "Blog", "Affiliate", "Ecommerce", "Content Site", "Startup", "Other"];
  const hit = exact.find((t) => t.toLowerCase() === key);
  return hit ?? null;
}

/** 生成稳定的 lead_id：域名 + 邮箱的短哈希（同一输入恒等，便于重跑不串号） */
export function makeLeadId(website: string, email: string): string {
  const key = `${normalizeDomain(website)}|${normalizeEmail(email)}`;
  // FNV-1a 32bit —— 无需引入依赖，输出稳定
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `L${h.toString(36).toUpperCase().padStart(7, "0")}`;
}
