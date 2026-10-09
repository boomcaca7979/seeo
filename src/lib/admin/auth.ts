// ===== Owner Console 授权层（/admin）=====
//
// 设计原则（与任务要求一致）：
//   1. **不新增第二套登录系统**：完全复用现有 Supabase Auth 会话
//      （`createServer().auth.getUser()`）。owner 身份 = 明确授权的邮箱白名单。
//   2. **fail-closed**：未配置 ADMIN_EMAILS、未登录、邮箱不在白名单、
//      或鉴权被关闭（演示模式）—— 一律拒绝。绝不出现"配置缺失即放开"。
//   3. 页面用 `requireAdminPage()`（重定向），API 用 `requireAdminApi()`（返回状态码）。

import { createServer } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/auth-config";

/** 白名单环境变量名（逗号分隔的邮箱） */
export const ADMIN_EMAILS_ENV = "ADMIN_EMAILS";

export interface AdminIdentity {
  userId: string;
  email: string;
}

export type AdminGuardResult =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; status: 401 | 403 | 503; code: AdminDenyCode; error: string };

export type AdminDenyCode =
  | "ADMIN_NOT_CONFIGURED"
  | "AUTH_REQUIRED"
  | "NOT_AN_ADMIN";

/** 解析 ADMIN_EMAILS 白名单（小写、去空、去重） */
export function getAdminEmails(raw: string | undefined = process.env[ADMIN_EMAILS_ENV]): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/** 白名单是否已配置（false 时 /admin 完全关闭） */
export function isAdminConfigured(raw?: string): boolean {
  return getAdminEmails(raw).length > 0;
}

/** 邮箱是否在 owner 白名单内（大小写不敏感；空值恒 false） */
export function isAdminEmail(
  email: string | null | undefined,
  raw?: string
): boolean {
  if (!email) return false;
  return getAdminEmails(raw).includes(email.trim().toLowerCase());
}

/** 读取当前会话身份（未登录 / 鉴权关闭返回 null） */
export async function getCurrentIdentity(): Promise<AdminIdentity | null> {
  if (!isAuthEnabled) return null;
  try {
    const supabase = await createServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return null;
    return { userId: user.id, email: user.email };
  } catch {
    return null;
  }
}

/**
 * 统一的 owner 校验（页面与 API 共用）。
 * 返回失败原因的稳定错误码，调用方各自决定如何呈现。
 */
export async function checkAdmin(): Promise<AdminGuardResult> {
  if (!isAdminConfigured()) {
    return {
      ok: false,
      status: 503,
      code: "ADMIN_NOT_CONFIGURED",
      error: `Owner Console 未启用：请配置 ${ADMIN_EMAILS_ENV}（逗号分隔的 owner 邮箱）。`,
    };
  }
  const identity = await getCurrentIdentity();
  if (!identity) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      error: "请先使用 owner 账号登录。",
    };
  }
  if (!isAdminEmail(identity.email)) {
    return {
      ok: false,
      status: 403,
      code: "NOT_AN_ADMIN",
      error: "当前账号没有 Owner Console 访问权限。",
    };
  }
  return { ok: true, identity };
}

/** Cron / 运维脚本用的 Bearer 校验（fail-closed；与既有 /api/cron/* 同一防线） */
export function hasCronSecret(req: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
