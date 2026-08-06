// ===== 内容分析引擎 =====
// 解析 HTML，输出字数、可读性、关键词密度、标题结构、链接/图片统计等

import * as cheerio from "cheerio";

export interface KeywordDensityItem {
  keyword: string;
  count: number;
  density: number;
}

export interface HeadingItem {
  level: number;
  text: string;
}

export interface TopKeywordItem {
  word: string;
  count: number;
}

export interface ContentAnalysisResult {
  wordCount: number;
  readabilityScore: number;
  readabilityLevel: string;
  keywordDensity: KeywordDensityItem[];
  headingStructure: HeadingItem[];
  internalLinksCount: number;
  externalLinksCount: number;
  imagesCount: number;
  imagesWithoutAlt: number;
  metaTitleLength: number;
  metaDescriptionLength: number;
  first100Words: string;
  topKeywords: TopKeywordItem[];
  titleSuggestions: string[];
  contentScore: number;
}

// 停用词（中文 + 英文）
const STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去",
  "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "它", "他", "她", "我们", "你们", "他们", "这个", "那个",
  "可以", "能", "什么", "怎么", "为什么", "哪里", "哪个", "如何", "如果", "但是", "因为", "所以", "虽然", "然后", "还是",
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare", "ought", "used",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after",
  "above", "below", "between", "under", "and", "but", "or", "yet", "so", "if", "because", "although", "though",
  "while", "where", "when", "that", "which", "who", "whom", "whose", "what", "this", "these", "those",
  "it", "its", "they", "them", "their", "there", "here", "then", "than", "too", "very", "just", "now",
  "only", "also", "back", "after", "use", "two", "how", "our", "out", "other", "many", "some", "time", "way",
  "no", "know", "take", "people", "year", "good", "give", "day", "get", "work", "life", "even", "new", "want",
  "any", "give", "most", "us", "more", "make", "like", "well",
]);

function countWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
}

function calculateReadability(text: string): number {
  const sentences = text.split(/[。！？.!?]/).filter((s) => s.trim().length > 0);
  const words = countWords(text);
  const avgSentenceLength = sentences.length > 0 ? words / sentences.length : 0;
  // 简化公式：句子越短越易读
  const score = 100 - avgSentenceLength * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTopKeywords(text: string, limit: number): TopKeywordItem[] {
  const counts: Record<string, number> = {};

  // 中文 2-4 字词组
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= text.length - len; i++) {
      const word = text.slice(i, i + len);
      // 跳过含英文/数字/空白的片段
      if (/[a-zA-Z0-9\s]/.test(word)) continue;
      // 跳过全为停用字的片段
      if (Array.from(word).every((c) => STOP_WORDS.has(c))) continue;
      counts[word] = (counts[word] ?? 0) + 1;
    }
  }

  // 英文单词
  const englishWords = text.toLowerCase().match(/[a-z]+/g) || [];
  for (const w of englishWords) {
    if (w.length <= 2) continue;
    if (STOP_WORDS.has(w)) continue;
    counts[w] = (counts[w] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function generateTitleSuggestions(currentTitle: string, targetKeywords: string[]): string[] {
  const suggestions: string[] = [];
  const titleLen = currentTitle.length;

  if (titleLen > 0 && titleLen < 30) {
    suggestions.push("标题过短，建议扩展至 30-60 字符");
  }
  if (titleLen > 60) {
    suggestions.push("标题过长，建议精简至 60 字符以内");
  }
  if (titleLen === 0) {
    suggestions.push("页面缺少 title 标签，建议添加 30-60 字符的标题");
  }

  for (const kw of targetKeywords) {
    if (!kw.trim()) continue;
    if (!currentTitle.toLowerCase().includes(kw.toLowerCase())) {
      suggestions.push(`标题未包含目标关键词「${kw}」，建议加入`);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push("标题长度和关键词覆盖良好");
  }
  return suggestions;
}

function calculateContentScore(metrics: {
  wordCount: number;
  readabilityScore: number;
  keywordDensity: KeywordDensityItem[];
  headingStructure: HeadingItem[];
  imagesWithoutAlt: number;
  imagesCount: number;
  metaTitle: number;
  metaDesc: number;
}): number {
  let score = 0;

  // 字数（20%）：1000 字以上满分
  score += Math.min(metrics.wordCount / 1000, 1) * 20;

  // 可读性（20%）
  score += (metrics.readabilityScore / 100) * 20;

  // 关键词密度（15%）：2% 为满分
  const avgDensity = metrics.keywordDensity.length > 0
    ? metrics.keywordDensity.reduce((s, k) => s + k.density, 0) / metrics.keywordDensity.length
    : 0;
  score += Math.min(avgDensity / 2, 1) * 15;

  // 标题结构（15%）
  const hasH1 = metrics.headingStructure.some((h) => h.level === 1);
  const hasH2 = metrics.headingStructure.some((h) => h.level === 2);
  score += (hasH1 ? 8 : 0) + (hasH2 ? 7 : 0);

  // 图片 alt（10%）
  if (metrics.imagesCount === 0) {
    score += 10;
  } else {
    const ratio = 1 - metrics.imagesWithoutAlt / metrics.imagesCount;
    score += ratio * 10;
  }

  // Meta 长度（10%）
  score += metrics.metaTitle >= 30 && metrics.metaTitle <= 60 ? 5 : 0;
  score += metrics.metaDesc >= 120 && metrics.metaDesc <= 160 ? 5 : 0;

  // 基础分（10%）
  score += 10;

  return Math.round(Math.min(100, score));
}

export function analyzeContent(html: string, url: string, targetKeywords: string[]): ContentAnalysisResult {
  const $ = cheerio.load(html);

  // 移除无关标签后取正文
  $("script, style, noscript").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = countWords(bodyText);

  // 可读性
  const readabilityScore = calculateReadability(bodyText);
  const readabilityLevel = readabilityScore >= 80 ? "易读" : readabilityScore >= 60 ? "中等" : "较难";

  // 关键词密度
  const keywordDensity: KeywordDensityItem[] = targetKeywords
    .filter((kw) => kw.trim())
    .map((kw) => {
      const regex = new RegExp(escapeRegex(kw), "gi");
      const matches = bodyText.match(regex) || [];
      return {
        keyword: kw,
        count: matches.length,
        density: wordCount > 0 ? Number(((matches.length / wordCount) * 100).toFixed(2)) : 0,
      };
    });

  // 标题结构
  const headingStructure: HeadingItem[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const $el = $(el);
    const tag = $el.prop("tagName") as string | undefined;
    if (!tag) return;
    const level = Number(tag[1]);
    const text = $el.text().trim();
    if (text) headingStructure.push({ level, text });
  });

  // 链接统计
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = "";
  }
  let internalLinksCount = 0;
  let externalLinksCount = 0;
  $('a[href]').each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (href.startsWith("/") || href.startsWith("./") || (hostname && href.includes(hostname))) {
      internalLinksCount++;
    } else if (/^https?:\/\//i.test(href)) {
      externalLinksCount++;
    }
  });

  // 图片统计
  const images = $("img");
  const imagesCount = images.length;
  let imagesWithoutAlt = 0;
  images.each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt === undefined || alt.trim() === "") imagesWithoutAlt++;
  });

  // Meta 长度
  const metaTitle = $("title").first().text().trim().length;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const metaDescriptionLength = metaDescription.length;

  // 前 100 字
  const first100Words = bodyText.slice(0, 200);

  // 高频词
  const topKeywords = extractTopKeywords(bodyText, 10);

  // 标题建议
  const currentTitle = $("title").first().text().trim();
  const titleSuggestions = generateTitleSuggestions(currentTitle, targetKeywords);

  // 内容评分
  const contentScore = calculateContentScore({
    wordCount,
    readabilityScore,
    keywordDensity,
    headingStructure,
    imagesWithoutAlt,
    imagesCount,
    metaTitle,
    metaDesc: metaDescriptionLength,
  });

  return {
    wordCount,
    readabilityScore,
    readabilityLevel,
    keywordDensity,
    headingStructure,
    internalLinksCount,
    externalLinksCount,
    imagesCount,
    imagesWithoutAlt,
    metaTitleLength: metaTitle,
    metaDescriptionLength: metaDescriptionLength,
    first100Words,
    topKeywords,
    titleSuggestions,
    contentScore,
  };
}
