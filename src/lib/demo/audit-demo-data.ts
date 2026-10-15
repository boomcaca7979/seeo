// ===== 首页真实审计演示快照（唯一数据来源）=====
//
// 纪律：
// - 本文件的数据是 2026-10-15 对 https://www.seeo.asia 的真实审计快照
//   （本地隔离环境审计记录 #8，引擎 v2 / 规则集 2.0），不是编造的客户数据。
// - 静态快照必须带时间与范围标注；本演示不声称任何改善效果（站点尚未实际修复）。
// - 数值必须与审计记录中的 dashboard_json 一致；如需更新，重新跑真实审计并逐字段核对。
// - 优先级不在本文件预计算：UI 渲染时调用 explainTechnicalPriority()（唯一来源）。

/** 演示快照的规则输入：与 audit #8 的 low-text-html-ratio RuleSnapshot 逐字段一致 */
export const DEMO_RULE_SNAPSHOT = {
  ruleId: "low-text-html-ratio",
  severity: "notice",
  affectedPages: 1,
  affectedRatio: 1,
  findings: 1,
  scoreImpact: 4,
  pattern: null,
  pageLevel: "page",
  status: "fail",
  sampleUrl: "https://www.seeo.asia/zh",
} as const;

/** 审计上下文（真实快照元数据） */
export const DEMO_AUDIT_META = {
  domain: "www.seeo.asia",
  auditedAtUtc: "2026-10-15T02:22:34Z",
  auditedAtLabel: "2026-10-15 10:22 (UTC+8)",
  scope: "quick-homepage" as const,
  pagesCrawled: 1,
  indexablePages: 1,
  healthScore: 96,
  checksTotal: 25,
  checksPassed: 24,
  engine: "V2 · 规则集 2.0",
} as const;

/** low-text-html-ratio 的实测证据（与该 finding 的 metrics 一致） */
export const DEMO_EVIDENCE = {
  visibleTextSize: 1181,
  htmlSize: 189650,
  /** 实测比例 ≈ 0.006（0.6%），低于 10% / 5% 两档阈值 */
  ratioPercent: "0.6",
} as const;

/**
 * 修复状态（真实解析记录）：
 * fixed_claimed + 再审计验证 fail（verified_audit_id=8，findings=1，pages=1），
 * 已尝试 3 次。站点尚未实际修复，因此问题仍被如实检出——不声称改善。
 */
export const DEMO_RESOLUTION = {
  status: "fixed_claimed" as const,
  verifyStatus: "fail" as const,
  verifiedAuditId: 8,
  verifyFindings: 1,
  verifyPages: 1,
  attempts: 3,
  /** 用户在产品内留下的真实修复备注 */
  note: "已压缩首页脚本体积",
} as const;

/**
 * 规则元数据（name / description / recommendation）。
 * 文案与 src/lib/seo/audit-checks.ts 中 low-text-html-ratio 规则定义保持一致；
 * 该模块含审计引擎依赖，不适合 client 直接导入，故此处以常量镜像并注明来源。
 */
export const DEMO_RULE_TEXT = {
  en: {
    name: "Low text-to-HTML ratio",
    description:
      "Visible text is less than 10% of the HTML size; the page markup is heavy relative to its content",
    recommendation: "Reduce HTML/script bloat or add meaningful visible content",
  },
  zh: {
    name: "文本/HTML 比例过低",
    description: "可见文本低于 HTML 大小的 10%；页面结构相对于有效文本较大",
    recommendation: "精简 HTML/脚本体积，或补充有价值的可见内容",
  },
} as const;

/** 问题解决状态机的五种状态（与 /app/actions 服务端状态机一致，仅用于说明机制） */
export const DEMO_RESOLUTION_STATES = [
  "open",
  "in_progress",
  "fixed_claimed",
  "verified_resolved",
  "dismissed",
] as const;
