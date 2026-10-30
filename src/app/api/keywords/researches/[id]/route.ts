// ===== /api/keywords/researches/[id] =====
// 单条保存的研究成果：GET 返回完整 payload（重开工作台用）、DELETE 删除。
// 仅限本人（user_id 过滤）；纯本地库操作，无供应商请求、无额度消耗。

import { NextResponse } from "next/server";
import { deleteKeywordResearch, getKeywordResearch } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function badId(idStr: string) {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const { id: idStr } = await params;
  const id = badId(idStr);
  if (id === null) {
    return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const saved = await getKeywordResearch(userId, id);
  if (!saved) {
    return NextResponse.json({ error: "未找到该保存的研究", code: "RESEARCH_NOT_FOUND" }, { status: 404 });
  }
  let payload: unknown = saved.payload;
  try {
    payload = JSON.parse(saved.payload);
  } catch {
    payload = saved.payload; // 旧数据兜底：原样返回，由前端校验
  }
  return NextResponse.json({ data: { ...saved, payload } });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const { id: idStr } = await params;
  const id = badId(idStr);
  if (id === null) {
    return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const deleted = await deleteKeywordResearch(userId, id);
  if (!deleted) {
    return NextResponse.json({ error: "未找到该保存的研究", code: "RESEARCH_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ data: { ok: true } });
}
