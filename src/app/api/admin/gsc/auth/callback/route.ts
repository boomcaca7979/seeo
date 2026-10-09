// ===== GET /api/admin/gsc/auth/callback =====
// Owner 级 GSC OAuth 回调：校验 state → 授权码换 token → 选择属性 → 加密存储。
//
// 属性选择顺序（避免要求 owner 手工填 ID，同时不猜错）：
//   1. 环境变量 GSC_ADMIN_PROPERTY（显式指定，优先级最高）
//   2. 授权下只有 1 个属性 → 直接用
//   3. 属性中含 seeo.asia → 用该属性
//   4. 其余情况 → 报 gsc_property_ambiguous，提示配置 GSC_ADMIN_PROPERTY

import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin/auth";
import {
  adminGscRedirectUri,
  encryptOwnerTokenSet,
  isOwnerGscOAuthConfigured,
  saveOwnerGscConnection,
} from "@/lib/admin/gsc-connection";
import {
  exchangeGoogleCode,
  getGscUserEmail,
  listGscSites,
  type GscSite,
} from "@/lib/seo/gsc-provider";
import { verifyOAuthState } from "@/lib/seo/gsc-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_SOURCES_PATH = "/admin/data-sources";

function back(req: Request, status: string, reason?: string): NextResponse {
  const url = new URL(DATA_SOURCES_PATH, req.url);
  url.searchParams.set("gsc", status);
  if (reason) url.searchParams.set("reason", reason.slice(0, 160));
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const guard = await checkAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error, code: guard.code }, { status: guard.status });
  }
  if (!isOwnerGscOAuthConfigured()) return back(req, "error", "not_configured");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return back(req, "error", "user_cancelled");
  if (!code || !state) return back(req, "error", "missing_params");

  // state 中的载荷必须是当前 owner 邮箱（防 CSRF / 串号）
  const statePayload = verifyOAuthState(state);
  if (!statePayload || statePayload !== guard.identity.email) {
    return back(req, "error", "invalid_state");
  }

  try {
    const tokens = await exchangeGoogleCode(code, adminGscRedirectUri(url.origin));
    const [sites, email] = await Promise.all([
      listGscSites(tokens.access_token),
      getGscUserEmail(tokens.access_token),
    ]);

    const chosen = pickProperty(sites);
    if (!chosen) {
      return back(
        req,
        "error",
        sites.length === 0
          ? "no_property：该 Google 账号下没有 Search Console 属性"
          : "gsc_property_ambiguous：授权下有多个属性，请设置 GSC_ADMIN_PROPERTY 后重试"
      );
    }

    await saveOwnerGscConnection({
      propertyUrl: chosen.siteUrl,
      propertyType: chosen.siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix",
      googleEmail: email,
      encryptedCredentials: encryptOwnerTokenSet({
        refreshToken: tokens.refresh_token ?? null,
        accessToken: tokens.access_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scope: tokens.scope ?? null,
      }),
    });

    return back(req, "connected");
  } catch {
    return back(req, "error", "token_exchange_failed");
  }
}

function pickProperty(sites: GscSite[]): GscSite | null {
  if (sites.length === 0) return null;
  const explicit = (process.env.GSC_ADMIN_PROPERTY ?? "").trim();
  if (explicit) {
    const match = sites.find((s) => s.siteUrl === explicit);
    if (match) return match;
  }
  if (sites.length === 1) return sites[0];
  const seeo = sites.find((s) => s.siteUrl.includes("seeo.asia"));
  return seeo ?? null;
}
