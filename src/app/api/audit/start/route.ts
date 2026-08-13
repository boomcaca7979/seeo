// ===== POST /api/audit/start =====
// 发起一次技术审计：异步执行（after），立即返回 auditId，前端轮询状态
// 防滥用：同一域名 1 小时内只允许一次 + IP/用户每日限额
// P2：增加 depth 权限校验（free=quick only）+ audit_daily_limit 套餐限额

import { NextResponse, after } from "next/server";
import { createAudit, getLatestAudit, reapStaleRunningAudit, tryIncrementAuditDailyUsage } from "@/lib/db";
import { runAudit, type AuditDepth } from "@/lib/audit";
import { requireAuthOrDemo } from "@/lib/auth";
import { checkAuditRateLimit, buildRateLimitKey } from "@/lib/rate-limit";
import { FeatureNotAllowedError, PlanLimitError, billingErrorToResponse } from "@/lib/guards";
import { requireFeature } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // after 任务的最大执行时长

const COOLDOWN_MS = 60 * 60 * 1000; // 1 小时

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const isAuthed = !!auth.user;
  const plan = auth.plan;
  const auditDailyLimit = auth.limits.audit_daily_limit;

  // Rate limit：匿名每天 3 次，登录每天 20 次（原有防滥用逻辑保留）
  const rlKey = buildRateLimitKey(req, isAuthed ? userId : undefined);
  const rl = checkAuditRateLimit(rlKey, isAuthed);
  if (!rl.allowed) {
    const resetHours = Math.round(rl.resetMs / (60 * 60 * 1000));
    return NextResponse.json({
      error: `今日审计次数已达上限，请约 ${resetHours} 小时后再试`,
      data: { resetMs: rl.resetMs },
    }, { status: 429 });
  }

  // P2：套餐级每日审计限额检查（audit_daily_limit）
  // 使用原子 tryIncrementAuditDailyUsage 消除 TOCTOU 竞态
  const today = todayStr();

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

  // P2：Audit 深度权限校验
  // free: 只允许 quick（audit_max_depth=1）
  // pro: 允许 full（audit_max_depth >= 3）
  if (depth === "full") {
    try {
      await requireFeature(userId, "full_audit");
    } catch (e) {
      if (e instanceof FeatureNotAllowedError) {
        const { status, body: errBody } = billingErrorToResponse(e);
        return NextResponse.json(errBody, { status });
      }
      throw e;
    }
  }

  // 简单规范化：去掉协议前缀，只保留 host
  let domain = rawDomain;
  domain = domain.replace(/^https?:\/\//i, "");
  domain = domain.replace(/\/.*$/, "");
  domain = domain.toLowerCase().trim();

  // 域名格式校验：stricter regex，禁止以 - 开头/结尾，TLD 2-63 字符
  if (!domain || !/^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)\.[a-z]{2,63}$/i.test(domain)) {
    return NextResponse.json({ error: "域名格式无效，如 example.com" }, { status: 400 });
  }

  // 防滥用：按 depth 分别限制 1 小时冷却
  // 先回收因 after() 被服务器回收而永久停留在 running 的审计行，避免 409 拦截阻止用户重跑
  await reapStaleRunningAudit(userId, domain);
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

  // P2：原子消耗审计每日用量（UPSERT + WHERE used < limit，消除 TOCTOU 竞态）
  const auditResult = await tryIncrementAuditDailyUsage(userId, today, auditDailyLimit);
  if (!auditResult.ok) {
    const err = new PlanLimitError("每日审计", plan, auditDailyLimit, "AUDIT_DAILY_LIMIT_REACHED");
    const { status, body: errBody } = billingErrorToResponse(err);
    return NextResponse.json(errBody, { status });
  }

  // 创建审计记录（status=running）
  const audit = await createAudit(userId, domain, depth);

  // 异步执行审计：after() 在响应返回后继续执行，不阻塞用户
  // runAudit 内部已处理 finishAudit / addAuditIssue / 失败兜底
  after(() =>
    runAudit(userId, audit.id, domain, { depth }).catch((err) => {
      console.error(`[audit ${audit.id}] async failed:`, err);
    })
  );

  // 立即返回 auditId，前端轮询 /api/audit/latest 获取进度
  return NextResponse.json({
    data: {
      auditId: audit.id,
      domain,
      depth,
      status: "running",
      message: "审计已开始，请稍后刷新查看结果",
      auditUsage: { used: auditResult.used, limit: auditResult.limit },
    },
  });
}
