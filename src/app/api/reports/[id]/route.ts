// /api/reports/[id] — 删除报告

import { NextResponse } from "next/server";
import { deleteReport, getReport } from "@/lib/db";
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
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id 无效" }, { status: 400 });
  }

  const existing = await getReport(id);
  if (!existing) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }

  await deleteReport(id);
  return NextResponse.json({ data: { deleted: true, id } });
}
