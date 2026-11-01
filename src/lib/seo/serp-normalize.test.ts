// ===== SERP 链接规范化契约测试（DEF-01）=====
// 真实样本取自 2026-10-31 隔离库缓存（人工智能代理 / seo 快照），
// /goto?url=CAES… 是 Google 不透明重定向 token，不得被当域名或外链。

import { describe, expect, it } from "vitest";
import {
  hostFromDisplayedLink,
  normalizeSerpRow,
  normalizeSerpRows,
  normalizeSerpResult,
  resolveSerpLink,
} from "./serp-normalize";

const GOTO_TOKEN =
  "/goto?url=CAESywEB6zswFeFEMsyCKAPTC8phOSSs_c_zBczTqvvB9MA18y-hSkjpCpRSnCnVGZIrt4--psLwN_ZVvHO7fnk4BNmOqcOBWrX3FCaYT5MvW2fzV29Y_AAOboYk9B-unZcHHI_U9_EnxJ0BxHKI7fMUVM1nM_ut_-iUenn1a8gI0yW9O1tA_GiogZFzc8jtnfSijIexoOrcYMnDe3xtMNRTF9hJs_yWA_sW3as7YVbaWCizsQv52fh3moIT-r04NQjfaukyXBksWADH-KNFdQ";

describe("resolveSerpLink", () => {
  it("真实 https 外链 → ok，域名取链接真实主机（优先于 provider 的可注册域）", () => {
    const r = resolveSerpLink("https://developers.google.com/search/docs/fundamentals/", "google.com");
    expect(r.status).toBe("ok");
    expect(r.url).toBe("https://developers.google.com/search/docs/fundamentals/");
    expect(r.domain).toBe("developers.google.com");
    expect(r.domainSource).toBe("link");
  });

  it("没有可验证链接时，才回退 provider 的 domain", () => {
    const r = resolveSerpLink("", "example.com");
    expect(r.status).toBe("missing");
    expect(r.domain).toBe("example.com");
    expect(r.domainSource).toBe("provider");
  });

  it("provider 只给 link 时，域名从 link 主机取", () => {
    const r = resolveSerpLink("https://www.oneas1a.com/ai", null);
    expect(r.status).toBe("ok");
    expect(r.domain).toBe("www.oneas1a.com");
    expect(r.domainSource).toBe("link");
  });

  it("/goto?url= token → 不可还原：url 为 null，且绝不把 token 当域名", () => {
    const r = resolveSerpLink(GOTO_TOKEN, GOTO_TOKEN, "https://www.oneas1a.com › ai代理是什...");
    expect(r.status).toBe("google_redirect_token");
    expect(r.url).toBeNull();
    expect(r.domain).toBe("www.oneas1a.com");
    expect(r.domainSource).toBe("displayed_link");
  });

  it("displayedLink 没有主机名（如「7个回应」）→ 域名 null，不编造", () => {
    const r = resolveSerpLink(GOTO_TOKEN, GOTO_TOKEN, "7个回应");
    expect(r.status).toBe("google_redirect_token");
    expect(r.url).toBeNull();
    expect(r.domain).toBeNull();
  });

  it("Google /url?q= 公开包装可安全还原（绝对与相对两种形态）", () => {
    const abs = resolveSerpLink(
      "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&sa=U",
      "google.com"
    );
    expect(abs.status).toBe("ok");
    expect(abs.url).toBe("https://example.com/a?b=1");
    expect(abs.domain).toBe("example.com");
    expect(abs.domainSource).toBe("link");

    const rel = resolveSerpLink("/url?q=https://example.org/x", null);
    expect(rel.status).toBe("ok");
    expect(rel.url).toBe("https://example.org/x");
    expect(rel.domain).toBe("example.org");
  });

  it("/url?q= 指向非法目标时不解码成外链", () => {
    const r = resolveSerpLink("/url?q=javascript:alert(1)", null);
    expect(r.status).toBe("unresolvable");
    expect(r.url).toBeNull();
  });

  it("相对路径与纯文本 → unresolvable，不当作可用链接", () => {
    expect(resolveSerpLink("/search?q=x", null).status).toBe("unresolvable");
    expect(resolveSerpLink("7个回应", null).status).toBe("unresolvable");
    expect(resolveSerpLink("7个回应", null).url).toBeNull();
  });

  it("缺失链接 → missing", () => {
    const r = resolveSerpLink("", null);
    expect(r.status).toBe("missing");
    expect(r.url).toBeNull();
    expect(r.domain).toBeNull();
  });

  it("协议相对地址补成 https", () => {
    const r = resolveSerpLink("//example.net/p", null);
    expect(r.status).toBe("ok");
    expect(r.url).toBe("https://example.net/p");
    expect(r.domain).toBe("example.net");
  });
});

describe("hostFromDisplayedLink", () => {
  it("解析面包屑主机（含 › 分隔与路径）", () => {
    expect(hostFromDisplayedLink("https://www.salesforce.com › agentforce")).toBe("www.salesforce.com");
    expect(hostFromDisplayedLink("www.a.com/path")).toBe("www.a.com");
    expect(hostFromDisplayedLink("baike.baidu.com›item")).toBe("baike.baidu.com");
  });

  it("没有主机名时返回 null", () => {
    expect(hostFromDisplayedLink("7个回应")).toBeNull();
    expect(hostFromDisplayedLink("")).toBeNull();
    expect(hostFromDisplayedLink(null)).toBeNull();
  });
});

describe("normalizeSerpRow 幂等与批量", () => {
  const row = { position: 2, title: "t", link: GOTO_TOKEN, domain: GOTO_TOKEN, snippet: "s" };

  it("首次规范化补齐三个派生字段，且保留原始 link/domain", () => {
    const n = normalizeSerpRow(row);
    expect(n.linkStatus).toBe("google_redirect_token");
    expect(n.resolvedUrl).toBeNull();
    expect(n.link).toBe(GOTO_TOKEN);
    expect(n.domain).toBe(GOTO_TOKEN);
  });

  it("重复规范化结果一致（旧快照读多次不会漂移）", () => {
    const once = normalizeSerpRow(row);
    const twice = normalizeSerpRow(once);
    expect(twice.resolvedUrl).toBe(once.resolvedUrl);
    expect(twice.linkStatus).toBe(once.linkStatus);
    expect(twice).toBe(once);
  });

  it("批量与整结果规范化不改动其他字段", () => {
    const result = { keyword: "kw", organic: [row], relatedSearches: [] };
    const out = normalizeSerpResult(result);
    expect(out.keyword).toBe("kw");
    expect(out.relatedSearches).toEqual([]);
    expect(out.organic[0].linkStatus).toBe("google_redirect_token");
    expect(normalizeSerpRows([row])[0].linkStatus).toBe("google_redirect_token");
  });
});
