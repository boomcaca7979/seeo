-- ===== 0005_plan_limits_content_check.sql =====
-- P3 商业化完善：plan_limits 增加 content_check_monthly_limit 字段
-- 用于 content/check API 的月度配额控制
-- 幂等可重复执行（do $$ ... add column if not exists）

-- ============ 新增 content_check_monthly_limit 字段 ============
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'plan_limits' and column_name = 'content_check_monthly_limit'
  ) then
    alter table public.plan_limits
      add column content_check_monthly_limit integer not null default 10;
  end if;
end $$;

-- ============ 更新各套餐的 content_check_monthly_limit ============
-- free: 10/月, pro: 100/月, team: 500/月, enterprise: 无限
update public.plan_limits set content_check_monthly_limit = 10 where plan = 'free';
update public.plan_limits set content_check_monthly_limit = 100 where plan = 'pro';
update public.plan_limits set content_check_monthly_limit = 500 where plan = 'team';
update public.plan_limits set content_check_monthly_limit = 2147483647 where plan = 'enterprise';
