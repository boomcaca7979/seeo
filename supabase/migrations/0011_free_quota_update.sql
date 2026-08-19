-- ===== 0011：Free 套餐额度调整 =====
-- 目标（与 src/lib/billing.ts DEFAULT_PLAN_LIMITS 保持一致）：
--   free.max_projects          1 → 2
--   free.max_tracked_keywords  5 → 3
--   free.serpapi_monthly_limit 50 → 30
--   free.serpapi_daily_limit   (新增) 3
--   free.audit_daily_limit     3（不变）
-- lite / pro 不变（serpapi_daily_limit = 0，无日度限制）
--
-- 注意：
--   - rowToPlanLimits 对 serpapi_daily_limit 做「列缺失/null → 代码默认值」兜底，
--     未执行本迁移的生产库仍会按 DEFAULT_PLAN_LIMITS 生效（free=3, lite/pro=0）。
--   - 执行本迁移后 DB 列为权威来源。

-- 1. 新增每日限额列（幂等）
alter table public.plan_limits
  add column if not exists serpapi_daily_limit integer not null default 0;

comment on column public.plan_limits.serpapi_daily_limit is
  'SerpApi 每日限额（0 = 无日度限制；free = 3）';

-- 2. 更新 free 行（幂等 upsert）
update public.plan_limits set
  max_projects = 2,
  max_tracked_keywords = 3,
  serpapi_monthly_limit = 30,
  serpapi_daily_limit = 3,
  audit_daily_limit = 3,
  updated_at = now()
where plan = 'free';

-- 3. lite / pro 显式写 0（无日度限制，防歧义）
update public.plan_limits set
  serpapi_daily_limit = 0,
  updated_at = now()
where plan in ('lite', 'pro');
