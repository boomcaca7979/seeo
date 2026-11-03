// ===== /api/keywords/strategies =====
// POST 创建策略（后台 after() 执行，立即返回 id）
// GET  列出当前用户的策略
//
// 归属：登录用户 = Supabase user.id；演示模式（未开启鉴权）= 浏览器级 demo scope cookie，
// 避免所有访客共用同一个 demo-user 读到彼此的策略。

import { NextResponse, after } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import {
  assertSupportedMarket,
  createStrategyRun,
  preflightSerpQuota,
  resolveStrategyOwner,
  validateSeeds,
} from "@/lib/seo/strategy-service";
import {
  createStrategy,
  findDuplicateStrategy,
  listStrategies,
  setStrategyProgress,
} from "@/lib/db/strategies";
import { getSerpUsage } from "@/lib/seo/serp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function bad(message: string, code: string, status = 400) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  const ownerId = await resolveStrategyOwner(auth);
  const rows = await listStrategies(ownerId, 50);
  const usage = await getSerpUsage(ownerId, auth.plan);
  return NextResponse.json({ data: rows, usage });
}

export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) return NextResponse.json({ error: auth.error, code: "AUTH_REQUIRED" }, { status: 401 });
  const ownerId = await resolveStrategyOwner(auth);

  let body: { seeds?: unknown; market?: unknown; device?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("请求体格式错误，需要 JSON", "BAD_REQUEST");
  }

  const rawSeeds = Array.isArray(body.seeds)
    ? body.seeds.filter((s): s is string => typeof s === "string")
    : typeof body.seeds === "string"
      ? [body.seeds]
      : [];
  const seedsCheck = validateSeeds(rawSeeds);
  if (seedsCheck.error) return bad(seedsCheck.error, "BAD_SEEDS");

  const marketRaw = typeof body.market === "string" ? body.market : "";
  let market;
  try {
    market = assertSupportedMarket(marketRaw);
  } catch {
    return bad(`不支持的市场：${marketRaw || "(空)"}`, "UNSUPPORTED_MARKET");
  }

  const deviceRaw = typeof body.device === "string" ? body.device.trim() : "PC";
  const device: "PC" | "移动端" = deviceRaw === "移动端" || deviceRaw === "mobile" ? "移动端" : "PC";

  // 防重复：同一 owner + 相同种子/市场/设备且仍在运行或 30s 内创建过 → 直接返回同一份
  const duplicate = await findDuplicateStrategy(ownerId, {
    seeds: seedsCheck.seeds,
    market: market.zh,
    device,
  });
  if (duplicate) {
    return NextResponse.json({
      data: { id: duplicate.id, status: duplicate.status, duplicate: true },
    });
  }

  // 配额预检：不足则不发任何供应商请求
  const preflight = await preflightSerpQuota(ownerId, auth.plan, seedsCheck.seeds.length);
  if (!preflight.ok) {
    return NextResponse.json(
      {
        error: preflight.message,
        code: "QUOTA_INSUFFICIENT",
        details: {
          needed: preflight.needed,
          monthlyRemaining: preflight.monthlyRemaining,
          dailyRemaining: preflight.dailyRemaining,
        },
      },
      { status: 429 }
    );
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : `${seedsCheck.seeds[0]} 关键词策略`;

  const created = await createStrategy(ownerId, {
    name,
    seeds: seedsCheck.seeds,
    market: market.zh,
    device,
  });

  const plan = auth.plan;
  const jobSeeds = seedsCheck.seeds;
  const jobMarket = market.zh;
  after(async () => {
    try {
      await createStrategyRun({
        userId: ownerId,
        plan,
        strategyId: created.id,
        seeds: jobSeeds,
        market: jobMarket,
        device,
      });
    } catch (e) {
      await setStrategyProgress(ownerId, created.id, {
        status: "failed",
        progress: 100,
        error: (e as Error).message,
      });
    }
  });

  return NextResponse.json(
    {
      data: { id: created.id, status: created.status, duplicate: false },
      meta: {
        duplicatesIgnored: seedsCheck.duplicates,
        market: market.zh,
        device,
        quota: {
          needed: preflight.needed,
          available: preflight.available,
          tight: preflight.tight,
          warning: preflight.message,
        },
      },
    },
    { status: 201 }
  );
}
