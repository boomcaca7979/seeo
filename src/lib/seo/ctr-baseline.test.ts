// ===== CTR 基线（共享纯模块）测试 =====
// 抽取自 opportunity-service（客户端关键词研究页与机会引擎共用同一份曲线）。

import { describe, expect, it } from "vitest";
import { CTR_BASELINE_BY_POSITION, expectedCtrForPosition } from "./ctr-baseline";

describe("ctr-baseline（SeeO 启发式 CTR 基线）", () => {
  it("分段返回预期 CTR", () => {
    expect(expectedCtrForPosition(1)).toBe(0.28);
    expect(expectedCtrForPosition(2)).toBe(0.15);
    expect(expectedCtrForPosition(5)).toBe(0.05);
    expect(expectedCtrForPosition(8)).toBe(0.03);
    expect(expectedCtrForPosition(10)).toBe(0.02);
  });

  it("超出最后分段（position > 10）返回 null（基线不外推）", () => {
    expect(expectedCtrForPosition(11)).toBeNull();
    expect(expectedCtrForPosition(50)).toBeNull();
  });

  it("曲线单调不递增（位置越靠后 CTR 不升高）", () => {
    for (let i = 1; i < CTR_BASELINE_BY_POSITION.length; i++) {
      expect(CTR_BASELINE_BY_POSITION[i].ctr).toBeLessThanOrEqual(CTR_BASELINE_BY_POSITION[i - 1].ctr);
    }
  });
});
