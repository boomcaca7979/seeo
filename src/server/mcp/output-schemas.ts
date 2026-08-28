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

export function validateOutput<T>(schema: z.ZodType<T>, value: T): T { return schema.parse(value); }
