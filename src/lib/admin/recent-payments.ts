// ===== Owner Console：最近成功付款（orders 权威 + profiles 邮箱 + 通知状态）=====
//
// 口径：
//   - 「成功付款」= orders.payment_status ∈ {paid, refunded}（refunded 表示曾经付过）
//   - 金额按订单自身币种展示，绝不跨币种换算/混算
//   - 通知状态来自 payment_notifications（dedupe_key = pay:<out_trade_no>）：
//       none = 无通知记录 → 历史订单（通知功能上线前），UI 不得伪装成「已发送」
//

import {
  getNotificationsByOutTradeNo,
  type PaymentNotificationRow,
} from "@/lib/payments/notify";
import {
  getOrdersSnapshot,
  getProfilesSnapshot,
  type OrderRow,
} from "./snapshot";

export type PaymentNotifyStatus = "sent" | "failed" | "pending" | "none";

export interface RecentPaymentRow {
  outTradeNo: string;
  paidAt: string | null;
  customerEmail: string | null;
  plan: string;
  amountCents: number;
  currency: string;
  channel: string | null;
  notifyStatus: PaymentNotifyStatus;
  notifyAttempts: number;
  notifyLastError: string | null;
  /** payment_notifications.id（手动重试按钮用；none 时为 null） */
  notifyId: number | null;
}

function isPaid(o: OrderRow): boolean {
  return o.payment_status === "paid" || o.payment_status === "refunded";
}

/** 纯函数（可单测）：orders + 邮箱映射 + 通知映射 → 展示行（按 paid_at 降序） */
export function buildRecentPaymentRows(args: {
  orders: OrderRow[];
  emailByUser: Map<string, string>;
  notifications: Map<string, PaymentNotificationRow>;
  limit?: number;
}): RecentPaymentRow[] {
  const limit = args.limit ?? 10;
  const ts = (v: string | null) => {
    const t = v ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? 0 : t;
  };
  const paid = args.orders
    .filter(isPaid)
    .sort((a, b) => ts(b.paid_at) - ts(a.paid_at))
    .slice(0, limit);

  return paid.map((o) => {
    const n = args.notifications.get(o.out_trade_no) ?? null;
    return {
      outTradeNo: o.out_trade_no,
      paidAt: o.paid_at,
      customerEmail: args.emailByUser.get(o.user_id) ?? null,
      plan: o.plan,
      amountCents: Math.round(Number(o.amount ?? 0) * 100),
      currency: String(o.currency ?? "USD").toUpperCase(),
      channel: o.payment_channel ?? null,
      notifyStatus: n ? n.status : "none",
      notifyAttempts: n?.attempts ?? 0,
      notifyLastError: n?.lastError ?? null,
      notifyId: n?.id ?? null,
    };
  });
}

export interface RecentPaymentsSnapshot {
  ordersAvailable: boolean;
  ordersError?: string;
  rows: RecentPaymentRow[];
}

/** 查询最近成功付款（含通知状态）。订单不可读时 rows=[] 且 available=false。 */
export async function getRecentPayments(limit = 10): Promise<RecentPaymentsSnapshot> {
  const ordersSnap = await getOrdersSnapshot();
  if (!ordersSnap.available) {
    return { ordersAvailable: false, ordersError: ordersSnap.error, rows: [] };
  }
  const paid = ordersSnap.rows.filter(isPaid);
  const ts = (v: string | null) => {
    const t = v ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? 0 : t;
  };
  const recent = [...paid].sort((a, b) => ts(b.paid_at) - ts(a.paid_at)).slice(0, limit);

  // 邮箱映射（profiles 权威账号邮箱）；profiles 不可读时邮箱列为空，不阻塞订单展示
  const profilesSnap = await getProfilesSnapshot();
  const emailByUser = new Map<string, string>();
  if (profilesSnap.available) {
    for (const p of profilesSnap.rows) emailByUser.set(p.id, p.email);
  }

  const notifications = await getNotificationsByOutTradeNo(recent.map((o) => o.out_trade_no));

  return {
    ordersAvailable: true,
    rows: buildRecentPaymentRows({
      orders: recent,
      emailByUser,
      notifications,
      limit,
    }),
  };
}
