// ===== /api/content/check =====
// 真实抓取页面 + 解析 + 内容分析，不消耗 SerpApi 额度

import { NextResponse } from "next/server";
import { fetchPage, parsePage, detectIssues, keywordAnalysis, normalizeUrl, CrawlError } from "@/lib/crawl";
import {
  addContentCheck,
  listContentChecksFull,
  getPreviousContentCheck,
  updateContentCheckComparison,
  type ContentCheckFull,
} from "@/lib/db";
import { analyzeContent, type ContentAnalysisResult } from "@/lib/seo/content-analyzer";
import { compareContentChecks, type ContentHistoryComparison } from "@/lib/seo/content-history";
import { requireAuthOrDemo } from "@/lib/auth";
import { requireQuota, QuotaExceededError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface CheckResponse {
  url: string;
  finalUrl: string;
  keyword: string;
  score: number;
  wordCount: number;
  density: number;
  checks: ReturnType<typeof detectIssues>;
  keywordAnalysis: ReturnType<typeof keywordAnalysis>;
  responseTimeMs: number;
  analysis: ContentAnalysisResult;
  comparison: ContentHistoryComparison | null;
  historyId: number | null;
}

function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,，\n]/)
      .map((k) => k.trim())
      .filter(Boolean);
  }
  return [];
}

function buildComparison(
  current: ContentAnalysisResult,
  checkedAt: string,
  prev: ContentCheckFull | null
): ContentHistoryComparison | null {
  if (!prev) return null;
  const prevAnalysis = parsePrevAnalysis(prev);
  return compareContentChecks(
    {
      contentScore: current.contentScore,
      wordCount: current.wordCount,
      readabilityScore: current.readabilityScore,
      titleSuggestions: current.titleSuggestions,
      checkedAt,
    },
    prevAnalysis
      ? {
          contentScore: prevAnalysis.contentScore,
          wordCount: prevAnalysis.wordCount,
          readabilityScore: prevAnalysis.readabilityScore,
          titleSuggestions: prevAnalysis.titleSuggestions,
          checkedAt: prev.created_at,
        }
      : null
  );
}

function parsePrevAnalysis(prev: ContentCheckFull): ContentAnalysisResult | null {
  if (!prev.title_suggestions || !prev.keyword_density) return null;
  try {
    const titleSuggestions = JSON.parse(prev.title_suggestions) as string[];
    const keywordDensity = JSON.parse(prev.keyword_density) as ContentAnalysisResult["keywordDensity"];
    const headingStructure = prev.heading_structure ? JSON.parse(prev.heading_structure) as ContentAnalysisResult["headingStructure"] : [];
    const topKeywords = prev.top_keywords ? JSON.parse(prev.top_keywords) as ContentAnalysisResult["topKeywords"] : [];
    return {
      wordCount: prev.word_count_full ?? prev.word_count,
      readabilityScore: prev.readability_score ?? 0,
      readabilityLevel: prev.readability_level ?? "中等",
      keywordDensity,
      headingStructure,
      internalLinksCount: prev.internal_links_count,
      externalLinksCount: prev.external_links_count,
      imagesCount: prev.images_count,
      imagesWithoutAlt: prev.images_without_alt,
      metaTitleLength: prev.meta_title_length ?? 0,
      metaDescriptionLength: prev.meta_description_length ?? 0,
      first100Words: prev.first_100_words ?? "",
      topKeywords,
      titleSuggestions,
      contentScore: prev.content_score ?? prev.score,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const rawUrl = String(body.url ?? "").trim();
  const keyword = String(body.keyword ?? "").trim();
  const targetKeywords = parseKeywords(body.targetKeywords ?? (keyword ? [keyword] : []));

  if (!rawUrl) {
    return NextResponse.json({ error: "URL 不能为空", code: "URL_REQUIRED" }, { status: 400 });
  }
  if (targetKeywords.length === 0) {
    return NextResponse.json({ error: "关键词不能为空", code: "KEYWORD_REQUIRED" }, { status: 400 });
  }

  const url = normalizeUrl(rawUrl);

  // P3：内容检查配额校验（content_check_monthly_limit）
  // free: 10/月, lite: 50/月, pro: 300/月（详见 billing.ts DEFAULT_PLAN_LIMITS）
  try {
    await requireQuota(userId, "content_check");
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      const { status, body } = billingErrorToResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }

  try {
    const result = await fetchPage(url);
    const pageData = parsePage(result.html, result.url);
    const checks = detectIssues(pageData);
    const kwAnalysis = keywordAnalysis(pageData, keyword || targetKeywords[0]);

    // 内容评分（通过项加权平均）
    const passedCount = checks.filter((c) => c.passed).length;
    const score = Math.round((passedCount / checks.length) * 100);

    // 深度内容分析
    const analysis = analyzeContent(result.html, result.url, targetKeywords);

    // 写入数据库
    let savedId: number | null = null;
    let comparison: ContentHistoryComparison | null = null;
    try {
      const saved = await addContentCheck(userId, {
        url: result.url,
        keyword: keyword || targetKeywords[0],
        score,
        word_count: pageData.wordCount,
        density: kwAnalysis.density,
        checks_json: JSON.stringify(checks),
        title_suggestions: JSON.stringify(analysis.titleSuggestions),
        keyword_density: JSON.stringify(analysis.keywordDensity),
        readability_score: analysis.readabilityScore,
        readability_level: analysis.readabilityLevel,
        word_count_full: analysis.wordCount,
        heading_structure: JSON.stringify(analysis.headingStructure),
        internal_links_count: analysis.internalLinksCount,
        external_links_count: analysis.externalLinksCount,
        images_count: analysis.imagesCount,
        images_without_alt: analysis.imagesWithoutAlt,
        meta_title_length: analysis.metaTitleLength,
        meta_description_length: analysis.metaDescriptionLength,
        first_100_words: analysis.first100Words,
        top_keywords: JSON.stringify(analysis.topKeywords),
        content_score: analysis.contentScore,
      });
      savedId = saved.id;

      // 生成对比
      const prev = await getPreviousContentCheck(userId, result.url, saved.id);
      comparison = buildComparison(analysis, saved.created_at, prev);
      if (comparison) {
        await updateContentCheckComparison(userId, saved.id, JSON.stringify(comparison));
      }
    } catch {
      // ignore save error
    }

    const response: CheckResponse = {
      url,
      finalUrl: result.url,
      keyword: keyword || targetKeywords[0],
      score,
      wordCount: pageData.wordCount,
      density: kwAnalysis.density,
      checks,
      keywordAnalysis: kwAnalysis,
      responseTimeMs: result.responseTimeMs,
      analysis,
      comparison,
      historyId: savedId,
    };

    return NextResponse.json({ data: response });
  } catch (e) {
    if (e instanceof CrawlError) {
      const msg =
        e.code === "TIMEOUT"
          ? `抓取超时：${e.message}`
          : e.code === "INVALID_URL"
          ? `URL 无效：${e.message}`
          : e.code === "HTTP_ERROR"
          ? `页面返回错误：${e.message}`
          : `抓取失败：${e.message}`;
      return NextResponse.json({ error: msg, code: e.code }, { status: 502 });
    }
    return NextResponse.json({ error: `服务器错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" }, { status: 500 });
  }
}

interface HistoryItem {
  id: number;
  url: string;
  keyword: string;
  score: number;
  word_count: number;
  density: number;
  created_at: string;
  content_score: number | null;
  readability_score: number | null;
  readability_level: string | null;
  comparison: string | null;
}

/** GET 查询历史（支持 ?url= 或 ?limit=） */
export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);
  const urlFilter = searchParams.get("url")?.trim() || undefined;
  const limitRaw = Number(searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 10;

  const rows = await listContentChecksFull(userId, limit, urlFilter);
  const data: HistoryItem[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    keyword: r.keyword,
    score: r.score,
    word_count: r.word_count,
    density: r.density,
    created_at: r.created_at,
    content_score: r.content_score,
    readability_score: r.readability_score,
    readability_level: r.readability_level,
    comparison: r.comparison,
  }));

  return NextResponse.json({ data });
}
