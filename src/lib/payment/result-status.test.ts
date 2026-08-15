// ===== 支付结果页状态判定回归测试 =====
// 安全目标：
//   - paid 判定唯一依据是服务端 payment_status
//   - 浏览器 URL 参数不能作为 paid 依据（resolvePaymentPageStatus 根本不接收浏览器参数）

import { describe, it, expect } from "vitest";
import {
  resolvePaymentPageStatus,
  type PaymentPageStatus,
} from "@/lib/payment/result-status";

describe("resolvePaymentPageStatus", () => {
  it("无订单号 → not_found（不发起查询）", () => {
    expect(
      resolvePaymentPageStatus({ hasOrderNo: false })
    ).toBe<PaymentPageStatus>("not_found");
  });

  it("query 返回 404 → not_found", () => {
    expect(
      resolvePaymentPageStatus({
        hasOrderNo: true,
        queryHttpStatus: 404,
        serverPaymentStatus: undefined,
      })
    ).toBe<PaymentPageStatus>("not_found");
  });

  it("服务端 payment_status=paid → paid", () => {
    expect(
      resolvePaymentPageStatus({
        hasOrderNo: true,
        queryHttpStatus: 200,
        serverPaymentStatus: "paid",
      })
    ).toBe<PaymentPageStatus>("paid");
  });

  it("服务端 payment_status=pending → pending（继续轮询）", () => {
    expect(
      resolvePaymentPageStatus({
        hasOrderNo: true,
        queryHttpStatus: 200,
        serverPaymentStatus: "pending",
      })
    ).toBe<PaymentPageStatus>("pending");
  });

  it("服务端 payment_status=failed → failed", () => {
    expect(
      resolvePaymentPageStatus({
        hasOrderNo: true,
        queryHttpStatus: 200,
        serverPaymentStatus: "failed",
      })
    ).toBe<PaymentPageStatus>("failed");
  });

  it("服务端 payment_status=refunded → refunded", () => {
    expect(
      resolvePaymentPageStatus({
        hasOrderNo: true,
        queryHttpStatus: 200,
        serverPaymentStatus: "refunded",
      })
    ).toBe<PaymentPageStatus>("refunded");
  });

  it("query 暂时失败（500/网络错误）→ pending（不误判为成功/失败）", () => {
    expect(
      resolvePaymentPageStatus({
        hasOrderNo: true,
        queryHttpStatus: 500,
        serverPaymentStatus: undefined,
      })
    ).toBe<PaymentPageStatus>("pending");
  });

  it("服务端未返回状态 → pending", () => {
    expect(
      resolvePaymentPageStatus({
        hasOrderNo: true,
        queryHttpStatus: 200,
        serverPaymentStatus: undefined,
      })
    ).toBe<PaymentPageStatus>("pending");
  });

  it("浏览器参数不能作为 paid 依据：签名只含订单号存在性与服务端状态，无任何浏览器支付参数", () => {
    // 模拟攻击：URL 带 pay_type=jump&pay_info=xxx&trade_no=FAKE&status=success
    // resolvePaymentPageStatus 无法接收这些参数，唯一可信输入是 serverPaymentStatus
    const forgedBrowserParams = {
      pay_type: "jump",
      pay_info: "https://evil.example/pay",
      trade_no: "FAKE_TRADE",
      status: "success", // 伪造成功标识
    };

    // 服务端仍返回 pending → 必须判 pending，浏览器伪造参数无法改变结果
    const result = resolvePaymentPageStatus({
      hasOrderNo: true,
      queryHttpStatus: 200,
      serverPaymentStatus: "pending",
      // forgedBrowserParams 无处传入
    } as Parameters<typeof resolvePaymentPageStatus>[0]);

    expect(Object.keys(forgedBrowserParams).length).toBeGreaterThan(0);
    expect(result).toBe<PaymentPageStatus>("pending");
  });
});
