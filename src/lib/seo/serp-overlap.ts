// ===== SERP Overlap 验证（纯函数：URL 归一 + Jaccard + 阈值建议） =====
//
// 目的：判断两个关键词是否适合由同一页面覆盖——用「Google 实际给它们排名的 URL 重合度」
// 作为证据，而不是词语相似度。
//
// 诚实边界：
//   - Jaccard overlap 是 SERP 观察指标，绝不冒充 KD / 搜索量 / 流量预测；
//   - 样本 = 每个 snapshot 的 Top 10（小样本），阈值在下方明确定义且可测试；
//   - 跨市场 / 跨设备 / 跨语言的快照不可比，调用方必须先分组（本模块校验并拒绝混算）。

import type { CompactSerpSnapshot } from "./serp-snapshot";

/** URL 归一：去 tracking 参数（utm_*、gclid、fbclid 等）、去 hash、小写 host、去末尾斜杠 */
export function normalizeUrlForOverlap(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const keep: Array<[string, string]> = [];
    const TRACKING = /^(utm_[a-z0-9_]*|gclid|fbclid|msclkid|ref|referrer|srsltid)$/i;
    u.searchParams.forEach((v, k) => {
      if (!TRACKING.test(k)) keep.push([k, v]);
    });
    keep.sort(([a], [b]) => a.localeCompare(b));
    const qs = keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.host.toLowerCase()}${path}${qs}`;
  } catch {
    return null;
  }
}

export function snapshotUrlSet(snapshot: CompactSerpSnapshot): Set<string> {
  const set = new Set<string>();
  for (const row of snapshot.results) {
    const normalized = normalizeUrlForOverlap(row.url);
    if (normalized) set.add(normalized);
  }
  return set;
}

export type OverlapVerdict =
  | "strong-same-page"
  | "possible-same-page"
  | "separate-pages"
  | "insufficient-evidence";

export interface PairOverlapResult {
  a: string;
  b: string;
  /** 归一化后 URL 交集数 */
  sharedUrls: number;
  /** 交集的实际 URL（展示用） */
  sharedUrlList: string[];
  /** a ∪ b 归一 URL 数 */
  unionUrls: number;
  /** Jaccard = shared / union（0-1，两位小数）；union=0 时为 null */
  overlapRatio: number | null;
  /** 共同排名的域名（去重） */
  sharedDomains: string[];
  verdict: OverlapVerdict;
  /** 建议的可解释说明（引用阈值） */
  explanation: string;
  /** 证据规模说明：两份快照各自的可用 URL 数 */
  aUrls: number;
  bUrls: number;
}

/** 阈值（明确定义、可测试）：≥0.5 强合并候选；0.3–0.5 可能；<0.3 分开；证据不足单独判定 */
export const OVERLAP_STRONG = 0.5;
export const OVERLAP_POSSIBLE = 0.3;
/** 任一侧可用 URL < 5 时视为证据不足（Top 10 快照缺了大半） */
export const MIN_URLS_FOR_VERDICT = 5;

export function compareSnapshots(a: CompactSerpSnapshot, b: CompactSerpSnapshot): PairOverlapResult | null {
  // 市场维度校验：不同市场/设备/语言的 SERP 不可比，混算直接拒绝
  if (a.market !== b.market || a.device !== b.device || a.language !== b.language) return null;

  const setA = snapshotUrlSet(a);
  const setB = snapshotUrlSet(b);
  const shared = [...setA].filter((u) => setB.has(u));
  const union = new Set([...setA, ...setB]);

  const sharedDomains = [
    ...new Set(
      shared.map((u) => {
        const row = a.results.find((r) => normalizeUrlForOverlap(r.url) === u) ?? b.results.find((r) => normalizeUrlForOverlap(r.url) === u);
        return row?.domain ?? "";
      }).filter(Boolean),
    ),
  ];

  const aUrls = setA.size;
  const bUrls = setB.size;
  const ratio = union.size > 0 ? Math.round((shared.length / union.size) * 100) / 100 : null;

  let verdict: OverlapVerdict;
  let explanation: string;
  if (aUrls < MIN_URLS_FOR_VERDICT || bUrls < MIN_URLS_FOR_VERDICT || ratio === null) {
    verdict = "insufficient-evidence";
    explanation = `SERP 证据不足（可用 URL：${aUrls} vs ${bUrls}，少于 ${MIN_URLS_FOR_VERDICT}），不给强结论。`;
  } else if (ratio >= OVERLAP_STRONG) {
    verdict = "strong-same-page";
    explanation = `URL 重合 ${shared.length}/${union.size}（${Math.round(ratio * 100)}%）≥ ${Math.round(OVERLAP_STRONG * 100)}% 阈值：Google 视两者意图高度一致，适合合并为一页。`;
  } else if (ratio >= OVERLAP_POSSIBLE) {
    verdict = "possible-same-page";
    explanation = `URL 重合 ${shared.length}/${union.size}（${Math.round(ratio * 100)}%）介于 ${Math.round(OVERLAP_POSSIBLE * 100)}%–${Math.round(OVERLAP_STRONG * 100)}%：可考虑一页覆盖或以小节区分，建议人工复核。`;
  } else {
    verdict = "separate-pages";
    explanation = `URL 重合 ${shared.length}/${union.size}（${Math.round(ratio * 100)}%）< ${Math.round(OVERLAP_POSSIBLE * 100)}%：Google 给出的是不同页面集合，建议分开建页。`;
  }

  return {
    a: a.keyword,
    b: b.keyword,
    sharedUrls: shared.length,
    sharedUrlList: shared.slice(0, 10),
    unionUrls: union.size,
    overlapRatio: ratio,
    sharedDomains,
    verdict,
    explanation,
    aUrls,
    bUrls,
  };
}

/** 多词比较：返回两两结果（n 个词 → C(n,2) 对） */
export function compareSnapshotPairs(snapshots: CompactSerpSnapshot[]): PairOverlapResult[] {
  const out: PairOverlapResult[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    for (let j = i + 1; j < snapshots.length; j++) {
      const r = compareSnapshots(snapshots[i], snapshots[j]);
      if (r) out.push(r);
    }
  }
  return out;
}

/** 分组校验：混入不同市场/设备/语言的种子直接列出，由调用方拒绝执行 */
export function groupByContext(snapshots: CompactSerpSnapshot[]): Map<string, CompactSerpSnapshot[]> {
  const groups = new Map<string, CompactSerpSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.market}|${s.language}|${s.device}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return groups;
}
