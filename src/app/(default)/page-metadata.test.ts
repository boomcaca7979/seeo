// ===== /payment、/login、/signup、工作台 404 的服务端 metadata 本地化测试 =====
// 全部直接调用各模块导出的 generateMetadata()，断言返回的 Metadata 对象等于
// messages 里对应语言的文案（不是断言源码里出现了某个字符串）。
// 覆盖：
//   1. /payment/result：英文界面不再拿到硬编码中文标题（旧 payment/layout 的「支付 · SeeO」）
//   2. /login、/signup：中文界面拿到中文标题与描述（旧版是静态英文 metadata）
//   3. 两者都保留 SeeO 品牌、og:locale 随语言、canonical 单地址、robots 不索引
//   4. 工作台 not-found 边界：标题是本地化「项目不存在 · SeeO」，不沿用功能页标题
//      （/app/projects/99999 曾输出「Website overview · SeeO」）

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";
import { composeDashboardTitle } from "@/lib/dashboard-titles";

const state = { locale: "en" as "en" | "zh" };

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg?: unknown) => {
    const namespace =
      typeof arg === "string"
        ? arg
        : (arg as { namespace?: string } | undefined)?.namespace;
    const table = (state.locale === "zh" ? zhMessages : enMessages) as Record<string, unknown>;
    // next-intl 支持点号命名空间（dashboard.notFound），fake 同样逐段下钻
    const ns = (namespace
      ? namespace.split(".").reduce<unknown>(
          (acc, seg) => (acc as Record<string, unknown> | undefined)?.[seg],
          table
        )
      : table) as Record<string, string>;
    return (key: string) => ns[key] ?? key;
  },
  getLocale: async () => state.locale,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/components/auth/AuthForm", () => ({ default: () => null }));
vi.mock("@/components/JsonLd", () => ({ default: () => null }));
vi.mock("@/lib/seo/schema", () => ({ breadcrumbSchema: () => ({ "@type": "BreadcrumbList" }) }));

type OpenGraph = { title?: string; locale?: string };

/** 断言里都会读到的字段：这些页面必须给出 title/description（缺失即测试失败） */
type PageMetadata = {
  title: string;
  description: string;
  robots?: unknown;
  alternates?: unknown;
  openGraph?: OpenGraph;
  twitter?: OpenGraph;
};

/** 认证页额外承诺带 openGraph / twitter 两块（用于 og:locale 与品牌一致性断言） */
type AuthPageMetadata = PageMetadata & { openGraph: OpenGraph; twitter: OpenGraph };

type MetadataModule<T extends PageMetadata = PageMetadata> = {
  generateMetadata: () => Promise<T>;
};

const login = () =>
  import("./login/page.tsx") as unknown as Promise<MetadataModule<AuthPageMetadata>>;
const signup = () =>
  import("./signup/page.tsx") as unknown as Promise<MetadataModule<AuthPageMetadata>>;
const payment = () => import("./payment/layout.tsx") as unknown as Promise<MetadataModule>;
const dashNotFound = () =>
  import("./(dashboard)/app/not-found.tsx") as unknown as Promise<MetadataModule>;

const HAS_CHINESE = /[\u4e00-\u9fff]/;

beforeEach(() => {
  state.locale = "en";
});

describe("/payment/result metadata", () => {
  it("英文界面输出英文标题与描述（不再硬编码中文）", async () => {
    const meta = await (await payment()).generateMetadata();
    expect(meta.title).toBe(enMessages.paymentResult.metaTitle);
    expect(meta.description).toBe(enMessages.paymentResult.metaDescription);
    expect(HAS_CHINESE.test(meta.title)).toBe(false);
  });

  it("中文界面输出中文标题与描述", async () => {
    state.locale = "zh";
    const meta = await (await payment()).generateMetadata();
    expect(meta.title).toBe(zhMessages.paymentResult.metaTitle);
    expect(HAS_CHINESE.test(meta.title)).toBe(true);
  });

  it("私有页不索引，两种语言都保留 SeeO 品牌", async () => {
    for (const locale of ["en", "zh"] as const) {
      state.locale = locale;
      const meta = await (await payment()).generateMetadata();
      expect(meta.robots).toEqual({ index: false, follow: false });
      expect(meta.title).toContain("SeeO");
    }
  });
});

describe("/login metadata", () => {
  it("en/zh 标题与描述取自 authPage 对应语言", async () => {
    const en = await (await login()).generateMetadata();
    expect(en.title).toBe(enMessages.authPage.loginTitle);
    expect(en.description).toBe(enMessages.authPage.loginDescription);
    expect(en.openGraph.title).toBe(enMessages.authPage.loginTitle);
    expect(en.twitter.title).toBe(enMessages.authPage.loginTitle);
    expect(en.openGraph.locale).toBe("en_US");

    state.locale = "zh";
    const zh = await (await login()).generateMetadata();
    expect(zh.title).toBe(zhMessages.authPage.loginTitle);
    expect(zh.description).toBe(zhMessages.authPage.loginDescription);
    expect(zh.openGraph.locale).toBe("zh_CN");
    expect(HAS_CHINESE.test(zh.title)).toBe(true);
  });

  it("单地址：canonical 恒为 /login，品牌保留，营销页标题不被继承", async () => {
    for (const locale of ["en", "zh"] as const) {
      state.locale = locale;
      const meta = await (await login()).generateMetadata();
      expect(meta.alternates).toEqual({ canonical: "/login" });
      expect(meta.title).toContain("SeeO");
      expect(meta.title).not.toBe(enMessages.meta.siteTitle);
      expect(meta.title).not.toBe(zhMessages.meta.siteTitle);
      // 认证页不得继承工作台标题（BUG-09 的标题表不参与本页）
      expect(meta.title).not.toContain(composeDashboardTitle(enMessages.dashboard.workspace.title));
    }
  });
});

describe("/signup metadata", () => {
  it("en/zh 标题与描述取自 authPage 对应语言，canonical 恒为 /signup", async () => {
    const en = await (await signup()).generateMetadata();
    expect(en.title).toBe(enMessages.authPage.signupTitle);
    expect(en.description).toBe(enMessages.authPage.signupDescription);
    expect(en.openGraph.locale).toBe("en_US");
    expect(en.alternates).toEqual({ canonical: "/signup" });

    state.locale = "zh";
    const zh = await (await signup()).generateMetadata();
    expect(zh.title).toBe(zhMessages.authPage.signupTitle);
    expect(zh.openGraph.locale).toBe("zh_CN");
    expect(HAS_CHINESE.test(zh.title)).toBe(true);
    expect(zh.alternates).toEqual({ canonical: "/signup" });
  });

  it("登录页与注册页标题互不相同（避免两个页面共用一个标题）", async () => {
    const loginMeta = await (await login()).generateMetadata();
    const signupMeta = await (await signup()).generateMetadata();
    expect(loginMeta.title).not.toBe(signupMeta.title);
    expect(loginMeta.description).not.toBe(signupMeta.description);
  });
});

describe("工作台 not-found metadata", () => {
  it("标题本地化为「<项目不存在> · SeeO」，不沿用功能页标题", async () => {
    const en = await (await dashNotFound()).generateMetadata();
    expect(en.title).toBe(composeDashboardTitle(enMessages.dashboard.notFound.title));
    expect(en.description).toBe(enMessages.dashboard.notFound.subtitle);

    state.locale = "zh";
    const zh = await (await dashNotFound()).generateMetadata();
    expect(zh.title).toBe(composeDashboardTitle(zhMessages.dashboard.notFound.title));
    expect(HAS_CHINESE.test(zh.title)).toBe(true);

    // 关键回归：404 不得顶着工作台概览/其他功能页标题
    expect(en.title).not.toBe(composeDashboardTitle(enMessages.dashboard.workspace.title));
    expect(zh.title).not.toBe(composeDashboardTitle(zhMessages.dashboard.workspace.title));
  });
});
