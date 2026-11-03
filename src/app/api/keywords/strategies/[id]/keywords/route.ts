// ===== /api/keywords/strategies/[id]/keywords =====
// Add keywords：把新种子并入已有策略（真实扩词 → 全局去重 → 重新聚类/Pillar），
// 旧关键词与收藏保持不变；只对新增种子消耗 SerpApi 配额。

import { NextResponse, after } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import {
  MAX_SEEDS,
  createStrategyRun,
  preflightSerpQuota,
  resolveStrategyOwner,
  validateSeeds,
} from "@/lib/seo/strategy-service";
import { getStrategy, claimStrategyRun, setStrategyProgress } from "@/lib/db/strategies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  const ownerId = await resolveStrategyOwner(auth);

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }

  const record = await getStrategy(ownerId, id);
  if (!record) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });
  if (record.status === "running") {
    return NextResponse.json({ error: "策略正在生成中，请稍后再试", code: "STRATEGY_RUNNING" }, { status: 409 });
  }
  if (!record.doc) {
    return NextResponse.json({ error: "策略结果为空，无法追加关键词", code: "STRATEGY_EMPTY" }, { status: 409 });
  }

  let body: { seeds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "BAD_REQUEST" }, { status: 400 });
  }
  const list = Array.isArray(body.seeds)
    ? body.seeds.filter((s): s is string => typeof s === "string")
    : typeof body.seeds === "string"
      ? [body.seeds]
      : [];
  const check = validateSeeds(list);
  if (check.error || check.seeds.length === 0) {
    return NextResponse.json({ error: check.error ?? "请至少输入一个关键词", code: "BAD_SEEDS" }, { status: 400 });
  }
  if (check.seeds.length > MAX_SEEDS) {
    return NextResponse.json({ error: `一次最多追加 ${MAX_SEEDS} 个种子关键词`, code: "TOO_MANY_SEEDS" }, { status: 400 });
  }

  const existingSeeds = new Set(record.seeds.map((s) => s.trim().toLowerCase()));
  const newSeeds = check.seeds.filter((s) => !existingSeeds.has(s.trim().toLowerCase()));
  if (newSeeds.length === 0) {
    return NextResponse.json({ error: "这些关键词已在本策略中", code: "DUPLICATE_SEEDS" }, { status: 400 });
  }

  const preflight = await preflightSerpQuota(ownerId, auth.plan, newSeeds.length);
  if (!preflight.ok) {
    return NextResponse.json(
      { error: preflight.message, code: "QUOTA_INSUFFICIENT", details: preflight },
      { status: 429 }
    );
  }

  // 原子抢占置 running（与 retry 相同的防并发双扣配额语义）
  const claimed = await claimStrategyRun(ownerId, id, { status: "running", progress: 5, error: null });
  if (!claimed) {
    return NextResponse.json({ error: "策略正在生成中", code: "STRATEGY_RUNNING" }, { status: 409 });
  }

  const plan = auth.plan;
  const market = record.market;
  const device = record.device === "移动端" ? "移动端" : "PC";
  const existing = record.doc;
  after(async () => {
    try {
      await createStrategyRun({
        userId: ownerId,
        plan,
        strategyId: id,
        seeds: newSeeds,
        market,
        device,
        manual: true,
        existing,
        previousMeta: existing.meta,
      });
    } catch (e) {
      await setStrategyProgress(ownerId, id, { status: "failed", progress: 100, error: (e as Error).message });
    }
  });

  return NextResponse.json({ data: { id, status: "running", addedSeeds: newSeeds } });
}
