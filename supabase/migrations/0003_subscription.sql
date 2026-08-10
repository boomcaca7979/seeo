-- ===== 0003_subscription.sql =====
-- 商业化基础设施 P0：profiles 表增加订阅/套餐字段
-- 幂等可重复执行，不修改已有用户数据

-- ============ profiles 表增加商业字段 ============
-- plan: 当前套餐等级，默认 free
alter table public.profiles
  add column if not exists plan text not null default 'free'
  check (plan in ('free', 'pro', 'team', 'enterprise'));

-- subscription_status: 订阅状态，默认 inactive
alter table public.profiles
  add column if not exists subscription_status text not null default 'inactive'
  check (subscription_status in ('active', 'trialing', 'past_due', 'canceled', 'expired', 'inactive'));

-- subscription_id: 外部支付平台（如 Stripe）订阅 ID
alter table public.profiles
  add column if not exists subscription_id text;

-- current_period_end: 当前订阅周期结束时间
alter table public.profiles
  add column if not exists current_period_end timestamptz;

-- trial_ends_at: 试用结束时间
alter table public.profiles
  add column if not exists trial_ends_at timestamptz;

-- ============ 索引 ============
create index if not exists idx_profiles_plan on public.profiles(plan);
create index if not exists idx_profiles_subscription_status on public.profiles(subscription_status);
