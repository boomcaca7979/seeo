// ===== /api/cache/cleanup =====
// GET：返回当前缓存条目数（含已过期）
// POST：清理所有已过期缓存，返回已删除条数与剩余条数

import { NextResponse } from "next/server";
import { deleteExpiredCache, countCacheEntries } from "@/lib/db";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const total = await countCacheEntries();
  return NextResponse.json({ data: { total } });
}

export async function POST() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  // 全局缓存清理属于运维操作，限制为 Pro 套餐用户
  if (auth.plan !== "pro") {
    return NextResponse.json(
      { error: "需要 Pro 套餐权限才能执行缓存清理", code: "PLAN_REQUIRED" },
      { status: 403 }
    );
  }
  const deleted = await deleteExpiredCache();
  const remaining = await countCacheEntries();
  return NextResponse.json({
    data: { deleted, remaining },
    message: `已清理 ${deleted} 条过期缓存`,
  });
}
