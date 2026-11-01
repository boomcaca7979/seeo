// ===== /api/keywords/metrics =====
// 关键词市场指标（搜索量 / KD / CPC / 竞争度）的真实更新入口。
//
// 背景（2026-11-01 验收 DEF-06）：概览页「更新指标」原本调用 /api/keywords/expand，
// 等于把「关键词扩展」包装成「指标更新」——用户点一次会重新跑一次性研究，
// 且界面无任何反馈。本路由只做指标补全，复用 enrichKeywordMetrics 这一唯一实现
// （DataForSEO 缓存优先、配额受控、失败时返回 source=null + warnings，绝不编造数值）。

import { NextResponse } from "next/server";
import { enrichKeywordMetrics } from "@/lib/seo/keyword-research-service";
import { requireAuthOrDemo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单次补全上限：与 expand 的 200 词上限一致，避免一次请求放大供应商成本 */
const MAX_KEYWORDS = 200;

function badParams(msg: string) {
  return NextResponse.json({ error: msg, code: "BAD_REQUEST" }, { status: 400 });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  }
  const userId = auth.user?.id ?? "demo-user";
  const plan = auth.plan;

  let body: { keywords?: unknown; location?: unknown; language?: unknown };
  try {
    body = await req.json();
  } catch {
    return badParams("请求体格式错误，需要 JSON");
  }

  if (!Array.isArray(body.keywords)) return badParams("keywords 必须是字符串数组");
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of body.keywords) {
    if (typeof raw !== "string") return badParams("keywords 必须是字符串数组");
    const kw = raw.trim();
    if (!kw) continue;
    if (seen.has(kw)) continue;
    seen.add(kw);
    keywords.push(kw);
    if (keywords.length > MAX_KEYWORDS) return badParams(`keywords 不能超过 ${MAX_KEYWORDS} 个`);
  }
  if (keywords.length === 0) return badParams("keywords 不能为空");

  const location = typeof body.location === "string" && body.location.trim() ? body.location.trim() : "中国";
  const language =
    typeof body.language === "string" && body.language.trim() ? body.language.trim() : undefined;

  const result = await enrichKeywordMetrics(userId, plan, keywords, location, language);

  // 有可用数值的行数：至少一个市场指标字段是真实数字。
  // 供应商返回了该关键词但全部字段为 null（例如该词无数据/端点未返回）不算「更新成功」，
  // 因此必须单独计数——否则前端会把「缓存命中 N 行」误读成「N 个关键词的指标已更新」。
  const withValues = result.rows.filter(
    (r) =>
      typeof r.searchVolume === "number" ||
      typeof r.difficulty === "number" ||
      typeof r.cpc === "number" ||
      typeof r.competition === "number"
  ).length;

  return NextResponse.json({
    data: {
      // 只返回 provider 真实返回的行；缺失即缺失，不用 0 补齐
      rows: result.rows,
      source: result.source,
      fromCache: result.fromCache,
      warnings: result.warnings,
      requested: keywords.length,
      returned: result.rows.length,
      /** 其中真正带可用指标数值的行数（0 = 有行但没有任何可用数值，不得宣称更新成功） */
      withValues,
      /**
       * 无数据时的机器可读原因（null = 有数据）：
       * plan_not_included = 套餐额度为 0，未发起请求；unconfigured = 凭据缺失；
       * quota_exceeded = 额度已用尽；provider_error = 已发起请求但供应商失败。
       */
      reason: result.reason ?? null,
      planIncluded: result.planIncluded ?? null,
    },
  });
}
