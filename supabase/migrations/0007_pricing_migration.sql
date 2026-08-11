-- ===== 0007_pricing_migration.sql =====
-- Phase 3: Pricing Migration
-- 旧套餐：free / pro / team / enterprise
-- 新套餐：free / lite / pro
--
-- 迁移策略：
--   profiles.plan:
--     free → free（保持不变）
--     pro  → pro（保持不变）
--     team → pro
--     enterprise → pro
--   plan_limits:
--     更新 free / pro 行为 src/lib/billing.ts DEFAULT_PLAN_LIMITS
--     插入 lite 行
--     删除 team / enterprise 行
--
-- 安全要求：
--   - 不删除用户
--   - 不修改 subscription_id / subscription_status / current_period_end
--   - 不影响 RLS
--   - 不影响登录触发器
--   - 幂等可重复执行
--   - 约束变更顺序：先迁移数据 → 再 DROP 旧 CHECK → 再 ADD 新 CHECK

-- ========================================================
-- 1. profiles.plan：旧用户套餐数据迁移（在旧 CHECK 下合法）
-- ========================================================
-- 旧 CHECK 允许 'team' 和 'enterprise'，'pro' 也合法，可直接更新
update public.profiles set plan = 'pro' where plan = 'team';
update public.profiles set plan = 'pro' where plan = 'enterprise';

-- ========================================================
-- 2. profiles.plan：删除旧 CHECK 约束
-- ========================================================
-- 0003_subscription.sql 使用列级 CHECK，PostgreSQL 默认命名为 profiles_plan_check
-- 但不同环境下可能存在其他自动命名，故按约束定义内容动态识别并删除
do $$
declare
  v_constraint_name text;
begin
  select c.conname
  into v_constraint_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'public'
    and t.relname = 'profiles'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ~* 'team'
    and pg_get_constraintdef(c.oid) ~* 'enterprise';

  if v_constraint_name is not null then
    execute format('alter table public.profiles drop constraint if exists %I', v_constraint_name);
  end if;
end $$;

-- 兜底：删除可能残留的默认命名约束（无副作用）
alter table public.profiles drop constraint if exists profiles_plan_check;

-- ========================================================
-- 3. profiles.plan：添加新 CHECK 约束（free / lite / pro）
-- ========================================================
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'profiles'
      and constraint_name = 'profiles_plan_check'
  ) then
    alter table public.profiles
      add constraint profiles_plan_check
      check (plan in ('free', 'lite', 'pro'));
  end if;
end $$;

-- ========================================================
-- 4. plan_limits：删除旧 CHECK 约束（0004_plan_limits.sql 显式命名）
-- ========================================================
-- 必须先 DROP 旧 CHECK，否则插入 'lite' 行会被旧约束拒绝
alter table public.plan_limits drop constraint if exists plan_limits_plan_check;

-- 兜底：按定义内容识别并删除其他可能残留的列级 CHECK
do $$
declare
  v_constraint_name text;
begin
  select c.conname
  into v_constraint_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'public'
    and t.relname = 'plan_limits'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ~* 'team'
    and pg_get_constraintdef(c.oid) ~* 'enterprise';

  if v_constraint_name is not null then
    execute format('alter table public.plan_limits drop constraint if exists %I', v_constraint_name);
  end if;
end $$;

-- ========================================================
-- 5. plan_limits：更新 free 行（以 src/lib/billing.ts DEFAULT_PLAN_LIMITS.free 为准）
-- ========================================================
insert into public.plan_limits (
  plan, max_projects, max_tracked_keywords,
  max_competitors, max_keyword_groups,
  serpapi_monthly_limit, dataforseo_monthly_limit,
  content_check_monthly_limit, audit_daily_limit, audit_max_depth,
  can_export_pdf, can_export_excel, can_white_label,
  can_email_report, can_team_collaboration, max_seats
) values (
  'free', 1, 5,
  3, 3,
  50, 0,
  10, 3, 1,
  false, false, false,
  false, false, 1
)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_tracked_keywords = excluded.max_tracked_keywords,
  max_competitors = excluded.max_competitors,
  max_keyword_groups = excluded.max_keyword_groups,
  serpapi_monthly_limit = excluded.serpapi_monthly_limit,
  dataforseo_monthly_limit = excluded.dataforseo_monthly_limit,
  content_check_monthly_limit = excluded.content_check_monthly_limit,
  audit_daily_limit = excluded.audit_daily_limit,
  audit_max_depth = excluded.audit_max_depth,
  can_export_pdf = excluded.can_export_pdf,
  can_export_excel = excluded.can_export_excel,
  can_white_label = excluded.can_white_label,
  can_email_report = excluded.can_email_report,
  can_team_collaboration = excluded.can_team_collaboration,
  max_seats = excluded.max_seats,
  updated_at = now();

-- ========================================================
-- 6. plan_limits：插入 lite 行（以 src/lib/billing.ts DEFAULT_PLAN_LIMITS.lite 为准）
-- ========================================================
insert into public.plan_limits (
  plan, max_projects, max_tracked_keywords,
  max_competitors, max_keyword_groups,
  serpapi_monthly_limit, dataforseo_monthly_limit,
  content_check_monthly_limit, audit_daily_limit, audit_max_depth,
  can_export_pdf, can_export_excel, can_white_label,
  can_email_report, can_team_collaboration, max_seats
) values (
  'lite', 3, 30,
  10, 10,
  300, 5,
  50, 10, 2,
  false, false, false,
  false, false, 1
)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_tracked_keywords = excluded.max_tracked_keywords,
  max_competitors = excluded.max_competitors,
  max_keyword_groups = excluded.max_keyword_groups,
  serpapi_monthly_limit = excluded.serpapi_monthly_limit,
  dataforseo_monthly_limit = excluded.dataforseo_monthly_limit,
  content_check_monthly_limit = excluded.content_check_monthly_limit,
  audit_daily_limit = excluded.audit_daily_limit,
  audit_max_depth = excluded.audit_max_depth,
  can_export_pdf = excluded.can_export_pdf,
  can_export_excel = excluded.can_export_excel,
  can_white_label = excluded.can_white_label,
  can_email_report = excluded.can_email_report,
  can_team_collaboration = excluded.can_team_collaboration,
  max_seats = excluded.max_seats,
  updated_at = now();

-- ========================================================
-- 7. plan_limits：更新 pro 行（以 src/lib/billing.ts DEFAULT_PLAN_LIMITS.pro 为准）
-- ========================================================
insert into public.plan_limits (
  plan, max_projects, max_tracked_keywords,
  max_competitors, max_keyword_groups,
  serpapi_monthly_limit, dataforseo_monthly_limit,
  content_check_monthly_limit, audit_daily_limit, audit_max_depth,
  can_export_pdf, can_export_excel, can_white_label,
  can_email_report, can_team_collaboration, max_seats
) values (
  'pro', 10, 200,
  50, 50,
  2000, 30,
  300, 50, 5,
  true, true, false,
  true, false, 1
)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_tracked_keywords = excluded.max_tracked_keywords,
  max_competitors = excluded.max_competitors,
  max_keyword_groups = excluded.max_keyword_groups,
  serpapi_monthly_limit = excluded.serpapi_monthly_limit,
  dataforseo_monthly_limit = excluded.dataforseo_monthly_limit,
  content_check_monthly_limit = excluded.content_check_monthly_limit,
  audit_daily_limit = excluded.audit_daily_limit,
  audit_max_depth = excluded.audit_max_depth,
  can_export_pdf = excluded.can_export_pdf,
  can_export_excel = excluded.can_export_excel,
  can_white_label = excluded.can_white_label,
  can_email_report = excluded.can_email_report,
  can_team_collaboration = excluded.can_team_collaboration,
  max_seats = excluded.max_seats,
  updated_at = now();

-- ========================================================
-- 8. plan_limits：删除旧 team / enterprise 行
-- ========================================================
-- profiles.plan 已不再产生 team / enterprise 值
-- plan_limits 中这两行不再作为有效套餐，可安全删除
delete from public.plan_limits where plan = 'team';
delete from public.plan_limits where plan = 'enterprise';

-- ========================================================
-- 9. plan_limits：添加新 CHECK 约束（free / lite / pro）
-- ========================================================
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'plan_limits'
      and constraint_name = 'plan_limits_plan_check'
  ) then
    alter table public.plan_limits
      add constraint plan_limits_plan_check
      check (plan in ('free', 'lite', 'pro'));
  end if;
end $$;

-- ========================================================
-- 10. 验证：最终状态确认
-- ========================================================
-- profiles.plan 合法值：free / lite / pro
-- plan_limits.plan 合法值：free / lite / pro
-- plan_limits 现存行：free / lite / pro（team / enterprise 已删除）
-- subscription_id / subscription_status / current_period_end 未修改
-- RLS 策略未修改
-- 触发器未修改
