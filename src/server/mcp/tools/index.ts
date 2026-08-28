import { getSerpUsage, expandKeyword, searchSerp } from "@/lib/seo/serp-service";
import { getBacklinkProfile, normalizeBacklinkDomain } from "@/lib/seo/backlink-service";
import { authorizeProject, listAuthorizedProjects, projectContext } from "../project-auth";
import { backlinkInputSchema, gscInputSchema, keywordInputSchema, projectIdSchema, serpInputSchema, type ToolName } from "../schemas";
import { McpNormalizedError } from "../errors";
import type { ToolAuthContext } from "../context";
import { validateOutput, backlinkOutputSchema, keywordOutputSchema, projectListOutputSchema, projectOutputSchema, serpOutputSchema } from "../output-schemas";

export interface RegisteredTool { name: ToolName; description: string; inputSchema: Record<string, unknown>; execute: (ctx: ToolAuthContext, input: unknown) => Promise<unknown>; }

const stringProperty = { type: "string" };
const projectProperty = { projectId: stringProperty };
const tools: RegisteredTool[] = [
  { name: "list_projects", description: "List projects accessible to the authenticated SeeO caller.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, execute: async (ctx, input) => { if (input !== undefined && (typeof input !== "object" || input === null || Object.keys(input as object).length > 0)) throw new McpNormalizedError("BAD_REQUEST", "list_projects does not accept arguments."); return validateOutput(projectListOutputSchema, { projects: await listAuthorizedProjects(ctx) }); } },
  { name: "project_context", description: "Get the verified context and available SEO metadata for a SeeO project.", inputSchema: { type: "object", properties: projectProperty, required: ["projectId"], additionalProperties: false }, execute: async (ctx, input) => validateOutput(projectOutputSchema, await projectContext(ctx, projectIdSchema.parse(input).projectId)) },
  { name: "research_keywords", description: "Expand seed keywords using SeeO's existing SerpApi related-search and PAA capability. Volume and difficulty are unavailable in the current provider.", inputSchema: { type: "object", properties: { ...projectProperty, seedKeywords: { type: "array", items: stringProperty, minItems: 1, maxItems: 20 }, location: stringProperty, language: stringProperty, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["projectId", "seedKeywords"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = keywordInputSchema.parse(input); await authorizeProject(ctx, parsed.projectId);
    const items = await Promise.all(parsed.seedKeywords.map(async (seed) => expandKeyword(ctx.userId, ctx.plan, { keyword: seed, location: parsed.location, device: "PC" })));
    const keywords = items.flatMap((item) => [...item.related, ...item.paa].slice(0, parsed.limit).map((keyword) => ({ keyword, searchVolume: null, difficulty: null, cpc: null, competition: null, intent: null, trend: null, source: "serpapi", seed: item.seed })));
    return validateOutput(keywordOutputSchema, { data: { keywords: keywords.slice(0, parsed.limit) }, meta: { count: Math.min(keywords.length, parsed.limit), source: "serpapi", unavailableMetrics: ["searchVolume", "difficulty", "cpc", "competition", "intent", "trend"] }, usage: await getSerpUsage(ctx.userId, ctx.plan) });
  } },
  { name: "get_serp_results", description: "Get structured organic SERP results through SeeO's SerpApi service.", inputSchema: { type: "object", properties: { ...projectProperty, keyword: stringProperty, location: stringProperty, language: stringProperty, device: { type: "string", enum: ["PC", "移动端"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["projectId", "keyword"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = serpInputSchema.parse(input); await authorizeProject(ctx, parsed.projectId); const { result } = await searchSerp(ctx.userId, ctx.plan, parsed); return validateOutput(serpOutputSchema, { data: { ...result, organic: result.organic.slice(0, parsed.limit).map((row) => ({ rank: row.position, title: row.title, url: row.link, domain: row.domain, snippet: row.snippet, featureType: null })) }, meta: { count: Math.min(result.organic.length, parsed.limit), source: "serpapi", fromCache: result.fromCache === true }, usage: await getSerpUsage(ctx.userId, ctx.plan) });
  } },
  { name: "get_backlinks_profile", description: "Read a bounded, filterable, paginated SeeO backlink profile.", inputSchema: { type: "object", properties: { ...projectProperty, domain: stringProperty, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, sort: { type: "string", enum: ["sourceRankDesc", "sourceRankAsc", "firstSeenDesc", "firstSeenAsc"] }, filters: { type: "object" }, onePerDomain: { type: "boolean" }, asIs: { type: "boolean" } }, required: ["projectId"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = backlinkInputSchema.parse(input); const project = await authorizeProject(ctx, parsed.projectId); const domain = normalizeBacklinkDomain(parsed.domain ?? project.domain); if (!domain) throw new McpNormalizedError("BAD_REQUEST", "domain is invalid.");
    return validateOutput(backlinkOutputSchema, await getBacklinkProfile(ctx.userId, ctx.plan, domain, { page: parsed.page, pageSize: parsed.pageSize, sort: parsed.sort, ...parsed.filters, onePerDomain: parsed.onePerDomain }));
  } },
  { name: "search_console_tools", description: "Expose SeeO Search Console operations. SeeO does not have a GSC integration configured yet.", inputSchema: { type: "object", properties: { ...projectProperty, operation: { type: "string", enum: ["performance_summary", "top_queries", "top_pages", "compare_periods", "inspect_url"] }, url: { type: "string", format: "uri" } }, required: ["projectId", "operation"], additionalProperties: false }, execute: async (ctx, input) => { const parsed = gscInputSchema.parse(input); await authorizeProject(ctx, parsed.projectId); throw new McpNormalizedError("NOT_CONFIGURED", `Search Console operation '${parsed.operation}' is not configured in SeeO.`); } },
];

export function getRegisteredTools() { return tools; }
