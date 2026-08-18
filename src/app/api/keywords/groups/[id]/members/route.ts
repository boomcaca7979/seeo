// ===== /api/keywords/groups/[id]/members =====
// POST：将关键词加入分组
// DELETE：将关键词移出分组

import { NextResponse } from "next/server";
import {
  addKeywordToGroup,
  removeKeywordFromGroup,
  getTrackedKeywordById,
} from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const { id: idStr } = await params;
  const groupId = Number(idStr);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return NextResponse.json({ error: "group id 参数无效", code: "INVALID_GROUP_ID" }, { status: 400 });
  }

  let body: { keyword_id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const keywordId = Number(body.keyword_id);
  if (!Number.isInteger(keywordId) || keywordId <= 0) {
    return NextResponse.json({ error: "keyword_id 参数无效", code: "INVALID_KEYWORD_ID" }, { status: 400 });
  }

  // 校验关键词存在
  const userId = auth.user?.id ?? "demo-user";
  const kw = await getTrackedKeywordById(userId, keywordId);
  if (!kw) {
    return NextResponse.json({ error: "未找到该关键词", code: "KEYWORD_NOT_FOUND" }, { status: 404 });
  }

  await addKeywordToGroup(userId, groupId, keywordId);
  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const { id: idStr } = await params;
  const groupId = Number(idStr);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return NextResponse.json({ error: "group id 参数无效", code: "INVALID_GROUP_ID" }, { status: 400 });
  }

  let body: { keyword_id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const keywordId = Number(body.keyword_id);
  if (!Number.isInteger(keywordId) || keywordId <= 0) {
    return NextResponse.json({ error: "keyword_id 参数无效", code: "INVALID_KEYWORD_ID" }, { status: 400 });
  }

  const userId = auth.user?.id ?? "demo-user";
  const ok = await removeKeywordFromGroup(userId, groupId, keywordId);
  if (!ok) {
    return NextResponse.json({ error: "该关键词不在此分组中", code: "KEYWORD_NOT_IN_GROUP" }, { status: 404 });
  }
  return NextResponse.json({ data: { ok: true } });
}
