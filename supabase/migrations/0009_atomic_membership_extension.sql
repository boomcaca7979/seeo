-- ===== 0009_atomic_membership_extension.sql =====
-- 修复 B1：原子化会员周期续费，避免并发续费导致会员时间丢失
-- 修复 B3：退款后原子化重新计算有效套餐，避免保留错误套餐
--
-- 新增两个 SECURITY DEFINER 函数：
-- 1. extend_membership(p_user_id, p_plan, p_period_days)
--    原子地读取 current_period_end（FOR UPDATE 行锁）并续费
--    返回新的到期时间
-- 2. recompute_membership_after_refund(p_user_id)
--    原子地根据剩余有效订单重新计算套餐
--    返回新的 plan
--
-- 安全：
-- - 两个函数都 SECURITY DEFINER，绕过 RLS
-- - REVOKE EXECUTE from anon / authenticated
-- - GRANT EXECUTE only to service_role
-- - search_path = public 防止搜索路径注入

-- ============ 1. 续费函数 ============
create or replace function public.extend_membership(
  p_user_id uuid,
  p_plan text,
  p_period_days integer
) returns timestamptz
language plpgsql
security definer set search_path = public
as $$
declare
  v_current_period_end timestamptz;
  v_new_period_end timestamptz;
begin
  -- 读取当前到期时间，加行锁串行化并发续费
  select current_period_end into v_current_period_end
  from public.profiles
  where id = p_user_id
  for update;

  -- 如果用户不存在，返回 null
  if not found then
    return null;
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

-- ============ 2. 退款后重新计算套餐函数 ============
create or replace function public.recompute_membership_after_refund(
  p_user_id uuid
) returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_has_pro boolean := false;
  v_has_lite boolean := false;
  v_max_period_end timestamptz := null;
  v_plan text := 'free';
  v_subscription_status text := 'expired';
  v_period_end timestamptz := null;
begin
  -- 锁定 profile 行，串行化与 extend_membership 的并发
  perform 1 from public.profiles where id = p_user_id for update;

  -- 查询所有有效订单：
  --   payment_status = 'paid'
  --   refund_status IS NULL 或 refund_status != 'succeeded'
  --   period_end > now()
  -- 套餐优先级：pro > lite
  select
    bool_or(plan = 'pro'),
    bool_or(plan = 'lite'),
    max(period_end)
  into v_has_pro, v_has_lite, v_max_period_end
  from public.orders
  where
    user_id = p_user_id
    and payment_status = 'paid'
    and (refund_status is null or refund_status <> 'succeeded')
    and period_end > now();

  -- 计算应得套餐
  if v_has_pro then
    v_plan := 'pro';
  elsif v_has_lite then
    v_plan := 'lite';
  else
    v_plan := 'free';
  end if;

  -- 计算 subscription_status 和 current_period_end
  if v_has_pro or v_has_lite then
    v_subscription_status := 'active';
    v_period_end := v_max_period_end;
  else
    v_subscription_status := 'expired';
    v_period_end := null;
  end if;

  -- 原子更新 profiles
  update public.profiles
  set
    plan = v_plan,
    subscription_status = v_subscription_status,
    current_period_end = v_period_end
  where id = p_user_id;

  return v_plan;
end;
$$;

-- ============ 权限：仅 service_role 可调用 ============
revoke execute on function public.extend_membership(uuid, text, integer) from anon, authenticated;
grant execute on function public.extend_membership(uuid, text, integer) to service_role;

revoke execute on function public.recompute_membership_after_refund(uuid) from anon, authenticated;
grant execute on function public.recompute_membership_after_refund(uuid) to service_role;
