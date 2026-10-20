// ===== BUG-08 回归测试：/app/backlinks 的取数门控接线 =====
// 要求：无权限（或权益未确定）时前端根本不发 /api/backlinks 请求；
// 有权限时仍按原契约自动加载一次（不重复）；后端 entitlement guard 必须原样保留。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const API = readFileSync(
  fileURLToPath(new URL("../../../../api/backlinks/route.ts", import.meta.url)),
  "utf-8"
);

// INIT 只取「域名解析 effect」那一段：门控 effect 从 autoLoadedRef 起，不在本段范围内
// 2026-10：域名解析改为跟随全局项目（appliedProjectRef），锚点随之更新
const INIT = PAGE.slice(PAGE.indexOf("// 挂载/切换项目时确定域名"), PAGE.indexOf("const autoLoadedRef"));
const GATED = PAGE.slice(PAGE.indexOf("const autoLoadedRef"), PAGE.indexOf("const handleDomainChange"));

describe("BUG-08：挂载 effect 不再无条件请求 Pro 数据", () => {
  it("域名解析 effect 只记录待加载域名，不发起 /api/backlinks 请求", () => {
    expect(INIT).toContain("setAutoDomain(target)");
    expect(INIT).not.toContain("loadCache(");
    expect(INIT).not.toContain("/api/backlinks");
    expect(INIT).toContain('localStorage.getItem("seeo:last-backlink-domain")');
  });

  it("取数改由权益三态门控：wait/block 都不请求，只有 fetch 才请求", () => {
    expect(GATED).toContain("decideEntitlementFetch({ loading: entitlementsLoading, allowed: features.backlinks })");
    expect(GATED).toContain('!== "fetch"');
    expect(GATED).toContain("return;");
    expect(GATED).toContain("void loadCache(autoDomain);");
  });

  it("同一域名只自动加载一次（重渲染 / 权益由未知转已知都不应重复请求）", () => {
    expect(GATED).toContain("autoLoadedRef.current === autoDomain");
    expect(GATED).toContain("autoLoadedRef.current = autoDomain;");
  });

  it("升级门槛仍按「权益已确定且无权限」显示，不显示加载失败", () => {
    expect(PAGE).toContain("if (!entitlementsLoading && !features.backlinks)");
    expect(PAGE).toContain('t("proTitle")');
  });
});

describe("BUG-08：后端保护不得放宽", () => {
  it("/api/backlinks 仍然调用 requireFeature 做服务端 entitlement 校验", () => {
    expect(API).toContain('requireFeature(userId, "backlinks")');
    expect(API).toContain("FeatureNotAllowedError");
  });
});
