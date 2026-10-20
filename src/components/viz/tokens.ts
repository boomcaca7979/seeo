// ===== 共享可视化设计令牌（/app 与 /app/audit 共用一套视觉语义） =====
//
// 唯一目的：让"优先级 / 状态 / 分数"在三个页面里**同义同色**。
// 这里只放纯映射，不放任何业务算法（优先级算法仍唯一来自 lib/seo/issue-priority.ts）。

export type VizTone = "neutral" | "pos" | "warn" | "neg" | "info" | "accent";

/** 语义色（与 components/audit/ui.tsx、chart-theme.ts 同一色板） */
export const TONE_COLOR: Record<VizTone, string> = {
  neutral: "#9CA3AF",
  pos: "#22C55E",
  warn: "#F59E0B",
  neg: "#EF4444",
  info: "#6B7280",
  accent: "#2563EB",
};

/** 徽标类（globals.css 的描边 mono 徽标，语义统一） */
export const TONE_BADGE_CLASS: Record<VizTone, string> = {
  neutral: "badge-info",
  pos: "badge-pos",
  warn: "badge-warn",
  neg: "badge-err",
  info: "badge-info",
  accent: "badge-info",
};

/** 文字色类（用于数值/图例强调；ink-40 仅作 metadata，不做正文） */
export const TONE_TEXT_CLASS: Record<VizTone, string> = {
  neutral: "text-ink-60",
  pos: "text-pos",
  warn: "text-warn",
  neg: "text-neg",
  info: "text-ink-60",
  accent: "text-accent",
};

/** 健康分 → 语义色（≥80 正向 / 60-79 警告 / <60 负向）；无分 → 中性 */
export function scoreTone(score: number | null): VizTone {
  if (score === null) return "neutral";
  if (score >= 80) return "pos";
  if (score >= 60) return "warn";
  return "neg";
}

export function scoreColor(score: number | null): string {
  return TONE_COLOR[scoreTone(score)];
}

/** 优先级档位 → 语义色（P0 红 / P1 橙 / P2 中性） */
export function priorityTone(level: "P0" | "P1" | "P2"): VizTone {
  return level === "P0" ? "neg" : level === "P1" ? "warn" : "info";
}

/** 再审计验证结果 → 语义色（通过=正 / 未通过=负 / 无法判断=中性 / 待验证=警告） */
export function verificationTone(status: "pass" | "fail" | "inconclusive" | null): VizTone {
  if (status === "pass") return "pos";
  if (status === "fail") return "neg";
  if (status === "inconclusive") return "neutral";
  return "warn";
}

/** 统一处理状态 → 语义色（已验证解决=正 / 待处理=警告 / 其余=信息） */
export function unifiedStatusTone(status: string): VizTone {
  if (status === "verified_resolved") return "pos";
  if (status === "open") return "warn";
  return "info";
}
