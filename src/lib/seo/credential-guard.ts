// ===== 供应商凭据错误的额度保护（唯一判定入口）=====
//
// 背景（2026-11-01 验收）：service 层先 consumeQuota 再调 provider，
// 而 provider 在**发出请求之前**才检查凭据 —— SERPAPI_KEY 为空时接口返回 401，
// 用户的 SerpApi 额度却已经被扣掉。凭据缺失是平台配置问题，用户什么都没拿到。
//
// 两条防线，缺一不可：
//   1) 预检（assertXxxConfigured）：配置缺失在 consumeQuota **之前**直接失败 —— 不扣费、不请求；
//   2) 回滚（refundOnPlatformCredentialError）：请求已发出但供应商判定认证/账户失败 —— 回滚本次预扣。
//
// 这里只做「判定 + 回滚」，套餐上限、429 语义、额度数字一律不动。

import { SeoProviderError } from "./provider";
import { DataForSeoApiError, DataForSeoNotConfiguredError } from "./dataforseo";
import { refundQuota } from "./cache";
import type { ApiType } from "@/lib/db";
import type { PlanTier } from "@/lib/auth";

/**
 * 是否属于「平台侧凭据/账户问题」（而不是用户请求本身的问题）：
 * - SerpApi：INVALID_KEY（未配置或供应商判定 Key 无效）
 * - DataForSEO：未配置；401xx 认证失败 / 402xx 账户未激活或欠费 / 403xx 无权访问
 *
 * 明确排除：
 * - QUOTA_EXCEEDED（用户套餐额度，属真实计费边界，不回滚）
 * - UPSTREAM_ERROR / TIMEOUT（供应商临时故障，与凭据无关，额度已用于真实请求）
 * - BAD_REQUEST（用户参数错误，在扣费前就已被参数校验拦下）
 */
export function isPlatformCredentialError(e: unknown): boolean {
  if (e instanceof SeoProviderError) return e.code === "INVALID_KEY";
  if (e instanceof DataForSeoNotConfiguredError) return true;
  if (e instanceof DataForSeoApiError) {
    return e.status_code >= 40100 && e.status_code < 40400;
  }
  return false;
}

/**
 * 供应商调用失败后调用：确认是平台侧凭据错误才回滚本次预扣。
 * 返回是否真的回滚了（供测试与日志判断）；任何异常都不会向外抛出。
 */
export async function refundOnPlatformCredentialError(
  e: unknown,
  userId: string,
  apiType: ApiType,
  plan: PlanTier
): Promise<boolean> {
  if (!isPlatformCredentialError(e)) return false;
  await refundQuota(userId, apiType, plan);
  return true;
}
