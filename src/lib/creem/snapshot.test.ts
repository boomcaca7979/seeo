// ===== Creem 本地经营快照测试（真实 SQLite，走 migration + 真实 SQL）=====
//
// 为什么用真实库而不是 mock：本文件要证明的是**收入口径与幂等**，
// 那正是 SQL（PRIMARY KEY / INSERT OR IGNORE / SUM CASE WHEN）在保证的东西。
// mock 掉数据库等于把被测对象抽走，测不出"重投是否重复计收入"。
//
// 关键不变量：
//   1. 事件账本：同一 event id 只能被 claim 一次；processed/ignored → duplicate；failed/received → retry；
//   2. 收入：gross = Σ payment(paid)，refunds = Σ refund，**重投永不重复计**；
//   3. 订阅状态迁移只在真的变化时改变 statusChanged（决定是否发射 analytics 事件）；
//   4. Admin 页面只读本地表 —— 这些函数里没有任何网络调用。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-admin-snapshot-"));

type SnapshotModule = typeof import("./snapshot");
type MigrationsModule = typeof import("@/lib/db/migrations");

let snap: SnapshotModule;
let db: MigrationsModule;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  vi.resetModules();
  snap = await import("./snapshot");
  db = await import("@/lib/db/migrations");
  // 触发 migration（getAdapter 内部会 migrate）
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("claimWebhookEvent / finishWebhookEvent：事件账本", () => {
  it("首次到达 → claimed", async () => {
    await expect(
      snap.claimWebhookEvent({ eventId: "evt-a", eventType: "checkout.completed" })
    ).resolves.toBe("claimed");
  });

  it("未 finish（处理中崩溃留下的 received）→ retry，事件不会被永久丢弃", async () => {
    await snap.claimWebhookEvent({ eventId: "evt-b", eventType: "checkout.completed" });
    await expect(
      snap.claimWebhookEvent({ eventId: "evt-b", eventType: "checkout.completed" })
    ).resolves.toBe("retry");
  });

  it("processed 之后重投 → duplicate（幂等命中）", async () => {
    await snap.claimWebhookEvent({ eventId: "evt-c", eventType: "checkout.completed" });
    await snap.finishWebhookEvent("evt-c", "processed");
    await expect(
      snap.claimWebhookEvent({ eventId: "evt-c", eventType: "checkout.completed" })
    ).resolves.toBe("duplicate");
  });

  it("ignored（未处理事件类型）→ duplicate", async () => {
    await snap.claimWebhookEvent({ eventId: "evt-d", eventType: "product.created" });
    await snap.finishWebhookEvent("evt-d", "ignored", "unhandled: product.created");
    await expect(
      snap.claimWebhookEvent({ eventId: "evt-d", eventType: "product.created" })
    ).resolves.toBe("duplicate");
  });

  it("failed → retry（允许 Creem 重放）", async () => {
    await snap.claimWebhookEvent({ eventId: "evt-e", eventType: "refund.created" });
    await snap.finishWebhookEvent("evt-e", "failed", "boom");
    await expect(
      snap.claimWebhookEvent({ eventId: "evt-e", eventType: "refund.created" })
    ).resolves.toBe("retry");
  });

  it("事件账本记录 event_type / object_id / detail，便于人工排查", async () => {
    await snap.claimWebhookEvent({
      eventId: "evt-f",
      eventType: "checkout.completed",
      objectId: "ch_1",
    });
    await snap.finishWebhookEvent("evt-f", "failed", "x".repeat(900));
    const adapter = await db.getAdapter();
    const row = (await adapter.get(
      `SELECT event_type, object_id, status, LENGTH(detail) AS detail_len, processed_at
         FROM creem_webhook_events WHERE id = 'evt-f'`
    )) as {
      event_type: string;
      object_id: string;
      status: string;
      detail_len: number;
      processed_at: string | null;
    };
    expect(row.event_type).toBe("checkout.completed");
    expect(row.object_id).toBe("ch_1");
    expect(row.status).toBe("failed");
    expect(row.detail_len).toBe(500); // detail 截断上限
    expect(row.processed_at).not.toBeNull();
  });
});

describe("收入口径：gross - refunds = net（重投不重复计）", () => {
  it("同一 Creem order id 写两次 → 只计一次", async () => {
    await snap.recordCreemPayment({
      transactionId: "ord_dup",
      status: "paid",
      amountCents: 990,
      userId: "u-rev",
      outTradeNo: "S-REV-1",
    });
    await snap.recordCreemPayment({
      transactionId: "ord_dup",
      status: "paid",
      amountCents: 990,
      userId: "u-rev",
      outTradeNo: "S-REV-1",
    });
    const rev = await snap.getCreemRevenueSnapshot();
    expect(rev.grossCents).toBe(990);
    expect(rev.payments).toBe(1);
  });

  it("未 paid 的交易不计入 gross（pending / failed）", async () => {
    await snap.recordCreemPayment({
      transactionId: "ord_pending",
      status: "pending",
      amountCents: 5000,
    });
    await snap.recordCreemPayment({
      transactionId: "ord_failed",
      status: "failed",
      amountCents: 5000,
    });
    const rev = await snap.getCreemRevenueSnapshot();
    expect(rev.grossCents).toBe(990);
    expect(rev.payments).toBe(1);
  });

  it("退款按 refund id 幂等，net 递减", async () => {
    await snap.recordCreemRefund({
      refundId: "ref_1",
      amountCents: 400,
      userId: "u-rev",
      parentTransactionId: "ord_dup",
    });
    await snap.recordCreemRefund({ refundId: "ref_1", amountCents: 400 }); // 重投
    const rev = await snap.getCreemRevenueSnapshot();
    expect(rev.grossCents).toBe(990);
    expect(rev.refundCents).toBe(400);
    expect(rev.netCents).toBe(590);
    expect(rev.refunds).toBe(1);
  });

  it("新增一笔收款 → gross / net 同步增长", async () => {
    await snap.recordCreemPayment({
      transactionId: "ord_second",
      status: "paid",
      amountCents: 1000,
      currency: "usd",
    });
    const rev = await snap.getCreemRevenueSnapshot();
    expect(rev.grossCents).toBe(1990);
    expect(rev.refundCents).toBe(400);
    expect(rev.netCents).toBe(1590);
    expect(rev.payments).toBe(2);
    expect(rev.currency).toBe("USD"); // MAX(currency) 规范化为大写
  });

  it("负数金额在写入前被夹到 0（不产生负收入行）", async () => {
    await snap.recordCreemPayment({
      transactionId: "ord_negative",
      status: "paid",
      amountCents: -500,
    });
    const rev = await snap.getCreemRevenueSnapshot();
    expect(rev.grossCents).toBe(1990);
  });
});

describe("upsertCreemSubscription：状态迁移判定", () => {
  /** Creem live 的 lite 产品 ID（config.ts 里的固定映射，非敏感常量） */
  const LITE_PRODUCT_ID = "prod_1lm34wwaIsim962h2ibpmx";

  it("首次插入 created=true 且 statusChanged=true，plan 由 product id 反查", async () => {
    const r = await snap.upsertCreemSubscription({
      subscriptionId: "sub_x",
      status: "active",
      userId: "u-sub",
      productId: LITE_PRODUCT_ID,
    });
    expect(r).toEqual({ created: true, previousStatus: null, statusChanged: true });
    const adapter = await db.getAdapter();
    const row = (await adapter.get(
      `SELECT plan FROM creem_subscriptions WHERE creem_subscription_id = 'sub_x'`
    )) as { plan: string | null };
    expect(row.plan).toBe("lite");
  });

  it("未知 product id → plan 保持 null（不猜测档位）", async () => {
    await snap.upsertCreemSubscription({
      subscriptionId: "sub_unknown_product",
      status: "active",
      productId: "prod_does_not_exist",
    });
    const adapter = await db.getAdapter();
    const row = (await adapter.get(
      `SELECT plan FROM creem_subscriptions WHERE creem_subscription_id = 'sub_unknown_product'`
    )) as { plan: string | null };
    expect(row.plan).toBeNull();
  });

  it("同一状态重放 → statusChanged=false（不重复发射 subscription_active）", async () => {
    const r = await snap.upsertCreemSubscription({ subscriptionId: "sub_x", status: "active" });
    expect(r).toEqual({ created: false, previousStatus: "active", statusChanged: false });
  });

  it("状态真正变化 → statusChanged=true", async () => {
    const r = await snap.upsertCreemSubscription({ subscriptionId: "sub_x", status: "canceled" });
    expect(r).toEqual({ created: false, previousStatus: "active", statusChanged: true });
  });

  it("canceled 写入 canceled_at，重投不覆盖历史取消时间、也不再报告状态变化", async () => {
    const adapter = await db.getAdapter();
    const read = async () =>
      (await adapter.get(
        `SELECT plan, canceled_at, status FROM creem_subscriptions WHERE creem_subscription_id = 'sub_x'`
      )) as { plan: string | null; canceled_at: string | null; status: string };

    const before = await read();
    expect(before.status).toBe("canceled");
    expect(before.canceled_at).not.toBeNull();

    const replay = await snap.upsertCreemSubscription({
      subscriptionId: "sub_x",
      status: "canceled",
    });
    expect(replay.statusChanged).toBe(false);

    const after = await read();
    expect(after.canceled_at).toBe(before.canceled_at); // 历史取消时间保留
  });

  it("空 subscriptionId → 不写入、不抛错", async () => {
    await expect(
      snap.upsertCreemSubscription({ subscriptionId: "", status: "active" })
    ).resolves.toEqual({ created: false, previousStatus: null, statusChanged: false });
  });
});

describe("upsertCreemCustomer：email ↔ user 桥梁", () => {
  it("插入后可用 COALESCE 补写空字段，但不覆盖已有值", async () => {
    await snap.upsertCreemCustomer({ customerId: "cus_1", email: "a@example.com" });
    await snap.upsertCreemCustomer({ customerId: "cus_1", userId: "u-cus" });
    const adapter = await db.getAdapter();
    let row = (await adapter.get(
      `SELECT email, user_id FROM creem_customers WHERE creem_customer_id = 'cus_1'`
    )) as { email: string | null; user_id: string | null };
    expect(row).toEqual({ email: "a@example.com", user_id: "u-cus" });

    await snap.upsertCreemCustomer({ customerId: "cus_1", email: null, userId: null });
    row = (await adapter.get(
      `SELECT email, user_id FROM creem_customers WHERE creem_customer_id = 'cus_1'`
    )) as { email: string | null; user_id: string | null };
    expect(row).toEqual({ email: "a@example.com", user_id: "u-cus" });
  });

  it("空 customerId → 跳过", async () => {
    await expect(snap.upsertCreemCustomer({ customerId: "" })).resolves.toBeUndefined();
  });
});

describe("订阅计数 / 生命周期 / 用户排查", () => {
  it("getCreemSubscriptionCounts 按状态分组（增量断言，不依赖前序用例的具体条数）", async () => {
    const before = await snap.getCreemSubscriptionCounts();
    await snap.upsertCreemSubscription({ subscriptionId: "sub_active2", status: "active" });
    await snap.upsertCreemSubscription({ subscriptionId: "sub_trialing", status: "trialing" });
    await snap.upsertCreemSubscription({ subscriptionId: "sub_pastdue", status: "past_due" });
    await snap.upsertCreemSubscription({ subscriptionId: "sub_unpaid", status: "unpaid" });
    const after = await snap.getCreemSubscriptionCounts();
    expect(after.active).toBe(before.active + 1);
    expect(after.trialing).toBe(before.trialing + 1);
    expect(after.pastDue).toBe(before.pastDue + 1);
    expect(after.unpaid).toBe(before.unpaid + 1);
    expect(after.canceled).toBe(before.canceled);
    expect(after.total).toBe(before.total + 4);
  });

  it("countNewSubscriptions：本文件写入的订阅全部落在 7 天窗口内", async () => {
    const counts = await snap.getCreemSubscriptionCounts();
    await expect(snap.countNewSubscriptions(7)).resolves.toBe(counts.total);
  });

  it("countCanceledSubscriptions 只统计窗口内真正取消过的订阅", async () => {
    const adapter = await db.getAdapter();
    const row = (await adapter.get(
      `SELECT COUNT(*) AS n FROM creem_subscriptions WHERE canceled_at IS NOT NULL`
    )) as { n: number };
    await expect(snap.countCanceledSubscriptions(7)).resolves.toBe(Number(row.n));
    expect(Number(row.n)).toBeGreaterThanOrEqual(1); // sub_x 确实取消过
  });

  it("listCreemRecordsForUser 返回该用户的客户 / 订阅 / 交易记录", async () => {
    await snap.upsertCreemSubscription({
      subscriptionId: "sub_u",
      status: "active",
      userId: "u-rev",
    });
    const rec = await snap.listCreemRecordsForUser("u-rev");
    expect(rec.subscriptions).toHaveLength(1);
    expect(rec.customers).toEqual([]); // 该用户没有 creem_customer 关联
    const ids = (rec.transactions as Array<{ creem_transaction_id: string }>).map(
      (t) => t.creem_transaction_id
    );
    // 收款（ord_dup）+ 退款（ref_1）都带 user_id=u-rev
    expect(ids.sort()).toEqual(["ord_dup", "ref_1"]);
  });
});

describe("Owner Console migration 契约（唯一 schema 入口）", () => {
  it("快照层新表全部建立", async () => {
    const adapter = await db.getAdapter();
    const rows = (await adapter.query(
      `SELECT name FROM sqlite_master WHERE type='table'
         AND (name LIKE 'creem_%' OR name LIKE 'gsc_%' OR name = 'ad_revenue_daily'
              OR name = 'admin_gsc_connections')`
    )) as Array<{ name: string }>;
    expect(rows.map((r) => r.name).sort()).toEqual([
      "ad_revenue_daily",
      "admin_gsc_connections",
      "creem_customers",
      "creem_subscriptions",
      "creem_transactions",
      "creem_webhook_events",
      "gsc_connections", // 既有的用户级 project GSC 连接（本次未改动）
      "gsc_daily_metrics",
      "gsc_page_metrics",
      "gsc_query_metrics",
    ]);
  });

  it("external ID 唯一 / 复合主键 = 幂等底座", async () => {
    const adapter = await db.getAdapter();
    const ddlFor = async (name: string) => {
      const r = (await adapter.get(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`,
        [name]
      )) as { sql: string } | undefined;
      return r?.sql ?? "";
    };

    // 事件账本：event id 主键 + 状态枚举
    expect(await ddlFor("creem_webhook_events")).toMatch(/id TEXT PRIMARY KEY/i);
    expect(await ddlFor("creem_webhook_events")).toMatch(
      /CHECK \(status IN \('received', 'processed', 'ignored', 'failed'\)\)/i
    );
    // 交易：Creem 侧 external id 主键，方向由 type 表达
    const tx = await ddlFor("creem_transactions");
    expect(tx).toMatch(/creem_transaction_id TEXT PRIMARY KEY/i);
    expect(tx).toMatch(/CHECK \(type IN \('payment', 'refund'\)\)/i);
    // GSC：按日/按窗口复合唯一
    expect(await ddlFor("gsc_daily_metrics")).toMatch(/PRIMARY KEY \(property_url, date\)/i);
    expect(await ddlFor("gsc_query_metrics")).toMatch(
      /UNIQUE \(property_url, captured_on, window_days, country, device, query\)/i
    );
    expect(await ddlFor("gsc_page_metrics")).toMatch(
      /UNIQUE \(property_url, captured_on, window_days, page\)/i
    );
    // 广告收入：多 provider 并存（date + provider）
    const ad = await ddlFor("ad_revenue_daily");
    expect(ad).toMatch(/PRIMARY KEY \(date, provider\)/i);
    expect(ad).toMatch(/CHECK \(source IN \('api', 'csv', 'manual'\)\)/i);
    // Owner 级 GSC 连接：一站一行
    expect(await ddlFor("admin_gsc_connections")).toMatch(/property_url TEXT NOT NULL UNIQUE/i);
  });

  it("analytics_events 追加了 content / term（不动历史数据）", async () => {
    const adapter = await db.getAdapter();
    const cols = (await adapter.query(`PRAGMA table_info(analytics_events)`)) as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("content");
    expect(names).toContain("term");
    // B 阶段既有列必须原样保留（归因不能断）
    for (const col of [
      "event_name",
      "user_id",
      "anonymous_id",
      "session_id",
      "path",
      "referrer",
      "landing_page",
      "source",
      "medium",
      "campaign",
      "ref_id",
      "props",
    ]) {
      expect(names, `analytics_events 丢失列：${col}`).toContain(col);
    }
  });
});
