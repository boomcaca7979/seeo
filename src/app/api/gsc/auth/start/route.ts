// ===== /api/gsc/auth/start =====
// GET：发起 Google OAuth 授权码流程（offline access，webmasters.readonly scope）
//   - 必须真实登录（demo 模式禁止触达真实 Google API）
//   - OAuth 未配置 → GSC_NOT_CONFIGURED
//   - state：HMAC 签名的 userId+时间戳（10 分钟有效），防 CSRF

import { NextResponse } from "next/server";
import { requireAuthOrDemo } from "@/lib/auth";
import { isGscOAuthConfigured, signOAuthState } from "@/lib/seo/gsc-service";
import { buildGoogleAuthUrl, isGoogleOAuthConfigured } from "@/lib/seo/gsc-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuthOrDemo();
  if (!auth.allowed || !auth.user) {
    // 演示模式（auth.user 为 null）不允许进入真实 Google OAuth 流程
    return NextResponse.json({ error: "连接 Search Console 需要登录 SeeO 账号", code: "GSC_NOT_CONFIGURED" }, { status: 403 });
  }
  if (!isGoogleOAuthConfigured() || !isGscOAuthConfigured()) {
    return NextResponse.json({
      error: "Google OAuth 未配置（需要 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GSC_TOKEN_ENCRYPTION_KEY）",
      code: "GSC_NOT_CONFIGURED",
    }, { status: 503 });
  }

  const url = new URL(req.url);
  // redirect_uri 必须与 Google Cloud Console 中登记的一致；可用 GSC_OAUTH_REDIRECT_URI 覆盖
  const redirectUri = process.env.GSC_OAUTH_REDIRECT_URI ?? `${url.origin}/api/gsc/auth/callback`;
  const state = signOAuthState(auth.user.id);
  return NextResponse.redirect(buildGoogleAuthUrl(redirectUri, state));
}
