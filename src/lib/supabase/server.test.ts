// ===== 共享 Supabase 客户端的 transport 边界 =====
// 本轮只给「认证/身份」这一条路注入有界 transport。若哪天有人图省事对
// createServer() 的默认调用也统一加时限，一次只是偏慢的业务查询会被误判成
// 错误 —— 这个文件把「默认不注入、显式传入才生效」锁死。
// 同时锁住 cookie 适配：加 transport 不能动会话读写。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Options = {
  global?: { fetch?: unknown };
  cookies: { getAll(): unknown[]; setAll?: unknown };
};

const mockCreateServerClient = vi.fn((options: Options) => ({ kind: "client", options }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _anonKey: string, options: Options) =>
    mockCreateServerClient(options),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import { createServer } from "./server";

const url = "https://example.supabase.co";
const anon = "anon-key-for-tests";

beforeEach(() => {
  mockCreateServerClient.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const optionsOf = () => mockCreateServerClient.mock.calls[0][0];

describe("createServer 的 transport 边界", () => {
  it("默认调用不注入 global：共享客户端上的业务查询没有应用层超时", async () => {
    await createServer();
    expect(optionsOf()).not.toHaveProperty("global");
  });

  it("显式传入 transport 时原样交给 global.fetch（身份读取用的就是这一条）", async () => {
    const transport = vi.fn();
    await createServer(transport as unknown as typeof globalThis.fetch);
    expect(optionsOf().global?.fetch).toBe(transport);
  });

  it("cookie 适配照旧：注入 transport 不影响会话读写", async () => {
    await createServer(vi.fn() as unknown as typeof globalThis.fetch);
    expect(optionsOf().cookies.getAll()).toEqual([]);
    expect(typeof optionsOf().cookies.setAll).toBe("function");
  });
});
