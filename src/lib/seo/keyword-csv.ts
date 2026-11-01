// ===== 关键词 CSV 导出统一口径（两个页面共用，唯一实现）=====
//
// 背景（2026-11-01 验收 DEF-03）：概览与魔法工具的导出表头各自硬编码，
// 都缺 market / device / language / collected_at / metrics_source 五项口径，
// 文件脱离页面后无法判断数据来自哪个市场、哪个设备、何时采集、指标出自哪个 provider。
//
// 硬约束：
//   - 取不到的值一律导出空字符串（单元格为空），绝不用 0、绝不用导出时间冒充采集时间；
//   - collected_at 只接受真实研究快照的采集时间（serpSnapshot.fetchedAt），没有就留空；
//   - metrics_source 只接受真实 provider 来源（当前仅 dataforseo），没有就留空；
//   - 两个页面调用同一函数，保证口径完全一致。

import { toSerpDevice } from "./device-params";

export interface KeywordCsvRowInput {
  keyword: string;
  origins: string[];
  /** 已本地化的意图文案（信息型 / Informational …） */
  intentLabel: string;
  searchVolume: number | null;
  /** 无 CPC 数据的页面（如未取指标的场景）传 null */
  cpc: number | null;
}

export interface KeywordCsvContext {
  /** 实际选择的市场（如「中国」） */
  market: string;
  /** 实际研究设备（页面口径：PC / 移动端） */
  device: string;
  /** 实际研究语言（provider 返回的 hl，如 zh-cn）；未知为空 */
  language: string | null;
  /** 真实研究快照采集时间（ISO）；未知为空 */
  collectedAt: string | null;
  /** 指标真实来源（dataforseo）；无指标为空 */
  metricsSource: string | null;
}

/** 表头顺序固定：既有字段在前，五项口径追加在后 */
export const KEYWORD_CSV_HEADERS = [
  "keyword",
  "origins",
  "intent",
  "searchVolume",
  "cpc",
  "market",
  "device",
  "language",
  "collected_at",
  "metrics_source",
] as const;

/** 从 expand 响应构建口径：两个页面都走这里，禁止各自拼装 */
export function buildKeywordCsvContext(input: {
  location: string;
  device: string;
  language?: string | null;
  fetchedAt?: string | null;
  metricsSource?: string | null;
}): KeywordCsvContext {
  return {
    market: input.location ?? "",
    device: toSerpDevice(input.device),
    language: input.language ?? null,
    collectedAt: input.fetchedAt ?? null,
    metricsSource: input.metricsSource ?? null,
  };
}

export function buildKeywordCsv(
  rows: KeywordCsvRowInput[],
  ctx: KeywordCsvContext
): { headers: string[]; dataRows: (string | number | null)[][] } {
  const headers = [...KEYWORD_CSV_HEADERS];
  const dataRows = rows.map((r) => [
    r.keyword,
    r.origins.join("|"),
    r.intentLabel,
    // 缺失数字 → null（导出为空字符串），不用 0 冒充
    r.searchVolume,
    r.cpc === null ? null : r.cpc.toFixed(2),
    ctx.market || "",
    ctx.device || "",
    ctx.language ?? "",
    ctx.collectedAt ?? "",
    ctx.metricsSource ?? "",
  ]);
  return { headers, dataRows };
}
