import { z } from "zod";

export const projectIdSchema = z.object({ projectId: z.string().min(1) });
export const serpInputSchema = z.object({
  projectId: z.string().min(1), keyword: z.string().min(1), location: z.string().min(1).default("中国"),
  language: z.string().min(1).optional(), device: z.enum(["PC", "移动端"]).default("PC"), limit: z.number().int().min(1).max(100).default(10),
});
export const keywordInputSchema = z.object({
  projectId: z.string().min(1), seedKeywords: z.array(z.string().min(1)).min(1).max(20),
  location: z.string().min(1).default("中国"), language: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).default(20),
});
export const backlinkInputSchema = z.object({
  projectId: z.string().min(1), domain: z.string().min(1).optional(), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(25),
  sort: z.enum(["sourceRankDesc", "sourceRankAsc", "firstSeenDesc", "firstSeenAsc"]).default("sourceRankDesc"),
  filters: z.object({ sourceUrl: z.string().optional(), targetUrl: z.string().optional(), anchor: z.string().optional(), dofollow: z.boolean().optional() }).default({}),
  onePerDomain: z.boolean().default(false), asIs: z.boolean().default(false),
});
export const gscInputSchema = z.object({
  projectId: z.string().min(1),
  operation: z.enum(["performance_summary", "top_queries", "top_pages", "compare_periods", "inspect_url"]),
  url: z.string().url().optional(),
  /** Search Analytics 日期（YYYY-MM-DD）；compare_periods 默认最近 28 天 */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** 行数上限（1-1000，默认 25；GSC API 上限内由 service 再收紧） */
  rowLimit: z.number().int().min(1).max(1000).optional(),
  /** 维度过滤：query/page 精确匹配（top_queries/top_pages 用） */
  keyword: z.string().min(1).optional(),
  page: z.string().min(1).optional(),
});
export const rankHistoryInputSchema = z.object({
  projectId: z.string().min(1),
  /** 可选：按关键词文本过滤（精确匹配 tracked keyword） */
  keyword: z.string().min(1).optional(),
  /** 历史窗口天数（1-90，默认 30） */
  days: z.number().int().min(1).max(90).default(30),
  /** 返回关键词行数上限（1-100，默认 20） */
  limit: z.number().int().min(1).max(100).default(20),
});

export const aiSearchInputSchema = z.object({
  projectId: z.string().min(1),
  /** 品牌名或域名（自动检测；域名不含 https:// 和 www.） */
  target: z.string().min(1).max(250),
  /** 竞品（品牌名或域名），最多 9 个 */
  competitors: z.array(z.string().min(1).max(250)).max(9).optional(),
  /** DataForSEO location_code（默认 2840 US；chat_gpt mentions 库仅 US/en，会显式降级并给出 warning） */
  locationCode: z.number().int().optional(),
  languageCode: z.string().min(1).optional(),
});

export const competitorGapInputSchema = z.object({
  projectId: z.string().min(1),
  competitorId: z.number().int().min(1),
  limit: z.number().int().min(1).max(200).default(50),
  /** 触发竞品排名刷新（searchRank 缓存优先；可能消耗 serpapi 配额） */
  refresh: z.boolean().default(false),
  enrich: z.boolean().default(true),
});

export const seoOpportunityInputSchema = z.object({
  projectId: z.string().min(1),
  status: z.enum(["new", "reviewed", "approved", "in_progress", "completed", "dismissed"]).optional(),
  type: z.enum(["rank_improvement", "competitor_gap", "ctr", "content_refresh", "lost_recovery", "ai_visibility", "technical"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const actionPlanInputSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.number().int().min(1),
  /** 重新生成 preview（确定性，幂等） */
  refreshPreview: z.boolean().default(false),
});

export type ToolName = "list_projects" | "project_context" | "research_keywords" | "get_serp_results" | "get_backlinks_profile" | "search_console_tools" | "get_rank_history" | "ai_search_brand_lookup" | "get_competitor_keyword_gap" | "get_seo_opportunities" | "get_action_plan";
