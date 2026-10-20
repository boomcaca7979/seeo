// ===== proxy 的 locale 路由判定（含 /en 归一与「自代理再入」防线）=====
// /en → 无前缀 EN URL 的 301 是 SEO 归一（en 为默认 locale，as-needed 不应带前缀）。
// 但 standalone 把 HOSTNAME 绑到 127/8 或 ::1 时，NextURL 会把 middleware 侧
// request.url 的主机名归一成 localhost，而 initUrl 仍用原始 bind —— rewrite 因此被
// 判成「外部 rewrite」，Next 用 http-proxy 再请求自己一趟，本 proxy 被第二次调用，
// pathname 已是 /en、Host 已是归一后的内部 origin。再 301 回 / 就与 next-intl 的
// / → /en rewrite 互为对向，浏览器拿到自我指向的 301（且 301 会被永久缓存）。
//
// 这里锁死四件事：
//   1. 再入（loopback bind + Host 等于内部 origin）必须放行，断掉循环；
//   2. 不触发自代理的形态（HOSTNAME 缺省 / 0.0.0.0 / localhost / 公网域名）下
//      外部 /en 必须继续 301，包括 X-Forwarded-Host 与 Host 不同的反代形态
//      —— 判据不再看 X-Forwarded-Host（本版本 Next 会给首趟请求就补上它）；
//   3. 归一规则不碰 /zh、非白名单路径，也不变成开放重定向；
//   4. 放行/重定向都不能误触 session 刷新分支。
//
// next-intl 与 Supabase 会话刷新都 mock 成可辨识的哨兵：本文件只验「proxy 选了哪条
// 分支、给出什么状态」，真实渲染与循环是否终止由隔离生产构建里的逐跳 curl 验收。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  updateSessionPaths: [] as string[],
}));

vi.mock("next-intl/middleware", () => ({
  default: (config: { localeDetection?: boolean }) => {
    const kind = config.localeDetection === false ? "crawler-intl" : "intl";
    return async () => {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ kind });
    };
  },
}));

// @/i18n/routing 会连带引入 next/navigation（node 环境下解析不了 ESM 入口），
// 而这里只需要「爬虫变体 vs 常规变体」两条分支可辨，routing 本身不参与判定。
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["en", "zh"], defaultLocale: "en", localePrefix: "as-needed" },
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async (request: NextRequest) => {
    const { NextResponse } = await import("next/server");
    h.updateSessionPaths.push(request.nextUrl.pathname);
    return NextResponse.json({ kind: "update-session" });
  },
}));

import { proxy } from "./proxy";

function request(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

async function body(res: Response) {
  return (await res.json()) as { kind: string };
}

/** standalone 的 server.js 从同一份环境读 HOSTNAME/PORT，middleware 里可见 */
function bind(hostname: string | undefined, port: string | undefined) {
  if (hostname === undefined) delete process.env.HOSTNAME;
  else process.env.HOSTNAME = hostname;
  if (port === undefined) delete process.env.PORT;
  else process.env.PORT = port;
}

let snapshot: { hostname?: string; port?: string } = {};

beforeEach(() => {
  h.updateSessionPaths.length = 0;
  snapshot = { hostname: process.env.HOSTNAME, port: process.env.PORT };
  // 用例不写死宿主 shell 可能带进来的 bind 形态
  delete process.env.HOSTNAME;
  delete process.env.PORT;
});

afterEach(() => {
  bind(snapshot.hostname, snapshot.port);
});

describe("/en 自代理再入（standalone 绑回环地址时的循环来源）", () => {
  it("HOSTNAME=127.0.0.1 且 Host 是归一后的内部 origin → 放行（无 301、无 location）", async () => {
    bind("127.0.0.1", "3481");
    // Next 自代理那趟：changeOrigin 把 Host 换成 rewrite 目标 localhost:3481
    const res = await proxy(request("http://localhost:3481/en", { host: "localhost:3481" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(h.updateSessionPaths).toEqual([]);
  });

  it("再入的是 /en/pricing 时同样放行，且不重复跑 locale 路由", async () => {
    bind("127.0.0.1", "3481");
    const res = await proxy(
      request("http://localhost:3481/en/pricing", { host: "localhost:3481" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("location")).toBeNull();
    expect(h.updateSessionPaths).toEqual([]);
  });

  it("HOSTNAME=::1 也按再入放行（NextURL 同样归一成 localhost）", async () => {
    bind("::1", "3486");
    const res = await proxy(request("http://localhost:3486/en", { host: "localhost:3486" }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("location")).toBeNull();
  });

  it("同一台回环 bind 上，Host 仍是原始 bind 地址的请求算外部请求 → 301", async () => {
    bind("127.0.0.1", "3481");
    const res = await proxy(
      request("http://127.0.0.1:3481/en/pricing", { host: "127.0.0.1:3481" })
    );
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!, "http://x").pathname).toBe("/pricing");
  });
});

describe("/en 前缀归一（不参与自代理形态）", () => {
  it("HOSTNAME=0.0.0.0（standalone 默认 bind，rewrite 不会被绝对化）→ 照常 301", async () => {
    bind("0.0.0.0", "3485");
    // Host 与内部 origin 相等也不放行：循环前提（归一）在这个 bind 下不成立
    const res = await proxy(request("http://0.0.0.0:3485/en", { host: "0.0.0.0:3485" }));
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!, "http://x").pathname).toBe("/");
  });

  it("HOSTNAME=localhost（已验证单趟完成）→ 照常 301", async () => {
    bind("localhost", "3484");
    const res = await proxy(request("http://localhost:3484/en/pricing", { host: "localhost:3484" }));
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!, "http://x").pathname).toBe("/pricing");
  });

  it("HOSTNAME 缺省（next dev / next start）→ 照常 301", async () => {
    bind(undefined, "3300");
    const res = await proxy(request("http://localhost:3300/en", { host: "localhost:3300" }));
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!, "http://x").pathname).toBe("/");
  });

  it("公网域名 + X-Forwarded-Host 与 Host 不同（反代保留上游 Host）→ 仍 301，判据不看 X-Forwarded-Host", async () => {
    bind(undefined, "3000");
    const res = await proxy(
      request("https://www.seeo.asia/en/pricing", {
        host: "www.seeo.asia",
        "x-forwarded-host": "seeo.asia",
      })
    );
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!, "http://x").pathname).toBe("/pricing");
  });

  it("公网域名 + X-Forwarded-Host 与 Host 相同 → 301", async () => {
    const res = await proxy(
      request("https://www.seeo.asia/en", {
        host: "www.seeo.asia",
        "x-forwarded-host": "www.seeo.asia",
      })
    );
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!, "http://x").pathname).toBe("/");
  });
});

describe("不参与 /en 归一的路径", () => {
  it("/en/app/projects/17 不在 locale 白名单 → 交给 session 刷新（不 301）", async () => {
    const res = await proxy(request("http://localhost:3481/en/app/projects/17"));
    expect(await body(res)).toEqual({ kind: "update-session" });
    expect(h.updateSessionPaths).toEqual(["/en/app/projects/17"]);
  });

  it("/en/<未知路径> 目标不在白名单 → 不 301，避免归一规则变成开放重定向", async () => {
    const res = await proxy(request("http://localhost:3481/en/nope"));
    expect(await body(res)).toEqual({ kind: "update-session" });
  });

  it("/zh/pricing 进 locale 路由（zh 前缀本身就是 canonical）", async () => {
    const res = await proxy(request("http://localhost:3481/zh/pricing"));
    expect(await body(res)).toEqual({ kind: "intl" });
  });

  it("爬虫 UA 走 localeDetection: false 的变体（确定性 locale 响应）", async () => {
    const res = await proxy(
      request("http://localhost:3481/pricing", {
        "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0)",
      })
    );
    expect(await body(res)).toEqual({ kind: "crawler-intl" });
  });

  it("普通 /app 路径交给 session 刷新", async () => {
    const res = await proxy(request("http://localhost:3481/app/projects/17"));
    expect(await body(res)).toEqual({ kind: "update-session" });
  });
});
