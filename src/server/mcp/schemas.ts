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
export const gscInputSchema = z.object({ projectId: z.string().min(1), operation: z.enum(["performance_summary", "top_queries", "top_pages", "compare_periods", "inspect_url"]), url: z.string().url().optional() });
export const rankHistoryInputSchema = z.object({
  projectId: z.string().min(1),
  /** 可选：按关键词文本过滤（精确匹配 tracked keyword） */
  keyword: z.string().min(1).optional(),
  /** 历史窗口天数（1-90，默认 30） */
  days: z.number().int().min(1).max(90).default(30),
  /** 返回关键词行数上限（1-100，默认 20） */
  limit: z.number().int().min(1).max(100).default(20),
});

export type ToolName = "list_projects" | "project_context" | "research_keywords" | "get_serp_results" | "get_backlinks_profile" | "search_console_tools" | "get_rank_history";
