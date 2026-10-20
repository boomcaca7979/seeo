// ===== 逻辑路径归一：locale 前缀必须全部剥掉 =====
// 首页 hydration error #418 的根源在这里：[locale] 营销页预渲染到**内部路径**
// （.next/server/app/en.html、en/pricing.html，flight payload 里是 c:["","en","pricing"]），
// 而浏览器 canonical 地址是无前缀的 /、/pricing。usePathname() 在服务端给出 /en/pricing、
// 在客户端给出 /pricing，任何由路径推导的 JSX（语言切换按钮的显隐、锚点前缀、active 态）
// 都会在首轮 hydration 时对不上 —— React #418（args[]=text）。
// 只要 stripLocalePrefix 把所有 locale（含默认 en）都剥成同一个逻辑路径，
// 服务端 markup 与首轮客户端渲染就必然一致。
//
// 这里同时锁住另一条 SEO 事实：剥前缀后 isLocaleRoutedPath 认得 /en/*，
// 否则 EN 预渲染文档会判不出「本页参与 locale 路由」，SSR HTML 里连语言切换链接都没有。

import { describe, it, expect } from "vitest";
import {
  LOCALE_ROUTED_PATHS,
  UI_LOCALE_SEGMENTS,
  isLocaleRoutedPath,
  isUiLocalePath,
  localeSegmentFromPathname,
  stripLocalePrefix,
} from "./locale-routed-paths";
import { locales } from "./config";
import { localePath } from "./seo";

describe("stripLocalePrefix", () => {
  it("每个 locale 的前缀形式与无前后归一到同一个逻辑路径", () => {
    for (const locale of locales) {
      expect(stripLocalePrefix(`/${locale}`)).toBe("/");
      expect(stripLocalePrefix(`/${locale}/`)).toBe("/");
      expect(stripLocalePrefix(`/${locale}/pricing`)).toBe("/pricing");
      expect(stripLocalePrefix(`/${locale}/features/seo-audit`)).toBe("/features/seo-audit");
    }
  });

  it("en 与 zh 对称：服务端预渲染内部路径 /en/* 与浏览器 / 得到同一个值（#418 回归）", () => {
    expect(stripLocalePrefix("/en")).toBe(stripLocalePrefix("/"));
    expect(stripLocalePrefix("/en/pricing")).toBe(stripLocalePrefix("/pricing"));
    expect(stripLocalePrefix("/en/")).toBe("/");
    expect(stripLocalePrefix("/en/guides/how-to-do-a-technical-seo-audit")).toBe(
      "/guides/how-to-do-a-technical-seo-audit"
    );
  });

  it("非 locale 首段原样保留（不把 /zh-hans、/app 误剥）", () => {
    expect(stripLocalePrefix("/zh-hans/pricing")).toBe("/zh-hans/pricing");
    expect(stripLocalePrefix("/app/projects/17")).toBe("/app/projects/17");
    expect(stripLocalePrefix("/payment/result")).toBe("/payment/result");
    expect(stripLocalePrefix("/")).toBe("/");
  });

  it("幂等：对已剥好的逻辑路径再剥一次不变", () => {
    for (const path of LOCALE_ROUTED_PATHS) {
      const once = stripLocalePrefix(path);
      expect(stripLocalePrefix(once)).toBe(once);
      for (const locale of locales) {
        expect(stripLocalePrefix(stripLocalePrefix(localePath(locale, path)))).toBe(path);
      }
    }
  });
});

describe("isLocaleRoutedPath", () => {
  it("白名单页三种写法都认（浏览器无前缀、zh 前缀、en 内部前缀）", () => {
    for (const path of LOCALE_ROUTED_PATHS) {
      expect(isLocaleRoutedPath(path)).toBe(true);
      expect(isLocaleRoutedPath(localePath("zh", path))).toBe(true);
      expect(isLocaleRoutedPath(localePath("en", path))).toBe(true);
    }
  });

  it("EN 预渲染内部路径同样判为 locale 路由（否则 SSR HTML 里没有语言切换链接）", () => {
    expect(isLocaleRoutedPath("/en/pricing")).toBe(true);
    expect(isLocaleRoutedPath("/en")).toBe(true);
  });

  it("不参与 locale 路由的路径保持 false", () => {
    for (const path of ["/app", "/app/audit", "/login", "/nope", "/en/nope"]) {
      expect(isLocaleRoutedPath(path)).toBe(false);
    }
  });
});

describe("UI locale 路径空间", () => {
  it("/app、/login、/signup、/payment、/unsubscribe 的首段判为 UI 空间", () => {
    for (const segment of UI_LOCALE_SEGMENTS) {
      expect(isUiLocalePath(`/${segment}/anything`)).toBe(true);
    }
    expect(isUiLocalePath("/pricing")).toBe(false);
    expect(isUiLocalePath(null)).toBe(false);
  });

  it("localeSegmentFromPathname 只认 zh/en 首段（其余 null，由调用方决定回退）", () => {
    expect(localeSegmentFromPathname("/zh/unknown")).toBe("zh");
    expect(localeSegmentFromPathname("/en/unknown")).toBe("en");
    expect(localeSegmentFromPathname("/nope")).toBe(null);
    expect(localeSegmentFromPathname("/app/projects/999")).toBe(null);
  });
});
