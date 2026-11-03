// ===== /api/content-gap/analysis =====
// GET：站点页面清单 × 关键词策略 → 覆盖 / 缺口 / 内耗（纯本地匹配，零 API 成本）。

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { getProjectById } from "@/lib/db/projects";
import { listSitePages } from "@/lib/db/site-content";
import { getStrategy } from "@/lib/db/strategies";
import { analyzeContentGap } from "@/lib/seo/content-gap/matcher";
import { isAuthEnabled } from "@/lib/auth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  // 项目数据用项目身份；策略数据用策略身份（demo 模式下两套身份不同，见 scan/route.ts 注释）
  const projectOwnerId = auth.user?.id ?? (isAuthEnabled ? null : "demo-user");
  const strategyOwnerId = await (async () => {
    const { resolveStrategyOwner } = await import("@/lib/seo/strategy-service");
    return resolveStrategyOwner(auth);
  })();
  const url = new URL(req.url);
  const projectId = Number(url.searchParams.get("projectId"));
  const strategyId = Number(url.searchParams.get("strategyId"));
  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(strategyId) || strategyId <= 0) {
    return NextResponse.json({ error: "projectId / strategyId 参数无效", code: "BAD_REQUEST" }, { status: 400 });
  }
  const project = await getProjectById(projectOwnerId ?? "", projectId);
  if (!project) return NextResponse.json({ error: "项目不存在", code: "PROJECT_NOT_FOUND" }, { status: 404 });
  const record = await getStrategy(strategyOwnerId, strategyId);
  if (!record || !record.doc) {
    return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });
  }

  const pages = await listSitePages(projectOwnerId ?? "", projectId);
  const result = analyzeContentGap(
    record.doc,
    pages.map((p) => ({ url: p.url, title: p.title, h1: p.h1, httpStatus: p.httpStatus, error: p.error })),
  );
  return NextResponse.json({
    data: {
      ...result,
      project: { id: project.id, name: project.name, domain: project.domain },
      strategy: { id: record.id, name: record.name },
    },
  });
}
