// ===== Owner Console：Supabase 权威快照读取 =====
//
// profiles 与 orders 都在 Supabase（RLS 保护），服务端用 admin client（service_role）
// 读取。任何失败都必须**如实降级**（available=false + error），不得返回 0 冒充"没有"。

import { getAdminClient } from "@/lib/supabase/admin";

export interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  plan: string;
  subscription_status: string;
  current_period_end: string | null;
}

export interface OrderRow {
  id: string;
  user_id: string;
  out_trade_no: string;
  plan: string;
  amount: number;
  currency: string;
  payment_channel: string | null;
  payment_status: string;
  paid_at: string | null;
  refund_status: string | null;
  refund_amount: number | null;
  refunded_at: string | null;
  created_at: string;
  period_end: string | null;
  param: string | null;
}

export interface Snapshot<T> {
  available: boolean;
  rows: T[];
  /** 是否因分页上限被截断 */
  truncated: boolean;
  error?: string;
}

const PAGE_SIZE = 1000;
/** 上限保护：一次最多读取 5000 行（owner console 规模足够；超出会标记 truncated） */
const MAX_ROWS = 5000;

async function readPaged<T>(
  table: "profiles" | "orders",
  columns: string,
  orderBy: string
): Promise<Snapshot<T>> {
  const admin = getAdminClient();
  if (!admin) {
    return {
      available: false,
      rows: [],
      truncated: false,
      error: "SUPABASE_SERVICE_ROLE_KEY 未配置，无法读取权威表",
    };
  }
  const rows: T[] = [];
  try {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await admin
        .from(table)
        .select(columns)
        .order(orderBy, { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        return { available: false, rows: [], truncated: false, error: error.message };
      }
      const batch = (data ?? []) as unknown as T[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) {
        return { available: true, rows, truncated: false };
      }
    }
    return { available: true, rows, truncated: true };
  } catch (err) {
    return {
      available: false,
      rows: [],
      truncated: false,
      error: err instanceof Error ? err.message : "未知读取错误",
    };
  }
}

/** 轻量连通性探针：只取 1 行，判断 service_role 是否真的能读（不拉全量） */
export async function probeSupabase(): Promise<{ ok: boolean; error?: string }> {
  const admin = getAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未配置" };
  try {
    const { error } = await admin.from("profiles").select("id").limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "未知连接错误" };
  }
}

export async function getProfilesSnapshot(): Promise<Snapshot<ProfileRow>> {
  return readPaged<ProfileRow>(
    "profiles",
    "id, email, display_name, created_at, plan, subscription_status, current_period_end",
    "created_at"
  );
}

export async function getOrdersSnapshot(): Promise<Snapshot<OrderRow>> {
  return readPaged<OrderRow>(
    "orders",
    "id, user_id, out_trade_no, plan, amount, currency, payment_channel, payment_status, paid_at, refund_status, refund_amount, refunded_at, created_at, period_end, param",
    "created_at"
  );
}

/** 窗口起点（ISO，UTC；用于与 Supabase timestamptz 字符串比较） */
export function windowStartIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** ISO 字符串是否落在近 N 天窗口内（无法解析的时间视为不在窗口内） */
export function withinWindow(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= Date.now() - days * 86_400_000;
}
