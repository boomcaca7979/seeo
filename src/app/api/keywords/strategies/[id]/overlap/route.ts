// ===== /api/keywords/strategies/[id]/overlap =====
//
// SERP Overlap 验证：比较 2–5 个代表关键词的 Top 10 URL 重合度。
// 成本纪律：默认只读策略已保存的快照；缺失时列出清单并给出所需调用数与配额预检，
// 只有 body.confirm === true 且配额足够时才发起 SerpApi 请求（每次 1 调用，走统一配额）。

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveStrategyOwner } from "@/lib/seo/strategy-service";
import { getStrategy, saveStrategyDoc } from "@/lib/db/strategies";
import { searchSerp } from "@/lib/seo/serp-service";
import { preflightSerpQuota } from "@/lib/seo/strategy-service";
import { compareSnapshotPairs, groupByContext } from "@/lib/seo/serp-overlap";
import { extractCompactSnapshot, type CompactSerpSnapshot, type SerpSnapshotMap } from "@/lib/seo/serp-snapshot";
import { normalizeKeyword } from "@/lib/seo/strategy-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function ownerOrNull() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return null;
  return { ownerId: await resolveStrategyOwner(auth), plan: auth.plan };
}

export async function POST(req: Request, { params }: RouteContext) {
  const owner = await ownerOrNull();
  if (!owner) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }

  let body: { keywords?: unknown; confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "BAD_REQUEST" }, { status: 400 });
  }
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
    : [];
  if (keywords.length < 2 || keywords.length > 5) {
    return NextResponse.json({ error: "请选择 2–5 个关键词进行比较", code: "BAD_KEYWORD_COUNT" }, { status: 400 });
  }
  const confirm = body.confirm === true;

  const record = await getStrategy(owner.ownerId, id);
  if (!record || !record.doc) {
    return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });
  }

  const snapshots: SerpSnapshotMap = record.doc.meta.serpSnapshots ?? {};
  const kwById = new Map(record.doc.keywords.map((k) => [k.id, k]));

  // 解析每个请求关键词的快照：优先词本身是种子；否则用它所属种子的快照
  const resolved = new Map<string, CompactSerpSnapshot>();
  const missing: string[] = [];
  for (const kw of keywords) {
    const key = normalizeKeyword(kw);
    const row = kwById.get(key);
    const direct = snapshots[key] ?? (row ? snapshots[row.seeds[0] ?? ""] : undefined);
    if (direct) resolved.set(kw, direct);
    else missing.push(kw);
  }

  // 缺失快照：未经用户确认绝不发起新请求
  if (missing.length > 0 && !confirm) {
    const preflight = await preflightSerpQuota(owner.ownerId, owner.plan, missing.length);
    return NextResponse.json({
      data: { needsFetch: missing, neededCalls: missing.length, preflight, pairs: [], ready: false },
    });
  }

  // 用户已确认：逐个补抓（每次 1 调用，统一配额与缓存；配额不足整体拒绝）。
  // 单词失败不放弃整轮：已成功的快照照常持久化（重试时命中缓存不重复扣费），
  // 失败的词列入 failedFetch 返回给 UI，由用户决定是否重试——绝不静默吞掉。
  const failedFetch: Array<{ keyword: string; error: string }> = [];
  if (missing.length > 0 && confirm) {
    const preflight = await preflightSerpQuota(owner.ownerId, owner.plan, missing.length);
    if (!preflight.ok) {
      return NextResponse.json(
        { error: preflight.message, code: "QUOTA_INSUFFICIENT", details: preflight },
        { status: 403 },
      );
    }
    for (const kw of missing) {
      try {
        const { result } = await searchSerp(owner.ownerId, owner.plan, {
          keyword: kw,
          location: record.doc.meta.market,
          device: record.doc.meta.device,
        });
        snapshots[normalizeKeyword(kw)] = extractCompactSnapshot(kw, record.doc.meta.market, result);
        resolved.set(kw, snapshots[normalizeKeyword(kw)]);
      } catch (e) {
        failedFetch.push({ keyword: kw, error: (e as Error).message?.slice(0, 200) ?? "fetch failed" });
      }
    }
    if (failedFetch.length < missing.length) {
      // 至少成功了一个才落库；全部失败时不改写快照集合
      record.doc.meta.serpSnapshots = snapshots;
      await saveStrategyDoc(owner.ownerId, id, record.doc, record.status);
    }
  }

  // 全部抓取失败：明确报错，不给一个「看起来 ready」的空比较
  if (failedFetch.length > 0 && resolved.size < 2) {
    return NextResponse.json(
      {
        error: `快照获取失败：${failedFetch.map((f) => f.keyword).join("、")}（可重试；已获取的快照已保存，重试不重复扣费）`,
        code: "FETCH_FAILED",
        data: { failedFetch },
      },
      { status: 502 },
    );
  }

  // 分组校验：不同市场/设备/语言不可混算
  const list = [...resolved.values()];
  const groups = groupByContext(list);
  if (groups.size > 1) {
    return NextResponse.json(
      {
        error: "所选关键词的 SERP 快照来自不同市场/设备/语言，不可混算；请选择同一上下文的词或先更新快照",
        code: "CONTEXT_MISMATCH",
      },
      { status: 400 },
    );
  }

  const pairs = compareSnapshotPairs(list);
  return NextResponse.json({
    data: { pairs, ready: true, needsFetch: [], usedSnapshots: list.length, failedFetch },
  });
}
