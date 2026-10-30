// ===== 关键词主题分组 + 问题词识别（纯本地规则，零外部 API 成本） =====
// 明确边界：这是 SeeO 的规则型关键词分组（词频 + 修饰词规则），
// 不是经过验证的语义聚类算法，更不是 Google 官方分类；UI 文案已如实标注。
// 输入全部来自真实研究结果（SerpApi 相关搜索 / PAA / Google 自动补全 / 数据库扩词），
// 分组名称由真实结果生成，绝不预置示例簇。

/** 主题分组结果：label 由真实关键词中的高频核心词生成 */
export interface KeywordCluster {
  /** 稳定 id（即核心词的归一形式；「其他」为固定 id） */
  id: string;
  label: string;
  keywords: string[];
}

/** 「其他」分组 id：无高频核心词可归属的关键词都进这里 */
export const CLUSTER_OTHER_ID = "__other__";

// 拉丁文停用词：不作为分组核心词（修饰词/功能词/疑问词，单靠它们分组没有信息量）
const LATIN_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "to", "of", "in", "on", "at", "by",
  "is", "are", "was", "were", "be", "can", "could", "should", "will", "would", "do",
  "does", "did", "my", "your", "you", "i", "it", "that", "this", "how", "what",
  "why", "when", "where", "which", "who", "vs", "versus",
]);

/** 疑问词（拉丁）：作为独立 token 出现即视为问题词 */
const LATIN_QUESTION_TOKENS = new Set([
  "how", "what", "why", "when", "where", "which", "who", "whom", "whose",
  "can", "could", "should", "does", "do", "is", "are", "will",
]);

/** 疑问词（中日韩）：子串命中即视为问题词 */
const CJK_QUESTION_MARKS = [
  "怎么", "怎样", "如何", "什么", "为什么", "为何", "哪个", "哪些", "多少",
  "几个", "什么时候", "何时", "哪里", "哪儿", "能不能", "是不是", "好不好",
  "要不要", "值不值", "怎么样",
];

/** 拉丁 token：字母数字段（含撇号内部），长度 ≥2 */
function latinTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9']+/).filter((token) => token.length >= 2);
}

/** CJK 连续段（汉字，不含日文假名以外的判断——本项目市场以中文为主） */
function cjkRuns(text: string): string[] {
  return text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
}

/**
 * 提取候选核心词（document frequency 统计用）：
 * - 拉丁 token（排除停用词）
 * - CJK 段内的 2-gram / 3-gram
 */
function candidateTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const token of latinTokens(text)) {
    if (!LATIN_STOPWORDS.has(token)) terms.add(token);
  }
  for (const run of cjkRuns(text)) {
    for (let size = 2; size <= 3; size++) {
      for (let i = 0; i + size <= run.length; i++) {
        terms.add(run.slice(i, i + size));
      }
    }
  }
  return [...terms];
}

/**
 * 规则型主题分组：
 * 1. 统计核心词在关键词集合中的出现次数（df），保留 df ≥ 2 的核心词，
 *    按 df 降序 → 长度降序 → 字典序排序（确定性，不依赖输入顺序）。
 * 2. 每个关键词按排序后的核心词逐个匹配，命中第一个即为主分组归属（唯一主分组）。
 * 3. 无任何核心词命中的关键词进入「其他」。
 * 单个关键词 / 空列表都是安全输入（无 df≥2 词时全部进「其他」）。
 */
export function clusterKeywords(keywords: string[]): KeywordCluster[] {
  const originals = keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const df = new Map<string, number>();
  for (const keyword of originals) {
    for (const term of candidateTerms(keyword)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const cores = [...df.entries()]
    .filter(([, count]) => count >= 2)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) =>
      b.count - a.count ||
      b.term.length - a.term.length ||
      a.term.localeCompare(b.term)
    );

  const clusters = new Map<string, KeywordCluster>();
  const ensure = (id: string, label: string) => {
    let cluster = clusters.get(id);
    if (!cluster) {
      cluster = { id, label, keywords: [] };
      clusters.set(id, cluster);
    }
    return cluster;
  };
  const other = ensure(CLUSTER_OTHER_ID, CLUSTER_OTHER_ID);

  for (const keyword of originals) {
    const normalized = keyword.toLowerCase();
    const hit = cores.find(({ term }) => normalized.includes(term));
    if (hit) {
      ensure(hit.term, hit.term).keywords.push(keyword);
    } else {
      other.keywords.push(keyword);
    }
  }

  // 稳定输出顺序：按组内数量降序 → 标签字典序；「其他」固定排最后（空则不输出）
  const result = [...clusters.values()]
    .filter((cluster) => cluster.id !== CLUSTER_OTHER_ID)
    .sort((a, b) =>
      b.keywords.length - a.keywords.length ||
      a.label.localeCompare(b.label)
    );
  if (other.keywords.length > 0) result.push(other);
  return result;
}

/**
 * 问题词识别（规则型，与 PAA 来源区分开）：
 * - 拉丁：疑问/助动 token 命中
 * - 中文：疑问子串命中
 * 普通相关词不含疑问特征时不判为问题词；识别结果只用于「问题词」视图过滤，
 * 不代表 Google 官方问题分类。
 */
export function isQuestionKeyword(keyword: string): boolean {
  const text = keyword.trim().toLowerCase();
  if (!text) return false;
  if (CJK_QUESTION_MARKS.some((mark) => text.includes(mark))) return true;
  if (/[\u4e00-\u9fff]吗[?？!！.。]?$/.test(text)) return true;
  return latinTokens(text).some((token) => LATIN_QUESTION_TOKENS.has(token));
}
