// ===== /api/keywords/researches =====
// 保存的关键词研究成果（P8）：GET 列表（不含 payload）、POST 保存一次「分析」快照。
// 纯本地持久化：不消耗任何 SerpApi 额度；保存/读取不触发任何供应商请求。

import { NextResponse } from "next/server";
import { listKeywordResearches, saveKeywordResearch } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";
import type { SeoApiError } from "@/lib/seo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** payload 上限：一次分析快照（≤200 发现词 + 第一页 organic + PAA/方向/趋势来源）远小于此值 */
const MAX_PAYLOAD_BYTES = 2_000_000;

/** 与页面统一发现表同一套归一口径：跨来源去重后的词数（诚实计数，不等于各列表长度之和） */
function normalizeKeyword(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function collectKeywords(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  const pushAll = (value: unknown) => {
    if (Array.isArray(value)) for (const item of value) out.push(normalizeKeyword(item));
  };
  const expand = (payload.expandData ?? {}) as Record<string, unknown>;
  pushAll(expand.related);
  pushAll(expand.paa);
  pushAll(payload.suggestions);
  pushAll(payload.directionSuggestions);
  // paaExpanded 是 {parent, question} 对象数组，按 question 计数
  if (Array.isArray(payload.paaExpanded)) {
    for (const item of payload.paaExpanded) {
      if (item && typeof item === "object") out.push(normalizeKeyword((item as Record<string, unknown>).question));
    }
  }
  if (Array.isArray(payload.trendsQueries)) {
    for (const item of payload.trendsQueries) {
      if (item && typeof item === "object") out.push(normalizeKeyword((item as Record<string, unknown>).query));
    }
  }
  const keywords = (expand.metrics ?? {}) as Record<string, unknown>;
  if (Array.isArray(keywords.keywords)) {
    for (const item of keywords.keywords) {
      if (item && typeof item === "object") out.push(normalizeKeyword((item as Record<string, unknown>).keyword));
    }
  }
  return [...new Set(out.filter((k) => k !== ""))];
}

function badParams(msg: string) {
  return NextResponse.json<SeoApiError>({ error: msg, code: "BAD_REQUEST" }, { status: 400 });
}

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const list = await listKeywordResearches(userId);
  return NextResponse.json({ data: list });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  let body: { seed?: string; location?: string; device?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return badParams("请求体格式错误，需要 JSON");
  }
  const seed = (body.seed ?? "").trim();
  const location = (body.location ?? "").trim();
  // device 兼容两种口径：页面选择（PC/移动端）与 expand 响应的 provider 归一值
  // （desktop/mobile）——保存的是「这次研究用什么设备跑的」，统一存页面口径。
  const deviceRaw = (body.device ?? "").trim();
  const device = deviceRaw === "desktop" ? "PC" : deviceRaw === "mobile" ? "移动端" : deviceRaw;
  if (!seed) return badParams("seed 不能为空");
  if (!location) return badParams("location 不能为空");
  if (device !== "PC" && device !== "移动端") return badParams("device 必须是 PC 或 移动端");
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    return badParams("payload 必须是对象");
  }
  const payloadText = JSON.stringify(body.payload);
  if (payloadText.length > MAX_PAYLOAD_BYTES) {
    return badParams("研究结果快照过大，无法保存");
  }

  const saved = await saveKeywordResearch(userId, {
    seed,
    location,
    device: device as "PC" | "移动端",
    keywordCount: collectKeywords(body.payload as Record<string, unknown>).length,
    payload: payloadText,
  });
  return NextResponse.json({ data: saved });
}
