import { getSerpUsage, searchSerp, summarizeSerp } from "@/lib/seo/serp-service";
import { researchKeywords, normalizeKeywordForDedup } from "@/lib/seo/keyword-research-service";
import { getProjectRankSummary } from "@/lib/seo/rank-tracking-service";
import { aiBrandLookup } from "@/lib/seo/ai-search-service";
import { getCompetitorKeywordGap } from "@/lib/seo/competitor-service";
import { getCompetitorById, listTrackedKeywords } from "@/lib/db";
import { listOpportunities } from "@/lib/db/opportunities";
import { inspectUrl, searchAnalytics } from "@/lib/seo/gsc-service";
import { peekUsage } from "@/lib/seo/cache";
import { getBacklinkProfile, normalizeBacklinkDomain } from "@/lib/seo/backlink-service";
import { authorizeProject, listAuthorizedProjects, projectContext } from "../project-auth";
import { aiSearchInputSchema, backlinkInputSchema, competitorGapInputSchema, gscInputSchema, keywordInputSchema, projectIdSchema, rankHistoryInputSchema, seoOpportunityInputSchema, serpInputSchema, type ToolName } from "../schemas";
import { McpNormalizedError } from "../errors";
import type { ToolAuthContext } from "../context";
import { validateOutput, aiSearchBrandLookupOutputSchema, backlinkOutputSchema, competitorGapOutputSchema, seoOpportunityOutputSchema, gscCompareOutputSchema, gscInspectOutputSchema, gscPerformanceOutputSchema, keywordOutputSchema, projectListOutputSchema, projectOutputSchema, rankHistoryOutputSchema, serpOutputSchema } from "../output-schemas";

/** GSC 数据滞后 2-3 天；compare_periods 默认窗口的结束日扣除滞后 */
function gscTodayMinusLag(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
}
function gscDaysBefore(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export type { ToolName };

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
  { name: "ai_search_brand_lookup", description: "AI Search (GEO) brand lookup via DataForSEO AI Optimization: how often a brand/domain is mentioned by ChatGPT and Google AI Overview, which pages get cited, and AI Share of Voice versus competitors. Persists a run record for history/trend (SeeO-specific). ChatGPT mentions data is US/en only per the provider — other locales degrade with an explicit warning. Consumes DataForSEO quota per platform batch.", inputSchema: { type: "object", properties: { ...projectProperty, target: { type: "string", description: "Brand name or domain (no https://, no www.)." }, competitors: { type: "array", items: stringProperty, maxItems: 9 }, locationCode: { type: "integer" }, languageCode: stringProperty }, required: ["projectId", "target"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = aiSearchInputSchema.parse(input); const project = await authorizeProject(ctx, parsed.projectId);
    const result = await aiBrandLookup({
      userId: ctx.userId, plan: ctx.plan, projectId: project.sqliteId,
      target: parsed.target,
      ...(parsed.competitors ? { competitors: parsed.competitors } : {}),
      ...(parsed.locationCode !== undefined ? { locationCode: parsed.locationCode } : {}),
      ...(parsed.languageCode ? { languageCode: parsed.languageCode } : {}),
    });
    return validateOutput(aiSearchBrandLookupOutputSchema, { data: { target: result.target, platforms: result.platforms.map((bundle) => ({ platform: bundle.platform, status: bundle.status, totalMentions: bundle.totalMentions, totalAiSearchVolume: bundle.totalAiSearchVolume, samplePrompts: bundle.mentions.filter((mention) => mention.question).slice(0, 5).map((mention) => ({ question: mention.question, aiSearchVolume: mention.aiSearchVolume, brandEntities: mention.brandEntities })) })), mentionsTotal: result.mentionsTotal, citations: result.citations.slice(0, 25), topCitedDomains: result.topCitedDomains, aiShareOfVoice: result.aiShareOfVoice, warnings: result.warnings, hasData: result.hasData, runId: result.runId }, meta: { source: "dataforseo-ai-optimization", providerCostUsd: result.providerCostUsd } });
  } },
  { name: "get_competitor_keyword_gap", description: "Keyword gap between the project and one saved competitor over the project's tracked keywords: shared / weaklyOwned / competitorOnly / projectOnly categories, rank gaps, and DataForSEO metrics (volume/difficulty/CPC/competition). Universe is the project's tracked keyword set. Set refresh=true to re-check ranks via the SERP cache (may consume SerpApi quota); enrich=false skips DataForSEO metrics.", inputSchema: { type: "object", properties: { ...projectProperty, competitorId: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 200 }, refresh: { type: "boolean" }, enrich: { type: "boolean" } }, required: ["projectId", "competitorId"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = competitorGapInputSchema.parse(input); const project = await authorizeProject(ctx, parsed.projectId);
    // competitor 必须属于该项目（禁止跨项目访问竞品数据）
    const competitor = await getCompetitorById(ctx.userId, parsed.competitorId);
    if (!competitor || competitor.project_id !== project.sqliteId) throw new McpNormalizedError("PROJECT_ACCESS_DENIED", "The competitor does not belong to this project.");
    const allTracked = await listTrackedKeywords(ctx.userId);
    const tracked = allTracked.filter((kw) => kw.domain === project.domain).map((kw) => ({ id: kw.id, keyword: kw.keyword, location: kw.location, device: kw.device, todayPosition: kw.todayPosition, todayUrl: kw.matchedUrl ?? null }));
    const gap = await getCompetitorKeywordGap({
      userId: ctx.userId, plan: ctx.plan, projectDomain: project.domain, trackedKeywords: tracked,
      competitorId: parsed.competitorId, competitorDomain: competitor.domain,
      limit: parsed.limit, refresh: parsed.refresh, enrichMetrics: parsed.enrich,
    });
    return validateOutput(competitorGapOutputSchema, { data: { competitor: gap.competitor, summary: gap.summary, keywords: gap.keywords.map(({ keyword, location, device, projectRank, competitorRank, rankGap, category, searchVolume, difficulty, cpc, competition }) => ({ keyword, location, device, projectRank, competitorRank, rankGap, category, searchVolume, difficulty, cpc, competition })), warnings: gap.warnings }, meta: { count: gap.keywords.length, source: "db+serpapi+dataforseo" } });
  } },
  { name: "get_seo_opportunities", description: "Read SeeO's Opportunity Engine output for a project: prioritized (P0-P2), evidence-backed SEO opportunities (rank improvement, competitor gap, CTR, content refresh, lost-ranking recovery, AI visibility, technical) with recommended action plans. Each opportunity carries evidence references; run SeeO's scan to refresh. Free (DB read).", inputSchema: { type: "object", properties: { ...projectProperty, status: { type: "string", enum: ["new", "reviewed", "approved", "in_progress", "completed", "dismissed"] }, type: { type: "string", enum: ["rank_improvement", "competitor_gap", "ctr", "content_refresh", "lost_recovery", "ai_visibility", "technical"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["projectId"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = seoOpportunityInputSchema.parse(input); await authorizeProject(ctx, parsed.projectId);
    const rows = await listOpportunities(ctx.userId, { project_id: Number(parsed.projectId), ...(parsed.status ? { status: parsed.status } : {}), ...(parsed.type ? { type: parsed.type } : {}), limit: parsed.limit });
    const opportunities = rows.map((row) => {
      let evidence: Array<{ source: string; ref: string; summary: string }> = [];
      let signals: Record<string, unknown> = {};
      let actionPlan: { steps?: string[] } | undefined = undefined;
      try { evidence = JSON.parse(row.evidence_json) as typeof evidence; } catch { /* ignore */ }
      try { signals = JSON.parse(row.signals_json) as Record<string, unknown>; } catch { /* ignore */ }
      try { actionPlan = row.action_plan_json ? JSON.parse(row.action_plan_json) as { steps?: string[] } : undefined; } catch { /* ignore */ }
      return {
        id: row.id, type: row.type, targetType: row.target_type, targetValue: row.target_value,
        priority: row.priority, impact: row.impact, confidence: row.confidence, status: row.status,
        recommendation: typeof signals.recommendation === "string" ? signals.recommendation : null,
        evidence: evidence.map(({ source, ref, summary }) => ({ source, ref, summary })),
        actionSteps: actionPlan?.steps ?? null,
        generatedAt: row.generated_at,
      };
    });
    return validateOutput(seoOpportunityOutputSchema, { data: { opportunities }, meta: { count: opportunities.length, source: "db" } });
  } },
  { name: "search_console_tools", description: "First-party Google Search Console data for a project's connected property. Operations: performance_summary (daily rows + totals), top_queries, top_pages, compare_periods (range vs previous equal-length range), inspect_url (URL Inspection; requires url). Requires the project to be connected to a Search Console property in SeeO; CTR is a 0-1 fraction and position is a float average (distinct from SERP rank). Reads the free GSC API — no SeeO credits consumed.", inputSchema: { type: "object", properties: { ...projectProperty, operation: { type: "string", enum: ["performance_summary", "top_queries", "top_pages", "compare_periods", "inspect_url"] }, url: { type: "string", format: "uri" }, startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, rowLimit: { type: "integer", minimum: 1, maximum: 1000 }, keyword: stringProperty, page: stringProperty }, required: ["projectId", "operation"], additionalProperties: false }, execute: async (ctx, input) => {
    const parsed = gscInputSchema.parse(input); const project = await authorizeProject(ctx, parsed.projectId);
    const perfInput = {
      userId: ctx.userId, projectId: project.sqliteId,
      ...(parsed.startDate ? { startDate: parsed.startDate } : {}),
      ...(parsed.endDate ? { endDate: parsed.endDate } : {}),
      ...(parsed.rowLimit ? { rowLimit: parsed.rowLimit } : {}),
      ...(parsed.keyword ? { filters: [{ dimension: "query", operator: "equals", expression: parsed.keyword }] } : {}),
      ...(parsed.page && !parsed.keyword ? { filters: [{ dimension: "page", operator: "equals", expression: parsed.page }] } : {}),
    };
    if (parsed.operation === "inspect_url") {
      if (!parsed.url) throw new McpNormalizedError("BAD_REQUEST", "inspect_url requires the url argument.");
      const inspection = await inspectUrl({ userId: ctx.userId, projectId: project.sqliteId, url: parsed.url });
      return validateOutput(gscInspectOutputSchema, { data: { property: inspection.propertyUrl, url: parsed.url, result: inspection.result as Record<string, unknown> | null }, meta: { source: "google-search-console", operation: parsed.operation } });
    }
    if (parsed.operation === "compare_periods") {
      const end = parsed.endDate ?? gscTodayMinusLag();
      const start = parsed.startDate ?? gscDaysBefore(end, 28);
      const span = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000));
      const [current, previous] = await Promise.all([
        searchAnalytics({ ...perfInput, projectId: project.sqliteId, dimensions: ["query"], startDate: start, endDate: end }),
        searchAnalytics({ ...perfInput, projectId: project.sqliteId, dimensions: ["query"], startDate: gscDaysBefore(start, span + 1), endDate: gscDaysBefore(start, 1) }),
      ]);
      return validateOutput(gscCompareOutputSchema, { data: { property: current.propertyUrl, current: { dateRange: current.dateRange, summary: current.summary }, previous: { dateRange: previous.dateRange, summary: previous.summary } }, meta: { source: "google-search-console", operation: parsed.operation, cached: current.fromCache && previous.fromCache } });
    }
    const dimensionByOperation = { performance_summary: ["date"], top_queries: ["query"], top_pages: ["page"] } as const;
    const performance = await searchAnalytics({ ...perfInput, projectId: project.sqliteId, dimensions: [...dimensionByOperation[parsed.operation]] });
    return validateOutput(gscPerformanceOutputSchema, { data: { property: performance.propertyUrl, dateRange: performance.dateRange, rows: performance.rows.slice(0, 50).map((row) => ({ key: row.keys.join(" / "), clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })), summary: performance.summary }, meta: { source: "google-search-console", operation: parsed.operation, cached: performance.fromCache, rowCount: performance.rows.length } });
  } },
];

export function getRegisteredTools() { return tools; }
