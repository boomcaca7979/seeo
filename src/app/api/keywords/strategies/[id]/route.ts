// ===== /api/keywords/strategies/[id] =====
// GET    读取策略（?progress=1 只返回状态，供轮询，不传大 JSON）
// PATCH  改名 / 保存收藏
// DELETE 删除
//
// 所有操作都带 user_id/owner 归属校验，跨用户一律 404（不泄漏存在性）。

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { resolveStrategyOwner } from "@/lib/seo/strategy-service";
import {
  deleteStrategy,
  getPriorityOverrides,
  getStrategy,
  renameStrategy,
  setPriorityOverride,
  setStrategyBrief,
  setStrategyFavorites,
  type SavedBrief,
} from "@/lib/db/strategies";

/** Content Brief 的 Markdown 上限（约 20 万字符；正常大纲 ~2–5KB） */
const MAX_BRIEF_CHARS = 200_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function badId(idStr: string): number | null {
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function ownerOrNull() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return null;
  return resolveStrategyOwner(auth);
}

export async function GET(req: Request, { params }: RouteContext) {
  const ownerId = await ownerOrNull();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  const { id: idStr } = await params;
  const id = badId(idStr);
  if (id === null) return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });

  const record = await getStrategy(ownerId, id);
  if (!record) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });

  const progressOnly = new URL(req.url).searchParams.get("progress") === "1";
  if (progressOnly) {
    return NextResponse.json({
      data: {
        id: record.id,
        status: record.status,
        progress: record.progress,
        keywordCount: record.keywordCount,
        updatedAt: record.updatedAt,
        error: record.error,
      },
    });
  }
  return NextResponse.json({
    data: {
      id: record.id,
      name: record.name,
      seeds: record.seeds,
      addedSeeds: record.addedSeeds,
      market: record.market,
      device: record.device,
      status: record.status,
      progress: record.progress,
      keywordCount: record.keywordCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      shareToken: record.shareToken,
      favorites: record.favorites,
      briefs: record.briefs,
      /** Strategy Priority 用户覆盖（与自动计算分离持久化） */
      priorityOverrides: await getPriorityOverrides(ownerId, id),
      error: record.error,
      doc: record.doc,
    },
  });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const ownerId = await ownerOrNull();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  const { id: idStr } = await params;
  const id = badId(idStr);
  if (id === null) return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });

  let body: { name?: unknown; favorites?: unknown; brief?: unknown; priorityOverride?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误", code: "BAD_REQUEST" }, { status: 400 });
  }

  const record = await getStrategy(ownerId, id);
  if (!record) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 120) {
      return NextResponse.json({ error: "名称需为 1–120 个字符", code: "BAD_NAME" }, { status: 400 });
    }
    await renameStrategy(ownerId, id, name);
  }

  let favorites: string[] | null = null;
  if (Array.isArray(body.favorites)) {
    const valid = new Set((record.doc?.keywords ?? []).map((k) => k.id));
    favorites = [...new Set(body.favorites.filter((v): v is string => typeof v === "string" && valid.has(v)))];
    await setStrategyFavorites(ownerId, id, favorites);
  }

  // Strategy Priority：用户手动覆盖（recommended / review / low / null 清除）
  if (body.priorityOverride !== undefined) {
    const raw = body.priorityOverride as { topicId?: unknown; level?: unknown };
    const topicId = typeof raw.topicId === "string" ? raw.topicId.trim() : "";
    const level = raw.level;
    if (!topicId || (level !== "recommended" && level !== "review" && level !== "low" && level !== null)) {
      return NextResponse.json(
        { error: "priorityOverride 需要 topicId 与 level（recommended/review/low/null）", code: "BAD_PRIORITY" },
        { status: 400 },
      );
    }
    const ok = await setPriorityOverride(ownerId, id, topicId, level);
    if (!ok) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({
      data: { id, priorityOverride: { topicId, level } },
    });
  }

  // Content Brief：按 topicId 保存 / 覆盖 / 删除（markdown=null）。
  let savedBrief: SavedBrief | null = null;
  let briefTouched = false;
  if (body.brief !== undefined) {
    briefTouched = true;
    const raw = body.brief;
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "brief 需要是对象或 null", code: "BAD_BRIEF" }, { status: 400 });
    }
    const input = raw as { topicId?: unknown; markdown?: unknown; generatedAt?: unknown };
    const topicId = typeof input.topicId === "string" ? input.topicId.trim() : "";
    const topic = (record.doc?.topics ?? []).find((t) => t.id === topicId);
    if (!topicId || !topic) {
      return NextResponse.json({ error: "topicId 不属于该策略", code: "BAD_BRIEF_TOPIC" }, { status: 400 });
    }
    if (input.markdown === null) {
      await setStrategyBrief(ownerId, id, topicId, null);
    } else {
      const markdown = typeof input.markdown === "string" ? input.markdown : "";
      if (!markdown.trim()) {
        return NextResponse.json({ error: "大纲内容不能为空", code: "BAD_BRIEF" }, { status: 400 });
      }
      if (markdown.length > MAX_BRIEF_CHARS) {
        return NextResponse.json(
          { error: `大纲过长（上限 ${MAX_BRIEF_CHARS} 字符）`, code: "BAD_BRIEF_TOO_LARGE" },
          { status: 400 }
        );
      }
      savedBrief = {
        topicId,
        topicName: topic.name,
        markdown,
        savedAt: new Date().toISOString(),
        generatedAt: typeof input.generatedAt === "string" ? input.generatedAt : "",
      };
      await setStrategyBrief(ownerId, id, topicId, savedBrief);
    }
  }

  return NextResponse.json({
    data: { id, favorites, ...(briefTouched ? { brief: savedBrief } : {}) },
  });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const ownerId = await ownerOrNull();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  const { id: idStr } = await params;
  const id = badId(idStr);
  if (id === null) return NextResponse.json({ error: "id 参数无效", code: "BAD_REQUEST" }, { status: 400 });

  const deleted = await deleteStrategy(ownerId, id);
  if (!deleted) return NextResponse.json({ error: "未找到该策略", code: "STRATEGY_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ data: { id, deleted: true } });
}
