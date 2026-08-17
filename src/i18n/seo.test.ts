// ===== i18n SEO 工具单测（纯函数）=====
// 验证 localePath / localeUrl / alternatesFor 的输出契约：
// EN 无前缀、ZH /zh 前缀、hreflang 双向 + x-default 指向 EN。

import { describe, it, expect } from "vitest";
import { localePath, localeUrl, alternatesFor, SITE_URL } from "./seo";

describe("localePath", () => {
  it("EN（默认语言）无前缀", () => {
    expect(localePath("en", "/")).toBe("/");
    expect(localePath("en", "/pricing")).toBe("/pricing");
    expect(localePath("en", "/features/seo-audit")).toBe("/features/seo-audit");
  });

  it("ZH 使用 /zh 前缀（首页为 /zh，无尾斜杠）", () => {
    expect(localePath("zh", "/")).toBe("/zh");
    expect(localePath("zh", "/pricing")).toBe("/zh/pricing");
    expect(localePath("zh", "/features/seo-audit")).toBe("/zh/features/seo-audit");
  });

  it("容错：相对路径与多余尾斜杠", () => {
    expect(localePath("zh", "pricing")).toBe("/zh/pricing");
    expect(localePath("en", "/pricing/")).toBe("/pricing");
    expect(localePath("zh", "/")).toBe("/zh");
  });
});

describe("localeUrl", () => {
  it("输出绝对 URL", () => {
    expect(localeUrl("en", "/pricing")).toBe(`${SITE_URL}/pricing`);
    expect(localeUrl("zh", "/pricing")).toBe(`${SITE_URL}/zh/pricing`);
  });
});

describe("alternatesFor", () => {
  it("EN 页面：canonical 无前缀 + 三向 hreflang", () => {
    const { alternates } = alternatesFor("en", "/pricing");
    expect(alternates?.canonical).toBe("/pricing");
    expect(alternates?.languages).toEqual({
      en: `${SITE_URL}/pricing`,
      "zh-CN": `${SITE_URL}/zh/pricing`,
      "x-default": `${SITE_URL}/pricing`,
    });
  });

  it("ZH 页面：canonical 为 /zh 前缀", () => {
    const { alternates } = alternatesFor("zh", "/pricing");
    expect(alternates?.canonical).toBe("/zh/pricing");
    expect(alternates?.languages?.["zh-CN"]).toBe(`${SITE_URL}/zh/pricing`);
    expect(alternates?.languages?.en).toBe(`${SITE_URL}/pricing`);
    expect(alternates?.languages?.["x-default"]).toBe(`${SITE_URL}/pricing`);
  });

  it("首页：EN / 与 ZH /zh", () => {
    expect(alternatesFor("en", "/").alternates?.canonical).toBe("/");
    expect(alternatesFor("zh", "/").alternates?.canonical).toBe("/zh");
    expect(alternatesFor("zh", "/").alternates?.languages?.en).toBe(`${SITE_URL}/`);
  });
});
