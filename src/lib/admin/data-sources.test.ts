// ===== 数据源五态推导（纯函数）=====

import { describe, it, expect } from "vitest";
import { deriveState, DATA_SOURCE_STATE_LABELS } from "./data-sources";

const ok = { event: "success" as const, message: "", createdAt: "2026-10-09 10:00:00" };
const err = { event: "error" as const, message: "boom", createdAt: "2026-10-09 11:00:00" };

describe("deriveState：五态推导", () => {
  it("凭据未配置 → not-configured（无论探针结果）", () => {
    expect(deriveState({ configured: false, count: 0, lastError: null, lastSuccess: null })).toBe(
      "not-configured"
    );
    expect(deriveState({ configured: false, count: 5, lastError: null, lastSuccess: null })).toBe(
      "not-configured"
    );
  });

  it("已配置但探针失败（count=null）→ unreachable", () => {
    expect(deriveState({ configured: true, count: null, lastError: null, lastSuccess: null })).toBe(
      "unreachable"
    );
  });

  it("连接成功但无数据 → connected-no-data", () => {
    expect(deriveState({ configured: true, count: 0, lastError: null, lastSuccess: null })).toBe(
      "connected-no-data"
    );
  });

  it("有真实数据 → synced", () => {
    expect(
      deriveState({ configured: true, count: 42, lastError: null, lastSuccess: ok })
    ).toBe("synced");
  });

  it("有数据但最近事件是失败且晚于最近成功 → sync-error", () => {
    expect(
      deriveState({ configured: true, count: 42, lastError: err, lastSuccess: ok })
    ).toBe("sync-error");
  });

  it("失败后又成功 → 回到 synced（不永久报错）", () => {
    const lateOk = { ...ok, createdAt: "2026-10-09 12:00:00" };
    expect(
      deriveState({ configured: true, count: 42, lastError: err, lastSuccess: lateOk })
    ).toBe("synced");
  });

  it("五态中文标签齐全", () => {
    expect(Object.keys(DATA_SOURCE_STATE_LABELS).sort()).toEqual(
      ["connected-no-data", "not-configured", "sync-error", "synced", "unreachable"].sort()
    );
    expect(DATA_SOURCE_STATE_LABELS.synced).toBe("已同步真实数据");
  });
});
