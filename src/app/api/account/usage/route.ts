// ===== GET /api/account/usage =====
// 返回当前用户的套餐、订阅状态、用量、限制、Feature 开关
// 供 Settings 页面展示用量统计、套餐对比等
// 演示模式下返回 free 套餐的示例数据

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { getCurrentUsage } from "@/lib/usage-service";
import { getFeaturesForPlan } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const userId = auth.user?.id ?? "demo-user";

  try {
    const [usage, features] = await Promise.all([
      getCurrentUsage(userId),
      getFeaturesForPlan(auth.plan),
    ]);
    return NextResponse.json({
      data: {
        plan: auth.plan,
        subscriptionStatus: auth.subscriptionStatus,
        usage,
        limits: auth.limits,
        features,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询用量失败" },
      { status: 500 }
    );
  }
}
