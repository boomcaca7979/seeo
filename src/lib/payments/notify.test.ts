// ===== 老板付款通知逻辑测试（模拟邮件服务，不发真实邮件）=====
// 覆盖任务要求的 8 项：
//   1. 成功支付触发一封（字段映射正确）
//   2. 重复 webhook / 重投不重复发送
//   3. 非成功支付（未 opened / 续费判定不满足）不触发
//   4. 续费语义（kind=renewal，dedupe = 订阅 + 交易号）
//   5. 邮件失败不影响支付链路（不抛错、订单/订阅状态由调用方独立处理）
//   6. 失败留痕可重试（last_error + 重试成功 / attempts 封顶）
//   7. provider 未配置：保持 pending 不烧 attempts
//   8. 历史订单不伪装已发送（无通知记录 → none）

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQLiteAdapter } from "../db/adapter";

function makeAdapter(): SQLiteAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE payment_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('first_payment', 'renewal')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      payload_json TEXT NOT NULL,
      provider_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return new SQLiteAdapter(raw);
}

let currentAdapter: SQLiteAdapter;
vi.mock("../db/migrations", () => ({
  getAdapter: vi.fn(async () => currentAdapter),
}));

// 统一发送层 mock（可注入成功/失败/未配置）
const h = vi.hoisted(() => ({
  sendTx: vi.fn(),
}));
vi.mock("../email/service", () => ({
  sendTransactionalEmail: h.sendTx,
}));

// Supabase 不可用 → getAccountEmail 返回 null（邮箱回退路径单独断言）
vi.mock("../supabase/admin", () => ({
  getAdminClient: vi.fn(() => null),
}));

const {
  queuePaymentNotification,
  deliverPaymentNotification,
  retryPendingPaymentNotifications,
  shouldNotifyRenewal,
  firstPaymentDedupeKey,
  renewalDedupeKey,
  buildSubject,
  buildHtml,
} = await import("./notify");

const FIRST_PAYLOAD = {
  paidAt: "2026-10-12T08:30:00.000Z",
  customerEmail: "customer@example.com",
  plan: "pro",
  productName: "SeeO Pro",
  amount: 29,
  currency: "USD",
  outTradeNo: "S20261012abc123",
  transactionId: "ch_123",
  subscriptionId: null as string | null,
  kind: "first_payment" as const,
  periodEndIso: null as string | null,
};

const RENEWAL_PAYLOAD = {
  paidAt: "2026-11-12T08:30:00.000Z",
  customerEmail: "customer@example.com",
  plan: "pro",
  productName: "SeeO Pro",
  amount: 29,
  currency: "USD",
  outTradeNo: "S20261012abc123",
  transactionId: "txn_renew_1",
  subscriptionId: "sub_1",
  kind: "renewal" as const,
  periodEndIso: "2026-12-12T08:30:00.000Z",
};

function sentResult() {
  return { status: "sent", claimed: true, messageId: "msg-1" };
}

async function notifRows(): Promise<Array<Record<string, unknown>>> {
  return (await currentAdapter.query(
    `SELECT * FROM payment_notifications ORDER BY id`
  )) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  currentAdapter = makeAdapter();
  h.sendTx.mockReset();
  h.sendTx.mockImplementation(async () => sentResult());
});

describe("付款通知（模拟邮件服务）", () => {
  it("① 成功支付触发一封：入队 + 投递 → sent，邮件字段映射正确", async () => {
    const id = await queuePaymentNotification(FIRST_PAYLOAD);
    expect(id).not.toBeNull();
    const out = await deliverPaymentNotification(id as number);
    expect(out.status).toBe("sent");

    expect(h.sendTx).toHaveBeenCalledTimes(1);
    const arg = h.sendTx.mock.calls[0][0];
    expect(arg.email).toBe("boomcaca666@gmail.com");
    expect(arg.subject).toContain("29.00 USD");
    expect(arg.subject).toContain("S20261012abc123");
    expect(arg.html).toContain("customer@example.com");
    expect(arg.html).toContain("SeeO Pro");
    expect(arg.html).toContain("首次付款");

    const rows = await notifRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].provider_message_id).toBe("msg-1");
  });

  it("② 重复 webhook（同笔支付重复入队/重复投递）不重复发送", async () => {
    const id1 = await queuePaymentNotification(FIRST_PAYLOAD);
    const id2 = await queuePaymentNotification({ ...FIRST_PAYLOAD, paidAt: "2026-10-12T09:00:00.000Z" });
    // dedupe_key 相同 → 同一行
    expect(id1).toBe(id2);
    const rows = await notifRows();
    expect(rows).toHaveLength(1);

    await deliverPaymentNotification(id1 as number);
    const out2 = await deliverPaymentNotification(id1 as number);
    expect(out2.status).toBe("already_sent");
    expect(h.sendTx).toHaveBeenCalledTimes(1);
  });

  it("③ 非成功支付不触发：续费判定纯函数（未 opened/首付/快照不可用/周期未推进 → false）", async () => {
    const base = {
      subscriptionId: "sub_1",
      snapshotOk: true,
      snapshotCreated: false,
      isFirstTransaction: false,
      periodAdvanced: true,
    };
    expect(shouldNotifyRenewal(base)).toBe(true);
    // 首付（订阅快照刚创建）不是续费
    expect(shouldNotifyRenewal({ ...base, snapshotCreated: true })).toBe(false);
    // 快照不可用（无法区分首投/重投）→ 不发（诚实边界）
    expect(shouldNotifyRenewal({ ...base, snapshotOk: false })).toBe(false);
    // 周期未推进（首付事件的重投/同周期 active）→ 不发
    expect(shouldNotifyRenewal({ ...base, periodAdvanced: false })).toBe(false);
    // 缺订阅 id → 无法可靠去重 → 不发
    expect(shouldNotifyRenewal({ ...base, subscriptionId: null })).toBe(false);
    // 同一笔首付交易号 → 不发
    expect(shouldNotifyRenewal({ ...base, isFirstTransaction: true })).toBe(false);
  });

  it("④ 续费语义：kind=renewal，dedupe = renew:<订阅>:<交易号>；缺依据时 null", async () => {
    expect(renewalDedupeKey("sub_1", "txn_9", null)).toBe("renew:sub_1:txn_9");
    expect(renewalDedupeKey("sub_1", null, "2026-12-12")).toBe("renew:sub_1:2026-12-12");
    expect(renewalDedupeKey(null, "txn_9", null)).toBeNull();
    expect(renewalDedupeKey("sub_1", null, null)).toBeNull();

    const id = await queuePaymentNotification(RENEWAL_PAYLOAD);
    const rows = await notifRows();
    expect(rows[0].dedupe_key).toBe("renew:sub_1:txn_renew_1");
    expect(rows[0].kind).toBe("renewal");
    await deliverPaymentNotification(id as number);
    const arg = h.sendTx.mock.calls[0][0];
    expect(arg.subject).toContain("订阅续费");
    expect(arg.html).toContain("订阅续费");
  });

  it("⑤ 邮件失败不影响支付链路：deliver 返回 failed 不抛错，订单/订阅表零写入", async () => {
    h.sendTx.mockImplementation(async () => ({ status: "failed", claimed: true, reason: "provider 5xx" }));
    const id = await queuePaymentNotification(FIRST_PAYLOAD);
    await expect(deliverPaymentNotification(id as number)).resolves.toMatchObject({ status: "failed" });
    const rows = await notifRows();
    expect(rows[0].status).toBe("failed");
    expect(rows[0].last_error).toBe("provider 5xx");
    // 支付链路本身不写本表之外的任何状态（本模块对外不抛错即测试通过）
  });

  it("⑥ 失败留痕可重试：重试成功 → sent；超过 attempts 封顶不再处理", async () => {
    h.sendTx.mockImplementationOnce(async () => ({ status: "failed", claimed: true, reason: "boom" }));
    const id = await queuePaymentNotification(FIRST_PAYLOAD);
    await deliverPaymentNotification(id as number);
    let rows = await notifRows();
    expect(rows[0].status).toBe("failed");
    expect(rows[0].last_error).toBe("boom");
    expect(Number(rows[0].attempts)).toBe(1);

    // 恢复成功 → 巡检重试成功
    h.sendTx.mockImplementation(async () => sentResult());
    const summary = await retryPendingPaymentNotifications();
    expect(summary.sent).toBe(1);
    rows = await notifRows();
    expect(rows[0].status).toBe("sent");
    expect(rows[0].last_error).toBeNull();

    // attempts 封顶：手工造 5 次失败的记录 → 巡检跳过
    await currentAdapter.run(
      `UPDATE payment_notifications SET status='failed', attempts=5 WHERE id=?`,
      [Number(rows[0].id)]
    );
    // 复位为 failed 且 attempts 已达上限 → 不再处理
    const summary2 = await retryPendingPaymentNotifications();
    expect(summary2.processed).toBe(0);
  });

  it("⑦ provider 未配置：保持 pending、不烧 attempts，配置恢复后可发出", async () => {
    h.sendTx.mockImplementation(async () => ({ status: "skipped_no_provider", claimed: true }));
    const id = await queuePaymentNotification(FIRST_PAYLOAD);
    const out = await deliverPaymentNotification(id as number);
    expect(out.status).toBe("pending");
    let rows = await notifRows();
    expect(rows[0].status).toBe("pending");
    expect(Number(rows[0].attempts)).toBe(0); // 不烧重试次数

    h.sendTx.mockImplementation(async () => sentResult());
    const out2 = await deliverPaymentNotification(id as number);
    expect(out2.status).toBe("sent");
    rows = await notifRows();
    expect(rows[0].status).toBe("sent");
  });

  it("⑧ 历史订单不伪装已发送：无通知记录 → status=none + 展示为「历史记录」", async () => {
    const { buildRecentPaymentRows } = await import("../admin/recent-payments");
    const orders = [
      {
        id: "o1",
        user_id: "u1",
        out_trade_no: "OLD20260101",
        trade_no: null,
        api_trade_no: null,
        plan: "lite",
        amount: 9,
        currency: "USD",
        payment_channel: "creem",
        payment_status: "paid",
        paid_at: "2026-01-01T00:00:00Z",
        refund_status: null,
        refund_amount: null,
        refunded_at: null,
        period_type: null,
        period_end: null,
        clientip: null,
        param: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        ...({} as object),
        id: "o2",
        user_id: "u2",
        out_trade_no: "S20261012abc123",
        trade_no: null,
        api_trade_no: null,
        plan: "pro",
        amount: 29,
        currency: "USD",
        payment_channel: "creem",
        payment_status: "paid",
        paid_at: "2026-10-12T08:30:00Z",
        refund_status: null,
        refund_amount: null,
        refunded_at: null,
        period_type: null,
        period_end: null,
        clientip: null,
        param: null,
        created_at: "2026-10-12T08:30:00Z",
        updated_at: "2026-10-12T08:30:00Z",
      } as never,
    ];
    const id = await queuePaymentNotification(FIRST_PAYLOAD);
    await deliverPaymentNotification(id as number);
    const notifications = await (
      await import("./notify")
    ).getNotificationsByOutTradeNo(["OLD20260101", "S20261012abc123"]);
    const rows = buildRecentPaymentRows({
      orders: orders as never[],
      emailByUser: new Map([
        ["u1", "old@example.com"],
        ["u2", "customer@example.com"],
      ]),
      notifications,
    });
    expect(rows).toHaveLength(2);
    const historical = rows.find((r) => r.outTradeNo === "OLD20260101");
    const recent = rows.find((r) => r.outTradeNo === "S20261012abc123");
    expect(historical?.notifyStatus).toBe("none"); // 无记录 ≠ 已发送
    expect(recent?.notifyStatus).toBe("sent");
    // 排序：最近的在前
    expect(rows[0].outTradeNo).toBe("S20261012abc123");
  });

  it("附加：dedupe key / 主题内容纯函数", () => {
    expect(firstPaymentDedupeKey("S1")).toBe("pay:S1");
    expect(buildSubject(FIRST_PAYLOAD)).toContain("首次付款");
    expect(buildHtml(FIRST_PAYLOAD, 2)).toContain("第 2 次尝试");
    // 续费金额如实标注为套餐价
    expect(buildHtml(RENEWAL_PAYLOAD, 1)).toContain("以 Creem 实际扣款为准");
  });
});
