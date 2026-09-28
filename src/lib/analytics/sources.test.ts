// ===== 来源标准化测试（B3 / B10）=====
// 覆盖：refhost 归类（含子域/短链变体）、UTM 优先级、direct 判定、未知来源收敛为 other

import { describe, it, expect } from "vitest";
import { normalizeTouch, CANONICAL_SOURCES } from "./sources";

describe("normalizeTouch：referrer host 分类", () => {
  it("reddit 变体统一为 reddit", () => {
    for (const r of ["https://www.reddit.com/r/seo/", "https://old.reddit.com/r/seo", "https://reddit.com", "https://np.reddit.com"]) {
      expect(normalizeTouch({ referrer: r }).source).toBe("reddit");
    }
  });

  it("google 变体统一为 google（含国别域名）", () => {
    for (const r of ["https://www.google.com/", "https://google.co.uk/", "https://www.google.de/search?q=x"]) {
      expect(normalizeTouch({ referrer: r }).source).toBe("google");
    }
  });

  it("bing / linkedin / x / producthunt / indiehackers 归类", () => {
    expect(normalizeTouch({ referrer: "https://www.bing.com/search?q=x" }).source).toBe("bing");
    expect(normalizeTouch({ referrer: "https://www.linkedin.com/feed/" }).source).toBe("linkedin");
    expect(normalizeTouch({ referrer: "https://lnkd.in/abc" }).source).toBe("linkedin");
    expect(normalizeTouch({ referrer: "https://x.com/user" }).source).toBe("x");
    expect(normalizeTouch({ referrer: "https://twitter.com/user" }).source).toBe("x");
    expect(normalizeTouch({ referrer: "https://t.co/abc" }).source).toBe("x");
    expect(normalizeTouch({ referrer: "https://www.producthunt.com/" }).source).toBe("producthunt");
    expect(normalizeTouch({ referrer: "https://www.indiehackers.com/post/x" }).source).toBe("indiehackers");
  });

  it("无 referrer 且无 UTM → direct", () => {
    const t = normalizeTouch({});
    expect(t.source).toBe("direct");
    expect(t.medium).toBe("direct");
    expect(t.hasTouch).toBe(false);
  });

  it("未知 referrer → other（不保留原始 host，避免来源碎片化）", () => {
    const t = normalizeTouch({ referrer: "https://news.ycombinator.com/item?id=1" });
    expect(t.source).toBe("other");
    expect(t.medium).toBe("referral");
    expect(CANONICAL_SOURCES).toContain("other");
  });
});

describe("normalizeTouch：UTM 优先级", () => {
  it("有 UTM 时优先于 referrer", () => {
    const t = normalizeTouch({
      utmSource: "reddit",
      utmMedium: "social",
      utmCampaign: "launch",
      referrer: "https://www.google.com/",
    });
    expect(t.source).toBe("reddit");
    expect(t.medium).toBe("social");
    expect(t.campaign).toBe("launch");
    expect(t.hasTouch).toBe(true);
  });

  it("utm_source 别名归一（twitter → x，newsletter → email）", () => {
    expect(normalizeTouch({ utmSource: "Twitter" }).source).toBe("x");
    expect(normalizeTouch({ utmSource: "newsletter" }).source).toBe("email");
    expect(normalizeTouch({ utmSource: "Product Hunt" }).source).toBe("producthunt");
  });

  it("utm 大小写不敏感（Reddit → reddit）", () => {
    expect(normalizeTouch({ utmSource: "Reddit" }).source).toBe("reddit");
  });

  it("utm_source 未知值 → other", () => {
    expect(normalizeTouch({ utmSource: "weird-channel" }).source).toBe("other");
  });
});
