// ===== /api/keywords/strategies/[id]/retry =====
// 只重试失败种子：成功种子的结果原样保留（不重复请求、不重复扣配额）。

import { NextResponse, after } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import {
  createStrategyRun,
  preflightSerpQuota,
  resolveStrategyOwner,
} from "@/lib/seo/strategy-service";
import { getStrategy, claimStrategyRun, setStrategyProgress } from "@/lib/db/strategies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteContext) {
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
  if (!record.doc) {
    return NextResponse.json({ error: "策略尚未生成完成，无法重试", code: "STRATEGY_NOT_READY" }, { status: 409 });
  }
  if (record.status === "running") {
    return NextResponse.json({ error: "策略正在生成中", code: "STRATEGY_RUNNING" }, { status: 409 });
  }

  const failed = record.doc.meta.failedSeeds;
  if (failed.length === 0) {
    return NextResponse.json({ error: "没有失败的种子需要重试", code: "NOTHING_TO_RETRY" }, { status: 400 });
  }

  const preflight = await preflightSerpQuota(ownerId, auth.plan, failed.length);
  if (!preflight.ok) {
    return NextResponse.json(
      { error: preflight.message, code: "QUOTA_INSUFFICIENT", details: preflight },
      { status: 429 }
    );
  }

  // 原子抢占置 running：与上面的 status 检查之间不再有可并发穿透的窗口，
  // 两个并发 retry 只有一个能把状态改为 running（其余收到 409），不会重复扣配额。
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
        seeds: failed,
        market,
        device,
        existing,
        previousMeta: existing.meta,
      });
    } catch (e) {
      await setStrategyProgress(ownerId, id, { status: "failed", progress: 100, error: (e as Error).message });
    }
  });

  return NextResponse.json({ data: { id, status: "running", retrying: failed } });
}
