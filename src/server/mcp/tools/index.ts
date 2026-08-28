import { getSerpUsage, searchSerp, summarizeSerp } from "@/lib/seo/serp-service";
import { researchKeywords, normalizeKeywordForDedup } from "@/lib/seo/keyword-research-service";
import { getProjectRankSummary } from "@/lib/seo/rank-tracking-service";
import { peekUsage } from "@/lib/seo/cache";
import { getBacklinkProfile, normalizeBacklinkDomain } from "@/lib/seo/backlink-service";
import { authorizeProject, listAuthorizedProjects, projectContext } from "../project-auth";
import { backlinkInputSchema, gscInputSchema, keywordInputSchema, projectIdSchema, rankHistoryInputSchema, serpInputSchema, type ToolName } from "../schemas";
import { McpNormalizedError } from "../errors";
import type { ToolAuthContext } from "../context";
import { validateOutput, backlinkOutputSchema, keywordOutputSchema, projectListOutputSchema, projectOutputSchema, rankHistoryOutputSchema, serpOutputSchema } from "../output-schemas";

export interface RegisteredTool { name: ToolName; description: string; inputSchema: Record<string, unknown>; execute: (ctx: ToolAuthContext, input: unknown) => Promise<unknown>; }

const stringProperty = { type: "string" };
const projectProperty = { projectId: stringProperty };
const tools: RegisteredTool[] = [
  { name: "list_projects", description: "List projects accessible to the authenticated SeeO caller.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, execute: async (ctx, input) => { if (input !== undefined && (typeof input !== "object" || input === null || Object.keys(input as object).length > 0)) throw new McpNormalizedError("BAD_REQUEST", "list_projects does not accept arguments."); return validateOutput(projectListOutputSchema, { projects: await listAuthorizedProjects(ctx) }); } },
  { name: "project_context", description: "Get the verified context and available SEO metadata for a SeeO project.", inputSchema: { type: "object", properties: projectProperty, required: ["projectId"], additionalProperties: false }, execute: async (ctx, input) => validateOutput(projectOutputSchema, await projectContext(ctx, projectIdSchema.parse(input).projectId)) },
  { name: "research_keywords", description: "Research seed keywords via SeeO's Keyword Research Service: SerpApi related-search/PAA expansion enriched with real DataForSEO metrics (search volume, difficulty, CPC, competition, trend) where available. Metrics not covered by the provider for the request are returned as null and listed in meta.unavailableMetrics.", inputSchema: { type: "object", properties: { ...projectProperty, seedKeywords: { type: "array", items: stringProperty, minItems: 1, maxItems: 20 }, location: stringProperty, language: stringProperty, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["projectId", "seedKeywords"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = keywordInputSchema.parse(input); await authorizeProject(ctx, parsed.projectId);
    const results = await Promise.all(parsed.seedKeywords.map(async (seed) => researchKeywords(ctx.userId, ctx.plan, { keyword: seed, location: parsed.location, device: "PC", limit: 100, language: parsed.language, enrichMetrics: true })));
    const seen = new Set<string>();
    const keywords: { keyword: string; searchVolume: number | null; difficulty: number | null; cpc: number | null; competition: number | null; competitionLevel: string | null; intent: string | null; trend: { year: number; month: number; searchVolume: number }[] | null; source: string; seed: string }[] = [];
    for (const result of results) {
      for (const item of result.keywords) {
        if (keywords.length >= parsed.limit) break;
        const key = normalizeKeywordForDedup(item.keyword);
        if (seen.has(key)) continue;
        seen.add(key);
        keywords.push({ keyword: item.keyword, searchVolume: item.searchVolume, difficulty: item.difficulty, cpc: item.cpc, competition: item.competition, competitionLevel: item.competitionLevel, intent: item.intent, trend: item.trend, source: item.source, seed: item.seed });
      }
    }
    const metricFields = ["searchVolume", "difficulty", "cpc", "competition", "intent", "trend"] as const;
    const unavailableMetrics = metricFields.filter((field) => keywords.every((row) => row[field] === null));
    const metricsSource = results.some((result) => result.metrics.source === "dataforseo") ? "dataforseo" : "serpapi";
    return validateOutput(keywordOutputSchema, { data: { keywords }, meta: { count: keywords.length, source: "serpapi", metricsSource, unavailableMetrics: [...unavailableMetrics], warnings: [...new Set(results.flatMap((result) => result.metrics.warnings))] }, usage: { serp: await getSerpUsage(ctx.userId, ctx.plan), dataforseo: await peekUsage(ctx.userId, "dataforseo", ctx.plan) } });
  } },
  { name: "get_serp_results", description: "Get structured Google SERP results through SeeO's SerpApi service: organic results with domain extraction, real SERP feature blocks, domain frequency, and the project's own ranking presence. The optional language (SerpApi hl code, e.g. zh-cn / en / ja) refines the market; location and device are distinct cache dimensions.", inputSchema: { type: "object", properties: { ...projectProperty, keyword: stringProperty, location: stringProperty, language: stringProperty, device: { type: "string", enum: ["PC", "移动端"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["projectId", "keyword"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = serpInputSchema.parse(input); const project = await authorizeProject(ctx, parsed.projectId);
    const { result } = await searchSerp(ctx.userId, ctx.plan, { keyword: parsed.keyword, location: parsed.location, device: parsed.device, ...(parsed.language ? { language: parsed.language } : {}) });
    const summary = summarizeSerp(result, project?.domain ?? null);
    const target = (project?.domain ?? "").toLowerCase().replace(/^www\./, "");
    return validateOutput(serpOutputSchema, { data: { ...result, organic: result.organic.slice(0, parsed.limit).map((row) => ({ rank: row.position, title: row.title, url: row.link, domain: row.domain, snippet: row.snippet, featureType: null, isProjectDomain: target ? row.domain.toLowerCase() === target || row.domain.toLowerCase().endsWith(`.${target}`) : null })), summary }, meta: { count: Math.min(result.organic.length, parsed.limit), source: "serpapi", fromCache: result.fromCache === true, language: result.language, location: result.location, device: result.device === "PC" ? "desktop" : "mobile" } });
  } },
  { name: "get_backlinks_profile", description: "Read a bounded, filterable, paginated SeeO backlink profile.", inputSchema: { type: "object", properties: { ...projectProperty, domain: stringProperty, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, sort: { type: "string", enum: ["sourceRankDesc", "sourceRankAsc", "firstSeenDesc", "firstSeenAsc"] }, filters: { type: "object" }, onePerDomain: { type: "boolean" }, asIs: { type: "boolean" } }, required: ["projectId"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = backlinkInputSchema.parse(input); const project = await authorizeProject(ctx, parsed.projectId); const domain = normalizeBacklinkDomain(parsed.domain ?? project.domain); if (!domain) throw new McpNormalizedError("BAD_REQUEST", "domain is invalid.");
    return validateOutput(backlinkOutputSchema, await getBacklinkProfile(ctx.userId, ctx.plan, domain, { page: parsed.page, pageSize: parsed.pageSize, sort: parsed.sort, ...parsed.filters, onePerDomain: parsed.onePerDomain }));
  } },
  { name: "get_rank_history", description: "Read SeeO rank tracking data for a project: current rank, previous rank, rank change (positive = improved), status (improved/declined/stable/new/lost), ranking URL and captured SERP feature types per tracked keyword, plus project-level rank distribution. Reads stored history only — no provider cost; trigger a refresh in SeeO for fresh data. Rank series are isolated per keyword+location+device.", inputSchema: { type: "object", properties: { ...projectProperty, keyword: { type: "string", description: "Optional exact keyword filter." }, days: { type: "integer", minimum: 1, maximum: 90 }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["projectId"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = rankHistoryInputSchema.parse(input); const project = await authorizeProject(ctx, parsed.projectId);
    const summary = await getProjectRankSummary(ctx.userId, project.domain, parsed.days);
    const filtered = parsed.keyword
      ? summary.keywords.filter((row) => normalizeKeywordForDedup(row.keyword) === normalizeKeywordForDedup(parsed.keyword!))
      : summary.keywords;
    const keywords = filtered.slice(0, parsed.limit);
    return validateOutput(rankHistoryOutputSchema, { data: { domain: summary.domain, keywords, distribution: summary.distribution }, meta: { count: keywords.length, source: "db", days: parsed.days } });
  } },
  { name: "search_console_tools", description: "Expose SeeO Search Console operations. SeeO does not have a GSC integration configured yet.", inputSchema: { type: "object", properties: { ...projectProperty, operation: { type: "string", enum: ["performance_summary", "top_queries", "top_pages", "compare_periods", "inspect_url"] }, url: { type: "string", format: "uri" } }, required: ["projectId", "operation"], additionalProperties: false }, execute: async (ctx, input) => { const parsed = gscInputSchema.parse(input); await authorizeProject(ctx, parsed.projectId); throw new McpNormalizedError("NOT_CONFIGURED", `Search Console operation '${parsed.operation}' is not configured in SeeO.`); } },
];

export function getRegisteredTools() { return tools; }
