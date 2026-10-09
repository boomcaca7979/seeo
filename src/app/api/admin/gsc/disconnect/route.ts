// ===== POST /api/admin/gsc/disconnect =====
// 解除 Owner 级 GSC 绑定（只删连接与加密凭证，不删除已同步的历史指标快照）。

import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin/auth";
import { deleteOwnerGscConnection } from "@/lib/admin/gsc-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await checkAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error, code: guard.code }, { status: guard.status });
  }
  await deleteOwnerGscConnection();
  const url = new URL("/admin/data-sources", req.url);
  url.searchParams.set("gsc", "disconnected");
  return NextResponse.redirect(url, { status: 303 });
}
