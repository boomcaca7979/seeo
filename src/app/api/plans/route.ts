// ===== GET /api/plans =====
// 返回所有套餐的完整信息（limits + display），供 Pricing / Settings 页面展示
// 公开接口，无需鉴权（套餐信息不属敏感数据）
// 数据来源：billing 层 getAllPlanInfo()，统一来源，前端不再硬编码

import { NextResponse } from "next/server";
import { getAllPlanInfo } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const plans = await getAllPlanInfo();
    return NextResponse.json({ data: plans });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "获取套餐信息失败", code: "UPSTREAM_ERROR" },
      { status: 500 }
    );
  }
}
