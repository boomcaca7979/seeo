// ===== 广告收入 Provider 抽象 =====
//
// 背景：SeeO 当前实际投放的广告平台是 **Google AdSense**
//（`src/app/[locale]/layout.tsx` 已注入 adsbygoogle 脚本，publisher id 见
//  `ADSENSE_PUBLISHER_ID` 默认值），站点**没有**任何其它广告 SDK（已全仓检索确认）。
//
// 原则（与任务要求一致）：
//   1. 不做脆弱 scraping —— 平台没有可用 API 时，走 CSV / 手工导入；
//   2. 广告收入与订阅收入是**两个独立 source**，只在 Admin Revenue 汇总时相加；
//   3. 未配置凭据时如实返回 unavailable，绝不显示 0 装作"没收入"。

/** 单日广告收入（金额单位：分，避免浮点误差） */
export interface AdRevenueDay {
  /** YYYY-MM-DD */
  date: string;
  revenueCents: number;
  impressions: number;
  clicks: number;
  currency: string;
}

/** Provider 未配置（缺凭据）—— 调用方应据此展示 unavailable，而非 0 */
export class AdProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdProviderNotConfiguredError";
  }
}

export interface AdProviderConfigStatus {
  /** 是否具备自动同步能力 */
  configured: boolean;
  /** 缺少哪些环境变量（人工补充凭据用） */
  missing: string[];
  hint: string;
}

export interface AdRevenueProvider {
  /** 稳定 id（写入 ad_revenue_daily.provider） */
  id: string;
  label: string;
  /** 自动同步可用性（不发起网络请求） */
  configStatus(): AdProviderConfigStatus;
  /** 拉取 [startDate, endDate] 的日粒度收入；未配置时抛 AdProviderNotConfiguredError */
  fetchDaily(startDate: string, endDate: string): Promise<AdRevenueDay[]>;
}
