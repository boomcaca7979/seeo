// ===== /api/keywords/groups/[id] =====
// DELETE：删除分组（级联删除成员关联）

import { NextResponse } from "next/server";
import { deleteKeywordGroup } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id 参数无效" }, { status: 400 });
  }

  const userId = auth.user?.id ?? "demo-user";
  const ok = await deleteKeywordGroup(userId, id);
  if (!ok) {
    return NextResponse.json({ error: "未找到该分组" }, { status: 404 });
  }
  return NextResponse.json({ data: { ok: true } });
}
