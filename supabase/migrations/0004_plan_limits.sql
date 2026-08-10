-- ===== 0004_plan_limits.sql =====
-- P1 商业化基础设施：plan_limits 表
-- 各套餐的限额与功能开关，统一在数据库管理，不写死代码
-- 幂等可重复执行（create table if not exists + upsert）

-- ============ plan_limits 表 ============
create table if not exists public.plan_limits (
  plan text primary key,
  max_projects integer not null default 1,
  max_tracked_keywords integer not null default 5,
  serpapi_monthly_limit integer not null default 50,
  dataforseo_monthly_limit integer not null default 0,
  audit_daily_limit integer not null default 3,
  audit_max_depth integer not null default 1,
  can_export_pdf boolean not null default false,
  can_export_excel boolean not null default false,
  can_white_label boolean not null default false,
  can_email_report boolean not null default false,
  can_team_collaboration boolean not null default false,
  max_seats integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 约束：plan 必须是合法的套餐等级
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'plan_limits' and constraint_name = 'plan_limits_plan_check'
  ) then
    alter table public.plan_limits
      add constraint plan_limits_plan_check
      check (plan in ('free', 'pro', 'team', 'enterprise'));
  end if;
end $$;

-- ============ 插入各套餐配置（upsert） ============
-- 使用 2147483647（int32 最大值）表示"无限"，避免 JS Number.MAX_SAFE_INTEGER 在 SQL 中不友好

-- free：免费版，限制最严格
insert into public.plan_limits (
  plan, max_projects, max_tracked_keywords,
  serpapi_monthly_limit, dataforseo_monthly_limit,
  audit_daily_limit, audit_max_depth,
  can_export_pdf, can_export_excel, can_white_label,
  can_email_report, can_team_collaboration, max_seats
) values (
  'free', 1, 5,
  50, 0,
  3, 1,
  false, false, false,
  false, false, 1
)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_tracked_keywords = excluded.max_tracked_keywords,
  serpapi_monthly_limit = excluded.serpapi_monthly_limit,
  dataforseo_monthly_limit = excluded.dataforseo_monthly_limit,
  audit_daily_limit = excluded.audit_daily_limit,
  audit_max_depth = excluded.audit_max_depth,
  can_export_pdf = excluded.can_export_pdf,
  can_export_excel = excluded.can_export_excel,
  can_white_label = excluded.can_white_label,
  can_email_report = excluded.can_email_report,
  can_team_collaboration = excluded.can_team_collaboration,
  max_seats = excluded.max_seats,
  updated_at = now();

-- pro：专业版，解锁 PDF/Excel 导出、邮件报告、完整审计
insert into public.plan_limits (
  plan, max_projects, max_tracked_keywords,
  serpapi_monthly_limit, dataforseo_monthly_limit,
  audit_daily_limit, audit_max_depth,
  can_export_pdf, can_export_excel, can_white_label,
  can_email_report, can_team_collaboration, max_seats
) values (
  'pro', 5, 50,
  1000, 10,
  20, 3,
  true, true, false,
  true, false, 1
)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_tracked_keywords = excluded.max_tracked_keywords,
  serpapi_monthly_limit = excluded.serpapi_monthly_limit,
  dataforseo_monthly_limit = excluded.dataforseo_monthly_limit,
  audit_daily_limit = excluded.audit_daily_limit,
  audit_max_depth = excluded.audit_max_depth,
  can_export_pdf = excluded.can_export_pdf,
  can_export_excel = excluded.can_export_excel,
  can_white_label = excluded.can_white_label,
  can_email_report = excluded.can_email_report,
  can_team_collaboration = excluded.can_team_collaboration,
  max_seats = excluded.max_seats,
  updated_at = now();

-- team：团队版，在 pro 基础上 + 团队协作 + 更高额度
insert into public.plan_limits (
  plan, max_projects, max_tracked_keywords,
  serpapi_monthly_limit, dataforseo_monthly_limit,
  audit_daily_limit, audit_max_depth,
  can_export_pdf, can_export_excel, can_white_label,
  can_email_report, can_team_collaboration, max_seats
) values (
  'team', 20, 500,
  5000, 50,
  100, 5,
  true, true, false,
  true, true, 5
)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_tracked_keywords = excluded.max_tracked_keywords,
  serpapi_monthly_limit = excluded.serpapi_monthly_limit,
  dataforseo_monthly_limit = excluded.dataforseo_monthly_limit,
  audit_daily_limit = excluded.audit_daily_limit,
  audit_max_depth = excluded.audit_max_depth,
  can_export_pdf = excluded.can_export_pdf,
  can_export_excel = excluded.can_export_excel,
  can_white_label = excluded.can_white_label,
  can_email_report = excluded.can_email_report,
  can_team_collaboration = excluded.can_team_collaboration,
  max_seats = excluded.max_seats,
  updated_at = now();

-- enterprise：企业版，全部功能 + 白标 + 最高额度（用 int32 max 表示无限）
insert into public.plan_limits (
  plan, max_projects, max_tracked_keywords,
  serpapi_monthly_limit, dataforseo_monthly_limit,
  audit_daily_limit, audit_max_depth,
  can_export_pdf, can_export_excel, can_white_label,
  can_email_report, can_team_collaboration, max_seats
) values (
  'enterprise', 2147483647, 2147483647,
  2147483647, 2147483647,
  2147483647, 10,
  true, true, true,
  true, true, 50
)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_tracked_keywords = excluded.max_tracked_keywords,
  serpapi_monthly_limit = excluded.serpapi_monthly_limit,
  dataforseo_monthly_limit = excluded.dataforseo_monthly_limit,
  audit_daily_limit = excluded.audit_daily_limit,
  audit_max_depth = excluded.audit_max_depth,
  can_export_pdf = excluded.can_export_pdf,
  can_export_excel = excluded.can_export_excel,
  can_white_label = excluded.can_white_label,
  can_email_report = excluded.can_email_report,
  can_team_collaboration = excluded.can_team_collaboration,
  max_seats = excluded.max_seats,
  updated_at = now();

-- ============ RLS 策略 ============
-- plan_limits 为全局配置表，所有登录用户可读（用于前端展示套餐对比）
-- 写入只允许 service_role（通过 Dashboard / 后台脚本）
alter table public.plan_limits enable row level security;

drop policy if exists "plan_limits readable by authenticated" on public.plan_limits;
create policy "plan_limits readable by authenticated"
  on public.plan_limits for select
  using (auth.role() = 'authenticated' or auth.role() = 'anon');

-- 不创建 insert/update/delete policy，写入只走 service_role（绕过 RLS）

-- ============ 索引 ============
create index if not exists idx_plan_limits_plan on public.plan_limits(plan);
