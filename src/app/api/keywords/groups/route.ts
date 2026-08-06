// ===== /api/keywords/groups =====
// GET：返回所有分组 + 每个分组的关键词数量
// POST：创建分组

import { NextResponse } from "next/server";
import { listKeywordGroups, createKeywordGroup } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const groups = await listKeywordGroups(userId);
  return NextResponse.json({ data: groups });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name 不能为空" }, { status: 400 });
  }
  if (name.length > 50) {
    return NextResponse.json({ error: "name 长度不能超过 50 个字符" }, { status: 400 });
  }

  const description = body.description?.trim() || undefined;
  const userId = auth.user?.id ?? "demo-user";
  const created = await createKeywordGroup(userId, name, description);
  return NextResponse.json({ data: created }, { status: 201 });
}
