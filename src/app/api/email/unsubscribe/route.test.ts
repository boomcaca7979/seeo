// ===== GET /api/email/unsubscribe 路由测试（C10）=====
// 契约：只按 token 退订营销邮件；空 token / 无效 token 都要落到可读的确认页状态，
// 且绝不因此影响事务性邮件（该保证在 src/lib/email 层验证）。

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  result: { value: true as boolean },
  lastToken: { value: "" as string },
}));

vi.mock("@/lib/email/preferences", () => ({
  unsubscribeByToken: vi.fn(async (token: string) => {
    h.lastToken.value = token;
    return h.result.value;
  }),
}));

import { GET } from "./route";

function req(qs: string): Request {
  return new Request(`http://localhost/api/email/unsubscribe${qs}`);
}

beforeEach(() => {
  h.result.value = true;
  h.lastToken.value = "";
});

describe("GET /api/email/unsubscribe", () => {
  it("有效 token → 302 到 status=done", async () => {
    const res = await GET(req("?token=abc123"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/unsubscribe?status=done");
    expect(h.lastToken.value).toBe("abc123");
  });

  it("已退订过的 token → 302 到 status=already", async () => {
    h.result.value = false;
    const res = await GET(req("?token=abc123"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/unsubscribe?status=already");
  });

  it("缺少 token → 302 到 status=invalid，且不触碰偏好层", async () => {
    const res = await GET(req(""));
    expect(res.headers.get("location")).toContain("/unsubscribe?status=invalid");
    expect(h.lastToken.value).toBe("");
  });

  it("空白 token → 视为无效", async () => {
    const res = await GET(req("?token=%20%20"));
    expect(res.headers.get("location")).toContain("/unsubscribe?status=invalid");
  });
});
