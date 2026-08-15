// ===== GET /api/cron/membership-expire =====
// 会员到期自动降级定时任务
// 每日 UTC 00:00 执行（vercel.json: "0 0 * * *"）
// 检查所有 current_period_end < now 且 subscription_status=active/trialing 的用户
// 将 plan 降为 free、subscription_status 置为 expired
// 注：运行时 getUserPlan 也会动态判断过期，cron 仅同步 profiles 字段
//
// 安全：必须验证 CRON_SECRET（fail-closed）
// 不允许任何人随意调用此接口

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 验证 CRON_SECRET（fail-closed：secret 为空时拒绝）
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "admin client 不可用" }, { status: 503 });
  }

  try {
    // 1. 找出所有已过期但仍标记为 active 的用户
    // 条件：subscription_status IN ('active', 'trialing')
    //       AND current_period_end IS NOT NULL
    //       AND current_period_end < now()
    const { data: expiredUsers, error: queryError } = await admin
      .from("profiles")
      .select("id, plan, subscription_status, current_period_end")
      .in("subscription_status", ["active", "trialing"])
      .not("current_period_end", "is", null)
      .lt("current_period_end", new Date().toISOString())
      .limit(500); // 单次最多处理 500 个用户

    if (queryError) {
      console.error("[Cron Expire] 查询过期用户失败:", queryError.message);
      return NextResponse.json({ error: queryError.message }, { status: 500 });
    }

    if (!expiredUsers || expiredUsers.length === 0) {
      return NextResponse.json({
        data: { processed: 0, status: "no_expired_users" },
      });
    }

    // 2. 批量降级为 free + expired
    const userIds = expiredUsers.map((u) => u.id);
    let updatedCount = 0;
    const errors: string[] = [];

    for (const userId of userIds) {
      try {
        const { error: updateError } = await admin
          .from("profiles")
          .update({
            plan: "free",
            subscription_status: "expired",
          })
          .eq("id", userId)
          .in("subscription_status", ["active", "trialing"]);

        if (updateError) {
          errors.push(`${userId}: ${updateError.message}`);
        } else {
          updatedCount++;
        }
      } catch (err) {
        errors.push(`${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (errors.length > 0) {
      console.error("[Cron Expire] 部分降级失败:", errors);
    }

    return NextResponse.json({
      data: {
        processed: updatedCount,
        total: userIds.length,
        status: "done",
        errors: errors.slice(0, 10), // 仅返回前 10 条错误
      },
    });
  } catch (err) {
    console.error("[Cron Expire] 异常:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "执行失败" },
      { status: 500 }
    );
  }
}
