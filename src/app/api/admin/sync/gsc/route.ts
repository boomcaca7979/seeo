// ===== POST /api/admin/sync/gsc =====
// 触发一次 Owner 级 GSC 同步（日序列 + 7/28/90 窗口的 query/page/country/device）。
//
// 授权：已登录 owner（ADMIN_EMAILS 白名单）**或** CRON_SECRET Bearer（无人值守定时同步）。
// 说明：这是唯一会真实请求 Google API 的入口；Admin 页面本身只读本地快照表。

import { NextResponse } from "next/server";
import { checkAdmin, hasCronSecret } from "@/lib/admin/auth";
import {
  syncOwnerGscMetrics,
  OwnerGscNotConnectedError,
  GSC_WINDOWS,
} from "@/lib/admin/gsc-sync";
import { GscNotConfiguredError, GscProviderError } from "@/lib/seo/gsc-provider";
import { recordSourceEvent } from "@/lib/admin/source-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GROWTH_PATH = "/admin/growth";

function wantsRedirect(req: Request): boolean {
  const ct = req.headers.get("content-type") ?? "";
  return ct.includes("form-urlencoded") || ct.includes("multipart/form-data");
}

function fail(req: Request, reason: string, status = 500): NextResponse {
  if (wantsRedirect(req)) {
    const url = new URL(GROWTH_PATH, req.url);
    url.searchParams.set("sync", "error");
    url.searchParams.set("error", reason.slice(0, 200));
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: reason }, { status });
}

export async function POST(req: Request) {
  // 1. 授权：owner 会话 或 CRON_SECRET
  const cron = hasCronSecret(req);
  if (!cron) {
    const guard = await checkAdmin();
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.error, code: guard.code },
        { status: guard.status }
      );
    }
  }

  // 2. 可选窗口覆盖（默认 7/28/90）
  let windows: readonly number[] = GSC_WINDOWS;
  if (wantsRedirect(req)) {
    try {
      const form = await req.formData();
      const raw = String(form.get("windows") ?? "");
      const parsed = raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n <= 480);
      if (parsed.length > 0) windows = parsed;
    } catch {
      // 忽略，使用默认窗口
    }
  }

  // 3. 执行同步
  try {
    const summary = await syncOwnerGscMetrics(windows);
    void recordSourceEvent(
      "gsc",
      "success",
      `OAuth 同步成功：日序列 ${summary.dailyRows} 行，窗口 ${windows.join("/")}d`
    );
    if (wantsRedirect(req)) {
      const url = new URL(GROWTH_PATH, req.url);
      url.searchParams.set("sync", "ok");
      url.searchParams.set("rows", String(summary.dailyRows));
      return NextResponse.redirect(url);
    }
    return NextResponse.json({ data: summary });
  } catch (err) {
    const reason =
      err instanceof OwnerGscNotConnectedError
        ? "尚未绑定 Search Console 属性（见 /admin/data-sources）"
        : err instanceof GscNotConfiguredError
          ? err.message
          : err instanceof GscProviderError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : "同步失败";
    void recordSourceEvent("gsc", "error", `OAuth 同步失败：${reason}`);
    if (err instanceof OwnerGscNotConnectedError) {
      return fail(req, reason, 409);
    }
    if (err instanceof GscNotConfiguredError) {
      return fail(req, reason, 503);
    }
    if (err instanceof GscProviderError) {
      return fail(req, reason, err.status === 401 ? 401 : 502);
    }
    return fail(req, reason);
  }
}
