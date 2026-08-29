// ===== Agent Skill 注册表（P0-04 Agent Skill Layer） =====
// Skill 的类型化元数据：触发词、工具预算、可选/必需工具、输出约定。
// Workflow 的实际执行在 runtime.ts（经 MCP tool registry，授权与外部 MCP client 完全一致）。
// 设计原则（吸收 OpenSEO skills）：
//   context-first（先 project_context）、bounded execution（每 skill 工具调用上限）、
//   cost awareness（provider 调用标注、缓存优先）、evidence-first（不发明数据）。

export type SkillId =
  | "seo-diagnostic"
  | "keyword-research"
  | "competitor-analysis"
  | "rank-drop-diagnosis"
  | "gsc-diagnosis"
  | "ai-search-visibility";

export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  /** 确定性 router 的触发关键词（zh/en，小写匹配） */
  triggers: string[];
  /** 该 skill 单次执行的 MCP 工具调用硬上限（成本护栏） */
  maxToolCalls: number;
  /** 执行所需的用户参数（缺省时 skill 必须明确产出 DATA GAP，不得编造） */
  requiredParams: Array<"seed" | "competitorId">;
  /** 消耗 provider 配额的工具集合（demo 模式下这些调用会降级为 DATA GAP） */
  providerTools: string[];
}

export const SKILLS: Record<SkillId, SkillDefinition> = {
  "seo-diagnostic": {
    id: "seo-diagnostic",
    name: "SEO Diagnostic",
    description: "全面 SEO 体检：排名分布、搜索表现、外链概况、AI 可见性的证据汇总与优先观察项。",
    triggers: ["全面分析", "seo 体检", "网站诊断", "seo 分析", "overall seo", "seo audit", "analyze my site", "diagnose"],
    maxToolCalls: 6,
    requiredParams: [],
    providerTools: ["search_console_tools", "ai_search_brand_lookup", "get_backlinks_profile"],
  },
  "keyword-research": {
    id: "keyword-research",
    name: "Keyword Research",
    description: "从 seed 展开关键词机会：真实指标 + SERP 竞争度 + 定性建议（Target/Monitor/Ignore）。",
    triggers: ["关键词", "keyword", "选词", "挖词", "拓词", "keyword research", "what keyword"],
    maxToolCalls: 4,
    requiredParams: ["seed"],
    providerTools: ["research_keywords", "get_serp_results"],
  },
  "competitor-analysis": {
    id: "competitor-analysis",
    name: "Competitor Analysis",
    description: "竞品关键词差距：shared/weaklyOwned/competitorOnly/projectOnly 分类与 rank gap。",
    triggers: ["竞争对手", "竞品", "competitor", "对手", "差距", "gap", "who competes"],
    maxToolCalls: 4,
    requiredParams: ["competitorId"],
    providerTools: ["get_competitor_keyword_gap", "get_serp_results"],
  },
  "rank-drop-diagnosis": {
    id: "rank-drop-diagnosis",
    name: "Rank Drop Diagnosis",
    description: "排名下降诊断：declined/lost 关键词 × SERP 现状 × GSC 交叉验证，输出证据链而非猜测。",
    triggers: ["排名下降", "排名为什么", "掉了", "rank drop", "why did my ranking", "lost ranking", "下降"],
    maxToolCalls: 6,
    requiredParams: [],
    providerTools: ["get_serp_results", "search_console_tools"],
  },
  "gsc-diagnosis": {
    id: "gsc-diagnosis",
    name: "GSC Diagnosis",
    description: "流量下降诊断：区分 impressions/CTR/position/clicks 哪个维度出了问题（决定 rule）。",
    triggers: ["流量", "traffic", "clicks", "曝光", "impressions", "ctr", "为什么跌", "traffic drop"],
    maxToolCalls: 4,
    requiredParams: [],
    providerTools: ["search_console_tools"],
  },
  "ai-search-visibility": {
    id: "ai-search-visibility",
    name: "AI Search Visibility",
    description: "品牌在 AI 搜索（ChatGPT / Google AI Overview）中的提及、引用与 AI SOV。",
    triggers: ["ai 搜索", "ai search", "chatgpt", "perplexity", "geo", "ai visibility", "ai 提及", "ai 引用"],
    maxToolCalls: 2,
    requiredParams: [],
    providerTools: ["ai_search_brand_lookup"],
  },
};

export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];
