// ===== GET /api/admin/gsc/auth/start =====
// Owner 级 GSC 授权入口（webmasters.readonly，离线 access）。
// 复用既有 gsc-provider（buildGoogleAuthUrl）与 gsc-service（signOAuthState），不新增第二套 OAuth。

import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin/auth";
import { adminGscRedirectUri, isOwnerGscOAuthConfigured } from "@/lib/admin/gsc-connection";
import { buildGoogleAuthUrl } from "@/lib/seo/gsc-provider";
import { signOAuthState } from "@/lib/seo/gsc-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_SOURCES_PATH = "/admin/data-sources";

export async function GET(req: Request) {
  const guard = await checkAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error, code: guard.code }, { status: guard.status });
  }
  const origin = new URL(req.url).origin;
  if (!isOwnerGscOAuthConfigured()) {
    const url = new URL(DATA_SOURCES_PATH, req.url);
    url.searchParams.set("gsc", "not_configured");
    url.searchParams.set(
      "missing",
      "GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GSC_TOKEN_ENCRYPTION_KEY"
    );
    return NextResponse.redirect(url);
  }

  // state 复用 GSC_TOKEN_ENCRYPTION_KEY 的 HMAC 签名（10 分钟有效），载荷为 owner 邮箱
  const state = signOAuthState(guard.identity.email);
  return NextResponse.redirect(buildGoogleAuthUrl(adminGscRedirectUri(origin), state));
}
