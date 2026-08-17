-- ===== 0010_plan_downgrade_guard.sql =====
-- 纵深防御：extend_membership 拒绝降级购买（Pro → Lite）
--
-- 背景：
--   create API（应用层）已在下单时通过 canPurchasePlan 拦截降级；
--   但仍存在绕过 API 直接调用本 RPC 的可能（如旧订单竞态、内部脚本误用）。
--   0009 版本的 extend_membership 会无条件 set plan = p_plan，
--   可能把有效 Pro 会员降级为 Lite。
--
-- 策略（与 JS 侧 canPurchasePlan / isSubscriptionActive 语义一致）：
--   - 在 FOR UPDATE 行锁内计算用户"当前有效套餐"：
--       subscription_status ∈ (active, trialing) 且 current_period_end 未过期
--       → 有效套餐 = profiles.plan；否则视为 free
--   - 目标套餐等级 < 当前有效套餐等级 → raise PLAN_DOWNGRADE_NOT_ALLOWED
--   - 同档（lite→lite / pro→pro）为续费，升档为升级，均放行
--   - 过期 Pro 用户（effectivePlan=free）允许重新购买 Lite
--
-- 注意：
--   - 不修改 0009 已有文件，通过 create or replace 原地升级函数
--   - recompute_membership_after_refund 的退款降级是预期行为，保持不变

create or replace function public.extend_membership(
  p_user_id uuid,
  p_plan text,
  p_period_days integer
) returns timestamptz
language plpgsql
security definer set search_path = public
as $$
declare
  v_current_plan text;
  v_subscription_status text;
  v_current_period_end timestamptz;
  v_new_period_end timestamptz;
  v_effective_plan text;
  v_current_rank integer;
  v_target_rank integer;
begin
  -- 读取当前状态，加行锁串行化并发续费
  select plan, subscription_status, current_period_end
    into v_current_plan, v_subscription_status, v_current_period_end
  from public.profiles
  where id = p_user_id
  for update;

  -- 如果用户不存在，返回 null
  if not found then
    return null;
  end if;

  -- 计算当前有效套餐（与 JS isSubscriptionActive 一致）：
  --   status 为 active/trialing 且未过期（无到期时间视为有效）→ 有效
  --   否则视为 free（过期订阅无权益，允许重新购买）
  if v_subscription_status in ('active', 'trialing')
     and (v_current_period_end is null or v_current_period_end > now()) then
    v_effective_plan := coalesce(v_current_plan, 'free');
  else
    v_effective_plan := 'free';
  end if;

  v_current_rank := case v_effective_plan
    when 'pro' then 2 when 'lite' then 1 else 0 end;
  v_target_rank := case p_plan
    when 'pro' then 2 when 'lite' then 1 else 0 end;

  -- 降级保护：目标套餐等级低于当前有效套餐 → 拒绝
  if v_target_rank < v_current_rank then
    raise exception 'PLAN_DOWNGRADE_NOT_ALLOWED: current effective plan %, target plan %',
      v_effective_plan, p_plan;
  end if;

  -- 计算：
  --   current_period_end IS NULL → now() + period_days
  --   current_period_end 已过期 → now() + period_days
  --   current_period_end 未过期 → current_period_end + period_days
  v_new_period_end := greatest(coalesce(v_current_period_end, now()), now())
    + make_interval(days => p_period_days);

  -- 原子更新 profiles
  update public.profiles
  set
    plan = p_plan,
    subscription_status = 'active',
    current_period_end = v_new_period_end
  where id = p_user_id;

  return v_new_period_end;
end;
$$;

-- ============ 权限：仅 service_role 可调用（与 0009 保持一致）============
revoke execute on function public.extend_membership(uuid, text, integer) from anon, authenticated;
grant execute on function public.extend_membership(uuid, text, integer) to service_role;
