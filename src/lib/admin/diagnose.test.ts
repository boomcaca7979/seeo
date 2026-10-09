// ===== 经营瓶颈判断测试 =====
// 任务第八条要求：Admin 首页必须能说出「当前最大瓶颈在哪一步」。
// 三条硬约束在这里被测试锁死：
//   1. 判断只基于真实计数 —— 不伪造阈值、不生成示例数据；
//   2. 上游优先 —— 越靠前的断点越是"最大瓶颈"；
//   3. 数据不足时**不下结论**，而是在 missingData 里说缺什么（conclusive=false）。

import { describe, it, expect } from "vitest";
import {
  FUNNEL_DIAGNOSIS_RULES,
  diagnoseFunnel,
  formatCents,
  type BottleneckCode,
  type FunnelDiagnosisInput,
} from "./diagnose";

/** 基线：全链路通畅 + 有收入（各用例只覆盖自己关心的字段） */
function input(overrides: Partial<FunnelDiagnosisInput> = {}): FunnelDiagnosisInput {
  return {
    impressions: 1000,
    clicks: 50,
    visits: 40,
    signups: 10,
    activated: 8,
    checkoutStarted: 3,
    paid: 2,
    subscriptionNetCents: 2980,
    adRevenueCents: 1200,
    gscConnected: true,
    impressionFloor: 100,
    ctrCeiling: 0.05,
    analyticsHasData: true,
    ...overrides,
  };
}

describe("FUNNEL_DIAGNOSIS_RULES：机器可读规则表", () => {
  it("覆盖全部有序规则（INSUFFICIENT_DATA 是兜底分支，无独立 condition）", () => {
    const codes = FUNNEL_DIAGNOSIS_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([
      "NO_DATA",
      "SERP_CTR",
      "TRAFFIC_TO_VISIT",
      "VISIT_TO_SIGNUP",
      "SIGNUP_TO_ACTIVATION",
      "SIGNUP_TO_CHECKOUT",
      "CHECKOUT_TO_PAID",
      "PAID_NO_REVENUE",
      "HEALTHY",
    ] satisfies BottleneckCode[]);
    expect(codes).not.toContain("INSUFFICIENT_DATA");
  });

  it("precedence 唯一且严格递增（顺序 = 优先级 = 上游优先）", () => {
    const p = FUNNEL_DIAGNOSIS_RULES.map((r) => r.precedence);
    expect(p).toEqual([...p].sort((a, b) => a - b));
    expect(new Set(p).size).toBe(p.length);
  });

  it("每条规则都有可读 condition（文档与实现不漂移）", () => {
    for (const r of FUNNEL_DIAGNOSIS_RULES) {
      expect(r.condition.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("diagnoseFunnel：三条任务要求的真实场景", () => {
  it("0 paid / 0 checkout / 12 signups → 瓶颈在 Signup → Checkout（不是流量）", () => {
    const d = diagnoseFunnel(
      input({ signups: 12, activated: 5, checkoutStarted: 0, paid: 0, subscriptionNetCents: 0 })
    );
    expect(d.code).toBe("SIGNUP_TO_CHECKOUT");
    expect(d.label).toBe("主要瓶颈在注册 → 开始付款");
    expect(d.detail).toContain("12 个注册用户");
    expect(d.conclusive).toBe(true);
  });

  it("0 paid / 0 checkout / 200 visitors 且 0 注册 → 瓶颈在产品激活/转化", () => {
    const d = diagnoseFunnel(
      input({ visits: 200, signups: 0, activated: 0, checkoutStarted: 0, paid: 0 })
    );
    expect(d.code).toBe("VISIT_TO_SIGNUP");
    expect(d.label).toBe("主要瓶颈在访客 → 注册");
    expect(d.detail).toContain("200 个访客");
    expect(d.detail).toContain("0 注册");
  });

  it("5,000 impressions / 40 clicks → 瓶颈在 SERP CTR", () => {
    const d = diagnoseFunnel(
      input({
        impressions: 5000,
        clicks: 40,
        visits: 30,
        ctrCeiling: 0.03,
        impressionFloor: 1000,
      })
    );
    expect(d.code).toBe("SERP_CTR");
    expect(d.label).toBe("主要瓶颈在搜索点击率：有曝光但点进来的太少");
    expect(d.detail).toContain("5000 次曝光");
    expect(d.detail).toContain("3.00%");
  });
});

describe("diagnoseFunnel：上游优先与边界", () => {
  it("完全无数据 → NO_DATA，且明确标为不可信", () => {
    const d = diagnoseFunnel(input({ impressions: 0, clicks: 0, visits: 0, gscConnected: false }));
    expect(d.code).toBe("NO_DATA");
    expect(d.conclusive).toBe(false);
    expect(d.missingData.join(" ")).toContain("Google Search Console");
  });

  it("SERP CTR 只承认站点自身基准（无基准时不判）", () => {
    const noCeiling = diagnoseFunnel(
      input({
        impressions: 5000,
        clicks: 40,
        ctrCeiling: null,
        impressionFloor: null,
        visits: 30,
      })
    );
    expect(noCeiling.code).not.toBe("SERP_CTR");

    // 曝光低于本站中位门槛 → 不足以断言 CTR 是瓶颈
    const belowFloor = diagnoseFunnel(input({ impressions: 50, clicks: 1, impressionFloor: 5000 }));
    expect(belowFloor.code).not.toBe("SERP_CTR");
  });

  it("GSC 未接入时不得用 SERP CTR 下结论", () => {
    const d = diagnoseFunnel(input({ impressions: 5000, clicks: 1, gscConnected: false }));
    expect(d.code).not.toBe("SERP_CTR");
  });

  it("clicks > 0 但站内 0 访问 → 指向埋点/落地链路，而不是「没人来」", () => {
    const d = diagnoseFunnel(input({ clicks: 300, visits: 0 }));
    expect(d.code).toBe("TRAFFIC_TO_VISIT");
    expect(d.detail).toContain("300 次点击");
  });

  it("有注册 / 有激活 / 未到 checkout → 不误报为激活问题", () => {
    const d = diagnoseFunnel(
      input({ signups: 12, activated: 12, checkoutStarted: 0, paid: 0, subscriptionNetCents: 0 })
    );
    expect(d.code).toBe("SIGNUP_TO_CHECKOUT");
  });

  it("有注册 / 0 激活且行为分析有数据 → Signup → Activation", () => {
    const d = diagnoseFunnel(input({ signups: 12, activated: 0, checkoutStarted: 0, paid: 0 }));
    expect(d.code).toBe("SIGNUP_TO_ACTIVATION");
    expect(d.detail).toContain("完成一次 SEO 审计");
  });

  it("行为分析无数据时不得声称「注册后未激活」", () => {
    const d = diagnoseFunnel(
      input({
        signups: 12,
        activated: 0,
        checkoutStarted: 0,
        paid: 0,
        analyticsHasData: false,
      })
    );
    expect(d.code).not.toBe("SIGNUP_TO_ACTIVATION");
    expect(d.missingData.join(" ")).toContain("站内行为分析");
  });

  it("有 checkout 无付费 → Checkout → Paid", () => {
    const d = diagnoseFunnel(
      input({ signups: 12, activated: 6, checkoutStarted: 3, paid: 0, subscriptionNetCents: 0 })
    );
    expect(d.code).toBe("CHECKOUT_TO_PAID");
    expect(d.detail).toContain("3 次付款流程");
  });

  it("有付费但收入为 0 → 指向记账/对账，而不是获客", () => {
    const d = diagnoseFunnel(input({ paid: 2, subscriptionNetCents: 0, adRevenueCents: 0 }));
    expect(d.code).toBe("PAID_NO_REVENUE");
    expect(d.detail).toContain("记账");
  });

  it("付费 + 广告收入 = 不报记账问题", () => {
    const d = diagnoseFunnel(input({ paid: 2, subscriptionNetCents: 0, adRevenueCents: 999 }));
    expect(d.code).toBe("HEALTHY");
  });

  it("全链路均有转化 → HEALTHY", () => {
    const d = diagnoseFunnel(input());
    expect(d.code).toBe("HEALTHY");
    expect(d.conclusive).toBe(true);
  });

  it("节点不成链（有曝光无点击无访问）→ INSUFFICIENT_DATA，不下结论", () => {
    const d = diagnoseFunnel(
      input({
        impressions: 500,
        clicks: 0,
        visits: 0,
        ctrCeiling: null,
        impressionFloor: null,
      })
    );
    expect(d.code).toBe("INSUFFICIENT_DATA");
    expect(d.conclusive).toBe(false);
  });
});

describe("diagnoseFunnel：evidence 必须能复核", () => {
  it("evidence 逐条列出真实数据点（含基准来源）", () => {
    const d = diagnoseFunnel(input({ impressions: 5000, clicks: 40, ctrCeiling: 0.03 }));
    expect(d.evidence.length).toBeGreaterThanOrEqual(4);
    expect(d.evidence.join("\n")).toContain("搜索曝光 5000 / 搜索点击 40");
    expect(d.evidence.join("\n")).toContain("本站搜索结果前 3 位中位点击率");
    expect(d.evidence.join("\n")).toContain("收入：订阅净额");
  });

  it("GSC 未接入时不展示 GSC 相关证据（不编造）", () => {
    const d = diagnoseFunnel(input({ gscConnected: false, impressions: 0, visits: 30 }));
    expect(d.evidence.join("\n")).not.toContain("Impressions");
  });
});

describe("formatCents", () => {
  it("USD / CNY / 其它币种", () => {
    expect(formatCents(149)).toBe("$1.49");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-250)).toBe("-$2.50");
    expect(formatCents(149, "CNY")).toBe("¥1.49");
    expect(formatCents(149, "EUR")).toBe("1.49 EUR");
  });
});
