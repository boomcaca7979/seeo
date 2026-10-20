// ===== provider 边界测试：sendRawEmail（Resend SDK 被 mock，绝不产生真实外呼）=====
// §六E 要求用 mock provider 验证：邮件正文构建、必填字段、错误处理、幂等键透传。
// 这里刻意 mock 的是 **provider SDK 本身**（而非 email.test.ts 里的 sendRawEmail 替身），
// 因为「业务参数 → SDK 请求体」这一段的映射只在 resend.ts 里发生：
//   - 未配置 RESEND_API_KEY 时绝不实例化 SDK、绝不发请求；
//   - from/to/subject/html 必须逐字段原样送达，不夹带额外字段；
//   - 幂等键只能作为 SDK 的第二个参数（映射为 Idempotency-Key 请求头）传入，
//     缺省时必须是 undefined —— 传 `{idempotencyKey: undefined}` 会让 SDK 仍然发出该头；
//   - SDK 的 error / throw / 非 Error 抛出都必须收敛为 { success: false, error }，
//     绝不把异常抛回业务流程（邮件失败不得影响下单、审计等主链路）。

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  send: vi.fn<(payload: Record<string, unknown>, options?: { idempotencyKey?: string }) => Promise<unknown>>(
    async () => ({ data: { id: "msg-harness" }, error: null })
  ),
  constructions: [] as string[],
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails: { send: typeof h.send };
    constructor(apiKey: string) {
      h.constructions.push(apiKey);
      this.emails = { send: h.send };
    }
  },
}));

const INPUT = {
  from: "SeeO <hello@seeo.asia>",
  to: "user@example.com",
  subject: "Your SEO audit is ready",
  html: "<p>Hi</p>",
};

/** 每个用例重新加载模块：resend.ts 会缓存 SDK 实例，env 变化必须从干净的模块图开始 */
async function loadResendModule(apiKey?: string) {
  vi.resetModules();
  if (apiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = apiKey;
  return await import("./resend");
}

beforeEach(() => {
  h.send.mockReset();
  h.send.mockImplementation(async () => ({ data: { id: "msg-harness" }, error: null }));
  h.constructions.length = 0;
  delete process.env.RESEND_API_KEY;
});

describe("provider 未配置（本地/预览环境的真实形态）", () => {
  it("isEmailConfigured 只看 RESEND_API_KEY，不猜测其它变量", async () => {
    const mod = await loadResendModule(undefined);
    expect(mod.isEmailConfigured()).toBe(false);
    const withKey = await loadResendModule("re_test_key");
    expect(withKey.isEmailConfigured()).toBe(true);
  });

  it("缺 key：返回失败并说明原因，绝不实例化 SDK、绝不发请求", async () => {
    const { sendRawEmail } = await loadResendModule(undefined);
    const out = await sendRawEmail(INPUT);
    expect(out).toEqual({ success: false, error: "RESEND_API_KEY 未配置" });
    expect(h.constructions).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("消息构建与必填字段", () => {
  it("from/to/subject/html 逐字段原样送达，且不夹带多余字段", async () => {
    const { sendRawEmail } = await loadResendModule("re_test_key");
    const out = await sendRawEmail(INPUT);
    expect(h.send).toHaveBeenCalledTimes(1);
    const [payload, options] = h.send.mock.calls[0];
    expect(payload).toEqual({
      from: "SeeO <hello@seeo.asia>",
      to: "user@example.com",
      subject: "Your SEO audit is ready",
      html: "<p>Hi</p>",
    });
    // 无幂等键时第二参数必须是 undefined（而不是 {} 或 {idempotencyKey: undefined}）
    expect(options).toBeUndefined();
    expect(out).toEqual({ success: true, messageId: "msg-harness" });
  });

  it("SDK 未返回 data.id 时成功态不伪造 messageId", async () => {
    h.send.mockImplementation(async () => ({ data: undefined, error: null }));
    const { sendRawEmail } = await loadResendModule("re_test_key");
    const out = await sendRawEmail(INPUT);
    expect(out.success).toBe(true);
    expect(out.messageId).toBeUndefined();
  });
});

describe("幂等键透传（重试不重复投递）", () => {
  it("显式幂等键作为 SDK 第二参数传入，映射为 Idempotency-Key 请求头", async () => {
    const { sendRawEmail } = await loadResendModule("re_test_key");
    await sendRawEmail({ ...INPUT, idempotencyKey: "tx:report_email_v1:order-1" });
    const [payload, options] = h.send.mock.calls[0];
    expect(Object.keys(payload)).toEqual(["from", "to", "subject", "html"]);
    expect(options).toEqual({ idempotencyKey: "tx:report_email_v1:order-1" });
  });

  it("同一次业务重试沿用同一键：两次调用向 SDK 送出完全相同的键", async () => {
    const { sendRawEmail } = await loadResendModule("re_test_key");
    await sendRawEmail({ ...INPUT, idempotencyKey: "pay:order-1:welcome" });
    await sendRawEmail({ ...INPUT, idempotencyKey: "pay:order-1:welcome" });
    expect(h.send.mock.calls.map((c) => c[1]?.idempotencyKey)).toEqual([
      "pay:order-1:welcome",
      "pay:order-1:welcome",
    ]);
  });
});

describe("错误处理", () => {
  it("SDK 结构化 error → success:false 且带上原文，不带 messageId", async () => {
    h.send.mockImplementation(async () => ({ data: null, error: { name: "invalid_parameter", message: "to is invalid" } }));
    const { sendRawEmail } = await loadResendModule("re_test_key");
    const out = await sendRawEmail(INPUT);
    expect(out).toEqual({ success: false, error: "to is invalid" });
  });

  it("SDK 抛异常 → 收敛为失败结果，异常不外泄", async () => {
    h.send.mockImplementation(async () => {
      throw new Error("fetch failed");
    });
    const { sendRawEmail } = await loadResendModule("re_test_key");
    await expect(sendRawEmail(INPUT)).resolves.toEqual({ success: false, error: "fetch failed" });
  });

  it("非 Error 抛出（字符串/对象）也能给出可读原因", async () => {
    h.send.mockImplementation(async () => {
      throw "rate limited";
    });
    const { sendRawEmail } = await loadResendModule("re_test_key");
    await expect(sendRawEmail(INPUT)).resolves.toEqual({ success: false, error: "rate limited" });
  });

  it("失败后仍可继续发送（不被一次故障永久化），且 SDK 实例只创建一次", async () => {
    const { sendRawEmail } = await loadResendModule("re_test_key");
    h.send.mockImplementationOnce(async () => ({ data: null, error: { message: "transient" } }));
    expect(await sendRawEmail(INPUT)).toEqual({ success: false, error: "transient" });
    expect(await sendRawEmail(INPUT)).toEqual({ success: true, messageId: "msg-harness" });
    expect(h.send).toHaveBeenCalledTimes(2);
    // 单例缓存：同一模块生命周期内只构造一个 client
    expect(h.constructions).toEqual(["re_test_key"]);
  });
});
