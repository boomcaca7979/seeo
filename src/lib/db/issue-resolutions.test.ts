// ===== 处理状态安全边界测试 =====
// 核心不变式：`verified_resolved` 是**服务端专属**。
// 客户端（或任何调用方）直接提交该状态必须被拒绝，且**在校验前就返回**（不触碰数据库）。

import { describe, it, expect } from "vitest";
import { isUserSettableStatus, setUserResolutionStatus, USER_SETTABLE_STATUSES } from "./issue-resolutions";

describe("isUserSettableStatus：用户可置位的状态集合", () => {
  it("open / in_progress / fixed_claimed / dismissed 可置位", () => {
    for (const s of ["open", "in_progress", "fixed_claimed", "dismissed"]) {
      expect(isUserSettableStatus(s), s).toBe(true);
    }
  });

  it("verified_resolved 不可由用户置位", () => {
    expect(isUserSettableStatus("verified_resolved")).toBe(false);
  });

  it("未知状态一律拒绝", () => {
    for (const s of ["", "resolved", "done", "VERIFIED_RESOLVED", "open "]) {
      expect(isUserSettableStatus(s), s).toBe(false);
    }
  });

  it("可置位集合中不包含 verified_resolved", () => {
    expect(USER_SETTABLE_STATUSES).not.toContain("verified_resolved");
  });
});

describe("setUserResolutionStatus：拒绝服务端专属状态（且不触碰数据库）", () => {
  it("提交 verified_resolved → ok:false + status_not_user_settable（先于任何 DB 访问返回）", async () => {
    const res = await setUserResolutionStatus("u1", "example.com", "missing-h1", "verified_resolved");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("status_not_user_settable");
  });
});
