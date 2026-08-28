import { serpApiProvider } from "./serpapi";
import { readCache, writeCache, consumeQuota, peekUsage } from "./cache";
import type { SerpResult } from "./types";
import type { PlanTier } from "@/lib/auth";

export interface SerpServiceParams {
  keyword: string;
  location: string;
  device: "PC" | "移动端";
}

export async function searchSerp(
  userId: string,
  plan: PlanTier,
  params: SerpServiceParams,
): Promise<{ result: SerpResult; fromCache: boolean }> {
  const cacheParams: Record<string, string> = { keyword: params.keyword, location: params.location, device: params.device };
  const cached = await readCache<SerpResult>("serp", cacheParams);
  if (cached) return { result: { ...cached, fromCache: true }, fromCache: true };
  await consumeQuota(userId, "serpapi", plan);
  const result = await serpApiProvider.searchSerp(params);
  try { await writeCache("serp", cacheParams, result); } catch { /* cache failure does not fail a provider result */ }
  return { result, fromCache: false };
}

export async function getSerpUsage(userId: string, plan: PlanTier) {
  return peekUsage(userId, "serpapi", plan);
}

export async function expandKeyword(
  userId: string,
  plan: PlanTier,
  params: SerpServiceParams,
) {
  const { result, fromCache } = await searchSerp(userId, plan, params);
  return {
    seed: params.keyword,
    related: result.relatedSearches.map((item) => item.query),
    paa: result.relatedQuestions.map((item) => item.question),
    location: params.location,
    device: params.device === "PC" ? "desktop" : "mobile",
    fromCache,
  };
}
