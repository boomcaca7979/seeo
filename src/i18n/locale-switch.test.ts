// ===== 语言切换导航契约（§七.10：营销页语言切换 + metadata） =====
// 覆盖：切换 URL 与页面 canonical/hreflang 同源（en 无前缀、zh 带 /zh、绝不出现 /en/*）、
// cookie 串可被 locale 解析器接受（值即 locale、Path=/、SameSite=Lax、有 Max-Age）。
// 「切换后 head 唯一且属于目标语言」由真实浏览器验证（客户端导航会追加重复标签，
// 因此这里锁定整份文档导航所用的地址与 cookie，而不是组件源码写法）。

import { describe, it, expect } from "vitest";
import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  localeSwitchCookie,
  localeSwitchHref,
} from "./locale-switch";
import { locales } from "./config";

describe("localeSwitchHref", () => {
  it("en 无前缀、zh 带 /zh（与 localePath/canonical/hreflang 同一规则）", () => {
    expect(localeSwitchHref("en", "/")).toBe("/");
    expect(localeSwitchHref("zh", "/")).toBe("/zh");
    expect(localeSwitchHref("en", "/pricing")).toBe("/pricing");
    expect(localeSwitchHref("zh", "/pricing")).toBe("/zh/pricing");
    expect(localeSwitchHref("zh", "/features/seo-audit")).toBe("/zh/features/seo-audit");
  });

  it("绝不产出 /en/* 前缀，也不残留重复前缀", () => {
    for (const p of ["/", "/pricing", "/docs"]) {
      expect(localeSwitchHref("en", p)).not.toMatch(/^\/en(\/|$)/);
      expect(localeSwitchHref("zh", p)).not.toMatch(/\/zh\/zh/);
    }
  });

  it("两端地址互不相同（切换一定换 URL，不会原地不动）", () => {
    for (const p of ["/", "/pricing", "/features/seo-audit"]) {
      expect(localeSwitchHref("zh", p)).not.toBe(localeSwitchHref("en", p));
    }
  });
});

describe("localeSwitchCookie", () => {
  const parse = (raw: string) => {
    const [pair, ...attrs] = raw.split(";");
    const idx = pair.indexOf("=");
    return {
      name: pair.slice(0, idx).trim(),
      value: pair.slice(idx + 1).trim(),
      attrs: attrs.map((a) => a.trim()),
    };
  };

  it("name 与 next-intl 默认 localeCookie 同名，value 即目标 locale", () => {
    for (const locale of locales) {
      const c = parse(localeSwitchCookie(locale));
      expect(c.name).toBe(LOCALE_COOKIE_NAME);
      expect(c.value).toBe(locale);
      expect(locales).toContain(c.value);
    }
  });

  it("Path=/ 保证切到任意前缀路径后仍可读，SameSite=Lax、Max-Age 为一年", () => {
    const c = parse(localeSwitchCookie("zh"));
    expect(c.attrs).toContain("Path=/");
    expect(c.attrs).toContain("SameSite=Lax");
    expect(c.attrs).toContain(`Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`);
    expect(LOCALE_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 365);
  });

  it("不含会被浏览器拒收或泄漏站点的属性", () => {
    for (const locale of locales) {
      const raw = localeSwitchCookie(locale);
      expect(raw).not.toMatch(/domain=/i);
      expect(raw).not.toMatch(/secure/i);
      expect(raw.split(";")[0]).toBe(`${LOCALE_COOKIE_NAME}=${locale}`);
    }
  });
});
