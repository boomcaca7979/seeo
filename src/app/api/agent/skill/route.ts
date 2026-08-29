// ===== /api/agent/skill =====
// POST：SeeO Agent Skill Runtime（P0-04）
//   - body: { project_id, message?, skill_id?, params? }
//   - 授权：session / API key（createMcpContext，与 /api/mcp 同一授权路径）
//   - demo：provider-backed 工具降级为 DATA GAP（不产生任何 provider 成本）
//   - 输出：FACT / SIGNAL / DATA GAPS / interpretation 骨架（解释由调用方 agent 完成）

import { NextResponse } from "next/server";
import { createMcpContext } from "@/server/mcp/context";
import { McpNormalizedError, normalizeMcpError } from "@/server/mcp/errors";
import { runAgentSkill } from "@/lib/agent/runtime";
import { SKILL_IDS, type SkillId } from "@/lib/agent/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const ctx = await createMcpContext(req);
    let body: {
      project_id?: string;
      message?: string;
      skill_id?: string;
      params?: { seed?: string; competitorId?: number; locationCode?: number; languageCode?: string };
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求体格式错误，需要 JSON", code: "BAD_REQUEST" }, { status: 400 });
    }
    const projectId = (body.project_id ?? "").trim();
    if (!projectId) {
      return NextResponse.json({ error: "project_id 参数无效", code: "BAD_REQUEST" }, { status: 400 });
    }
    let skillId: SkillId | undefined;
    if (body.skill_id) {
      if (!(SKILL_IDS as string[]).includes(body.skill_id)) {
        return NextResponse.json({ error: `未知 skill：${body.skill_id}`, code: "BAD_REQUEST" }, { status: 400 });
      }
      skillId = body.skill_id as SkillId;
    }
    if (!skillId && !body.message) {
      return NextResponse.json({ error: "需要 message 或 skill_id", code: "BAD_REQUEST" }, { status: 400 });
    }

    const result = await runAgentSkill({
      skillId,
      message: body.message,
      projectId,
      ctx,
      params: body.params,
    });
    return NextResponse.json({ data: result });
  } catch (e) {
    const normalized = e instanceof McpNormalizedError ? e : normalizeMcpError(e);
    return NextResponse.json(
      { error: normalized.message, code: normalized.code, retryable: normalized.retryable },
      { status: normalized.code === "AUTH_REQUIRED" ? 401 : normalized.code === "BAD_REQUEST" ? 400 : 502 }
    );
  }
}
