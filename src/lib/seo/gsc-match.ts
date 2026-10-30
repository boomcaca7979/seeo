// ===== GSC 查询词交叉匹配（P0 关键词研究 × GSC 第一方数据） =====
//
// 用途：判断关键词研究（Google 相关搜索 / PAA / Autocomplete / DataForSEO Labs）
// 得到的关键词是否出现在自有网站 GSC 查询数据中，并保留可验证的页面关系与真实表现。
//
// 边界（任务硬要求）：
// - 仅归一化后的精确匹配，不做模糊/词干/语义关联——"seo tools" 与 "seo tool" 不互认。
// - 同一查询词匹配多个落地页时保留全部 (query, page) 关系，不擅自选一个代表页。
// - CTR/位置聚合口径与 gsc-service.summarizeGscRows 一致：CTR=Σclicks/Σimpressions、
//   位置=曝光加权平均；无曝光时为 null（缺失不冒充 0）。
// - GSC 曝光 ≠ 市场搜索量；GSC 平均位置 ≠ 关键词难度。调用方必须分开标注口径。

/** 归一化规则（显式、可测试；只做"可安全归一"的处理）：
 *  1. 去首尾空白并小写化（大小写不改变搜索含义）
 *  2. 连续空白（含制表符/全角空格）折叠为单个空格
 *  3. 去除引号类字符（GSC 查询数据中不含引号运算符，引号无匹配意义）
 *  4. 去除首尾标点（句读/疑问符号等；中英文均处理，循环剥离直到稳定）
 *  保留：内部连字符、点号等内部标点（可能是有意义的产品名/域名形态） */
const EDGE_PUNCT_CLASS = ".,!?;:、。，！？；：…·~～\\-_/\\\\|()\\[\\]{}【】<>《》";
const EDGE_PUNCT = new RegExp(`^[${EDGE_PUNCT_CLASS}]+|[${EDGE_PUNCT_CLASS}]+$`, "g");

export function normalizeQueryForMatch(query: string): string {
  let s = query.trim().toLowerCase();
  s = s.replace(/[\s\u3000]+/g, " ");
  s = s.replace(/['"`’‘“”′″]/g, "");
  let previous: string;
  do {
    previous = s;
    s = s.replace(EDGE_PUNCT, "");
  } while (s !== previous);
  return s;
}

/** 匹配输入行：与 /api/gsc/performance 返回的 GscSearchRow 兼容（keys[0]=query，keys[1]=page 可选） */
export interface GscMatchInputRow {
  keys: string[];
  clicks: number;
  impressions: number;
  /** 0-1 小数（GSC 原生口径） */
  ctr: number;
  position: number;
}

/** 单条 (query, page) 关系的原始表现（page=null 表示该行未带页面维度） */
export interface GscMatchPageRelation {
  page: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** 查询词级聚合：pages 保留全部页面关系；总计为行求和；ctr/position 为曝光加权口径 */
export interface GscQueryMatch {
  /** GSC 原始查询词文本（首次出现形态） */
  query: string;
  pages: GscMatchPageRelation[];
  clicks: number;
  impressions: number;
  /** Σclicks/Σimpressions；无曝光为 null */
  ctr: number | null;
  /** Σ(position×impressions)/Σimpressions（仅计曝光>0 的行）；无曝光为 null */
  position: number | null;
}

/** GSC 行 → 归一化查询索引。keys 为空或 query 为空白的行跳过（无法归一）。 */
export function buildGscQueryIndex(rows: GscMatchInputRow[]): Map<string, GscQueryMatch> {
  const index = new Map<string, GscQueryMatch>();
  for (const row of rows) {
    const query = typeof row.keys[0] === "string" ? row.keys[0] : "";
    const normalized = normalizeQueryForMatch(query);
    if (!normalized) continue;
    const page = row.keys.length > 1 && typeof row.keys[1] === "string" && row.keys[1] ? row.keys[1] : null;
    const existing = index.get(normalized);
    if (existing) {
      existing.pages.push({ page, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position });
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
    } else {
      index.set(normalized, {
        query,
        pages: [{ page, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: null,
        position: null,
      });
    }
  }
  for (const match of index.values()) {
    match.ctr = match.impressions > 0 ? match.clicks / match.impressions : null;
    let weighted = 0;
    let weight = 0;
    for (const rel of match.pages) {
      if (rel.impressions > 0) {
        weighted += rel.position * rel.impressions;
        weight += rel.impressions;
      }
    }
    match.position = weight > 0 ? weighted / weight : null;
  }
  return index;
}

/** 关键词 → GSC 匹配（仅归一化后精确相等；返回命中关键词到其 GSC 聚合的映射） */
export function matchKeywordsToGsc(
  keywords: string[],
  index: Map<string, GscQueryMatch>
): Map<string, GscQueryMatch> {
  const matches = new Map<string, GscQueryMatch>();
  for (const keyword of keywords) {
    const hit = index.get(normalizeQueryForMatch(keyword));
    if (hit) matches.set(keyword, hit);
  }
  return matches;
}
