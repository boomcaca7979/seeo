-- ===== 0006_plan_limits_competitors_groups.sql =====
-- P3.5 商业化安全补丁：plan_limits 增加 max_competitors / max_keyword_groups 字段
-- 用于 POST /api/competitors 和 POST /api/keywords/groups 的套餐数量限制
-- 幂等可重复执行（do $$ ... add column if not exists）

-- ============ 新增 max_competitors 字段 ============
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'plan_limits' and column_name = 'max_competitors'
  ) then
    alter table public.plan_limits
      add column max_competitors integer not null default 3;
  end if;
end $$;

-- ============ 新增 max_keyword_groups 字段 ============
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'plan_limits' and column_name = 'max_keyword_groups'
  ) then
    alter table public.plan_limits
      add column max_keyword_groups integer not null default 3;
  end if;
end $$;

-- ============ 更新各套餐的 max_competitors ============
-- free: 3, pro: 20, team: 100, enterprise: 1000
update public.plan_limits set max_competitors = 3 where plan = 'free';
update public.plan_limits set max_competitors = 20 where plan = 'pro';
update public.plan_limits set max_competitors = 100 where plan = 'team';
update public.plan_limits set max_competitors = 1000 where plan = 'enterprise';

-- ============ 更新各套餐的 max_keyword_groups ============
-- free: 3, pro: 20, team: 100, enterprise: 1000
update public.plan_limits set max_keyword_groups = 3 where plan = 'free';
update public.plan_limits set max_keyword_groups = 20 where plan = 'pro';
update public.plan_limits set max_keyword_groups = 100 where plan = 'team';
update public.plan_limits set max_keyword_groups = 1000 where plan = 'enterprise';
