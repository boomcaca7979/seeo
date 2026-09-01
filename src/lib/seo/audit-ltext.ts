// ===== 审计引擎共享本地化文本类型 =====
// 独立于 audit-checks.ts，避免 rules / structured-data / page-type 等模块间循环依赖。
// audit-checks.ts 继续 re-export 保持既有导入路径兼容。

/** 双语文本：en / zh 各一份（渲染端按 locale 选取） */
export interface LText {
  en: string;
  zh: string;
}

/** 兼容类型：新数据为 LText，历史存量数据为纯文本 string */
export type LocalizedText = string | LText;

/** 按 locale 选取文本；string（历史数据）直接返回 */
export function pickText(t: LocalizedText | null | undefined, locale: "en" | "zh"): string {
  if (t === null || t === undefined) return "";
  return typeof t === "string" ? t : t[locale];
}
