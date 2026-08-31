// ===== 订单服务层 =====
// 统一处理订单的创建、完成、退款逻辑
// 所有"支付成功后开通会员"的逻辑都通过 completeOrder 完成
// 支付回调 / 订单查询均调用同一个 completeOrder，避免逻辑差异

import { getAdminClient } from "@/lib/supabase/admin";
import { PLAN_PRICING, CUSTOM_SERVICE_PLAN, type PurchaseType, type CheckoutPlan } from "@/lib/billing";
import type { PlanTier } from "@/lib/auth";

/** 订单支付方式（orders.payment_channel 历史数据值：alipay/wxpay 为 Yaolipay 历史订单，creem 为 Creem 订单） */
export type PaymentChannel = "alipay" | "wxpay" | "creem";

/** 订单支付状态（orders.payment_status） */
export type OrderStatus = "pending" | "paid" | "failed" | "refunded";

/** 订单记录（与 0008_orders_table.sql 一一对应；0012 迁移后 plan 增加 custom） */
export interface OrderRecord {
  id: string;
  user_id: string;
  out_trade_no: string;
  trade_no: string | null;
  api_trade_no: string | null;
  plan: CheckoutPlan;
  amount: number;
  currency: string;
  payment_channel: PaymentChannel | null;
  payment_status: OrderStatus;
  paid_at: string | null;
  refund_status: "pending" | "succeeded" | "failed" | null;
  refund_amount: number | null;
  refunded_at: string | null;
  period_type: string | null;
  period_end: string | null;
  clientip: string | null;
  param: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 生成唯一商户订单号
 * 格式：S{yyyyMMddHHmmss}{6位随机}
 */
export function generateOutTradeNo(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const date =
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `S${date}${rand}`;
}

/**
 * 创建本地 pending 订单
 * 在调用支付渠道下单接口之前先创建本地订单
 * purchaseType 与 Creem 元数据写入 param 字段（JSON），复用现有列，不改变表结构
 */
export async function createPendingOrder(args: {
  userId: string;
  plan: CheckoutPlan;
  paymentChannel: PaymentChannel;
  clientIp: string;
  purchaseType?: PurchaseType;
}): Promise<{ order: OrderRecord; error?: string } | null> {
  const admin = getAdminClient();
  if (!admin) {
    console.error("[Orders] getAdminClient 返回 null，SUPABASE_SERVICE_ROLE_KEY 可能缺失");
    return { order: null as unknown as OrderRecord, error: "admin client 不可用（SUPABASE_SERVICE_ROLE_KEY 缺失）" };
  }

  const pricing = PLAN_PRICING[args.plan];
  if (!pricing) {
    console.error("[Orders] PLAN_PRICING 未配置:", args.plan);
    return { order: null as unknown as OrderRecord, error: "套餐价格未配置" };
  }

  const outTradeNo = generateOutTradeNo();
  // 金额由服务端定价表决定（Creem 时代为 USD；历史 Yaolipay 订单为 CNY）
  // amount 写入 orders 表后，webhook/refund 均以 order.amount 为准
  const amount = pricing.amountCents / 100;

  try {
    const { data, error } = await admin
      .from("orders")
      .insert({
        user_id: args.userId,
        out_trade_no: outTradeNo,
        plan: args.plan,
        amount,
        currency: pricing.currency,
        payment_channel: args.paymentChannel,
        payment_status: "pending",
        period_type: args.plan === CUSTOM_SERVICE_PLAN ? "custom" : `${pricing.periodDays}d`,
        clientip: args.clientIp,
        param: args.purchaseType
          ? JSON.stringify({ purchase_type: args.purchaseType })
          : null,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("[Orders] 创建 pending 订单失败:", error?.message);
      console.log("[Orders] ERROR_DETAIL:", JSON.stringify({ code: error?.code, message: error?.message, details: error?.details, hint: error?.hint }));
      return { order: null as unknown as OrderRecord, error: error?.message ?? "数据库插入返回空数据" };
    }

    return { order: data as unknown as OrderRecord };
  } catch (err) {
    console.error("[Orders] 创建 pending 订单异常:", err);
    console.log("[Orders] EXCEPTION_DETAIL:", err instanceof Error ? err.message : String(err));
    return { order: null as unknown as OrderRecord, error: err instanceof Error ? err.message : "数据库写入异常" };
  }
}

/**
 * 根据 out_trade_no 查询订单
 */
export async function getOrderByOutTradeNo(
  outTradeNo: string
): Promise<OrderRecord | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("out_trade_no", outTradeNo)
      .single();
    return (data as unknown as OrderRecord) ?? null;
  } catch {
    return null;
  }
}

/**
 * 根据 out_trade_no 查询用户自己的订单（带 user_id 校验）
 */
export async function getOrderByOutTradeNoForUser(
  outTradeNo: string,
  userId: string
): Promise<OrderRecord | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("out_trade_no", outTradeNo)
      .eq("user_id", userId)
      .single();
    return (data as unknown as OrderRecord) ?? null;
  } catch {
    return null;
  }
}

/**
 * 比较金额是否一致（整数 cents 比较，避免浮点精度问题）
 */
export function amountsMatch(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/** 解析订单 param 字段（JSON 字符串）为对象；非法/空返回 {} */
export function parseOrderParam(order: OrderRecord): Record<string, unknown> {
  if (!order.param) return {};
  try {
    const v = JSON.parse(order.param);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * 完成订单：支付成功后的统一开通会员逻辑
 *
 * 幂等设计：
 *   1. 查询订单当前状态
 *   2. 如果已经是 paid/refunded，直接返回（不重复开通）
 *   3. 使用条件 UPDATE（WHERE payment_status='pending'）保证并发安全
 *   4. 更新成功后调用 RPC 原子更新 profiles：
 *      - Creem 订阅订单（periodEndIso 提供）：set_membership_period 按渠道实际周期设置
 *      - 其他订单：extend_membership 按 periodDays 延长
 *
 * 并发安全（B1 修复）：
 *   会员周期通过 PostgreSQL RPC 原子更新，
 *   使用 FOR UPDATE 行锁串行化同一用户的并发续费。
 *   不再在 JS 层读取 current_period_end 后计算，避免读到旧值。
 *
 * 返回值：
 *   - { ok: true, order, opened: true }  首次开通成功
 *   - { ok: true, order, opened: false } 订单已处理过（幂等）
 *   - { ok: false, error }  失败
 */
export async function completeOrder(args: {
  outTradeNo: string;
  /** 支付渠道订单号（Creem: ord_ 开头） */
  tradeNo?: string;
  /** 渠道侧订阅/会话 ID（Creem 订阅: sub_ 开头，存 api_trade_no 列） */
  apiTradeNo?: string;
  paidAmount: number;
  /**
   * 渠道返回的订阅周期结束时间（ISO）。
   * 提供时（Creem 订阅订单）使用 set_membership_period RPC 按渠道实际周期设置会员，
   * 而不是用 periodDays 自行换算。
   */
  periodEndIso?: string;
  /** Creem 元数据（写入 param JSON，供后续 webhook 匹配订阅/交易） */
  creem?: {
    checkoutId?: string;
    customerId?: string;
    subscriptionId?: string;
    transactionId?: string;
  };
}): Promise<{
  ok: boolean;
  order: OrderRecord | null;
  opened: boolean;
  error?: string;
}> {
  const admin = getAdminClient();
  if (!admin) {
    return { ok: false, order: null, opened: false, error: "admin client 不可用" };
  }

  // 1. 查询订单
  const order = await getOrderByOutTradeNo(args.outTradeNo);
  if (!order) {
    return { ok: false, order: null, opened: false, error: "订单不存在" };
  }

  // 2. 幂等：已支付或已退款则不再处理
  if (order.payment_status === "paid" || order.payment_status === "refunded") {
    return { ok: true, order, opened: false };
  }

  // 3. 校验金额
  if (!amountsMatch(order.amount, args.paidAmount)) {
    console.error("[Orders] 金额不匹配", {
      outTradeNo: args.outTradeNo,
      expected: order.amount,
      actual: args.paidAmount,
    });
    return { ok: false, order, opened: false, error: "订单金额不匹配" };
  }

  // 4. 获取套餐配置（用于 periodDays）
  const pricing = PLAN_PRICING[order.plan];
  if (!pricing) {
    return { ok: false, order, opened: false, error: "套餐价格配置缺失" };
  }

  // 5. 使用条件 UPDATE 标记订单为 paid（并发安全）
  // WHERE payment_status='pending' AND out_trade_no=xxx
  // period_end 暂不设置，待 RPC 返回实际值后更新
  // Creem 元数据合并进 param JSON（保留 purchase_type 等既有字段）
  const mergedParam = { ...parseOrderParam(order) };
  if (args.creem) {
    mergedParam.creem = {
      ...(typeof mergedParam.creem === "object" && mergedParam.creem !== null
        ? (mergedParam.creem as Record<string, unknown>)
        : {}),
      ...args.creem,
    };
  }
  const { data: updatedOrder, error: updateError } = await admin
    .from("orders")
    .update({
      payment_status: "paid",
      trade_no: args.tradeNo ?? order.trade_no,
      api_trade_no: args.apiTradeNo ?? order.api_trade_no,
      paid_at: new Date().toISOString(),
      ...(args.creem ? { param: JSON.stringify(mergedParam) } : {}),
    })
    .eq("out_trade_no", args.outTradeNo)
    .eq("payment_status", "pending")
    .select()
    .single();

  if (updateError || !updatedOrder) {
    // 可能是并发竞争，重新查询订单状态
    const reloaded = await getOrderByOutTradeNo(args.outTradeNo);
    if (reloaded && (reloaded.payment_status === "paid" || reloaded.payment_status === "refunded")) {
      return { ok: true, order: reloaded, opened: false };
    }
    console.error("[Orders] 条件 UPDATE 失败:", updateError?.message);
    return { ok: false, order: reloaded ?? order, opened: false, error: "订单状态更新失败" };
  }

  const finalOrder = updatedOrder as unknown as OrderRecord;

  // 6a. 定制服务订单：不开通会员周期（profiles.plan 不变），
  //     仅记录 period_end = 支付时间作为履约标记，避免 query 轮询重试开通
  if (order.plan === CUSTOM_SERVICE_PLAN) {
    const paidTs = finalOrder.paid_at ?? new Date().toISOString();
    try {
      await admin
        .from("orders")
        .update({ period_end: paidTs })
        .eq("out_trade_no", args.outTradeNo);
      finalOrder.period_end = paidTs;
    } catch (err) {
      console.error("[Orders] 定制服务订单 period_end 更新失败:", err);
    }
    return { ok: true, order: finalOrder, opened: true };
  }

  // 6. 调用 RPC 原子更新 profiles（B1 修复）
  //    数据库内部通过 FOR UPDATE 行锁串行化并发续费
  //    - Creem 订阅订单（periodEndIso 提供且合法）：
  //        set_membership_period，按渠道返回的实际订阅周期设置（不自行换算 Monthly→N 天）
  //    - 其他订单：extend_membership，按 periodDays 延长
  //        计算：greatest(coalesce(current_period_end, now()), now()) + period_days
  const planTier = order.plan as PlanTier;
  const periodEndValid =
    typeof args.periodEndIso === "string" &&
    !Number.isNaN(Date.parse(args.periodEndIso));
  let newPeriodEndIso: string | null = null;
  try {
    if (periodEndValid) {
      const { data: rpcResult, error: rpcError } = await admin.rpc(
        "set_membership_period",
        {
          p_user_id: order.user_id,
          p_plan: planTier,
          p_period_end: args.periodEndIso,
        }
      );
      if (rpcError) {
        console.error("[Orders] set_membership_period RPC 失败:", rpcError.message);
        if (String(rpcError.message).includes("PLAN_DOWNGRADE_NOT_ALLOWED")) {
          // 与 extend_membership 降级保护同语义：订单保留 paid，不开通周期，写 period_end 防重试
          const downgradeTs = new Date().toISOString();
          try {
            await admin
              .from("orders")
              .update({ period_end: downgradeTs })
              .eq("out_trade_no", args.outTradeNo);
            finalOrder.period_end = downgradeTs;
          } catch (err) {
            console.error("[Orders] 降级订单 period_end 更新失败:", err);
          }
        }
      } else if (rpcResult) {
        newPeriodEndIso = new Date(rpcResult as string).toISOString();
        try {
          await admin
            .from("orders")
            .update({ period_end: newPeriodEndIso })
            .eq("out_trade_no", args.outTradeNo);
          finalOrder.period_end = newPeriodEndIso;
        } catch (err) {
          console.error("[Orders] 更新订单 period_end 失败:", err);
        }
      }
    } else {
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "extend_membership",
      {
        p_user_id: order.user_id,
        p_plan: planTier,
        p_period_days: pricing.periodDays,
      }
    );

    if (rpcError) {
      console.error("[Orders] extend_membership RPC 失败:", rpcError.message);
      if (rpcError.message.includes("PLAN_DOWNGRADE_NOT_ALLOWED")) {
        // 竞态降级保护：下单时是 Lite，支付完成前用户已升级 Pro，
        // 此订单不能再把会员降回 Lite。
        // 处理：订单保留 paid（钱已收，需人工退款），但不开通会员周期；
        // 设置 period_end 为当前时间，避免 query 轮询无限重试 retryMembershipActivation。
        const downgradeTs = new Date().toISOString();
        try {
          await admin
            .from("orders")
            .update({ period_end: downgradeTs })
            .eq("out_trade_no", args.outTradeNo);
          finalOrder.period_end = downgradeTs;
        } catch (err) {
          console.error("[Orders] 降级订单 period_end 更新失败:", err);
        }
      }
      // 其他 RPC 错误：不回滚订单状态（订单已 paid，后续可通过 query 重试 RPC）
    } else if (rpcResult) {
      // RPC 返回新的到期时间
      newPeriodEndIso = new Date(rpcResult as string).toISOString();

      // 更新订单的 period_end 为 RPC 返回的实际值
      try {
        await admin
          .from("orders")
          .update({ period_end: newPeriodEndIso })
          .eq("out_trade_no", args.outTradeNo);
        finalOrder.period_end = newPeriodEndIso;
      } catch (err) {
        console.error("[Orders] 更新订单 period_end 失败:", err);
      }
    }
    } // end: extend_membership 路径
  } catch (err) {
    console.error("[Orders] membership RPC 异常:", err);
    // 不回滚订单状态（订单已 paid，后续可通过 query 重试）
  }

  // 7. 并发安全 post-check（completeOrder vs refund 竞态处理）
  //    场景：在步骤 5（订单→paid）和步骤 6（extend_membership）之间，
  //    如果退款将订单改为 refunded 并调用了 recompute_membership_after_refund，
  //    那么 extend_membership 仍然会基于本订单的 plan 错误地延长会员。
  //    修复：RPC 执行后重新检查订单状态，如果已 refunded，调用 recompute 修正。
  try {
    const { data: postCheck } = await admin
      .from("orders")
      .select("payment_status")
      .eq("out_trade_no", args.outTradeNo)
      .single();

    if (postCheck?.payment_status === "refunded") {
      // 订单在 extend_membership 期间被退款，重新计算会员权益
      await admin.rpc("recompute_membership_after_refund", {
        p_user_id: order.user_id,
      });
    }
  } catch (err) {
    console.error("[Orders] post-check 异常:", err);
  }

  return { ok: true, order: finalOrder, opened: true };
}

/**
 * 标记订单为失败
 */
export async function markOrderFailed(outTradeNo: string): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;
  try {
    await admin
      .from("orders")
      .update({ payment_status: "failed" })
      .eq("out_trade_no", outTradeNo)
      .eq("payment_status", "pending");
  } catch (err) {
    console.error("[Orders] 标记失败异常:", err);
  }
}

/**
 * 处理退款成功
 *
 * B3 修复：
 *   退款后不再仅判断"是否有其他有效订单"来决定是否保留当前套餐。
 *   改为调用 recompute_membership_after_refund RPC，原子地：
 *   - 查询所有有效订单（paid 且未成功退款 且未过期）
 *   - 按套餐优先级（pro > lite）计算应得套餐
 *   - 使用剩余订单中最大的 period_end 作为新的到期时间
 *   - 无有效订单则降级为 free
 *
 * 并发安全：
 *   RPC 内部使用 FOR UPDATE 锁定 profile 行，串行化与 extend_membership 的并发。
 *
 * @param args.outTradeNo 退款订单号
 * @param args.refundAmount 退款金额
 * @param args.outRefundNo 商户退款单号
 */
export async function handleRefundSuccess(args: {
  outTradeNo: string;
  refundAmount: number;
  outRefundNo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = getAdminClient();
  if (!admin) {
    return { ok: false, error: "admin client 不可用" };
  }

  // 1. 查询订单
  const order = await getOrderByOutTradeNo(args.outTradeNo);
  if (!order) {
    return { ok: false, error: "订单不存在" };
  }

  // 2. 防止重复退款
  if (order.payment_status === "refunded") {
    return { ok: true };
  }

  if (order.payment_status !== "paid") {
    return { ok: false, error: "订单未支付，不可退款" };
  }

  // 3. 校验退款金额
  if (args.refundAmount > order.amount) {
    return { ok: false, error: "退款金额超过订单金额" };
  }

  // 4. 条件 UPDATE 标记订单为 refunded（防止并发）
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      payment_status: "refunded",
      refund_status: "succeeded",
      refund_amount: args.refundAmount,
      refunded_at: new Date().toISOString(),
    })
    .eq("out_trade_no", args.outTradeNo)
    .eq("payment_status", "paid")
    .select()
    .single();

  if (updateError || !updated) {
    const reloaded = await getOrderByOutTradeNo(args.outTradeNo);
    if (reloaded?.payment_status === "refunded") {
      return { ok: true };
    }
    return { ok: false, error: "订单状态更新失败" };
  }

  // 5. 调用 recompute_membership_after_refund RPC 原子重新计算套餐（B3 修复）
  //    RPC 内部查询所有有效订单，按优先级（pro > lite）计算应得套餐
  try {
    const { error: rpcError } = await admin.rpc(
      "recompute_membership_after_refund",
      { p_user_id: order.user_id }
    );

    if (rpcError) {
      console.error("[Orders] recompute_membership_after_refund RPC 失败:", rpcError.message);
      // 不回滚订单状态（订单已 refunded，后续可通过 cron 或手动重试）
    }
  } catch (err) {
    console.error("[Orders] recompute_membership_after_refund RPC 异常:", err);
  }

  return { ok: true };
}

/**
 * 重试会员开通（针对 paid 但 period_end 为 null 的订单）
 *
 * 场景：completeOrder 中 extend_membership RPC 失败，
 * 订单已标记 paid 但会员未实际开通（period_end 为 null）。
 * query 路由在轮询时发现此状态自动重试。
 *
 * @returns true 表示重试成功（period_end 已更新）
 */
export async function retryMembershipActivation(order: OrderRecord): Promise<boolean> {
  const admin = getAdminClient();
  if (!admin) return false;

  // 定制服务订单无会员周期可开通，直接视为已处理
  if (order.plan === CUSTOM_SERVICE_PLAN) return true;

  const pricing = PLAN_PRICING[order.plan];
  if (!pricing) return false;

  try {
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "extend_membership",
      {
        p_user_id: order.user_id,
        p_plan: order.plan as PlanTier,
        p_period_days: pricing.periodDays,
      }
    );

    if (rpcError || !rpcResult) {
      console.error("[Orders] retryMembershipActivation RPC 失败:", rpcError?.message);
      return false;
    }

    const newPeriodEnd = new Date(rpcResult as string).toISOString();
    await admin
      .from("orders")
      .update({ period_end: newPeriodEnd })
      .eq("out_trade_no", order.out_trade_no);
    return true;
  } catch (err) {
    console.error("[Orders] retryMembershipActivation 异常:", err);
    return false;
  }
}

/**
 * 根据 Creem 订阅 ID 查找订单（api_trade_no 列存 sub_ 开头的订阅 ID）
 * 供 subscription.* 续费/取消等事件定位订单
 */
export async function findOrderByCreemSubscriptionId(
  subscriptionId: string
): Promise<OrderRecord | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("api_trade_no", subscriptionId)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = (data as unknown as OrderRecord[] | null)?.[0];
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * 根据 Creem 订单 ID（ord_ 开头，存 trade_no 列）查找订单
 * 供 refund.created 等事件定位订单
 */
export async function findOrderByCreemOrderId(
  creemOrderId: string
): Promise<OrderRecord | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("trade_no", creemOrderId)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = (data as unknown as OrderRecord[] | null)?.[0];
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * 同步订阅周期（subscription.paid 续费 / subscription.active 等事件）
 *
 * 幂等：set_membership_period RPC 内部使用 greatest(current_period_end, p_period_end)，
 * 重复投递同一事件不会缩短/重复延长会员。
 *
 * @returns true 表示同步成功
 */
export async function syncSubscriptionPeriod(args: {
  userId: string;
  plan: PlanTier;
  periodEndIso: string;
  outTradeNo?: string;
  transactionId?: string;
}): Promise<boolean> {
  const admin = getAdminClient();
  if (!admin) return false;
  if (Number.isNaN(Date.parse(args.periodEndIso))) return false;

  try {
    const { error: rpcError } = await admin.rpc("set_membership_period", {
      p_user_id: args.userId,
      p_plan: args.plan,
      p_period_end: args.periodEndIso,
    });
    if (rpcError) {
      console.error("[Orders] syncSubscriptionPeriod RPC 失败:", rpcError.message);
      return false;
    }
    // 同步订单 period_end（Creem 续费交易号也一并记录）
    if (args.outTradeNo) {
      const patch: Record<string, unknown> = { period_end: args.periodEndIso };
      await admin.from("orders").update(patch).eq("out_trade_no", args.outTradeNo);
    }
    return true;
  } catch (err) {
    console.error("[Orders] syncSubscriptionPeriod 异常:", err);
    return false;
  }
}

/**
 * 查询用户最近的所有订单（用于支付状态页等）
 */
export async function listUserOrders(
  userId: string,
  limit = 20
): Promise<OrderRecord[]> {
  const admin = getAdminClient();
  if (!admin) return [];
  try {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as unknown as OrderRecord[]) ?? [];
  } catch {
    return [];
  }
}
