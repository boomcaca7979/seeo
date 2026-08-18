// ===== BUG-004 回归测试：未知根路径 500 → 404 =====
// 根因：生产构建中未知根路径（如 /this-page-not-exist）由静态预渲染的
// /_not-found 壳承载。next-intl getRequestConfig 在 requestLocale 为空时
// 调用 resolveUiLocale()，其中 cookies()/headers() 在静态渲染上下文抛
// DYNAMIC_SERVER_USAGE → Server Components render error → HTTP 500。
// 修复：resolveUiLocale 捕获 DYNAMIC_SERVER_USAGE 并回退 defaultLocale，
// 让静态 404 壳正常渲染（HTTP 404）。dev 模式（无静态壳）不受影响。

import { describe, it, expect, vi, beforeEach } from "vitest";

const COOKIES = vi.fn();
const HEADERS = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => COOKIES(),
  headers: () => HEADERS(),
}));

// routing.ts 引入 next-intl/navigation → next/navigation（vitest 环境不可加载），
// 测试只依赖 routing.locales/defaultLocale 的纯数据，直接 mock。
vi.mock("./routing", () => ({
  routing: { locales: ["en", "zh"], defaultLocale: "en" },
}));

describe("BUG-004：resolveUiLocale 静态 404 壳兼容", () => {
  beforeEach(() => {
    COOKIES.mockReset();
    HEADERS.mockReset();
  });

  async function loadModule() {
    // 每次重新导入，避免模块级缓存干扰 mock
    vi.resetModules();
    return import("./request");
  }

  it("cookies() 抛 DYNAMIC_SERVER_USAGE（静态 /_not-found 壳）时回退 defaultLocale 而非 500", async () => {
    const dynamicErr = new Error("Route /_not-found couldn't be rendered statically");
    (dynamicErr as Error & { digest?: string }).digest = "DYNAMIC_SERVER_USAGE";
    COOKIES.mockRejectedValue(dynamicErr);

    const { resolveUiLocale } = await loadModule();
    await expect(resolveUiLocale()).resolves.toBe("en");
  });

  it("正常请求路径（cookie locale）行为不变：NEXT_LOCALE=zh → zh", async () => {
    COOKIES.mockResolvedValue({ get: (k: string) => (k === "NEXT_LOCALE" ? { value: "zh" } : undefined) });

    const { resolveUiLocale } = await loadModule();
    await expect(resolveUiLocale()).resolves.toBe("zh");
  });

  it("无 cookie 时 Accept-Language 中文 → zh（动态路由行为不变）", async () => {
    COOKIES.mockResolvedValue({ get: () => undefined });
    HEADERS.mockResolvedValue({ get: (k: string) => (k === "accept-language" ? "zh-CN,zh;q=0.9,en;q=0.8" : null) });

    const { resolveUiLocale } = await loadModule();
    await expect(resolveUiLocale()).resolves.toBe("zh");
  });

  it("其他异常不被吞掉：非 DYNAMIC_SERVER_USAGE 错误原样抛出", async () => {
    COOKIES.mockRejectedValue(new Error("some other failure"));

    const { resolveUiLocale } = await loadModule();
    await expect(resolveUiLocale()).rejects.toThrow("some other failure");
  });
});
