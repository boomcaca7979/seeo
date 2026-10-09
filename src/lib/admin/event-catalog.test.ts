// ===== Owner Console：事件目录与漏斗口径契约 =====
// 这个测试的真正目的不是"目录写全了"，而是**防止埋点与展示层漂移**：
//   - 漏斗/时间线里写的事件名必须在 src/lib/analytics/server.ts 的事件契约里真实存在；
//   - 该契约是**追加式**的（只允许新增事件名，不得重命名/删除既有事件，历史数据要按旧名读）；
//   - 漏斗每一步的口径必须写明数据源，避免"这个数字怎么来的"没有答案。

import { describe, it, expect } from "vitest";
import {
  ADMIN_FUNNEL_DEFINITION,
  REQUIRED_TIMELINE_EVENTS,
  TIMELINE_EVENT_LABELS,
  timelineLabel,
} from "./event-catalog";
import { ALL_EVENTS, CLIENT_EVENTS, SERVER_EVENTS } from "@/lib/analytics/server";

describe("漏斗口径定义", () => {
  it("节点顺序 = Impression → Click → Visit → Signup → Activation → Checkout → Paid", () => {
    expect(ADMIN_FUNNEL_DEFINITION.map((s) => s.key)).toEqual([
      "impression",
      "click",
      "visit",
      "signup",
      "activation",
      "checkout",
      "paid",
    ]);
  });

  it("每一步都写明了数据源与测量口径（不留黑盒）", () => {
    for (const step of ADMIN_FUNNEL_DEFINITION) {
      expect(step.label.trim().length).toBeGreaterThan(0);
      expect(step.source.trim().length).toBeGreaterThan(0);
      expect(step.measure.trim().length).toBeGreaterThan(0);
    }
  });

  it("权威表优先：Signup 用 profiles、Checkout/Paid 用 orders（含历史，不依赖新埋点）", () => {
    const byKey = Object.fromEntries(ADMIN_FUNNEL_DEFINITION.map((s) => [s.key, s]));
    expect(byKey.signup.source).toContain("profiles");
    expect(byKey.checkout.source).toContain("orders");
    expect(byKey.paid.source).toContain("orders");
    expect(byKey.visit.source).toContain("analytics_events");
    expect(byKey.activation.source).toContain("analytics_events");
  });
});

describe("时间线事件目录 ↔ 真实事件契约（不漂移）", () => {
  it("任务要求的关键事件都能展示", () => {
    for (const key of REQUIRED_TIMELINE_EVENTS) {
      expect(TIMELINE_EVENT_LABELS[key], `缺少时间线文案：${key}`).toBeTruthy();
      expect(TIMELINE_EVENT_LABELS[key].label.trim().length).toBeGreaterThan(0);
    }
  });

  it("目录里的 analytics 事件必须真实存在于事件契约中", () => {
    const known = new Set<string>(ALL_EVENTS);
    const analyticsKeys = Object.entries(TIMELINE_EVENT_LABELS)
      .filter(([, v]) => v.kind === "analytics")
      .map(([k]) => k);
    expect(analyticsKeys.length).toBeGreaterThan(0);
    for (const key of analyticsKeys) {
      expect(known.has(key), `目录引用了不存在的事件名：${key}`).toBe(true);
    }
  });

  it("事件契约是追加式的：既有事件名不得消失", () => {
    const known = new Set<string>(ALL_EVENTS);
    // 这些是 B 阶段（归因/漏斗）与本次 Owner Console 补齐的核心事件，
    // 任何一个消失都会让历史数据的漏斗口径断裂
    for (const required of [
      "page_view",
      "audit_started",
      "audit_completed",
      "signup_completed",
      "pricing_viewed",
      "activation_completed",
      "payment_completed",
      // Owner Console 补齐的最小经营漏斗事件
      "landing_view",
      "feature_used",
      "checkout_started",
      "checkout_completed",
      "subscription_active",
      "subscription_canceled",
    ]) {
      expect(known.has(required), `事件契约缺失：${required}`).toBe(true);
    }
  });

  it("客户端/服务端事件不重名（同一事件不能有两个写入路径）", () => {
    const client = new Set<string>(CLIENT_EVENTS);
    const overlap = (SERVER_EVENTS as readonly string[]).filter((e) => client.has(e));
    expect(overlap).toEqual([]);
  });

  it("timelineLabel：未知事件原样回退，不抛错", () => {
    expect(timelineLabel("page_view")).toEqual({ label: "访问网站", kind: "analytics" });
    expect(timelineLabel("something_new")).toEqual({
      label: "something_new",
      kind: "analytics",
    });
  });

  it("三类来源都覆盖到（analytics / order / creem）", () => {
    const kinds = new Set(Object.values(TIMELINE_EVENT_LABELS).map((v) => v.kind));
    expect([...kinds].sort()).toEqual(["analytics", "creem", "order"]);
  });
});
