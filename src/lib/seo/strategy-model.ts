// ===== 关键词策略领域模型（纯函数，客户端与服务端共用）=====
//
// 诚实边界（必须与 UI 文案一致，不得夸大）：
//   1. 主题分组是**规则型**：种子短语 + 高频短语包含匹配（复用 keyword-cluster 的
//      df/停用词口径，但改为「最长短语优先」，避免所有词被最泛的词吸走）。
//      不是语义聚类，也不是 LLM 分组。
//   2. Pillar 由「主题短语命中 + 中心度 + 搜索量(若有) + 长度」打分选出，不是 Google 认定；
//      没有搜索量时只用中心度与短语命中，评分依据必须展示给用户。
//   3. Volume / KD / CPC 只来自 provider；取不到一律 null，UI 显示「—」，
//      绝不用关键词数量、SERP 结果数或随机值冒充。
//   4. Intent 有 provider 标记时用 provider；否则用本地规则估算并标 estimated。
//   5. SERP features 只在**真的对该关键词做过 SERP 抓取**时才存在，
//      绝不把种子词的 SERP 复制给所有扩展词。

import type { KeywordOrigin } from "./keyword-merge";
import { detectIntent, type KeywordIntent } from "./keyword-intent";
import { isQuestionKeyword } from "./keyword-cluster";
import { detectIntentEvidence } from "./intent-evidence";
import { classifySerpPageType } from "./page-type-serp";
import type { SerpSnapshotMap } from "./serp-snapshot";

// ---------- 类型 ----------

/** 指标可用性三态：provider=真实数据；estimated=规则估算；unavailable=无来源 */
export type MetricState = "provider" | "estimated" | "unavailable";

export interface StrategyKeyword {
  /** 归一化关键词（同时用作唯一 id） */
  id: string;
  keyword: string;
  /** 产出该词的种子（可多个） */
  seeds: string[];
  origins: KeywordOrigin[];
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  /** 指标来源标记：volume/kd 只要有一个来自 provider 即为 provider */
  metricsSource: "provider" | null;
  intent: KeywordIntent;
  intentSource: "provider" | "estimated";
  /** true = 由用户「Add keywords」手动追加的种子带来（区别于原始种子与自动扩词） */
  manual: boolean;
  topicId: string;
  role: "pillar" | "subpage" | "unassigned";
  /** 所属 subpage 分组（pillar / unassigned 为 null） */
  pageId: string | null;
  /** 真实抓取到的 SERP feature 类型（仅当真的抓过该词的 SERP） */
  serpFeatures: string[] | null;
  /** 疑问型关键词（zh/en 规则，keyword-cluster.isQuestionKeyword） */
  isQuestion?: boolean;
  /** 疑似品牌词（来自真实扩词结果中的专名信号，启发式） */
  isBrandish?: boolean;
}

export interface StrategyPage {
  id: string;
  /** 页面名（取该组代表关键词，与 Semrush 的 subpage 命名方式一致） */
  name: string;
  keywordIds: string[];
  keywordCount: number;
  totalVolume: number | null;
  avgKd: number | null;
  intentMix: IntentMix;
}

export interface StrategyTopic {
  id: string;
  name: string;
  keywordIds: string[];
  keywordCount: number;
  /** 无可靠归类时为 null（未分组区域） */
  pillarId: string | null;
  pages: StrategyPage[];
  totalVolume: number | null;
  avgKd: number | null;
  intentMix: IntentMix;
  intentCounts: IntentCounts;
  /** Pillar 选择依据（面向用户的解释文本） */
  pillarReason: string;
}

/** [信息型, 商业型, 交易型] 百分比（整数） */
export type IntentMix = readonly [number, number, number];

export interface IntentCounts {
  informational: number;
  commercial: number;
  transactional: number;
  navigational: number;
  unknown: number;
}

export interface StrategyMeta {
  market: string;
  device: "PC" | "移动端";
  /** 真实 SERP 快照采集时间（最早一次），无则 null */
  fetchedAt: string | null;
  sources: string[];
  metrics: { volume: MetricState; kd: MetricState; cpc: MetricState; intent: MetricState };
  warnings: string[];
  /** 实际成功/失败的种子明细 */
  perSeed: { seed: string; ok: boolean; related: number; paa: number; error?: string }[];
  failedSeeds: string[];
  /** 用户通过 Add keywords 手动追加的种子（原始 seeds 永不被覆盖） */
  addedSeeds: string[];
  /** 种子级的 Related Searches / PAA（内容大纲用；明确标注为「种子级」） */
  related: string[];
  paa: string[];
  /** 聚类与 Pillar 的方法说明（UI 必须展示） */
  method: { clustering: string; pillar: string };
  /**
   * 种子级 compact SERP 快照（Top 10 标题/URL/域名/摘要/feature/PAA/related）。
   * 创建/重试/Add keywords 时随策略持久化；旧策略缺省 = 历史快照不可用（UI 明示，不自动补抓）。
   */
  serpSnapshots?: SerpSnapshotMap;
}

export interface StrategyDoc {
  topics: StrategyTopic[];
  keywords: StrategyKeyword[];
  meta: StrategyMeta;
}

/** 输入：每个种子一次真实扩词的结果 */
export interface SeedExpansion {
  seed: string;
  ok: boolean;
  error?: string;
  related: string[];
  paa: string[];
  /** 从该种子 SERP 标题/摘要提取的真实候选（serp_content） */
  content?: string[];
  /** 该种子 SERP 第一页快照时间 */
  fetchedAt: string | null;
  /** true = 该种子由用户手动追加（Add keywords） */
  manual?: boolean;
  /** 关键词 → provider 指标（volume/kd/cpc/intent），由 DataForSEO 提供；无配置时为空 */
  metrics: Map<string, ProviderMetric>;
  serpFeatures: string[] | null;
}

export interface ProviderMetric {
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  intent: string | null;
}

// ---------- 工具 ----------

const LATIN_STOP = new Set([
  "the", "a", "an", "and", "or", "for", "with", "to", "of", "in", "on", "at", "by",
  "is", "are", "was", "were", "be", "can", "could", "should", "will", "would", "do",
  "does", "did", "my", "your", "you", "i", "it", "that", "this", "how", "what",
  "why", "when", "where", "which", "who", "vs", "versus", "near", "me",
]);

/** 有序 token（保留原顺序，供短语匹配用） */
export function orderedTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.split(/[^a-z0-9']+/).filter(Boolean);
  const cjkRuns = lower.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return [...latin, ...cjkRuns];
}

/** 无序 token（停用词过滤后，供中心度计算） */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.split(/[^a-z0-9']+/).filter((t) => t.length >= 2 && !LATIN_STOP.has(t));
  const cjkRuns = lower.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const grams: string[] = [];
  for (const run of cjkRuns) {
    for (let i = 0; i + 2 <= run.length; i++) grams.push(run.slice(i, i + 2));
  }
  return [...latin, ...grams];
}

export function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

/** provider main_intent → 中文意图标签 */
export function mapProviderIntent(raw: string | null): KeywordIntent | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "informational") return "信息型";
  if (v === "commercial") return "商业型";
  if (v === "transactional") return "交易型";
  if (v === "navigational") return "导航型";
  return null;
}

function emptyCounts(): IntentCounts {
  return { informational: 0, commercial: 0, transactional: 0, navigational: 0, unknown: 0 };
}

function addIntent(counts: IntentCounts, intent: KeywordIntent) {
  if (intent === "信息型") counts.informational += 1;
  else if (intent === "商业型") counts.commercial += 1;
  else if (intent === "交易型") counts.transactional += 1;
  else if (intent === "导航型") counts.navigational += 1;
  else counts.unknown += 1;
}

function mixOf(counts: IntentCounts): IntentMix {
  const total =
    counts.informational + counts.commercial + counts.transactional + counts.navigational + counts.unknown;
  if (total === 0) return [0, 0, 0];
  const pct = (n: number) => Math.round((n / total) * 100);
  return [pct(counts.informational), pct(counts.commercial), pct(counts.transactional)];
}

export function sumOrNull(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0);
}

export function avgOrNull(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

/** 表格用的紧凑数字；null → 「—」（绝不填 0） */
export function formatVolume(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function formatKd(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

// ---------- 主题分组（规则型，最长短语优先） ----------

interface PhraseCandidate {
  phrase: string;
  tokens: number;
  /** 该短语作为候选来源的加权（df + 种子加成） */
  weight: number;
  fromSeed: boolean;
}

const MAX_TOPICS = 12;

/** 拉丁 2–3 词短语 / CJK 2–3 字短语（保留原顺序） */
function ngramPhrases(keyword: string): string[] {
  const tokens = orderedTokens(keyword);
  const out = new Set<string>();
  const latin = tokens.filter((t) => /^[a-z0-9']+$/.test(t));
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= latin.length; i++) {
      const phrase = latin.slice(i, i + n).join(" ");
      const words = phrase.split(" ");
      if (words.every((w) => LATIN_STOP.has(w))) continue;
      out.add(phrase);
    }
  }
  const cjk = keyword.toLowerCase().match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of cjk) {
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= run.length; i++) out.add(run.slice(i, i + n));
    }
  }
  return [...out];
}

function phraseMatches(keyword: string, phrase: string): boolean {
  const kw = ` ${keyword.toLowerCase()} `;
  if (/[\u4e00-\u9fff]/.test(phrase)) return kw.includes(phrase);
  // 拉丁短语按词匹配，允许简单的复数形式（bike/bikes）
  const parts = phrase.split(" ").map((w) => w.replace(/s$/, ""));
  const words = keyword.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).map((w) => w.replace(/s$/, ""));
  for (let i = 0; i + parts.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (words[i + j] !== parts[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** 候选短语质量：首尾不能是停用词，拉丁短语 ≥2 词且长度 ≥6 */
function isUsablePhrase(phrase: string): boolean {
  if (/[\u4e00-\u9fff]/.test(phrase)) return phrase.length >= 2;
  const words = phrase.split(" ");
  if (words.length < 2) return false;
  if (LATIN_STOP.has(words[0]) || LATIN_STOP.has(words[words.length - 1])) return false;
  return phrase.length >= 6;
}

/**
 * 规则分组：
 *   1. 候选短语 = 种子短语（权重最高）+ 出现在 ≥2 个关键词里的 2–3 词短语；
 *   2. 每个关键词匹配**最长**（其次种子、其次高频）的候选短语；
 *   3. 无匹配 → 未分组；成员 <2 且非种子的主题并入未分组；
 *   4. 主题数超过 12 时，超出部分（按成员数升序）并入未分组。
 */
export function groupByPhrases(
  keywords: StrategyKeyword[],
  seeds: string[]
): { topicKey: string; members: StrategyKeyword[] }[] {
  const candidates = new Map<string, PhraseCandidate>();
  for (const seed of seeds) {
    const phrase = normalizeKeyword(seed);
    if (!phrase) continue;
    candidates.set(phrase, {
      phrase,
      tokens: orderedTokens(phrase).length,
      weight: 1000,
      fromSeed: true,
    });
  }
  for (const kw of keywords) {
    // 只用查询类来源（种子/相关搜索/PAA）产生主题短语；SERP 标题摘要是页面文案，
    // 用作关键词候选可以，但让它们决定主题名会把「TOP 10 BEST Bike Repair」变成主题。
    const queryLike = kw.origins.some((o) => o === "seed" || o === "related" || o === "paa");
    if (!queryLike) continue;
    for (const phrase of ngramPhrases(kw.keyword)) {
      if (!isUsablePhrase(phrase)) continue;
      if (candidates.has(phrase)) {
        candidates.get(phrase)!.weight += 1;
      } else {
        candidates.set(phrase, {
          phrase,
          tokens: orderedTokens(phrase).length,
          weight: 1,
          fromSeed: false,
        });
      }
    }
  }

  const all = [...candidates.values()];
  const seedCandidates = all
    .filter((c) => c.fromSeed)
    .sort((a, b) => b.tokens - a.tokens || b.weight - a.weight || a.phrase.localeCompare(b.phrase));
  const phraseCandidates = all
    .filter((c) => !c.fromSeed)
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        b.weight - a.weight ||
        b.phrase.length - a.phrase.length ||
        a.phrase.localeCompare(b.phrase)
    );

  const buckets = new Map<string, StrategyKeyword[]>();
  for (const kw of keywords) {
    // 种子短语优先：种子周边的变体都归到种子主题，避免被更细的短语切碎
    const hit = seedCandidates.find((c) => phraseMatches(kw.keyword, c.phrase)) ??
      phraseCandidates.find((c) => phraseMatches(kw.keyword, c.phrase));
    const key = hit ? hit.phrase : "__ungrouped__";
    const list = buckets.get(key);
    if (list) list.push(kw);
    else buckets.set(key, [kw]);
  }

  const seedKeys = new Set(seeds.map((s) => normalizeKeyword(s)));
  const topics = [...buckets.entries()]
    .filter(([key, list]) => key !== "__ungrouped__" && (list.length >= 2 || seedKeys.has(key)))
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const kept = topics.slice(0, MAX_TOPICS);
  const overflow = topics.slice(MAX_TOPICS).flatMap(([, list]) => list);
  const ungrouped = [...(buckets.get("__ungrouped__") ?? []), ...overflow];

  if (ungrouped.length > 0) kept.push(["__ungrouped__", ungrouped]);
  return kept.map(([topicKey, members]) => ({ topicKey, members }));
}

// ---------- 构建 ----------

export interface BuildInput {
  seeds: string[];
  expansions: SeedExpansion[];
  market: string;
  device: "PC" | "移动端";
  /** 已有策略的关键词（Add keywords 增量合并时传入） */
  existing?: StrategyKeyword[];
  maxKeywords?: number;
  /**
   * 种子级 compact SERP 快照（来自本次运行的真实 searchSerp 结果）。
   * 重试 / Add keywords 由调用方合并旧快照后传入；缺省 = 不写入（旧策略兼容）。
   */
  snapshots?: SerpSnapshotMap;
}

const DEFAULT_MAX_KEYWORDS = 400;

export function buildStrategyDoc(input: BuildInput): StrategyDoc {
  const maxKeywords = input.maxKeywords ?? DEFAULT_MAX_KEYWORDS;
  const byId = new Map<string, StrategyKeyword>();

  for (const kw of input.existing ?? []) {
    byId.set(kw.id, { ...kw });
  }

  for (const expansion of input.expansions) {
    if (!expansion.ok) continue;
    const seedNorm = normalizeKeyword(expansion.seed);
    const candidates: { text: string; origin: KeywordOrigin }[] = [
      { text: expansion.seed, origin: "seed" },
      ...expansion.related.map((t) => ({ text: t, origin: "related" as KeywordOrigin })),
      ...expansion.paa.map((t) => ({ text: t, origin: "paa" as KeywordOrigin })),
      ...(expansion.content ?? []).map((t) => ({ text: t, origin: "serp_content" as KeywordOrigin })),
    ];
    for (const { text, origin } of candidates) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      const id = normalizeKeyword(trimmed);
      const existing = byId.get(id);
      const metric = expansion.metrics.get(id) ?? expansion.metrics.get(trimmed.toLowerCase());
      if (existing) {
        if (!existing.seeds.includes(seedNorm)) existing.seeds.push(seedNorm);
        if (!existing.origins.includes(origin)) existing.origins.push(origin);
        if (existing.volume === null && metric?.volume != null) existing.volume = metric.volume;
        if (existing.kd === null && metric?.kd != null) existing.kd = metric.kd;
        if (existing.cpc === null && metric?.cpc != null) existing.cpc = metric.cpc;
        if (existing.metricsSource === null && metric && (metric.volume != null || metric.kd != null)) {
          existing.metricsSource = "provider";
        }
        if (expansion.manual === true) existing.manual = true;
        if (existing.intentSource === "estimated") {
          const providerIntent = mapProviderIntent(metric?.intent ?? null);
          if (providerIntent) {
            existing.intent = providerIntent;
            existing.intentSource = "provider";
          }
        }
        continue;
      }
      if (byId.size >= maxKeywords) continue;
      const providerIntent = mapProviderIntent(metric?.intent ?? null);
      byId.set(id, {
        id,
        keyword: trimmed,
        seeds: [seedNorm],
        origins: [origin],
        volume: metric?.volume ?? null,
        kd: metric?.kd ?? null,
        cpc: metric?.cpc ?? null,
        metricsSource: metric && (metric.volume != null || metric.kd != null) ? "provider" : null,
        intent: providerIntent ?? detectIntent(trimmed),
        intentSource: providerIntent ? "provider" : "estimated",
        manual: expansion.manual === true,
        topicId: "",
        role: "unassigned",
        pageId: null,
        serpFeatures: null,
      });
    }
    // 该种子真实的 SERP feature 只挂在种子词自己身上（不复制给扩展词）
    if (expansion.serpFeatures && expansion.serpFeatures.length > 0) {
      const seedRow = byId.get(seedNorm);
      if (seedRow) seedRow.serpFeatures = [...expansion.serpFeatures];
    }
  }

  const keywords = [...byId.values()];
  const volumeAvailable = keywords.some((k) => k.volume !== null);
  // 聚类 2.0 增强：疑问词 / 品牌词启发式标记（基于真实扩词文本，纯本地）
  const brandTokens = collectBrandTokens(input.expansions);
  for (const kw of keywords) {
    if (kw.isQuestion === undefined) kw.isQuestion = isQuestionKeyword(kw.keyword);
    if (kw.isBrandish === undefined) {
      const raw = kw.keyword;
      kw.isBrandish = brandTokens.some((b) => new RegExp(`\\b${b}\\b`, "i").test(raw));
    }
  }
  const groups = groupByPhrases(keywords, input.seeds);

  const topics: StrategyTopic[] = groups.map(({ topicKey, members }) => {
    const isUngrouped = topicKey === "__ungrouped__";
    const topicId = isUngrouped ? "t-ungrouped" : `t-${slug(topicKey)}`;
    for (const member of members) member.topicId = topicId;

    if (isUngrouped) {
      for (const member of members) {
        member.role = "unassigned";
        member.pageId = null;
      }
      const counts = countIntent(members);
      return {
        id: topicId,
        name: "Ungrouped keywords",
        keywordIds: members.map((m) => m.id),
        keywordCount: members.length,
        pillarId: null,
        pages: [],
        totalVolume: sumOrNull(members.map((m) => m.volume)),
        avgKd: avgOrNull(members.map((m) => m.kd)),
        intentMix: mixOf(counts),
        intentCounts: counts,
        pillarReason: "无法可靠归入任何主题短语，保留在未分组区域，不强行塞入不相关主题。",
      };
    }

    const picked = pickPillar(members, volumeAvailable, topicKey);
    const rest = members.filter((m) => m.id !== picked.member.id);
    const pages = groupSubpages(rest, picked.member, topicId);
    const counts = countIntent(members);
    return {
      id: topicId,
      name: topicKey,
      keywordIds: members.map((m) => m.id),
      keywordCount: members.length,
      pillarId: picked.member.id,
      pages,
      totalVolume: sumOrNull(members.map((m) => m.volume)),
      avgKd: avgOrNull(members.map((m) => m.kd)),
      intentMix: mixOf(counts),
      intentCounts: counts,
      pillarReason: picked.reason,
    };
  });

  topics.sort((a, b) => {
    if (a.id === "t-ungrouped") return 1;
    if (b.id === "t-ungrouped") return -1;
    return b.keywordCount - a.keywordCount || a.name.localeCompare(b.name);
  });

  return { topics, keywords, meta: buildMeta(input, keywords) };
}

/**
 * 品牌词启发信号：真实相关搜索/related 结果里「短语中段的大写词」通常是品牌/专名
 * （如 "Ahrefs vs Semrush"、"Shopify SEO tips" 的 Ahrefs/Shopify）。
 * 只采集出现过的专名，绝不预置品牌表。原始字符串保留大小写，扩展词文本已 lowercase，
 * 用 \b 词边界匹配原始词。
 */
function collectBrandTokens(expansions: SeedExpansion[]): string[] {
  const counts = new Map<string, number>();
  for (const e of expansions) {
    for (const raw of [...e.related, ...e.paa]) {
      const words = raw.split(/\s+/).filter(Boolean);
      for (let i = 1; i < words.length - 1; i++) {
        const w = words[i].replace(/[^A-Za-z0-9'-]/g, "");
        if (w.length >= 3 && /^[A-Z]/.test(w)) {
          counts.set(w, (counts.get(w) ?? 0) + 1);
        }
      }
    }
  }
  // 至少出现 2 次才算专名信号，避免偶发大小写噪声
  return [...counts.entries()].filter(([, n]) => n >= 2).map(([w]) => w);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "topic"
  );
}

/** 运行状态：全部失败=failed；部分失败=partial；全成功=ready（无种子=ready） */
export type StrategyStatusValue = "running" | "ready" | "partial" | "failed";

export function deriveStrategyStatus(perSeed: { ok: boolean }[]): StrategyStatusValue {
  if (perSeed.length === 0) return "ready";
  const failed = perSeed.filter((p) => !p.ok).length;
  if (failed === 0) return "ready";
  if (failed === perSeed.length) return "failed";
  return "partial";
}

/** 来源标签（CSV / UI 共用；manual 单独一列，不混进 origins） */
export type KeywordSourceLabel = "seed" | "related" | "paa" | "serp_content" | "other";

export function primarySource(k: StrategyKeyword): KeywordSourceLabel {
  const order: KeywordSourceLabel[] = ["seed", "related", "paa", "serp_content"];
  for (const o of order) {
    if (k.origins.includes(o as never)) return o;
  }
  return "other";
}

function countIntent(members: StrategyKeyword[]): IntentCounts {
  const counts = emptyCounts();
  for (const m of members) addIntent(counts, m.intent);
  return counts;
}

/**
 * Pillar 选择（可解释）：
 *   phraseHit：关键词是否就是主题短语本身（最能代表该主题）
 *   centrality：与主题内其它关键词共享 ≥2 token 的比例
 *   volume：主题内搜索量占比（仅有真实 Volume 时）
 *   brevity：token 数的轻微加成，避免选出超长尾巴词
 * 权重：有 volume → 0.3/0.35/0.2/0.15；无 volume → 0.35/0.5/0/0.15
 */
function pickPillar(
  members: StrategyKeyword[],
  volumeAvailable: boolean,
  topicPhrase: string
): { member: StrategyKeyword; reason: string } {
  const tokenMap = new Map<string, Set<string>>();
  for (const m of members) tokenMap.set(m.id, new Set(tokenize(m.keyword)));
  const maxVolume = Math.max(0, ...members.map((m) => m.volume ?? 0));
  const topicNorm = normalizeKeyword(topicPhrase);

  const scored = members.map((m) => {
    const tokens = tokenMap.get(m.id)!;
    let shared = 0;
    for (const other of members) {
      if (other.id === m.id) continue;
      const otherTokens = tokenMap.get(other.id)!;
      let overlap = 0;
      for (const t of tokens) if (otherTokens.has(t)) overlap += 1;
      if (overlap >= 2) shared += 1;
    }
    const centrality = members.length > 1 ? shared / (members.length - 1) : 1;
    const volumeScore = volumeAvailable && maxVolume > 0 ? (m.volume ?? 0) / maxVolume : 0;
    const brevity = tokens.size > 0 ? Math.min(1, 4 / Math.max(4, tokens.size)) : 0.5;
    const phraseHit = m.id === topicNorm ? 1 : 0;
    const score = volumeAvailable
      ? 0.3 * phraseHit + 0.35 * centrality + 0.2 * volumeScore + 0.15 * brevity
      : 0.35 * phraseHit + 0.5 * centrality + 0.15 * brevity;
    return { member: m, score, centrality, volumeScore, phraseHit };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.member.keyword.length - b.member.keyword.length ||
      a.member.id.localeCompare(b.member.id)
  );
  const top = scored[0];
  top.member.role = "pillar";
  top.member.pageId = null;
  const basis = volumeAvailable
    ? `中心度 ${(top.centrality * 100).toFixed(0)}% · 搜索量占比 ${(top.volumeScore * 100).toFixed(0)}% · 主题短语命中${top.phraseHit ? "（是）" : "（否）"}`
    : `中心度 ${(top.centrality * 100).toFixed(0)}% · 主题短语命中${top.phraseHit ? "（是）" : "（否）"}（无搜索量数据，未参与排序）`;
  return { member: top.member, reason: basis };
}

/**
 * Subpages：按「首个区分性 token」分组（去掉 pillar 与主题短语 token 后剩下的词）。
 * 没有区分词的短尾词合并进「Related keywords」页。这是规则分组，不是语义切分。
 */
function groupSubpages(rest: StrategyKeyword[], pillar: StrategyKeyword, topicId: string): StrategyPage[] {
  if (rest.length === 0) return [];
  const pillarTokens = new Set(tokenize(pillar.keyword));
  const groups = new Map<string, StrategyKeyword[]>();

  for (const kw of rest) {
    const tokens = tokenize(kw.keyword).filter((t) => !pillarTokens.has(t));
    const key = tokens[0] ?? "__related__";
    const list = groups.get(key);
    if (list) list.push(kw);
    else groups.set(key, [kw]);
  }

  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const pages: StrategyPage[] = [];
  for (const [key, list] of entries.slice(0, 12)) {
    const pageId = `${topicId}-p-${slug(key).slice(0, 16)}`;
    const queryLike = (k: StrategyKeyword) =>
      k.origins.some((o) => o === "seed" || o === "related" || o === "paa") ? 1 : 0;
    const rep = [...list].sort((a, b) => {
      if (a.volume !== null || b.volume !== null) return (b.volume ?? -1) - (a.volume ?? -1);
      // 代表词优先取真实查询（相关搜索/PAA），SERP 标题只作兜底，避免页面标题变成页面名
      return queryLike(b) - queryLike(a) || a.keyword.length - b.keyword.length || a.id.localeCompare(b.id);
    })[0];
    const counts = countIntent(list);
    for (const member of list) {
      member.role = "subpage";
      member.pageId = pageId;
    }
    pages.push({
      id: pageId,
      name: key === "__related__" ? "Related keywords" : rep.keyword,
      keywordIds: list.map((m) => m.id),
      keywordCount: list.length,
      totalVolume: sumOrNull(list.map((m) => m.volume)),
      avgKd: avgOrNull(list.map((m) => m.kd)),
      intentMix: mixOf(counts),
    });
  }

  const covered = new Set(pages.flatMap((p) => p.keywordIds));
  const overflow = rest.filter((m) => !covered.has(m.id));
  if (overflow.length > 0) {
    const pageId = `${topicId}-p-more`;
    const counts = countIntent(overflow);
    for (const member of overflow) {
      member.role = "subpage";
      member.pageId = pageId;
    }
    pages.push({
      id: pageId,
      name: "More keywords",
      keywordIds: overflow.map((m) => m.id),
      keywordCount: overflow.length,
      totalVolume: sumOrNull(overflow.map((m) => m.volume)),
      avgKd: avgOrNull(overflow.map((m) => m.kd)),
      intentMix: mixOf(counts),
    });
  }
  return pages;
}

function buildMeta(input: BuildInput, keywords: StrategyKeyword[]): StrategyMeta {
  const okExpansions = input.expansions.filter((e) => e.ok);
  const failed = input.expansions.filter((e) => !e.ok);
  const hasVolume = keywords.some((k) => k.volume !== null);
  const hasKd = keywords.some((k) => k.kd !== null);
  const hasCpc = keywords.some((k) => k.cpc !== null);
  const hasProviderIntent = keywords.some((k) => k.intentSource === "provider");
  const fetchedAt =
    okExpansions
      .map((e) => e.fetchedAt)
      .filter((v): v is string => Boolean(v))
      .sort()[0] ?? null;

  const warnings: string[] = [];
  if (!hasVolume || !hasKd) {
    warnings.push(
      "搜索量 / KD 需要 DataForSEO 市场指标额度，当前未配置或套餐不含额度：相关列显示「—」，不参与排序。"
    );
  }
  if (!hasProviderIntent) {
    warnings.push("搜索意图来自本地文本规则估算（非供应商数据），已逐词标记为估算。");
  }
  for (const f of failed) {
    warnings.push(`种子「${f.seed}」扩词失败：${f.error ?? "未知原因"}`);
  }

  return {
    market: input.market,
    device: input.device,
    fetchedAt,
    sources: ["serpapi", ...(hasVolume || hasKd ? ["dataforseo"] : [])],
    metrics: {
      volume: hasVolume ? "provider" : "unavailable",
      kd: hasKd ? "provider" : "unavailable",
      cpc: hasCpc ? "provider" : "unavailable",
      intent: "estimated",
    },
    warnings,
    perSeed: input.expansions.map((e) => ({
      seed: e.seed,
      ok: e.ok,
      related: e.ok ? e.related.length : 0,
      paa: e.ok ? e.paa.length : 0,
      ...(e.error ? { error: e.error } : {}),
    })),
    failedSeeds: failed.map((f) => f.seed),
    addedSeeds: okExpansions.filter((e) => e.manual === true).map((e) => e.seed),
    related: dedupeFlat(okExpansions.flatMap((e) => e.related)).slice(0, 60),
    paa: dedupeFlat(okExpansions.flatMap((e) => e.paa)).slice(0, 60),
    method: {
      clustering:
        "规则分组：以种子短语 + 在多个关键词中重复出现的 2–3 词短语为候选，按最长匹配归类（非语义聚类、非 AI 分组）。",
      pillar:
        "Pillar 由主题短语命中、主题内中心度（与其它词共享 token 的比例）与长度权重选出；有搜索量时才计入搜索量权重。",
    },
    ...(input.snapshots && Object.keys(input.snapshots).length > 0
      ? { serpSnapshots: input.snapshots }
      : {}),
  };
}

function dedupeFlat(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = normalizeKeyword(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

// ---------- 视图 / 评分 ----------

export type TileId = "strategy" | "easy-start" | "conversions" | "traffic";

export interface TileResult {
  id: TileId;
  label: string;
  /** null = 该视图依赖的指标不可用 */
  count: number | null;
  available: boolean;
  reason: string;
  desc: string;
  /** 该视图命中的 topic id（用于筛选） */
  topicIds: string[];
}

const TILE_LABELS: Record<TileId, string> = {
  strategy: "Best for Strategy",
  "easy-start": "Easy Start",
  conversions: "Quick Conversions",
  traffic: "More Potential Traffic",
};

/**
 * 四宫格评分：
 *   strategy  = 覆盖度 + 意图多样度（无 volume）；有 volume 时加入搜索量占比
 *   easy-start= 依赖 KD，无 KD 一律 unavailable（不假装排序）
 *   conversions = 商业+交易意图占比 ≥ 25%
 *   traffic   = 依赖 Volume，无 Volume 一律 unavailable
 */
export function scoreTopics(doc: StrategyDoc): TileResult[] {
  const topics = doc.topics.filter((t) => t.id !== "t-ungrouped");
  const hasVolume = doc.meta.metrics.volume === "provider";
  const hasKd = doc.meta.metrics.kd === "provider";
  const maxCount = Math.max(1, ...topics.map((t) => t.keywordCount));
  const maxVolume = Math.max(1, ...topics.map((t) => t.totalVolume ?? 0));

  const diversity = (t: StrategyTopic) => {
    const c = t.intentCounts;
    const kinds = [c.informational, c.commercial, c.transactional].filter((n) => n > 0).length;
    return kinds / 3;
  };

  const strategyScored = topics
    .map((t) => {
      const coverage = t.keywordCount / maxCount;
      const volumeShare = hasVolume ? (t.totalVolume ?? 0) / maxVolume : 0;
      const score = hasVolume
        ? 0.45 * coverage + 0.35 * volumeShare + 0.2 * diversity(t)
        : 0.6 * coverage + 0.4 * diversity(t);
      return { t, score };
    })
    .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));

  const conversions = topics.filter((t) => {
    const conv = t.intentCounts.commercial + t.intentCounts.transactional;
    return t.keywordCount > 0 && conv / t.keywordCount >= 0.25;
  });

  const traffic = hasVolume ? [...topics].sort((a, b) => (b.totalVolume ?? 0) - (a.totalVolume ?? 0)) : [];
  const easyStart = hasKd ? [...topics].sort((a, b) => (a.avgKd ?? 101) - (b.avgKd ?? 101)) : [];

  return [
    {
      id: "strategy",
      label: TILE_LABELS.strategy,
      count: strategyScored.length,
      available: true,
      reason: hasVolume
        ? "评分 = 关键词覆盖度 45% + 搜索量占比 35% + 意图多样度 20%（真实指标）"
        : "评分 = 关键词覆盖度 60% + 意图多样度 40%（无搜索量数据，未使用搜索量）",
      desc: hasVolume ? "Coverage · Volume · Intent mix." : "Coverage · Intent mix（无 Volume）.",
      topicIds: strategyScored.map((s) => s.t.id),
    },
    {
      id: "easy-start",
      label: TILE_LABELS["easy-start"],
      count: hasKd ? easyStart.length : null,
      available: hasKd,
      reason: hasKd ? "按主题平均 KD 升序（低竞争优先）" : "KD 未提供：需要 DataForSEO 市场指标额度，不能假装按难度排序。",
      desc: "Lowest average KD first.",
      topicIds: easyStart.map((t) => t.id),
    },
    {
      id: "conversions",
      label: TILE_LABELS.conversions,
      count: conversions.length,
      available: true,
      reason:
        doc.meta.metrics.intent === "estimated"
          ? "按商业+交易意图占比 ≥25% 筛选；意图为本地规则估算（非供应商数据）"
          : "按商业+交易意图占比 ≥25% 筛选（供应商意图）",
      desc: "Commercial / Transactional share ≥ 25%.",
      topicIds: conversions.map((t) => t.id),
    },
    {
      id: "traffic",
      label: TILE_LABELS.traffic,
      count: hasVolume ? traffic.length : null,
      available: hasVolume,
      reason: hasVolume ? "按主题搜索量合计降序" : "Volume 未提供：需要 DataForSEO 市场指标额度，不能假装按流量排序。",
      desc: "Highest total volume first.",
      topicIds: traffic.map((t) => t.id),
    },
  ];
}

// ---------- 内容大纲（Content Brief）----------
// 明确边界：这不是 AI 写作，是把真实关键词 / Related / PAA / 意图结构组织成可执行的大纲。

/** 用户保存过的 Content Brief（按 topicId）；客户端与服务端共用同一形状 */
export interface SavedBrief {
  topicId: string;
  topicName: string;
  /** 用户编辑后的 Markdown 全文 */
  markdown: string;
  /** 保存时间（ISO） */
  savedAt: string;
  /** 源大纲的生成时间（用于提示「数据是否已更新」） */
  generatedAt: string;
}

export type SavedBriefMap = Record<string, SavedBrief>;

export interface ContentBrief {
  topicId: string;
  topicName: string;
  title: string;
  titleOptions: string[];
  h1: string;
  outline: { heading: string; level: 2 | 3; keywords: string[] }[];
  faq: string[];
  relatedKeywords: string[];
  relatedSearches: string[];
  coverage: string[];
  dataSource: string;
  generatedAt: string;
  // ---------- Brief 2.0（全部可选：旧 Brief 缺省字段正常读取，不丢失历史内容） ----------
  /** 目标搜索意图（多证据：文本 + SERP 页面类型 + related） */
  searchIntent?: { primary: string; secondary: string | null; confidence: string; evidence: string[] };
  /** 关键词分组：主词（Pillar）/ 次级词（Subpage 主词）/ 问题词 / 疑似品牌词 */
  keywordGroups?: { primary: string[]; secondary: string[]; questionKeywords: string[]; brandKeywords: string[] };
  /** SERP 竞争页清单（来自已保存快照，绝不为此重新调用 API） */
  serpCompetition?: {
    keyword: string;
    fetchedAt: string;
    rows: { position: number; title: string; url: string; domain: string; pageType: string; pageTypeConfidence: string }[];
    domainDistribution: { domain: string; count: number }[];
    notes: string[];
  } | null;
  /** 内容差异化角度（证据范围：标题/摘要/PAA，未抓取正文） */
  differentiation?: string[];
  /** 结构化大纲（每章意图 + 该章要回答的问题） */
  structuredOutline?: { heading: string; keywords: string[]; intent: string; questions: string[] }[];
  /** 内部链接建议（基于 Pillar/Subpage 关系，不生成不存在的 URL） */
  internalLinks?: { from: string; to: string; anchor: string; reason: string }[];
  /** 编辑检查清单 */
  editorialChecklist?: string[];
}

export function buildContentBrief(doc: StrategyDoc, topicId: string, now = new Date()): ContentBrief | null {
  const topic = doc.topics.find((t) => t.id === topicId);
  if (!topic) return null;
  const kwById = new Map(doc.keywords.map((k) => [k.id, k]));
  const pillar = topic.pillarId ? kwById.get(topic.pillarId) : null;

  const pages = [...topic.pages].sort((a, b) => b.keywordCount - a.keywordCount);
  const outline = pages.slice(0, 10).map((page) => ({
    heading: page.name,
    level: 2 as const,
    keywords: page.keywordIds.map((id) => kwById.get(id)?.keyword ?? id).slice(0, 8),
  }));
  if (outline.length === 0) {
    outline.push({ heading: "Overview", level: 2 as const, keywords: topic.keywordIds.slice(0, 8) });
  }

  const faq = doc.meta.paa.slice(0, 8);
  const relatedKeywords = topic.keywordIds
    .map((id) => kwById.get(id))
    .filter((k): k is StrategyKeyword => Boolean(k))
    .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
    .slice(0, 12)
    .map((k) => k.keyword);

  const coverage: string[] = [];
  coverage.push(`主题共 ${topic.keywordCount} 个真实关键词，其中 Pillar 1 个、Subpages ${topic.pages.length} 组。`);
  const counts = topic.intentCounts;
  coverage.push(
    `意图结构：信息型 ${counts.informational}、商业型 ${counts.commercial}、交易型 ${counts.transactional}、导航型 ${counts.navigational}、未知 ${counts.unknown}（估算或供应商，逐词可查）。`
  );
  if (doc.meta.metrics.volume === "provider") {
    coverage.push(`主题搜索量合计 ${formatVolume(topic.totalVolume)}，平均 KD ${formatKd(topic.avgKd)}。`);
  } else {
    coverage.push("搜索量与 KD 当前不可用；大纲按真实关键词与 SERP 结构组织，未使用虚构指标。");
  }
  if (doc.meta.failedSeeds.length > 0) {
    coverage.push(`注意：种子 ${doc.meta.failedSeeds.join("、")} 扩词失败，本大纲不含其关键词。`);
  }

  // ---------- Brief 2.0（全部基于已保存数据，零 API 调用） ----------
  const base = pillar?.keyword ?? topic.name;
  const snapshots = doc.meta.serpSnapshots ?? {};
  // 主题对应的快照：优先主题名本身，其次 Pillar 关键词，再次主题成员的种子
  const snapKey =
    snapshots[topic.name] ? topic.name :
    (pillar && snapshots[pillar.id]) ? pillar.id :
    topic.keywordIds.map((id) => kwById.get(id)).find((k) => k && snapshots[k.seeds[0]])?.seeds[0] ?? null;
  const snapshot = snapKey ? snapshots[snapKey] ?? null : null;

  // 1. 多证据意图（关键词 + 快照证据）
  const intent = detectIntentEvidence(base, snapshot);

  // 2. 关键词分组
  const topicKeywords = topic.keywordIds.map((id) => kwById.get(id)).filter((k): k is StrategyKeyword => Boolean(k));
  const keywordGroups = {
    primary: [base],
    secondary: pages.slice(0, 10).map((p) => p.name),
    questionKeywords: topicKeywords.filter((k) => k.isQuestion).map((k) => k.keyword).slice(0, 10),
    brandKeywords: topicKeywords.filter((k) => k.isBrandish).map((k) => k.keyword).slice(0, 10),
  };

  // 3. SERP 竞争（快照存在时；绝不为 Brief 重新调用 API）
  let serpCompetition: ContentBrief["serpCompetition"] = null;
  const differentiation: string[] = [];
  if (snapshot && snapshot.results.length > 0) {
    const domainCounts = new Map<string, number>();
    const rows = snapshot.results.map((r) => {
      domainCounts.set(r.domain, (domainCounts.get(r.domain) ?? 0) + 1);
      const pt = classifySerpPageType(r);
      return { position: r.position, title: r.title, url: r.url, domain: r.domain, pageType: pt.type, pageTypeConfidence: pt.confidence };
    });
    const notes: string[] = [];
    const topDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topDomain && topDomain[1] >= 3) notes.push(`域名集中度：${topDomain[0]} 占 ${topDomain[1]}/10 个席位（少数站点主导该 SERP）。`);
    const typeTally = new Map<string, number>();
    for (const row of rows) typeTally.set(row.pageType, (typeTally.get(row.pageType) ?? 0) + 1);
    const dominantType = [...typeTally.entries()].filter(([t]) => t !== "unknown").sort((a, b) => b[1] - a[1])[0];
    if (dominantType) notes.push(`主要页面类型：${dominantType[0]}（${dominantType[1]}/10）——新内容应匹配该类型才符合当前搜索意图。`);
    if (snapshot.adsCount > 0) notes.push(`快照含 ${snapshot.adsCount} 条广告位：商业竞争激烈，自然排名需要更强的内容差异化。`);
    if (snapshot.features.includes("ai_overview")) notes.push("快照含 AI Overview：考虑用结构化问答与独家数据争取引用。");
    const paaCovered = new Set(snapshot.paa.map((q) => normalizeKeyword(q)));
    const outlineCovered = new Set(outline.map((o) => normalizeKeyword(o.heading)));
    const uncoveredPaa = [...paaCovered].filter((q) => ![...outlineCovered].some((o) => o.includes(q) || q.includes(o)));
    if (uncoveredPaa.length > 0) notes.push(`大纲尚未覆盖 ${uncoveredPaa.length} 个 PAA 问题，可作为 FAQ/H2 补充。`);
    differentiation.push(
      "证据范围说明：以下角度来自 Top 10 的标题/摘要与 PAA 问题，未抓取竞争页面正文。",
      `覆盖 PAA 中的 ${Math.min(snapshot.paa.length, 8)} 个真实问题，并在开头 100 字内直接回答最高频问题。`,
      "补充竞争页面普遍缺失的原创材料：实测数据、流程截图、成本/时间基准或可下载清单。",
      "保持与主导页面类型一致的内容形态（如 SERP 以教程为主则不要只做产品页），再叠加竞品没有的章节。",
    );
    serpCompetition = {
      keyword: snapshot.keyword,
      fetchedAt: snapshot.fetchedAt,
      rows: rows.slice(0, 10),
      domainDistribution: [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).map(([domain, count]) => ({ domain, count })),
      notes,
    };
  }

  // 4. 结构化大纲（每章意图 + 该章要回答的问题）
  const structuredOutline = outline.map((o) => {
    const intent = detectIntentEvidence(o.heading, snapshot);
    const h = normalizeKeyword(o.heading);
    const questions = doc.meta.paa.filter((q) => {
      const qn = normalizeKeyword(q);
      return h.length > 2 && (qn.includes(h) || h.includes(qn));
    }).slice(0, 3);
    return {
      heading: o.heading,
      keywords: o.keywords,
      intent: intent.primary === "未知" ? "按上下文判断" : intent.primary,
      questions: questions.length > 0 ? questions : intent.evidence.slice(0, 1),
    };
  });

  // 5. 内部链接（Pillar/Subpage 真实关系，不生成不存在的 URL）
  const internalLinks: ContentBrief["internalLinks"] = [];
  if (pillar) {
    internalLinks.push({
      from: `Pillar：${pillar.keyword}`,
      to: `本页面（${base}）`,
      anchor: base,
      reason: "Pillar 页应链接到其全部 Subpage，集中主题权威",
    });
    for (const page of pages.slice(0, 5)) {
      const pageMain = page.keywordIds.map((id) => kwById.get(id)?.keyword ?? id)[0];
      if (pageMain && pageMain !== base) {
        internalLinks.push({
          from: `本页面（${base}）`,
          to: `Subpage：${page.name}`,
          anchor: pageMain,
          reason: "同主题 Subpage 互相内链，帮助 Google 理解主题结构",
        });
      }
    }
  }

  // 6. 编辑检查清单
  const editorialChecklist = [
    `开篇直接回答「${base}」的核心搜索意图（${intent.primary}${intent.confidence === "high" ? "，高置信" : "，需人工确认方向"}）`,
    `覆盖 ${Math.min(faq.length, 5)} 个 PAA 真实问题`,
    "提供至少 1 项竞争页面没有的原创内容（数据/案例/工具）",
    "每个 H2 有明确的目标关键词与意图，不堆叠同义关键词",
    pillar ? "已从 Pillar 页获得内链，并回链 Pillar" : "确定本页与现有内容的内链关系",
    "确认站内没有其它页面在争同一关键词（见 Cannibalization 检查）",
    "来源可信且标注数据时间",
  ];

  const titleOptions = [
    `${capitalize(base)}: Complete Guide`,
    `The Ultimate Guide to ${base}`,
    `${capitalize(base)} — What You Need to Know`,
  ];

  return {
    topicId,
    topicName: topic.name,
    title: titleOptions[0],
    titleOptions,
    h1: capitalize(base),
    outline,
    faq,
    relatedKeywords,
    relatedSearches: doc.meta.related.slice(0, 10),
    coverage,
    dataSource: `基于真实 SERP 数据组织（SerpApi · ${doc.meta.market} · ${doc.meta.device}）；关键词 ${doc.keywords.length} 个、主题 ${doc.topics.length} 个。不是 AI 自动撰写的正文。`,
    generatedAt: now.toISOString(),
    searchIntent: { primary: intent.primary, secondary: intent.secondary, confidence: intent.confidence, evidence: intent.evidence },
    keywordGroups,
    serpCompetition,
    differentiation,
    structuredOutline,
    internalLinks,
    editorialChecklist,
  };
}

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function briefToMarkdown(brief: ContentBrief): string {
  const lines: string[] = [];
  lines.push(`# ${brief.h1}`);
  lines.push("");
  lines.push(`> ${brief.dataSource}`);
  lines.push("");
  lines.push("## 建议标题");
  for (const t of brief.titleOptions) lines.push(`- ${t}`);
  lines.push("");
  lines.push("## 大纲");
  for (const section of brief.outline) {
    lines.push(`${"#".repeat(section.level)} ${section.heading}`);
    if (section.keywords.length > 0) lines.push(`- 覆盖关键词：${section.keywords.join("、")}`);
  }
  if (brief.faq.length > 0) {
    lines.push("");
    lines.push("## FAQ");
    for (const q of brief.faq) lines.push(`- ${q}`);
  }
  if (brief.relatedKeywords.length > 0) {
    lines.push("");
    lines.push("## 相关关键词");
    lines.push(brief.relatedKeywords.join("、"));
  }
  if (brief.relatedSearches.length > 0) {
    lines.push("");
    lines.push("## 相关搜索（种子级）");
    lines.push(brief.relatedSearches.join("、"));
  }
  if (brief.coverage.length > 0) {
    lines.push("");
    lines.push("## 覆盖建议");
    for (const c of brief.coverage) lines.push(`- ${c}`);
  }
  // ---------- Brief 2.0 段落（旧 Brief 缺省字段自动跳过） ----------
  if (brief.searchIntent) {
    lines.push("");
    lines.push("## 搜索意图");
    lines.push(
      `- 主意图：${brief.searchIntent.primary}` +
        (brief.searchIntent.secondary ? `（次要：${brief.searchIntent.secondary}）` : "") +
        ` · 置信度 ${brief.searchIntent.confidence}`,
    );
    for (const e of brief.searchIntent.evidence) lines.push(`  - 证据：${e}`);
  }
  if (brief.keywordGroups) {
    lines.push("");
    lines.push("## 关键词分组");
    lines.push(`- 主关键词：${brief.keywordGroups.primary.join("、")}`);
    if (brief.keywordGroups.secondary.length) lines.push(`- 次级关键词：${brief.keywordGroups.secondary.join("、")}`);
    if (brief.keywordGroups.questionKeywords.length) lines.push(`- 问题型关键词：${brief.keywordGroups.questionKeywords.join("、")}`);
    if (brief.keywordGroups.brandKeywords.length) lines.push(`- 疑似品牌词：${brief.keywordGroups.brandKeywords.join("、")}`);
  }
  if (brief.serpCompetition && brief.serpCompetition.rows.length > 0) {
    lines.push("");
    lines.push(`## SERP 竞争页（快照时间 ${brief.serpCompetition.fetchedAt}，关键词「${brief.serpCompetition.keyword}」）`);
    for (const row of brief.serpCompetition.rows) {
      lines.push(`- #${row.position} ${row.title}（${row.domain} · 类型 ${row.pageType}/${row.pageTypeConfidence}）`);
      lines.push(`  ${row.url}`);
    }
    if (brief.serpCompetition.domainDistribution.length > 0) {
      lines.push(`- 域名分布：${brief.serpCompetition.domainDistribution.map((d) => `${d.domain}×${d.count}`).join("、")}`);
    }
    for (const n of brief.serpCompetition.notes) lines.push(`- 观察：${n}`);
  }
  if (brief.differentiation && brief.differentiation.length > 0) {
    lines.push("");
    lines.push("## 差异化角度");
    for (const d of brief.differentiation) lines.push(`- ${d}`);
  }
  if (brief.structuredOutline && brief.structuredOutline.length > 0) {
    lines.push("");
    lines.push("## 结构化大纲（章节意图与待答问题）");
    for (const s of brief.structuredOutline) {
      lines.push(`- ${s.heading} · 意图：${s.intent}`);
      if (s.keywords.length) lines.push(`  - 目标关键词：${s.keywords.join("、")}`);
      if (s.questions.length) lines.push(`  - 需回答：${s.questions.join("；")}`);
    }
  }
  if (brief.internalLinks && brief.internalLinks.length > 0) {
    lines.push("");
    lines.push("## 内部链接建议");
    for (const l of brief.internalLinks) lines.push(`- ${l.from} → ${l.to}（锚文本：${l.anchor}）— ${l.reason}`);
  }
  if (brief.editorialChecklist && brief.editorialChecklist.length > 0) {
    lines.push("");
    lines.push("## 编辑检查清单");
    for (const c of brief.editorialChecklist) lines.push(`- [ ] ${c}`);
  }
  return lines.join("\n");
}
