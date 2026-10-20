// ===== BUG-08 回归测试：Pro 门槛页面的三态取数决策 =====
// 旧行为：挂载 effect 无条件 fetch(`/api/backlinks`)，free 用户先发出请求、再被后端 guard
// 判成 403，页面显示升级门槛却留下一个失败请求。
// 约束：「权益未加载」既不能当作无权限（Pro 用户会漏加载），也不能当作有权限（继续 403）。

import { describe, it, expect } from "vitest";
import { decideEntitlementFetch } from "./entitlement-fetch";

describe("decideEntitlementFetch", () => {
  it("套餐信息仍在加载 → wait：不发请求，也不判定为无权限", () => {
    // features 默认全是 false（EntitlementsContext 的 DEFAULT_FEATURES），
    // 此时 allowed=false 只代表「还没拿到数据」，绝不代表无权限
    expect(decideEntitlementFetch({ loading: true, allowed: false })).toBe("wait");
    expect(decideEntitlementFetch({ loading: true, allowed: true })).toBe("wait");
  });

  it("加载完成且有权限 → fetch", () => {
    expect(decideEntitlementFetch({ loading: false, allowed: true })).toBe("fetch");
  });

  it("加载完成且无权限 → block（前端不请求，后端 guard 仍然是最终防线）", () => {
    expect(decideEntitlementFetch({ loading: false, allowed: false })).toBe("block");
  });

  it("wait 与 block 都不会被调用方当成 fetch", () => {
    const decisions = [
      decideEntitlementFetch({ loading: true, allowed: false }),
      decideEntitlementFetch({ loading: false, allowed: false }),
    ];
    expect(decisions.every((d) => d !== "fetch")).toBe(true);
  });
});
