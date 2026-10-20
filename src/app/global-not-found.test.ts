// ===== 404 唯一渲染源：global-not-found 的语言、head 与路由契约 =====
// 覆盖（真实调用模块，不断言源码里碰巧有某个字符串）：
//   1. generateMetadata() 与正文同一次 notFoundLocale() 解析：三级规则
//      URL 前缀（/zh/* → 中文）> UI 路径空间（/app、/login、/signup、/payment、
//      /unsubscribe 的未知子路径 → cookie → Accept-Language → en）>
//      其余无效 locale 段（/nope、/x/y/z → defaultLocale，且不读 cookie）。
//   2. **首个服务器响应**就带正确的 <html lang>：文档由本页自己渲染，
//      不依赖客户端补丁（旧实现用 documentElement.lang 赋值掩盖错误壳缺 lang）。
//   3. robots：本页 metadata 不输出 robots（HTTP 404 的 noindex 由 Next 注入唯一一份），
//      因此同一份 404 HTML 只有一个 robots 标签。canonical 显式 null。
//   4. 路由契约：[locale] 布局 dynamicParams=false，[locale] 树内既没有
//      [...rest] catch-all 也没有 not-found 边界 —— 无效 locale 段在路由层就 404，
//      不会再进入 [locale] 触发 notFound() 的 __next_error__ 错误壳。
//   5. messages 双语齐备、404 不进 sitemap。
// BUG-004 防回归：非 UI 路径的无效 locale 段不解析 cookies（另见 src/i18n/request.test.ts）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import enMessages from "../../messages/en.json";
import zhMessages from "../../messages/zh.json";
import {
  isUiLocalePath,
  localeSegmentFromPathname,
} from "@/i18n/locale-routed-paths";
import { notFoundLocale } from "@/lib/not-found-locale";
import { notFoundPageMeta } from "@/lib/not-found-meta";
import { localeToHtmlLang } from "@/i18n/config";
import type { Locale } from "@/i18n/config";

const SITEMAP_SRC = readFileSync(fileURLToPath(new URL("./sitemap.ts", import.meta.url)), "utf-8");
const GLOBAL_NOT_FOUND_SRC = readFileSync(
  fileURLToPath(new URL("./global-not-found.tsx", import.meta.url)),
  "utf-8"
);
const LOCALE_LAYOUT_SRC = readFileSync(
  fileURLToPath(new URL("./[locale]/layout.tsx", import.meta.url)),
  "utf-8"
);

const state = {
  /** x-seeo-pathname（proxy 注入）；null = header 缺失 */
  pathname: null as string | null,
  /** NEXT_LOCALE cookie 值；undefined = 无 cookie */
  cookieLocale: undefined as string | undefined,
  /** Accept-Language 请求头 */
  acceptLanguage: "en-US,en;q=0.9",
  /** 模拟静态渲染上下文：headers()/cookies() 抛 DYNAMIC_SERVER_USAGE */
  staticContext: false,
  /** 正文 locale（单测里显式给，用来证明 locale 只来自入参） */
  bodyLocale: "en" as Locale,
  /** 记录 getTranslations 的入参：断言 metadata 走「显式 locale」而非隐式协商 */
  translationArgs: [] as unknown[],
  /** cookies() 被调用次数：断言非 UI 路径绝不解析 cookie（BUG-004） */
  cookieCalls: 0,
};

function dynamicServerError() {
  const err = new Error("Dynamic server usage") as Error & { digest?: string };
  err.digest = "DYNAMIC_SERVER_USAGE";
  return err;
}

vi.mock("next/headers", () => ({
  headers: async () => {
    if (state.staticContext) throw dynamicServerError();
    return {
      get: (name: string) => {
        const key = name.toLowerCase();
        if (key === "x-seeo-pathname") return state.pathname;
        if (key === "accept-language") return state.acceptLanguage;
        return null;
      },
    };
  },
  cookies: async () => {
    state.cookieCalls += 1;
    if (state.staticContext) throw dynamicServerError();
    return {
      get: (name: string) =>
        name === "NEXT_LOCALE" && state.cookieLocale !== undefined
          ? { value: state.cookieLocale }
          : undefined,
    };
  },
}));

// not-found-locale → @/i18n/request（getRequestConfig）→ @/i18n/routing
// （next-intl/navigation 在 vitest node 环境解析 next 内部模块失败），按
// dashboard-locale.test.ts 的做法 stub 掉这两处，resolveUiLocale 走真实实现。
vi.mock("next-intl/server", () => ({
  getRequestConfig: vi.fn(async () => ({ locale: "en", messages: {} })),
  getTranslations: async (arg?: unknown) => {
    state.translationArgs.push(arg);
    const locale: Locale =
      typeof arg === "object" && arg !== null && "locale" in arg
        ? ((arg as { locale: Locale }).locale)
        : state.bodyLocale;
    const namespace =
      typeof arg === "string" ? arg : (arg as { namespace?: string } | undefined)?.namespace;
    const table = (locale === "zh" ? zhMessages : enMessages) as Record<string, unknown>;
    const ns = (namespace ? table[namespace] : table) as Record<string, string>;
    return (key: string) => ns[key] ?? key;
  },
  getLocale: async () => state.bodyLocale,
}));

vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["en", "zh"], defaultLocale: "en", localePrefix: "as-needed" },
}));

type GlobalNotFoundModule = {
  generateMetadata: () => Promise<Record<string, unknown>>;
  default: () => Promise<ReactElement>;
  dynamic?: string;
};

let mod: GlobalNotFoundModule;

beforeEach(async () => {
  state.pathname = null;
  state.cookieLocale = undefined;
  state.acceptLanguage = "en-US,en;q=0.9";
  state.staticContext = false;
  state.bodyLocale = "en";
  state.translationArgs = [];
  state.cookieCalls = 0;
  mod = (await import("./global-not-found.tsx")) as unknown as GlobalNotFoundModule;
});

const text = (locale: Locale) => (locale === "zh" ? zhMessages : enMessages).notFoundPage;

describe("404：generateMetadata 按 URL 前缀本地化", () => {
  it("/zh/未知路径 → 中文 404 标题与描述", async () => {
    state.pathname = "/zh/nope";
    const meta = await mod.generateMetadata();
    expect(meta.title).toBe(text("zh").title);
    expect(meta.description).toBe(text("zh").desc);
    expect((meta.openGraph as { locale: string }).locale).toBe("zh_CN");
  });

  it("/zh 根之外的多段未知路径同样按前缀本地化", async () => {
    state.pathname = "/zh/pricing/deep/nope";
    const meta = await mod.generateMetadata();
    expect(meta.title).toBe(text("zh").title);
  });

  it("非 UI 路径的无效 locale 段（/nope、/x/y/z）→ 默认语言 en，且绝不读 cookie", async () => {
    for (const pathname of ["/nope", "/x/y/z", "/zhishen/nope"]) {
      state.pathname = pathname;
      state.cookieLocale = "zh"; // cookie 是中文也不影响：locale 路由白名单外且非 UI 空间
      state.bodyLocale = "zh";
      const meta = await mod.generateMetadata();
      expect(meta.title, pathname).toBe(text("en").title);
      expect((meta.openGraph as { locale: string }).locale).toBe("en_US");
      expect(state.cookieCalls, `${pathname} 不应解析 cookie（BUG-004 静态上下文）`).toBe(0);
    }
  });

  it("/app 未注册子路由按界面语言本地化（NEXT_LOCALE cookie → Accept-Language → en）", async () => {
    // 中文界面用户的 404 必须是中文标题（此前恒为英文 Page Not Found | SeeO）
    state.pathname = "/app/does-not-exist";
    state.cookieLocale = "zh";
    let meta = await mod.generateMetadata();
    expect(meta.title).toBe(text("zh").title);
    expect(meta.description).toBe(text("zh").desc);
    expect((meta.openGraph as { locale: string }).locale).toBe("zh_CN");

    // cookie 优先于 Accept-Language：en cookie + zh 浏览器语言 → 英文
    state.cookieLocale = "en";
    state.acceptLanguage = "zh-CN,zh;q=0.9";
    meta = await mod.generateMetadata();
    expect(meta.title).toBe(text("en").title);

    // 无 cookie 时 Accept-Language 含 zh → 中文
    state.cookieLocale = undefined;
    meta = await mod.generateMetadata();
    expect(meta.title).toBe(text("zh").title);

    // 无 cookie + 非中文浏览器 → 默认英文
    state.acceptLanguage = "en-US,en;q=0.9";
    meta = await mod.generateMetadata();
    expect(meta.title).toBe(text("en").title);
  });

  it("其余 UI 路径空间的未知子路径同一规则（/login、/signup、/payment、/unsubscribe）", async () => {
    for (const pathname of [
      "/login/deep/nope",
      "/signup/nope",
      "/payment/checkout/nope",
      "/unsubscribe/nope",
    ]) {
      state.pathname = pathname;
      state.cookieLocale = "zh";
      const meta = await mod.generateMetadata();
      expect(meta.title, pathname).toBe(text("zh").title);
      expect((meta.openGraph as { locale: string }).locale, pathname).toBe("zh_CN");
    }
  });

  it("URL 前缀优先于 cookie：/zh/app/nope 与 /en/app/nope 只认前缀，不读 cookie", async () => {
    for (const [pathname, expectTitle] of [
      ["/zh/app/nope", text("zh").title],
      ["/en/app/nope", text("en").title],
    ] as const) {
      state.pathname = pathname;
      state.cookieLocale = pathname === "/zh/app/nope" ? "en" : "zh";
      const meta = await mod.generateMetadata();
      expect(meta.title, pathname).toBe(expectTitle);
      expect(state.cookieCalls, `${pathname} 语言已由前缀决定`).toBe(0);
    }
  });

  it("locale 只来自显式入参：metadata 解析不使用 cookie/header 协商", async () => {
    state.pathname = "/zh/nope";
    await mod.generateMetadata();
    expect(state.translationArgs.length).toBe(1);
    expect(state.translationArgs[0]).toEqual({ locale: "zh", namespace: "notFoundPage" });
    expect(state.cookieCalls).toBe(0);
  });

  it("header 缺失 → 默认语言", async () => {
    state.pathname = null;
    const meta = await mod.generateMetadata();
    expect(meta.title).toBe(text("en").title);
  });

  it("静态渲染上下文（cookies 抛 DYNAMIC_SERVER_USAGE）→ 退默认语言，不抛错", async () => {
    // BUG-004：/app/nope 属 UI 路径空间要读 cookie，静态上下文里 cookies() 会抛错。
    // resolveUiLocale 必须吞掉这一种错误并回退默认语言，否则 404 变成 500。
    state.pathname = "/app/nope";
    state.cookieLocale = "zh";
    state.staticContext = true;
    expect(await notFoundLocale("/app/nope")).toBe("en");
  });
});

describe("404：canonical / robots（唯一索引控制标签）", () => {
  it("不继承 layout 的 canonical（显式 null）", async () => {
    state.pathname = "/zh/nope";
    const meta = await mod.generateMetadata();
    expect(meta.alternates).toEqual({ canonical: null });
  });

  it("metadata 不含 robots：noindex 由 Next 对 404 注入，本页再写一份就是重复标签", async () => {
    for (const pathname of ["/app/nope", "/zh/nope", "/nope"]) {
      state.pathname = pathname;
      const meta = await mod.generateMetadata();
      expect(meta.robots, pathname).toBeUndefined();
      expect("robots" in meta, pathname).toBe(false);
    }
  });

  it("notFoundPageMeta（各 404 入口共用）也不输出 robots", () => {
    const meta = notFoundPageMeta("zh", text("zh"));
    expect("robots" in meta).toBe(false);
    expect(meta).toMatchObject({
      title: text("zh").title,
      description: text("zh").desc,
      alternates: { canonical: null },
      openGraph: { locale: "zh_CN" },
    });
  });

  it("404 标题不继承站点默认标题", () => {
    expect(text("en").title).not.toBe(
      (enMessages as { metadata?: { siteTitle?: string } }).metadata?.siteTitle
    );
    expect(text("zh").title).not.toBe(
      (zhMessages as { metadata?: { siteTitle?: string } }).metadata?.siteTitle
    );
    expect(text("en").title).not.toBe(text("zh").title);
  });
});

describe("404：首个服务器响应就是正确文档", () => {
  // 旧实现：notFound() → Next 输出 <html id="__next_error__">（无 lang、body 空），
  // 语言靠客户端 documentElement.lang 补丁。本页必须让 SSR 字符串自带 lang + 正文。
  const doc = async () => renderToStaticMarkup(await mod.default());

  it("zh cookie 的 /app 未知子路径：SSR 就有 lang=zh-CN、中文正文、链接指向 /zh", async () => {
    state.pathname = "/app/does-not-exist";
    state.cookieLocale = "zh";
    state.bodyLocale = "en"; // 正文不得信任 next-intl 请求 locale，必须由解析出的 locale 决定
    const html = await doc();
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).not.toContain("__next_error__");
    expect(html).toContain(text("zh").heading);
    expect(html).toContain(text("zh").desc);
    expect(html).toContain(text("zh").back);
    expect(html).toContain('href="/zh"');
    expect(html).not.toContain(text("en").heading);
    expect(html).not.toContain("<title"); // head 由 metadata API 输出，正文里不重复
    expect(html).not.toContain('name="robots"');
  });

  it("en cookie 同一 URL：SSR lang=en + 英文正文 + 链接指向 /", async () => {
    state.pathname = "/app/does-not-exist";
    state.cookieLocale = "en";
    state.bodyLocale = "zh";
    const html = await doc();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(text("en").heading);
    expect(html).toContain('href="/"');
    expect(html).not.toContain(text("zh").heading);
  });

  it("无 cookie + Accept-Language zh → lang=zh-CN 且正文中文（与标题同一 locale）", async () => {
    state.pathname = "/app/does-not-exist";
    state.acceptLanguage = "zh-CN,zh;q=0.9";
    const meta = await mod.generateMetadata();
    const html = await doc();
    expect(meta.title).toBe(text("zh").title);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain(text("zh").heading);
  });

  it("/zh 前缀优先于 en cookie：lang=zh-CN", async () => {
    state.pathname = "/zh/nope";
    state.cookieLocale = "en";
    const html = await doc();
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain(text("zh").heading);
  });

  it("lang 值与 localeToHtmlLang 契约一致（en→en、zh→zh-CN）", async () => {
    for (const [pathname, locale] of [
      ["/nope", "en"],
      ["/zh/nope", "zh"],
    ] as const) {
      state.pathname = pathname;
      state.cookieLocale = undefined;
      state.acceptLanguage = "en-US,en;q=0.9";
      const html = await doc();
      expect(html, pathname).toContain(`<html lang="${localeToHtmlLang[locale]}">`);
    }
  });

  it("标题、正文、lang 三次解析共用同一 locale（单页一次请求只解析一种语言）", async () => {
    state.pathname = "/app/nope";
    state.cookieLocale = "zh";
    await mod.generateMetadata();
    await mod.default();
    expect(state.translationArgs).toEqual([
      { locale: "zh", namespace: "notFoundPage" },
      { locale: "zh", namespace: "notFoundPage" },
    ]);
  });
});

describe("404：路由契约（无效 locale 段不进 [locale] 树）", () => {
  it("[locale] 布局声明 dynamicParams=false（路由层 404，不靠页面 notFound()）", () => {
    expect(LOCALE_LAYOUT_SRC).toContain("export const dynamicParams = false");
  });

  it("[locale] 树内没有 [...rest] catch-all，也没有第二份 not-found 边界", () => {
    expect(existsSync(fileURLToPath(new URL("./[locale]/[...rest]/page.tsx", import.meta.url)))).toBe(false);
    expect(existsSync(fileURLToPath(new URL("./[locale]/not-found.tsx", import.meta.url)))).toBe(false);
  });

  it("已删除客户端 lang 补丁（SSR 不一致不允许靠 documentElement.lang 掩盖）", () => {
    expect(existsSync(fileURLToPath(new URL("../components/HtmlLang.tsx", import.meta.url)))).toBe(false);
  });

  it("404 文档必须逐请求渲染（语言要读 cookie / Accept-Language）", () => {
    expect(mod.dynamic).toBe("force-dynamic");
  });

  it("404 渲染路径里不得再出现 notFound()（错误壳）或客户端 lang 补丁", () => {
    const code = GLOBAL_NOT_FOUND_SRC.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bnotFound\(/);
    expect(code).not.toMatch(/documentElement\.lang/);
    expect(code).not.toMatch(/from "next\/navigation"/);
  });
});

describe("localeSegmentFromPathname（404 的 locale 判定）", () => {
  it("首段为 zh/en 才认 locale，其余返回 null", () => {
    expect(localeSegmentFromPathname("/zh/nope")).toBe("zh");
    expect(localeSegmentFromPathname("/zh")).toBe("zh");
    expect(localeSegmentFromPathname("/en/pricing")).toBe("en");
    expect(localeSegmentFromPathname("/nope")).toBeNull();
    expect(localeSegmentFromPathname("/app/nope")).toBeNull();
    expect(localeSegmentFromPathname("/zhishen/nope")).toBeNull();
    expect(localeSegmentFromPathname("/zh/nope?x=1")).toBe("zh");
    expect(localeSegmentFromPathname("/zh#frag")).toBe("zh");
    expect(localeSegmentFromPathname(null)).toBeNull();
    expect(localeSegmentFromPathname(undefined)).toBeNull();
    expect(localeSegmentFromPathname("/")).toBeNull();
  });
});

describe("isUiLocalePath（哪些 404 走界面语言，不新增路由）", () => {
  it("工作台/认证/支付/退订首段为 true；营销路径与 null 为 false", () => {
    for (const p of [
      "/app/nope",
      "/login/x/y",
      "/signup/nope",
      "/payment/nope",
      "/unsubscribe/nope",
    ]) {
      expect(isUiLocalePath(p), p).toBe(true);
    }
    for (const p of ["/nope", "/pricing/nope", "/zh/app/nope", "/", "", null, undefined]) {
      expect(isUiLocalePath(p), String(p)).toBe(false);
    }
    // query / hash 不参与首段判定
    expect(isUiLocalePath("/app/nope?x=1")).toBe(true);
    expect(isUiLocalePath("/app/nope#frag")).toBe(true);
    // 前缀为 en/zh 的路径由 localeSegmentFromPathname 先接管，不该被当成 UI 空间
    expect(isUiLocalePath("/en/nope")).toBe(false);
  });
});

describe("notFoundLocale（三级规则的单一数据源）", () => {
  it("前缀 > cookie > Accept-Language > 默认语言", async () => {
    state.cookieLocale = "en";
    state.acceptLanguage = "zh-CN,zh;q=0.9";
    expect(await notFoundLocale("/zh/app/nope")).toBe("zh");
    expect(await notFoundLocale("/en/app/nope")).toBe("en");
    expect(await notFoundLocale("/app/nope")).toBe("en"); // cookie 覆盖浏览器语言
    state.cookieLocale = undefined;
    expect(await notFoundLocale("/app/nope")).toBe("zh");
    state.acceptLanguage = "en-US,en;q=0.9";
    expect(await notFoundLocale("/app/nope")).toBe("en");
  });

  it("非 UI 无效首段回退默认语言且不解析 cookie", async () => {
    state.cookieLocale = "zh";
    state.cookieCalls = 0;
    expect(await notFoundLocale("/nope/deeper")).toBe("en");
    expect(state.cookieCalls).toBe(0);
    expect(await notFoundLocale(null)).toBe("en");
    expect(await notFoundLocale(undefined)).toBe("en");
  });
});

describe("404：messages 与 sitemap 契约", () => {
  it("messages 双语齐备（title/heading/desc/back）", () => {
    for (const key of ["title", "heading", "desc", "back"] as const) {
      expect(text("en")[key]).toBeTruthy();
      expect(/[\u4e00-\u9fff]/.test(text("zh")[key])).toBe(true);
      expect(/[\u4e00-\u9fff]/.test(text("en")[key])).toBe(false);
    }
  });

  it("sitemap 不包含 404 / catch-all 条目", () => {
    expect(SITEMAP_SRC).not.toMatch(/not-found|\[\.\.\.rest\]/);
  });
});
