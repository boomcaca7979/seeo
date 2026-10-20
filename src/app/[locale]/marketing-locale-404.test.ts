// ===== [locale] 营销页：无效 locale 段的 metadata 必须与 404 边界同源 =====
// 主路径：[locale]/layout.tsx 的 dynamicParams=false 让无效 locale 段在**路由层**就不匹配
// 本树，直接由 global-not-found 输出 404 文档（见 src/app/global-not-found.test.ts）。
// 本页级 guard 是纵深防御：任何把无效 locale 当正常 params 渲染的入口（含 metadata 解析
// 上下文与 not-found 边界不一致的情况）都必须输出 404 标题，而不是顶着营销标题。
// 本测试真实调用每个页面的 generateMetadata（非源码字符串断言）。

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MESSAGES = join(HERE, "../../../messages");

type MessageBundle = { notFoundPage: { title: string } } & Record<string, unknown>;

const EN = JSON.parse(readFileSync(join(MESSAGES, "en.json"), "utf-8")) as MessageBundle;
const ZH = JSON.parse(readFileSync(join(MESSAGES, "zh.json"), "utf-8")) as MessageBundle;

// next-intl 的 namespace 是点号路径；逐段下钻，缺段返回空表（此时按 key 原样回退）。
function pickNamespace(bundle: MessageBundle, ns: string): Record<string, unknown> {
  if (!ns) return bundle;
  let current: unknown = bundle;
  for (const segment of ns.split(".")) {
    if (current === null || typeof current !== "object") return {};
    current = (current as Record<string, unknown>)[segment];
  }
  return current && typeof current === "object" ? (current as Record<string, unknown>) : {};
}

vi.mock("next-intl/server", () => {
  const read = (opts: unknown, key: "locale" | "namespace", fallback: string): string =>
    opts && typeof opts === "object" && key in opts
      ? String((opts as Record<string, unknown>)[key])
      : fallback;
  return {
    setRequestLocale: vi.fn(),
    getTranslations: async (opts: unknown) => {
      const locale = read(opts, "locale", "en");
      const ns = read(opts, "namespace", "");
      const messages = pickNamespace(locale === "zh" ? ZH : EN, ns);
      return (key: string) => String(messages[key] ?? key);
    },
  };
});

type LinkProps = { href: string; children?: ReactNode };

vi.mock("next/link", () => ({
  default: ({ children }: LinkProps) => children,
}));

// next-intl 客户端入口会内部 ESM 裸路径引用 next/navigation（node 解析需 .js 后缀），
// 本测试只跑 generateMetadata → 直接替掉客户端入口，不加载 react-client 依赖树。
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
  useMessages: () => ({}),
  NextIntlClientProvider: ({ children }: { children?: ReactNode }) => children,
}));

// @/i18n/routing → next-intl/navigation 在 node 测试环境不可加载（同 dashboard-locale.test.ts），
// Navbar / FinalCTA 会 import 它的 Link/useRouter。
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["en", "zh"], defaultLocale: "en", localePrefix: "as-needed" },
  Link: ({ children }: LinkProps) => children,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

// 页面组件对无效 locale 调用 notFound()；测试里换成可断言的抛错。
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("__notFound__");
  },
  redirect: () => {
    throw new Error("__redirect__");
  },
  permanentRedirect: () => {
    throw new Error("__permanentRedirect__");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

const LOCALE_ROOT = HERE;

function collectPageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectPageFiles(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

// 所有自带 generateMetadata 的 [locale] 页面（含首页）；
// 404 文档本身（lang / 正文 / robots 唯一性）由 src/app/global-not-found.test.ts 覆盖。
const marketingPages = collectPageFiles(LOCALE_ROOT)
  .filter((f) => {
    const src = readFileSync(f, "utf-8");
    return /export async function generateMetadata/.test(src);
  })
  .sort();

const invalidMeta = (m: Metadata) => ({
  title: m.title,
  canonical: (m.alternates as { canonical?: string | null } | undefined)?.canonical,
  robots: m.robots,
  ogLocale: (m.openGraph as { locale?: string } | undefined)?.locale,
});

describe("[locale] 营销页 metadata 覆盖清单", () => {
  it("至少覆盖 25 个营销页（新增页面漏掉 404 guard 会让本用例缩水失效）", () => {
    expect(marketingPages.length).toBeGreaterThanOrEqual(25);
  });
});

describe.each(marketingPages.map((f) => [f.slice(LOCALE_ROOT.length), f]))(
  "无效 locale metadata：%s",
  (_rel, file) => {
    it("locale=de → 返回 404 metadata（标题/canonical=null，不自带 robots），不是营销标题", async () => {
      const mod = (await import(/* @vite-ignore */ file)) as {
        generateMetadata: (a: { params: Promise<{ locale: string }> }) => Promise<Metadata>;
      };
      const meta = await mod.generateMetadata({ params: Promise.resolve({ locale: "de" }) });
      // robots 只有一个来源：状态码 > 400 时由 Next 注入 <meta name="robots" content="noindex">。
      // 本页若再声明 robots，最终 HTML 会出现第二条（重复索引控制）。
      expect(invalidMeta(meta)).toEqual({
        title: EN.notFoundPage.title,
        canonical: null,
        robots: undefined,
        ogLocale: "en_US",
      });
    });

    it("locale=de 与 locale=xx 行为一致（任何无效段都不得落回营销标题）", async () => {
      const mod = (await import(/* @vite-ignore */ file)) as {
        generateMetadata: (a: { params: Promise<{ locale: string }> }) => Promise<Metadata>;
      };
      const a = await mod.generateMetadata({ params: Promise.resolve({ locale: "de" }) });
      const b = await mod.generateMetadata({ params: Promise.resolve({ locale: "xx" }) });
      expect(b.title).toBe(a.title);
      expect(b.title).toBe(EN.notFoundPage.title);
    });

    it("locale=en/zh 仍返回本页营销 metadata（guard 不得过度生效）", async () => {
      const mod = (await import(/* @vite-ignore */ file)) as {
        generateMetadata: (a: { params: Promise<{ locale: string }> }) => Promise<Metadata>;
      };
      for (const locale of ["en", "zh"] as const) {
        const meta = await mod.generateMetadata({ params: Promise.resolve({ locale }) });
        const title =
          typeof meta.title === "string"
            ? meta.title
            : String((meta.title as { default?: string } | null | undefined)?.default);
        expect(title).not.toBe(EN.notFoundPage.title);
        expect(title).not.toBe(ZH.notFoundPage.title);
        expect((meta.alternates as { canonical?: string } | undefined)?.canonical).not.toBeNull();
      }
    });
  }
);
