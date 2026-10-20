// ===== 权益决定「能不能发数据请求」（client-safe，纯函数）=====
// Pro 门槛页面若在权益尚未加载时就发请求，会得到后端 guard 的 403；
// 若把「尚未加载」当成「无权限」，Pro 用户又会少一次数据加载。
// 这里把三态显式分开，页面只按决策行事，后端 entitlement guard 保持原样不变。

export type EntitlementFetchDecision =
  /** 套餐信息尚未确定：不请求，也不报错（避免把未知当无权限） */
  | "wait"
  /** 已确认有权限：按现有契约请求 */
  | "fetch"
  /** 已确认无权限：不请求，展示升级门槛 */
  | "block";

export function decideEntitlementFetch(state: {
  loading: boolean;
  allowed: boolean;
}): EntitlementFetchDecision {
  if (state.loading) return "wait";
  return state.allowed ? "fetch" : "block";
}
