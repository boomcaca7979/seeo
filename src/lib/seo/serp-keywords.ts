// ===== SERP 标题/摘要关键词提取（纯函数，客户端与服务端共用） =====
// P5-A：从「分析」已获得的 SERP 快照标题与摘要中提取候选关键词。
// 数据口径硬约束：这些词是从真实 SERP 内容中提取的候选，绝不是 Google 推荐词
// （来源标记 serp_content，UI 明示）；只使用快照中真实存在的文本，不编造、不翻译。
//
// 提取规则（确定性，无随机、无外部调用）：
//   1. 分段：标题按分隔符（- | – — : ： · » 等）与句读切分；摘要按句读切分。
//   2. 候选：每段取整段短语（不穷举 n-gram，避免噪声爆炸）；
//      拉丁文 2-6 词 / 全长 4-60 字符，CJK 2-14 字。
//   3. 过滤：纯数字、URL、等于种子词、纯停用词的候选被丢弃。
//   4. 保留：出现 ≥2 次的短语（跨结果重复出现 = 更可能是真实搜索表达）；
//      或包含种子词的短语（种子词变体，出现 1 次也保留）。
//   5. 归一去重（与 keyword-merge 同一套 trim+小写口径），上限默认 20，按首现原文返回。

import { normalizeKeywordForDedup } from "./keyword-merge";

/** 拉丁文高频虚词：单独出现不构成候选（实词如 best/free/tool 不在表内） */
const SEGMENT_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "at", "by",
  "your", "my", "our", "you", "we", "is", "are", "was", "were", "be", "been",
  "how", "what", "why", "when", "which", "who", "that", "this", "these", "those",
  "it", "its", "as", "from", "into", "about", "more", "most", "very", "can",
  "will", "do", "does", "did", "not", "no", "yes", "up", "out", "get", "got",
]);

const TITLE_DELIMITER = /[-|–—:：·»|/]/;
const SENTENCE_DELIMITER = /[。！？!?.;;，,]/;

export interface SerpContentInput {
  title: string;
  snippet: string;
}

function isMostlyCjk(text: string): boolean {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return cjk > text.length / 2;
}

/** 候选有效性：字数/长度窗口 + 非纯数字 + 非 URL + 含至少一个实词（拉丁文） */
function isValidCandidate(raw: string): boolean {
  const trimmed = raw.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!trimmed) return false;
  if (/^[\d\s.,%+-]+$/.test(trimmed)) return false; // 纯数字/符号
  if (/https?:|www\./i.test(trimmed)) return false;
  if (isMostlyCjk(trimmed)) {
    const cjkChars = trimmed.replace(/[^\u4e00-\u9fff]/g, "").length;
    return cjkChars >= 2 && trimmed.length <= 14;
  }
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  if (trimmed.length < 4 || trimmed.length > 60) return false;
  return words.some((w) => w.length >= 2 && !SEGMENT_STOPWORDS.has(w.toLowerCase()));
}

function segmentsOf(text: string, delimiter: RegExp): string[] {
  return text
    .split(delimiter)
    .map((part) => part.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/**
 * 从 SERP 快照的标题与摘要中提取候选关键词（真实文本提取，非 Google 推荐）。
 * - title 命中权重 2、snippet 命中权重 1（标题更接近搜索表达）
 * - 保留：出现次数（加权）≥2，或包含种子词（种子词变体）
 * - 返回按首现顺序的原文短语；上限 limit（默认 20）
 */
export function extractSerpContentKeywords(
  rows: SerpContentInput[],
  seed: string,
  limit = 20
): string[] {
  const seedNorm = normalizeKeywordForDedup(seed);
  if (rows.length === 0 || !seedNorm) return [];

  const score = new Map<string, { display: string; weight: number }>();
  const order: string[] = [];

  const addSegment = (segment: string, weight: number) => {
    if (!isValidCandidate(segment)) return;
    const key = normalizeKeywordForDedup(segment);
    if (!key || key === seedNorm) return;
    const existing = score.get(key);
    if (existing) {
      existing.weight += weight;
    } else {
      score.set(key, { display: segment, weight });
      order.push(key);
    }
  };

  for (const row of rows) {
    // 标题：分隔符切分（标题常见「品牌 - 描述」「描述 | 品牌」结构）
    for (const part of segmentsOf(row.title ?? "", TITLE_DELIMITER)) {
      // 标题段可能仍是长句：再按句读切一次
      for (const seg of segmentsOf(part, SENTENCE_DELIMITER)) addSegment(seg, 2);
    }
    // 摘要：按句读切分
    for (const seg of segmentsOf(row.snippet ?? "", SENTENCE_DELIMITER)) addSegment(seg, 1);
  }

  const result: string[] = [];
  for (const key of order) {
    const entry = score.get(key)!;
    const isSeedVariant = key.includes(seedNorm);
    if (entry.weight >= 2 || isSeedVariant) {
      result.push(entry.display);
      if (result.length >= limit) break;
    }
  }
  return result;
}
