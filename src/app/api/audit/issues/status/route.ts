// ===== /api/audit/issues/status =====
// 审计问题的**处理状态**（与检测结果分离）：
//   GET  ?domain=xxx                → 该域名全部处理记录（审计页据此渲染状态）
//   POST { domain, rule_id, status, note? } → 用户置位
//
// 安全边界：`verified_resolved` 是**服务端专属**，客户端直接提交会被 403 拒绝。
// 只有「再次审计」的真实检测证据能推进到已验证解决。

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { normalizeDomain } from "@/lib/seo/domain";
import {
  listResolutionsByDomain,
  setUserResolutionStatus,
  isUserSettableStatus,
} from "@/lib/db/issue-resolutions";
import { captureAuditTaskBaseline } from "@/lib/seo/task-observations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const { searchParams } = new URL(req.url);
  const domain = normalizeDomain(searchParams.get("domain") ?? "");
  if (!domain) {
    return NextResponse.json(
      { error: "domain 参数无效，如 example.com", code: "INVALID_DOMAIN" },
      { status: 400 }
    );
  }
  const map = await listResolutionsByDomain(userId, domain);
  return NextResponse.json({ data: { domain, resolutions: [...map.values()] } });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";

  let body: { domain?: unknown; rule_id?: unknown; status?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const domain = normalizeDomain(typeof body.domain === "string" ? body.domain : "");
  const ruleId = typeof body.rule_id === "string" ? body.rule_id.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

  if (!domain || !ruleId) {
    return NextResponse.json(
      { error: "domain / rule_id 参数无效", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  // 服务端专属状态：禁止客户端自证"已验证解决"
  if (!isUserSettableStatus(status)) {
    return NextResponse.json(
      {
        error: "该状态不可由客户端设置（verified_resolved 只能通过再次审计验证）",
        code: "STATUS_NOT_USER_SETTABLE",
      },
      { status: 403 }
    );
  }

  const result = await setUserResolutionStatus(userId, domain, ruleId, status, note);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "状态更新失败", code: "STATUS_UPDATE_FAILED" },
      { status: 400 }
    );
  }

  // 反馈闭环：用户开始处理/声称修复时，捕获**执行前**真实基线（幂等，不覆盖已有基线）。
  // 基线捕获失败不影响状态更新结果。
  if (status === "in_progress" || status === "fixed_claimed") {
    try {
      await captureAuditTaskBaseline(userId, domain, ruleId);
    } catch {
      // 无审计快照等情况：不捕获基线，队列会显示"无基线"而不是伪造数字
    }
  }

  return NextResponse.json({ data: { domain, ruleId, status } });
}
