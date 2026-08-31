-- ===== 0012_custom_service_plan.sql =====
-- 新增「定制服务 ¥649」套餐（plan = 'custom'）
--
-- 说明：
--   - 定制服务为一次性服务购买，不开通会员周期（periodDays = 0）
--   - 仅放宽 orders.plan 的 CHECK 约束以允许 'custom'，不修改任何现有数据
--   - profiles.plan 约束（free/lite/pro）保持不变：定制服务不影响会员等级
--   - recompute_membership_after_refund 仅统计 pro/lite 订单，custom 自然被忽略

-- 放宽 orders.plan 约束：lite / pro / custom
alter table public.orders drop constraint if exists orders_plan_check;
alter table public.orders add constraint orders_plan_check
  check (plan in ('lite', 'pro', 'custom'));
