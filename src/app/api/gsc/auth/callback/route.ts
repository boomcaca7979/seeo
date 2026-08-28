// ===== /api/gsc/auth/callback =====
// GET：Google OAuth 回调——校验 state → 授权码换 token（含 refresh_token）→ 加密暂存
//   - 失败重定向回 /app/settings?gsc=error&reason=...
//   - 成功重定向回 /app/settings?gsc=connected（用户随后显式选择 property 绑定）

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { completeOAuth, isGscOAuthConfigured, verifyOAuthState } from "@/lib/seo/gsc-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToSettings(status: string, reason?: string): NextResponse {
  const url = new URL("/app/settings", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  url.searchParams.set("gsc", status);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url.toString());
}

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    return redirectToSettings("error", "auth_required");
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return redirectToSettings("error", "user_cancelled");
  if (!code || !state) return redirectToSettings("error", "missing_params");
  if (!isGscOAuthConfigured()) return redirectToSettings("error", "not_configured");

  const stateUserId = verifyOAuthState(state);
  if (!stateUserId || stateUserId !== auth.user.id) {
    return redirectToSettings("error", "invalid_state");
  }

  try {
    const redirectUri = process.env.GSC_OAUTH_REDIRECT_URI ?? `${url.origin}/api/gsc/auth/callback`;
    await completeOAuth({ userId: auth.user.id, code, redirectUri });
    return redirectToSettings("connected");
  } catch {
    return redirectToSettings("error", "token_exchange_failed");
  }
}
