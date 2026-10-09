// ===== 经营瓶颈判断（纯函数；只基于真实数据，不伪造阈值/示例）=====
//
// 设计约束（来自任务要求第八条）：
//   1. 判断只依据**传入的真实计数**，函数内不生成任何示例数据；
//   2. 所有阈值要么是**结构性零值**（如 clicks == 0），要么是**从站点自身 GSC 数据派生**
//      的基准（impressionFloor / ctrCeiling，见 gsc-metrics.ts）—— 不引入外部行业基准常量；
//   3. 数据不足时不做结论，而是在 missingData 里如实说明缺什么。
//
// 规则优先级 = 漏斗上游优先（越上游的断点越是"最大瓶颈"）。

/** 瓶颈位置的可枚举结果（机器可读，供测试与 UI 分支） */
export type BottleneckCode =
  | "NO_DATA"
  | "INSUFFICIENT_DATA"
  | "SERP_CTR"
  | "TRAFFIC_TO_VISIT"
  | "VISIT_TO_SIGNUP"
  | "SIGNUP_TO_ACTIVATION"
  | "SIGNUP_TO_CHECKOUT"
  | "CHECKOUT_TO_PAID"
  | "PAID_NO_REVENUE"
  | "HEALTHY";

export interface FunnelDiagnosisInput {
  impressions: number;
  clicks: number;
  visits: number;
  signups: number;
  activated: number;
  checkoutStarted: number;
  paid: number;
  /** 订阅净收入（分） */
  subscriptionNetCents: number;
  /** 广告收入（分） */
  adRevenueCents: number;
  /** GSC 是否已接入（含数据） */
  gscConnected: boolean;
  /** impressions 门槛（站点自身中位数）；null = 无派生基准 */
  impressionFloor: number | null;
  /** CTR 上限（站点自身 position ≤ 3 中位 CTR，0–1）；null = 无派生基准 */
  ctrCeiling: number | null;
  /**
   * 行为分析链路是否有任何数据（决定 activation 类判断是否可信）。
   * false 时不得声称"注册后未激活"——那可能只是埋点没上线。
   */
  analyticsHasData: boolean;
  /**
   * Supabase profiles（注册权威表）是否可读。
   * false 时 signups 是「未知」而不是 0 —— 不得断言「访客没有注册」。
   */
  profilesAvailable?: boolean;
  /**
   * Supabase orders（订单权威表）是否可读。
   * false 时 checkoutStarted / paid 是「未知」而不是 0 —— 不得断言付款环节问题。
   */
  ordersAvailable?: boolean;
}

export interface BottleneckDiagnosis {
  code: BottleneckCode;
  /** 一句话结论（中文，直接可读） */
  label: string;
  /** 支撑结论的具体数字 */
  detail: string;
  /** 用到的真实数据点（逐条列出，便于复核） */
  evidence: string[];
  /** 缺失的数据源（不为空时表示结论可能不完整） */
  missingData: string[];
  /** 是否为可信结论（数据不足时为 false） */
  conclusive: boolean;
}

export interface FunnelDiagnosisRule {
  code: BottleneckCode;
  precedence: number;
  /** 人类可读的条件描述（与实现一一对应，供 doctor/文档核对） */
  condition: string;
}

/**
 * 机器可读规则表（顺序 = 优先级）。
 * 测试断言「实现与规则表一致」，防止文档与代码漂移。
 */
export const FUNNEL_DIAGNOSIS_RULES: readonly FunnelDiagnosisRule[] = [
  { code: "NO_DATA", precedence: 1, condition: "impressions == 0 && visits == 0" },
  {
    code: "SERP_CTR",
    precedence: 2,
    condition:
      "impressions >= impressionFloor && ctrCeiling > 0 && clicks/impressions < ctrCeiling",
  },
  { code: "TRAFFIC_TO_VISIT", precedence: 3, condition: "clicks > 0 && visits == 0" },
  {
    code: "VISIT_TO_SIGNUP",
    precedence: 4,
    condition: "visits > 0 && signups == 0 && profilesAvailable !== false",
  },
  {
    code: "SIGNUP_TO_ACTIVATION",
    precedence: 5,
    condition: "signups > 0 && activated == 0 && analyticsHasData",
  },
  {
    code: "SIGNUP_TO_CHECKOUT",
    precedence: 6,
    condition: "signups > 0 && checkoutStarted == 0 && ordersAvailable !== false",
  },
  {
    code: "CHECKOUT_TO_PAID",
    precedence: 7,
    condition: "checkoutStarted > 0 && paid == 0",
  },
  {
    code: "PAID_NO_REVENUE",
    precedence: 8,
    condition: "paid > 0 && subscriptionNetCents <= 0 && adRevenueCents <= 0",
  },
  {
    code: "HEALTHY",
    precedence: 9,
    condition: "所有漏斗节点均 > 0",
  },
] as const;

function pct(n: number, d: number): string {
  if (d <= 0) return "—";
  return `${((n / d) * 100).toFixed(2)}%`;
}

/**
 * 判定当前最大经营瓶颈。纯函数：无 IO、无时间依赖、无随机。
 */
export function diagnoseFunnel(input: FunnelDiagnosisInput): BottleneckDiagnosis {
  const missingData: string[] = [];
  if (!input.gscConnected) missingData.push("Google Search Console（未连接：曝光量、搜索点击无法判断）");
  if (!input.analyticsHasData) missingData.push("站内行为分析（没有任何事件：访问、使用产品等判断不可信）");
  if (input.profilesAvailable === false) {
    missingData.push("注册数据不可读（缺少 Supabase service_role key）：「访客是否注册」未知，不得按 0 判断");
  }
  if (input.ordersAvailable === false) {
    missingData.push("订单数据不可读（缺少 Supabase service_role key）：「是否开始付款 / 支付成功」未知，不得按 0 判断");
  }

  const evidence = (): string[] => {
    const e: string[] = [];
    if (input.gscConnected) {
      e.push(`搜索曝光 ${input.impressions} / 搜索点击 ${input.clicks}（点击率 ${pct(input.clicks, input.impressions)}）`);
    }
    e.push(`网站访问 ${input.visits} / 注册 ${input.signups}（${pct(input.signups, input.visits)}）`);
    e.push(`首次使用 ${input.activated}（${pct(input.activated, input.signups)}）`);
    e.push(`开始付款 ${input.checkoutStarted} → 支付成功 ${input.paid}`);
    e.push(
      `收入：订阅净额 ${formatCents(input.subscriptionNetCents)} + 广告 ${formatCents(input.adRevenueCents)}`
    );
    if (input.ctrCeiling !== null && input.ctrCeiling > 0) {
      e.push(`本站搜索结果前 3 位中位点击率 = ${(input.ctrCeiling * 100).toFixed(2)}%（点击率判定基准）`);
    }
    if (input.impressionFloor !== null) {
      e.push(`本站曝光中位数 = ${input.impressionFloor}（高曝光判定门槛）`);
    }
    return e;
  };

  // 规则 1：完全无数据
  if (input.impressions === 0 && input.visits === 0) {
    return {
      code: "NO_DATA",
      label: "暂无流量数据，无法判断瓶颈",
      detail: "当前窗口内既没有 Search Console 曝光，也没有站内访问记录。",
      evidence: evidence(),
      missingData: missingData.length > 0 ? missingData : ["GSC 与站内分析均无该窗口数据"],
      conclusive: false,
    };
  }

  // 规则 2：SERP CTR（上游最前，且基于站点自身基准）
  if (
    input.gscConnected &&
    input.impressionFloor !== null &&
    input.ctrCeiling !== null &&
    input.ctrCeiling > 0 &&
    input.impressions >= input.impressionFloor &&
    input.impressions > 0 &&
    input.clicks / input.impressions < input.ctrCeiling
  ) {
    return {
      code: "SERP_CTR",
      label: "主要瓶颈在搜索点击率：有曝光但点进来的太少",
      detail: `已有 ${input.impressions} 次曝光，但点击率仅 ${pct(input.clicks, input.impressions)}，低于本站自身可达到的 ${(input.ctrCeiling * 100).toFixed(2)}% —— 流量在上游就被搜索结果页消耗掉了。`,
      evidence: evidence(),
      missingData,
      conclusive: true,
    };
  }

  // 规则 3：有搜索点击但站内没有访问（追因：埋点/同意/落地页跳转）
  if (input.clicks > 0 && input.visits === 0) {
    return {
      code: "TRAFFIC_TO_VISIT",
      label: "主要瓶颈在搜索点击 → 到站访问",
      detail: `Search Console 记录到 ${input.clicks} 次点击，但站内统计不到任何访问 —— 更可能是埋点未生效（Cookie 同意）或落地链路被中断，而不是真的没人来。`,
      evidence: evidence(),
      missingData,
      conclusive: true,
    };
  }

  // 规则 4：有访问无注册 → 产品激活/转化（profiles 不可读时 signups 是未知数，不得判此环节）
  if (input.visits > 0 && input.signups === 0 && input.profilesAvailable !== false) {
    return {
      code: "VISIT_TO_SIGNUP",
      label: "主要瓶颈在访客 → 注册",
      detail: `窗口内 ${input.visits} 个访客，但 0 注册 —— 问题不在流量，而在「访客没有变成用户」。`,
      evidence: evidence(),
      missingData,
      conclusive: input.analyticsHasData,
    };
  }

  // 规则 5：有注册无激活（仅当行为分析有数据时才可信）
  if (input.signups > 0 && input.activated === 0 && input.analyticsHasData) {
    return {
      code: "SIGNUP_TO_ACTIVATION",
      label: "主要瓶颈在注册 → 首次使用",
      detail: `${input.signups} 个注册用户，但没有一个完成首次可用动作（完成一次 SEO 审计）—— 注册后的「第一次成功体验」没有发生。`,
      evidence: evidence(),
      missingData,
      conclusive: true,
    };
  }

  // 规则 6：有注册无 checkout（orders 不可读时 checkoutStarted 是未知数，不得判此环节）
  if (input.signups > 0 && input.checkoutStarted === 0 && input.ordersAvailable !== false) {
    return {
      code: "SIGNUP_TO_CHECKOUT",
      label: "主要瓶颈在注册 → 开始付款",
      detail: `${input.signups} 个注册用户，0 次开始付款 —— 注册到付费之间没有任何一步被触发（不是支付失败，是根本没走到支付）。`,
      evidence: evidence(),
      missingData: missingData.length > 0 ? missingData : [],
      conclusive: true,
    };
  }

  // 规则 7：有 checkout 无付费
  if (input.checkoutStarted > 0 && input.paid === 0) {
    return {
      code: "CHECKOUT_TO_PAID",
      label: "主要瓶颈在开始付款 → 支付成功",
      detail: `已开始 ${input.checkoutStarted} 次付款流程，但 0 笔成功支付 —— 属于支付环节问题（价格、支付方式、渠道故障）。`,
      evidence: evidence(),
      missingData,
      conclusive: true,
    };
  }

  // 规则 8：有付费但收入为 0（对账/记账问题，不是收入问题）
  if (
    input.paid > 0 &&
    input.subscriptionNetCents <= 0 &&
    input.adRevenueCents <= 0
  ) {
    return {
      code: "PAID_NO_REVENUE",
      label: "主要瓶颈位于收入记账",
      detail: `已有 ${input.paid} 位付费用户，但订阅净收入与广告收入都是 0 —— 这指向记账/对账链路，而不是获客。`,
      evidence: evidence(),
      missingData,
      conclusive: true,
    };
  }

  // 规则 9：全链路通畅
  if (
    input.visits > 0 &&
    input.signups > 0 &&
    input.activated > 0 &&
    input.checkoutStarted > 0 &&
    input.paid > 0
  ) {
    return {
      code: "HEALTHY",
      label: "漏斗全链路均有转化，当前无单一断点",
      detail: "访问 → 注册 → 首次使用 → 开始付款 → 支付成功 每一步都产生了转化，优化重点应是放大流量与提升各步比率。",
      evidence: evidence(),
      missingData,
      conclusive: true,
    };
  }

  // 兜底：数据不足以判断
  return {
    code: "INSUFFICIENT_DATA",
    label: "数据不足，暂时无法判断",
    detail: "当前窗口的漏斗节点不完全（存在为 0 的上游节点但下游有数据，或反之），需要更长窗口或补齐数据源后再判断。",
    evidence: evidence(),
    missingData,
    conclusive: false,
  };
}

/** 分 → 展示字符串（USD） */
export function formatCents(cents: number, currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
  const amount = (abs / 100).toFixed(2);
  return symbol ? `${sign}${symbol}${amount}` : `${sign}${amount} ${currency}`;
}
