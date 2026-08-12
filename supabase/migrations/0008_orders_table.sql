-- ===== 0008_orders_table.sql =====
-- 耀立支付 V2 订单系统
-- 一次性购买 30 天会员，支持支付宝/微信支付
--
-- 安全要求：
--   - 启用 RLS：普通用户只能查询自己的订单
--   - 写入（创建/支付状态更新/退款）由 server admin client 完成
--   - out_trade_no 唯一约束，防止重复创建
--   - payment_status CHECK 约束
--   - 复用 0002_auth_isolation.sql 的 update_updated_at() 触发器
--
-- 幂等可重复执行

-- ============ orders 表 ============
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  out_trade_no text unique not null,
  trade_no text,
  api_trade_no text,
  plan text not null check (plan in ('lite', 'pro')),
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'CNY' check (currency in ('CNY')),
  payment_channel text check (payment_channel in ('alipay', 'wxpay')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  paid_at timestamptz,
  refund_status text check (refund_status in ('pending', 'succeeded', 'failed')),
  refund_amount numeric(10,2) check (refund_amount >= 0),
  refunded_at timestamptz,
  period_type text,
  period_end timestamptz,
  clientip text,
  param text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ 索引 ============
create index if not exists idx_orders_user_id on public.orders(user_id);
create index if not exists idx_orders_out_trade_no on public.orders(out_trade_no);
create index if not exists idx_orders_payment_status on public.orders(payment_status);
create index if not exists idx_orders_period_end on public.orders(period_end);

-- ============ updated_at 触发器（复用 0002 的 update_updated_at 函数） ============
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.update_updated_at();

-- ============ RLS ============
alter table public.orders enable row level security;

-- 用户只能 SELECT 自己的订单
drop policy if exists "Orders are viewable by owner" on public.orders;
create policy "Orders are viewable by owner"
  on public.orders for select
  using (auth.uid() = user_id);

-- 不开放 INSERT/UPDATE/DELETE 给普通用户
-- 所有写入通过 service_role admin client（绕过 RLS）完成
