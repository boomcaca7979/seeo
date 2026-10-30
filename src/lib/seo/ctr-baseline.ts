// ===== CTR 基线（公式明确、可测试；客户端/服务端共用） =====
// 行业通用的位置-CTR 近似曲线（聚合多项公开 CTR 研究的中位水平），
// 作为"预期 CTR"基线；实际 CTR < 0.5 × baseline → CTR 机会。
// 这是 SeeO 的启发式基线（非 Google 官方数据），公式随代码可见、可复现。
// 纯常量与纯函数，无服务端依赖——客户端（关键词研究页）与服务端（机会引擎）共用同一份。

export const CTR_BASELINE_BY_POSITION: ReadonlyArray<{ maxPosition: number; ctr: number }> = [
  { maxPosition: 1, ctr: 0.28 },
  { maxPosition: 2, ctr: 0.15 },
  { maxPosition: 3, ctr: 0.1 },
  { maxPosition: 4, ctr: 0.07 },
  { maxPosition: 5, ctr: 0.05 },
  { maxPosition: 8, ctr: 0.03 },
  { maxPosition: 10, ctr: 0.02 },
];

export function expectedCtrForPosition(position: number): number | null {
  for (const band of CTR_BASELINE_BY_POSITION) {
    if (position <= band.maxPosition) return band.ctr;
  }
  return null;
}
