// ===== POST /api/admin/plan-sync =====
// 一次性管理接口：将 DEFAULT_PLAN_LIMITS（代码权威值）同步到 Supabase plan_limits 表
// 用途：Free 套餐额度调整（2/3/30/3/3）生产落地
// 对应迁移：supabase/migrations/0011_free_quota_update.sql
//
// 安全：必须验证 CRON_SECRET（fail-closed），与 /api/cron/* 相同鉴权方式
// 行为：
//   1. 先尝试带 serpapi_daily_limit 列的 update（迁移 0011 已执行时）
//   2. 若列不存在（PGRST204）→ 回退为不含该列的 update（代码层兜底 DEFAULT）
//   3. 幂等：可重复调用

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PLAN_LIMITS } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "admin client 不可用", code: "ADMIN_CLIENT_UNAVAILABLE" }, { status: 503 });
  }

  const freeLimits = DEFAULT_PLAN_LIMITS.free;

  // 完整更新（含 serpapi_daily_limit 列，迁移 0011 已执行）
  const fullUpdate = {
    max_projects: freeLimits.max_projects,
    max_tracked_keywords: freeLimits.max_tracked_keywords,
    serpapi_monthly_limit: freeLimits.serpapi_monthly_limit,
    serpapi_daily_limit: freeLimits.serpapi_daily_limit,
    audit_daily_limit: freeLimits.audit_daily_limit,
    updated_at: new Date().toISOString(),
  };

  // 回退更新（列未创建，serpapi_daily_limit 走 rowToPlanLimits 代码兜底）
  const baseUpdate = { ...fullUpdate };
  delete (baseUpdate as Partial<typeof fullUpdate>).serpapi_daily_limit;

  let usedFallback = false;

  try {
    let { error: updateError } = await admin
      .from("plan_limits")
      .update(fullUpdate)
      .eq("plan", "free");

    if (updateError && updateError.code === "PGRST204") {
      // 列不存在 → 回退
      usedFallback = true;
      const baseResult = await admin
        .from("plan_limits")
        .update(baseUpdate)
        .eq("plan", "free");
      updateError = baseResult.error ?? null;
    }

    if (updateError) {
      return NextResponse.json({ error: updateError.message, code: "UPSTREAM_ERROR" }, { status: 500 });
    }

    // 回读验证
    const { data: row, error: readError } = await admin
      .from("plan_limits")
      .select("plan, max_projects, max_tracked_keywords, serpapi_monthly_limit, audit_daily_limit")
      .eq("plan", "free")
      .single();

    if (readError) {
      return NextResponse.json({ error: readError.message, code: "VERIFY_READ_FAILED" }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        synced: true,
        usedFallback,
        row,
        note: usedFallback
          ? "serpapi_daily_limit 列不存在，已更新其余字段；日度限额由代码 DEFAULT 兜底（free=3）。执行 0011 迁移后列为权威来源。"
          : "全部字段已同步（含 serpapi_daily_limit）。",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败", code: "UPSTREAM_ERROR" },
      { status: 500 }
    );
  }
}
