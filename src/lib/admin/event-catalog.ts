// ===== Owner Console：事件目录与漏斗定义（机器可读）=====
//
// 两个用途：
//   1. 客户详情页的时间线文案（把 analytics 事件 / 订单 / Creem 记录统一成人话）；
//   2. /admin 漏斗的**口径定义**——每一步的测量方式都写在这里，UI 与测试共用，
//      避免"这个数字到底怎么来的"没有答案。
//
// ⚠️ 只做映射与说明，**不新增事件名**（事件契约唯一来源仍是 src/lib/analytics/server.ts）。

/** 时间线条目来源类型 */
export type TimelineSourceKind = "analytics" | "order" | "creem";

/** 时间线文案目录（key = 事件名 / 派生事件名） */
export const TIMELINE_EVENT_LABELS: Record<
  string,
  { label: string; kind: TimelineSourceKind }
> = {
  // ---- analytics（站内行为）----
  landing_view: { label: "浏览落地页", kind: "analytics" },
  page_view: { label: "访问网站", kind: "analytics" },
  signup_started: { label: "开始注册", kind: "analytics" },
  signup_completed: { label: "完成注册", kind: "analytics" },
  login_completed: { label: "登录", kind: "analytics" },
  audit_started: { label: "开始 SEO 审计", kind: "analytics" },
  audit_completed: { label: "完成 SEO 审计", kind: "analytics" },
  pricing_viewed: { label: "查看定价页", kind: "analytics" },
  upgrade_started: { label: "点击升级", kind: "analytics" },
  checkout_started: { label: "开始付款", kind: "analytics" },
  checkout_completed: { label: "付款成功", kind: "analytics" },
  subscription_active: { label: "订阅生效", kind: "analytics" },
  subscription_canceled: { label: "订阅取消", kind: "analytics" },
  payment_completed: { label: "支付完成", kind: "analytics" },
  feature_used: { label: "使用功能", kind: "analytics" },
  activation_completed: { label: "首次使用产品", kind: "analytics" },
  returning_user: { label: "回访", kind: "analytics" },
  logout: { label: "退出登录", kind: "analytics" },
  // ---- 订单（Supabase orders，权威）----
  order_created: { label: "创建订单", kind: "order" },
  order_failed: { label: "订单失败", kind: "order" },
  refund_created: { label: "退款", kind: "order" },
  // ---- Creem（本地快照）----
  creem_subscription_created: { label: "创建订阅（Creem）", kind: "creem" },
  creem_subscription_updated: { label: "订阅状态变更（Creem）", kind: "creem" },
  creem_payment_recorded: { label: "Creem 收款记录", kind: "creem" },
  creem_refund_recorded: { label: "Creem 退款记录", kind: "creem" },
};

/** 时间线中必须能展示的关键事件（任务要求逐项覆盖；测试断言） */
export const REQUIRED_TIMELINE_EVENTS: readonly string[] = [
  "page_view",
  "signup_completed",
  "audit_started",
  "audit_completed",
  "pricing_viewed",
  "checkout_started",
  "checkout_completed",
  "subscription_active",
  "subscription_canceled",
];

/** 漏斗节点 key */
export type FunnelStepKey =
  | "impression"
  | "click"
  | "visit"
  | "signup"
  | "activation"
  | "checkout"
  | "paid";

export interface FunnelStepDefinition {
  key: FunnelStepKey;
  label: string;
  /** 数据源（务必与实现一致） */
  source: string;
  /** 测量口径（人类可读，与实现一一对应） */
  measure: string;
}

/**
 * 漏斗口径定义（Impression → Click → Visit → Signup → Activation → Checkout → Paid）。
 * 口径选择原则：**能用权威表就不用埋点** —— 注册用 profiles.created_at、
 * 结账/付费用 orders（含历史），只有「访问」与「激活」必须依赖站内事件。
 */
export const ADMIN_FUNNEL_DEFINITION: readonly FunnelStepDefinition[] = [
  {
    key: "impression",
    label: "网站曝光",
    source: "Google Search Console（本地日表 gsc_daily_metrics）",
    measure: "窗口内网站在 Google 搜索结果中的曝光次数合计",
  },
  {
    key: "click",
    label: "搜索点击",
    source: "Google Search Console（本地日表 gsc_daily_metrics）",
    measure: "窗口内从 Google 搜索结果点击进入的次数合计",
  },
  {
    key: "visit",
    label: "进入网站",
    source: "analytics_events（page_view）",
    measure: "窗口内去重访客数（同一人登录前后算一人）",
  },
  {
    key: "signup",
    label: "注册账号",
    source: "Supabase profiles",
    measure: "窗口内新注册的账号数（权威账号表，含历史）",
  },
  {
    key: "activation",
    label: "使用工具",
    source: "analytics_events（activation_completed）",
    measure: "窗口内至少完成一次 SEO 审计的去重用户数",
  },
  {
    key: "checkout",
    label: "开始付款",
    source: "Supabase orders",
    measure: "窗口内发起付款的订单数（权威订单表，含历史）",
  },
  {
    key: "paid",
    label: "支付成功",
    source: "Supabase orders",
    measure: "窗口内成功支付的订单数（权威订单表，含历史）",
  },
] as const;

export function timelineLabel(event: string): { label: string; kind: TimelineSourceKind } {
  return (
    TIMELINE_EVENT_LABELS[event] ?? { label: event, kind: "analytics" }
  );
}
