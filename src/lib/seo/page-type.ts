// ===== 页面类型识别（Page Type Awareness） =====
// 通过 URL / HTML / Schema / Heading / Content 信号识别页面类型，
// 用于内容阈值（thin content）、结构化数据期望、标题层级逻辑。

import type { PageData } from "@/lib/crawl";

export type PageType =
  | "homepage"
  | "guide"
  | "review"
  | "tool"
  | "category"
  | "contact"
  | "about"
  | "article"
  | "other";

/**
 * 各页面类型的正文字数阈值：
 * - low：低于该值视为 Low Content（notice 级）
 * - veryLow：低于该值视为 Very Low（warning 级）
 *
 * 阈值依据页面类型设定，不做一刀切的 "<300 词 = 差"：
 * 工具页/分类页天然短，指南/文章/评测天然长。
 */
export const CONTENT_THRESHOLDS: Record<PageType, { low: number; veryLow: number }> = {
  homepage: { low: 150, veryLow: 50 },
  guide: { low: 300, veryLow: 150 },
  review: { low: 300, veryLow: 150 },
  tool: { low: 100, veryLow: 30 },
  category: { low: 100, veryLow: 30 },
  contact: { low: 50, veryLow: 20 },
  about: { low: 200, veryLow: 80 },
  article: { low: 300, veryLow: 150 },
  other: { low: 150, veryLow: 75 },
};

/** 语言前缀路径（如 /zh、/en-US/），视为首页 */
const LANG_PATH_RE = /^\/[a-z]{2}(-[a-zA-Z]{2,4})?\/?$/;

/** 从 JSON-LD @type 推断页面类型 */
function typeFromSchema(page: PageData): PageType | null {
  for (const raw of page.structuredDataRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const obj = n as Record<string, unknown>;
      const types: string[] = Array.isArray(obj["@type"])
        ? (obj["@type"] as unknown[]).map(String)
        : obj["@type"]
          ? [String(obj["@type"])]
          : [];
      const graph = Array.isArray(obj["@graph"]) ? (obj["@graph"] as unknown[]) : [];
      const graphTypes = graph
        .filter((g) => g && typeof g === "object")
        .flatMap((g) => {
          const go = g as Record<string, unknown>;
          return Array.isArray(go["@type"])
            ? (go["@type"] as unknown[]).map(String)
            : go["@type"]
              ? [String(go["@type"])]
              : [];
        });
      const all = [...types, ...graphTypes];
      if (all.includes("Review") || all.includes("AggregateRating")) return "review";
      if (
        all.includes("Article") ||
        all.includes("BlogPosting") ||
        all.includes("NewsArticle") ||
        all.includes("TechArticle")
      ) {
        return "article";
      }
      if (all.includes("SoftwareApplication") || all.includes("WebApplication")) return "tool";
      if (all.includes("CollectionPage") || all.includes("ItemList")) return "category";
    }
  }
  return null;
}

/** 从 URL 路径推断页面类型 */
function typeFromPath(pathname: string): PageType | null {
  const p = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (p === "/" || LANG_PATH_RE.test(p)) return "homepage";
  if (/\/(contact|contact-us|kontakt)(\/|$)/.test(p)) return "contact";
  if (/\/(about|about-us|imprint)(\/|$)/.test(p)) return "about";
  if (/\/(guide|guides|tutorials?|how-to|docs|documentation|wiki|handbook)(\/|$)/.test(p)) return "guide";
  if (/\/(reviews?|ratings?)(\/|$)/.test(p)) return "review";
  if (/\/(tools?|apps?|calculators?|generators?|converters?|checkers?|playground|editors?)(\/|$)/.test(p)) return "tool";
  if (/\/(categor(y|ies)|collections?|tags?|topics?|series)(\/|$)/.test(p)) return "category";
  return null;
}

/** 从标题/H1 关键词推断页面类型（兜底信号） */
function typeFromHeadings(page: PageData): PageType | null {
  const text = [page.title ?? "", ...page.h1, ...page.h2.slice(0, 5)].join(" ").toLowerCase();
  if (/\b(contact|联系我|联系我们|联系方式)\b/.test(text)) return "contact";
  if (/\b(about us|关于我|关于我们)\b/.test(text)) return "about";
  if (/\b(complete guide|ultimate guide|tutorial|how to|step by step|入门|教程|指南)\b/.test(text)) return "guide";
  if (/\b(review|测评|评测|评价)\b/.test(text)) return "review";
  if (/\b(calculator|generator|converter|checker|在线工具|免费工具)\b/.test(text)) return "tool";
  return null;
}

/** 识别页面类型：URL 路径 > Schema @type > 标题关键词 */
export function detectPageType(page: PageData): PageType {
  let pathname = "/";
  try {
    pathname = new URL(page.finalUrl ?? page.url).pathname;
  } catch {
    pathname = "/";
  }
  return (
    typeFromPath(pathname) ??
    typeFromSchema(page) ??
    typeFromHeadings(page) ??
    "other"
  );
}

/** 内容量状态：Normal / Low / Very Low */
export function contentVolumeStatus(
  wordCount: number,
  pageType: PageType
): "normal" | "low" | "very-low" {
  const t = CONTENT_THRESHOLDS[pageType];
  if (wordCount < t.veryLow) return "very-low";
  if (wordCount < t.low) return "low";
  return "normal";
}
