import { z } from "zod";

export const projectOutputSchema = z.object({ projectId: z.string(), projectName: z.string(), domain: z.string(), primaryLocale: z.string().nullable(), targetCountry: z.string().nullable(), trackedKeywordsCount: z.number(), competitors: z.array(z.string()), gscConnectionStatus: z.string().nullable(), latestAuditStatus: z.string().nullable(), latestRankTrackingStatus: z.string().nullable(), plan: z.string() });
export const projectListOutputSchema = z.object({ projects: z.array(z.object({ projectId: z.string(), projectName: z.string(), domain: z.string(), createdAt: z.string(), status: z.string() })) });
export const backlinkOutputSchema = z.object({ summary: z.object({ totalBacklinks: z.number().nullable(), referringDomains: z.number().nullable(), domainRank: z.number().nullable(), dofollowPct: z.number().nullable() }), rows: z.array(z.record(z.string(), z.unknown())), page: z.number(), pageSize: z.number(), totalCount: z.number(), hasMore: z.boolean(), cachedAt: z.string().nullable(), fromCache: z.boolean(), limitations: z.array(z.string()) });
export const serpOutputSchema = z.object({
  data: z.object({
    organic: z.array(z.object({ rank: z.number(), title: z.string().nullable().optional(), url: z.string().nullable().optional(), domain: z.string().nullable().optional(), snippet: z.string().nullable().optional(), featureType: z.null(), isProjectDomain: z.boolean().nullable().optional() }).passthrough()),
    features: z.array(z.object({ featureType: z.string(), position: z.number().nullable(), title: z.string().nullable(), url: z.string().nullable() })).optional(),
    summary: z.object({ organicCount: z.number(), featureCount: z.number(), featureTypes: z.array(z.string()), projectPresent: z.boolean().nullable(), projectRank: z.number().nullable(), projectRankingUrl: z.string().nullable(), topDomains: z.array(z.object({ domain: z.string(), count: z.number() })), domainFrequency: z.record(z.string(), z.number()) }).optional(),
  }),
  meta: z.object({ count: z.number(), source: z.string(), fromCache: z.boolean(), language: z.string().optional(), location: z.string().optional(), device: z.string().optional() }),
}).passthrough();
export const keywordOutputSchema = z.object({ data: z.object({ keywords: z.array(z.object({ keyword: z.string(), source: z.string() }).passthrough()) }), meta: z.object({ count: z.number(), source: z.string(), unavailableMetrics: z.array(z.string()), metricsSource: z.string().optional(), warnings: z.array(z.string()).optional() }) }).passthrough();

export const rankHistoryOutputSchema = z.object({
  data: z.object({
    domain: z.string(),
    keywords: z.array(z.object({
      keyword: z.string(),
      location: z.string(),
      device: z.string(),
      currentRank: z.number().nullable(),
      previousRank: z.number().nullable(),
      change: z.number().nullable(),
      status: z.enum(["improved", "declined", "stable", "new", "lost", "not_ranked"]),
      rankingUrl: z.string().nullable(),
      featureTypes: z.array(z.string()),
    })),
    distribution: z.object({
      trackedCount: z.number(),
      rankedCount: z.number(),
      top3Count: z.number(),
      top10Count: z.number(),
      top20Count: z.number(),
      top50Count: z.number(),
      notRankingCount: z.number(),
      averageRank: z.number().nullable(),
      medianRank: z.number().nullable(),
    }),
  }),
  meta: z.object({ count: z.number(), source: z.string(), days: z.number() }),
}).passthrough();

export const gscPerformanceOutputSchema = z.object({
  data: z.object({
    property: z.string(),
    dateRange: z.object({ start: z.string(), end: z.string() }),
    rows: z.array(z.object({ key: z.string(), clicks: z.number(), impressions: z.number(), ctr: z.number(), position: z.number() })),
    summary: z.object({ clicks: z.number(), impressions: z.number(), ctr: z.number().nullable(), position: z.number().nullable() }),
  }),
  meta: z.object({ source: z.string(), operation: z.string(), cached: z.boolean().optional(), rowCount: z.number().optional() }),
}).passthrough();
export const gscCompareOutputSchema = z.object({
  data: z.object({
    property: z.string(),
    current: z.object({ dateRange: z.object({ start: z.string(), end: z.string() }), summary: z.object({ clicks: z.number(), impressions: z.number(), ctr: z.number().nullable(), position: z.number().nullable() }) }),
    previous: z.object({ dateRange: z.object({ start: z.string(), end: z.string() }), summary: z.object({ clicks: z.number(), impressions: z.number(), ctr: z.number().nullable(), position: z.number().nullable() }) }),
  }),
  meta: z.object({ source: z.string(), operation: z.string(), cached: z.boolean().optional() }),
}).passthrough();
export const gscInspectOutputSchema = z.object({
  data: z.object({
    property: z.string(),
    url: z.string(),
    result: z.record(z.string(), z.unknown()).nullable(),
  }),
  meta: z.object({ source: z.string(), operation: z.string() }),
}).passthrough();

export const aiSearchBrandLookupOutputSchema = z.object({
  data: z.object({
    target: z.object({ type: z.enum(["brand", "domain"]), value: z.string() }),
    platforms: z.array(z.object({
      platform: z.string(),
      status: z.enum(["success", "error"]),
      totalMentions: z.number().nullable(),
      totalAiSearchVolume: z.number().nullable(),
      samplePrompts: z.array(z.object({ question: z.string().nullable(), aiSearchVolume: z.number().nullable(), brandEntities: z.array(z.string()) })),
    })),
    mentionsTotal: z.number().nullable(),
    citations: z.array(z.object({ url: z.string(), domain: z.string(), platform: z.string(), title: z.string().nullable(), sourceType: z.string() })),
    topCitedDomains: z.array(z.object({ domain: z.string(), citationCount: z.number() })),
    aiShareOfVoice: z.array(z.object({ label: z.string(), isTarget: z.boolean(), mentions: z.number().nullable(), aiSharePct: z.number().nullable() })).nullable(),
    warnings: z.array(z.string()),
    hasData: z.boolean(),
    runId: z.number().nullable(),
  }),
  meta: z.object({ source: z.string(), providerCostUsd: z.number().nullable() }),
}).passthrough();

export const competitorGapOutputSchema = z.object({
  data: z.object({
    competitor: z.object({ id: z.number(), domain: z.string(), registrableDomain: z.string() }),
    summary: z.object({ analyzedKeywords: z.number(), shared: z.number(), weaklyOwned: z.number(), competitorOnly: z.number(), projectOnly: z.number() }),
    keywords: z.array(z.object({
      keyword: z.string(), location: z.string(), device: z.string(),
      projectRank: z.number().nullable(), competitorRank: z.number().nullable(),
      rankGap: z.number().nullable(),
      category: z.enum(["shared", "weaklyOwned", "competitorOnly", "projectOnly"]),
      searchVolume: z.number().nullable(), difficulty: z.number().nullable(), cpc: z.number().nullable(), competition: z.number().nullable(),
    })),
    warnings: z.array(z.string()),
  }),
  meta: z.object({ count: z.number(), source: z.string() }),
}).passthrough();

export const seoOpportunityOutputSchema = z.object({
  data: z.object({
    opportunities: z.array(z.object({
      id: z.number(),
      type: z.string(),
      targetType: z.string(),
      targetValue: z.string(),
      priority: z.enum(["P0", "P1", "P2"]),
      impact: z.string().nullable(),
      confidence: z.string().nullable(),
      status: z.string(),
      recommendation: z.string().nullable(),
      evidence: z.array(z.object({ source: z.string(), ref: z.string(), summary: z.string() })),
      actionSteps: z.array(z.string()).nullable(),
      generatedAt: z.string(),
    })),
  }),
  meta: z.object({ count: z.number(), source: z.string() }),
}).passthrough();

export const actionPlanOutputSchema = z.object({
  data: z.object({
    opportunity: z.object({ id: z.number(), type: z.string(), targetValue: z.string(), status: z.string() }),
    action: z.object({
      id: z.number(),
      actionType: z.string(),
      executionMode: z.string(),
      status: z.string(),
      approvedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
    }),
    preview: z.object({
      kind: z.string(),
      target: z.string(),
      currentState: z.array(z.string()),
      exactSteps: z.array(z.string()),
      expectedResult: z.string(),
      verificationPlan: z.array(z.string()),
      rollbackNotes: z.string(),
    }),
    note: z.string(),
  }),
  meta: z.object({ source: z.string() }),
}).passthrough();

export const actionPreviewOutputSchema = z.object({
  data: z.object({
    opportunityId: z.number(),
    executionMode: z.string(),
    status: z.string(),
    preview: z.record(z.string(), z.unknown()),
    note: z.string(),
  }),
  meta: z.object({ source: z.string() }),
}).passthrough();
export const actionStatusOutputSchema = z.object({
  data: z.object({
    opportunityId: z.number(),
    stage: z.string(),
    repository: z.string().nullable(),
    branch: z.string().nullable(),
    prNumber: z.number().nullable(),
    prUrl: z.string().nullable(),
    verification: z.array(z.object({ check: z.string(), status: z.string(), detail: z.string().nullable() })),
    note: z.string(),
  }),
  meta: z.object({ source: z.string() }),
}).passthrough();

export function validateOutput<T>(schema: z.ZodType<T>, value: T): T { return schema.parse(value); }
