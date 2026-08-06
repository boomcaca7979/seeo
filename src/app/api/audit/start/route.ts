// ===== POST /api/audit/start =====
// 发起一次技术审计：同步执行 BFS 爬取并返回最终结果（Vercel serverless 兼容）
// 防滥用：同一域名 1 小时内只允许一次

import { NextResponse } from "next/server";
import { createAudit, getLatestAudit } from "@/lib/db";
import { runAudit, type AuditDepth } from "@/lib/audit";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // full 模式可能 1-2 分钟，留足余量

const COOLDOWN_MS = 60 * 60 * 1000; // 1 小时

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 JSON" }, { status: 400 });
  }

  const rawDomain = String(body.domain ?? "").trim();
  if (!rawDomain) {
    return NextResponse.json({ error: "域名不能为空" }, { status: 400 });
  }

  // depth 参数：'quick'（默认，只爬首页）| 'full'（50 页 BFS）
  const rawDepth = String(body.depth ?? "quick").trim().toLowerCase();
  const depth: AuditDepth = rawDepth === "full" ? "full" : "quick";

  // 简单规范化：去掉协议前缀，只保留 host
  let domain = rawDomain;
  domain = domain.replace(/^https?:\/\//i, "");
  domain = domain.replace(/\/.*$/, "");
  domain = domain.toLowerCase().trim();

  if (!domain || !/^[\w.-]+\.[a-z]{2,}$/i.test(domain)) {
    return NextResponse.json({ error: "域名格式无效，如 example.com" }, { status: 400 });
  }

  // 防滥用：按 depth 分别限制 1 小时冷却
  // - status='failed' 不触发冷却，允许重试
  // - quick 和 full 互不影响（latest.depth !== 本次 depth 则不冷却）
  const latest = await getLatestAudit(userId, domain);
  if (latest && latest.status === "running") {
    return NextResponse.json({
      error: "该域名审计正在进行中，请等待完成",
      data: { auditId: latest.id, status: "running", pagesCrawled: latest.pages_crawled },
    }, { status: 409 });
  }
  if (
    latest &&
    latest.status !== "failed" &&
    latest.depth === depth &&
    latest.started_at
  ) {
    const startedAt = new Date(latest.started_at + "Z").getTime();
    if (!Number.isNaN(startedAt)) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - elapsed;
        const remainingMin = Math.max(1, Math.round(remainingMs / 60_000));
        const depthLabel = depth === "full" ? "深度审计" : "快速审计";
        return NextResponse.json({
          error: `该域名${depthLabel}冷却中，请约 ${remainingMin} 分钟后再试（同模式 1 小时内仅允许一次，可切另一种模式）`,
          data: { cooldownRemainingMs: remainingMs, lastAuditId: latest.id },
        }, { status: 429 });
      }
    }
  }

  // 创建审计记录
  const audit = await createAudit(userId, domain, depth);

  // 同步执行审计（不再 fire-and-forget，serverless 兼容）
  // runAudit 内部已处理 finishAudit / addAuditIssue / 失败兜底
  const result = await runAudit(userId, audit.id, domain, { depth });

  return NextResponse.json({
    data: {
      auditId: result.auditId,
      domain: result.domain,
      depth: result.depth,
      status: result.status,
      pagesCrawled: result.pagesCrawled,
      healthScore: result.healthScore,
      errors: result.errors,
      warnings: result.warnings,
      notices: result.notices,
      error: result.error,
    },
  });
}
