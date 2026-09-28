// ===== Marketing Analytics：来源标准化 =====
// 把 UTM 参数与 referrer host 统一映射到固定 source 集合，
// 避免 reddit.com / www.reddit.com / old.reddit.com 之类写法差异产生碎片来源。
// 优先级：UTM utm_source > referrer 分类 > direct。

/** 标准化后的来源集合（canonical sources） */
export const CANONICAL_SOURCES = [
  "google",
  "bing",
  "reddit",
  "indiehackers",
  "linkedin",
  "x",
  "producthunt",
  "email",
  "direct",
  "other",
] as const;

export type CanonicalSource = (typeof CANONICAL_SOURCES)[number];

/** referrer host → canonical source（域名边界匹配，覆盖子域与短链） */
const REFERRER_HOST_MAP: Array<[string, CanonicalSource]> = [
  ["google", "google"],
  ["bing.com", "bing"],
  ["reddit.com", "reddit"],
  ["redd.it", "reddit"],
  ["indiehackers.com", "indiehackers"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["t.co", "x"],
  ["producthunt.com", "producthunt"],
];

/** utm_source 原始值 → canonical（含别名，如 news.ycombinator 不在必选集内 → other） */
const UTM_SOURCE_ALIASES: Record<string, CanonicalSource> = {
  google: "google",
  googleads: "google",
  bing: "bing",
  reddit: "reddit",
  indiehackers: "indiehackers",
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  producthunt: "producthunt",
  "product hunt": "producthunt",
  email: "email",
  newsletter: "email",
};

/** 从 URL / 原始 referrer 中提取 host（无协议、小写、去 www） */
function extractHost(raw: string | null | undefined): string {
  if (!raw) return "";
  let v = raw.trim().toLowerCase();
  if (!v) return "";
  try {
    // 支持 "https://www.reddit.com/r/..." 与 "www.reddit.com" 两种输入
    if (!/^[a-z]+:\/\//.test(v)) v = `https://${v}`;
    const host = new URL(v).hostname;
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function classifyHost(host: string): CanonicalSource | null {
  if (!host) return null;
  for (const [needle, source] of REFERRER_HOST_MAP) {
    // 域名边界匹配：等于 / 子域（.needle 结尾）/ 同 base 域（needle. 开头，如 google.de）
    if (host === needle || host.endsWith(`.${needle}`) || host.startsWith(`${needle}.`)) {
      return source;
    }
  }
  return null;
}

function normalizeUtmSource(raw: string | null | undefined): CanonicalSource | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v in UTM_SOURCE_ALIASES) return UTM_SOURCE_ALIASES[v];
  // UTM 自带可读来源但不在映射表内 → other（不保留原始值，避免来源碎片化）
  return "other";
}

export interface TouchInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
}

export interface NormalizedTouch {
  source: CanonicalSource;
  medium: string;
  campaign: string | null;
  content: string | null;
  term: string | null;
  referrerHost: string;
  /** 本次访问是否携带真实渠道信息（false = 无 UTM 且无外部 referrer 的直接访问） */
  hasTouch: boolean;
}

/**
 * 标准化一次访问的来源。
 * - UTM 存在：utm_source（标准化）优先，medium/campaign 原样保留（截断）；
 * - 无 UTM：按 referrer host 分类；搜索引擎命中 map 归为对应 source；
 * - 都没有：direct。
 */
export function normalizeTouch(input: TouchInput): NormalizedTouch {
  const referrerHost = extractHost(input.referrer);
  const utmSource = normalizeUtmSource(input.utmSource);
  const refSource = classifyHost(referrerHost);
  // 有外部 referrer 但不在映射表内 → other（而非 direct：direct 仅指无任何来源痕迹）
  const refFallback: CanonicalSource | null = refSource ?? (referrerHost ? "other" : null);

  const source: CanonicalSource =
    utmSource ?? refFallback ?? "direct";
  const hasTouch = !!utmSource || !!input.utmMedium || !!input.utmCampaign || !!refFallback;

  let medium: string;
  if (input.utmMedium) {
    medium = sanitizeShort(input.utmMedium) ?? "none";
  } else if (source === "direct") {
    medium = "direct";
  } else if (source === "google" || source === "bing") {
    medium = "organic";
  } else {
    medium = "referral";
  }

  return {
    source,
    medium,
    campaign: sanitizeShort(input.utmCampaign),
    content: sanitizeShort(input.utmContent),
    term: sanitizeShort(input.utmTerm),
    referrerHost,
    hasTouch,
  };
}

/** 短字段清洗：截断到 120 字符，去掉控制字符（不丢弃语义，只防脏数据） */
export function sanitizeShort(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!v) return null;
  return v.slice(0, 120);
}
