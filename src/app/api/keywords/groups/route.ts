// ===== /api/keywords/groups =====
// GET：返回所有分组 + 每个分组的关键词数量
// POST：创建分组

import { NextResponse } from "next/server";
import { listKeywordGroups, countKeywordGroups, createKeywordGroup } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";
import { PlanLimitError, billingErrorToResponse } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const groups = await listKeywordGroups(userId);
  return NextResponse.json({ data: groups });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name 不能为空", code: "NAME_REQUIRED" }, { status: 400 });
  }
  if (name.length > 50) {
    return NextResponse.json({ error: "name 长度不能超过 50 个字符", code: "NAME_TOO_LONG" }, { status: 400 });
  }

  const description = body.description?.trim() || undefined;
  const userId = auth.user?.id ?? "demo-user";

  // P3.5：套餐关键词分组数量限额校验（max_keyword_groups，user-scoped）
  const maxGroups = auth.limits.max_keyword_groups;
  const existingCount = await countKeywordGroups(userId);
  if (existingCount >= maxGroups) {
    const err = new PlanLimitError("关键词分组", auth.plan, maxGroups, "KEYWORD_GROUP_LIMIT_REACHED");
    const { status, body: errBody } = billingErrorToResponse(err);
    return NextResponse.json(errBody, { status });
  }

  const created = await createKeywordGroup(userId, name, description);
  return NextResponse.json({ data: created }, { status: 201 });
}
