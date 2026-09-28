// ===== POST /api/analytics/events =====
// 客户端事件唯一入口（匿名允许）。约束：
//   - event 必须在 CLIENT_EVENTS 白名单内
//   - user_id 一律由服务端 Supabase session 推导，客户端字段被忽略（防伪造/串号）
//   - signup_completed / login_completed / page_view 顺带完成身份归因绑定
//   - IP 滑动窗口限流，防止恶意刷量
// 隐私：不落 cookie / token / 密码；props 白名单化截断（见 sanitizeProps）。

import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";
import { isClientEvent, insertEvent, recordVisit, bindIdentity, trackReturningIfEligible, getFirstTouchByAnonymousId } from "@/lib/analytics/server";
import { checkSlidingWindowRateLimit } from "@/lib/rate-limit";
import { sanitizeShort } from "@/lib/analytics/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 限流：单 IP 每分钟 120 条（正常浏览远低于此阈值）
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rl = checkSlidingWindowRateLimit(`analytics:${ip}`, 120, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const eventName = String(body.event ?? "");
  if (!isClientEvent(eventName)) {
    return NextResponse.json({ error: "unknown event" }, { status: 400 });
  }

  const anonymousId = sanitizeShort(body.anonymousId)?.slice(0, 64) ?? null;
  if (!anonymousId) {
    return NextResponse.json({ error: "missing anonymousId" }, { status: 400 });
  }

  // 服务端 session → user_id（客户端上报的 user 字段一律忽略）
  let userId: string | null = null;
  let sessionUserEmail: string | null = null;
  if (isAuthEnabled) {
    try {
      const supabase = await createServer();
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id ?? null;
      sessionUserEmail = user?.email ?? null;
    } catch {
      userId = null;
    }
  }

  const touch = {
    utmSource: typeof body.utmSource === "string" ? body.utmSource : null,
    utmMedium: typeof body.utmMedium === "string" ? body.utmMedium : null,
    utmCampaign: typeof body.utmCampaign === "string" ? body.utmCampaign : null,
    utmContent: typeof body.utmContent === "string" ? body.utmContent : null,
    utmTerm: typeof body.utmTerm === "string" ? body.utmTerm : null,
    referrer: typeof body.referrer === "string" ? body.referrer : null,
  };

  const props =
    body.props && typeof body.props === "object" && !Array.isArray(body.props)
      ? (body.props as Record<string, unknown>)
      : null;

  try {
    if (eventName === "page_view") {
      await recordVisit({
        anonymousId,
        sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
        path: typeof body.path === "string" ? body.path : null,
        locale: typeof body.locale === "string" ? body.locale : null,
        touch,
        userId,
      });
      return NextResponse.json({ ok: true });
    }

    // 注册/登录成功：身份级事件按匿名身份的 first-touch 归因，绑定身份，判定回访
    if ((eventName === "signup_completed" || eventName === "login_completed") && userId) {
      const firstTouch = await getFirstTouchByAnonymousId(anonymousId);
      await insertEvent({
        event: eventName,
        userId,
        anonymousId,
        sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
        path: typeof body.path === "string" ? body.path : null,
        locale: typeof body.locale === "string" ? body.locale : null,
        touch: firstTouch,
      });
      await bindIdentity(anonymousId, userId);
      if (eventName === "login_completed") {
        await trackReturningIfEligible(userId);
      }
      // C 阶段：注册成功 → Welcome（幂等由 email_log 唯一键保证；失败不阻塞）
      if (eventName === "signup_completed" && sessionUserEmail) {
        const { sendWelcomeEmail } = await import("@/lib/email/lifecycle");
        await sendWelcomeEmail(userId, sessionUserEmail);
      }
      return NextResponse.json({ ok: true });
    }

    await insertEvent({
      event: eventName,
      userId,
      anonymousId,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
      path: typeof body.path === "string" ? body.path : null,
      locale: typeof body.locale === "string" ? body.locale : null,
      touch,
      refId: typeof body.refId === "string" || typeof body.refId === "number" ? String(body.refId) : null,
      props,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // 分析失败不阻断业务（客户端为 fire-and-forget，这里静默 200 防止重试风暴）
    console.error("[analytics] ingest failed:", (err as Error).message);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
