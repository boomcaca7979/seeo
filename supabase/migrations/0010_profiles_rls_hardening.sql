-- ===== 0010_profiles_rls_hardening.sql =====
-- P0 修复：防止用户通过 anon client 直接篡改 profiles 敏感列
--
-- 漏洞：
--   原 UPDATE policy 仅有 using(auth.uid()=id) 无 with check 限制列，
--   用户可通过浏览器 anon client 直接执行：
--     supabase.from('profiles').update({plan:'pro',subscription_status:'active',current_period_end:'2099-12-31'}).eq('id',<自己uid>)
--   绕过整个支付系统免费获得 Pro 会员。
--
-- 修复方案：
--   1. 撤销 anon/authenticated 对 profiles 的全列 UPDATE 权限
--   2. 仅授予 display_name / avatar_url 两列的 UPDATE 权限
--   3. 敏感列（plan / subscription_status / current_period_end /
--      subscription_id / trial_ends_at）只能通过 service_role（绕过 RLS）修改
--   4. 收紧 RLS policy 增加 with check 确保 owner 一致性
--
-- 兼容性：
--   - 用户仍可修改 display_name / avatar_url（设置页 Edit 按钮）
--   - extend_membership / recompute_membership_after_refund RPC 使用 service_role，
--     不受此限制影响
--   - membership-expire cron 使用 service_role，不受此限制影响

-- 1. 撤销全表 UPDATE 权限（列级权限优先于表级）
revoke update on public.profiles from anon, authenticated;

-- 2. 仅授予安全列的 UPDATE 权限
grant update (display_name, avatar_url) on public.profiles to anon, authenticated;

-- 3. 收紧 RLS policy：增加 with check 确保更新后仍属于自己
drop policy if exists "Profiles are updatable by owner" on public.profiles;
create policy "Profiles are updatable by owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
