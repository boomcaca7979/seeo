// ===== /api/keywords/strategies/[id]/share =====
// POST   生成/返回只读分享 token（不可预测、可撤销）
// DELETE 撤销分享（旧链接立即失效）
// GET    查看当前分享状态

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { createShareToken, resolveStrategyOwner, strategySharePath } from "@/lib/seo/strategy-service";
import { getStrategy, isShareTokenTaken, setStrategyShareToken } from "@/lib/db/strategies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function badId(idStr: string): number | null {
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  const ownerId = await resolveStrategyOwner(auth);
  const { id: idStr } = await params;
  const id = badId(idStr);
  if (id === null) return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });

  const record = await getStrategy(ownerId, id);
  if (!record) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    data: {
      shared: Boolean(record.shareToken),
      url: record.shareToken ? strategySharePath(record.shareToken) : null,
    },
  });
}

export async function POST(_req: Request, { params }: RouteContext) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  const ownerId = await resolveStrategyOwner(auth);
  const { id: idStr } = await params;
  const id = badId(idStr);
  if (id === null) return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });

  const record = await getStrategy(ownerId, id);
  if (!record) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });
  if (!record.doc) {
    return NextResponse.json({ error: "策略尚未生成完成，无法分享", code: "STRATEGY_NOT_READY" }, { status: 409 });
  }

  let token = record.shareToken;
  if (!token) {
    // 24 字节随机（192bit）+ 唯一性复查：不覆盖别人的分享链接
    for (let i = 0; i < 5; i += 1) {
      const candidate = createShareToken();
      if (!(await isShareTokenTaken(candidate))) {
        token = candidate;
        break;
      }
    }
    if (!token) {
      return NextResponse.json({ error: "生成分享链接失败，请重试", code: "SHARE_TOKEN_FAILED" }, { status: 500 });
    }
  }
  if (!record.shareToken) {
    const ok = await setStrategyShareToken(ownerId, id, token);
    if (!ok) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ data: { shared: true, url: strategySharePath(token) } });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  const ownerId = await resolveStrategyOwner(auth);
  const { id: idStr } = await params;
  const id = badId(idStr);
  if (id === null) return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });

  const ok = await setStrategyShareToken(ownerId, id, null);
  if (!ok) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ data: { shared: false, url: null } });
}
