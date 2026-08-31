-- ===== 0013_creem_payment_channel.sql =====
-- Creem 支付通道接入：放宽 orders 的 currency / payment_channel CHECK 约束
--
-- 背景：
--   - 0008 建 orders 表时仅有 Yaolipay（CNY，alipay/wxpay）
--   - Creem 收款使用 USD；新增 creem 支付渠道
--
-- 原则：
--   - 只放宽约束，不修改/删除任何历史数据（CNY 与 alipay/wxpay 历史订单全部保留）
--   - currency 默认值改为 'USD'（服务端插入时始终显式指定，默认值仅兜底）

-- 1. currency：允许 USD（历史 CNY 订单保留）
alter table public.orders drop constraint if exists orders_currency_check;
alter table public.orders add constraint orders_currency_check
  check (currency in ('CNY', 'USD'));
alter table public.orders alter column currency set default 'USD';

-- 2. payment_channel：允许 creem（历史 alipay/wxpay 订单保留）
alter table public.orders drop constraint if exists orders_payment_channel_check;
alter table public.orders add constraint orders_payment_channel_check
  check (payment_channel in ('alipay', 'wxpay', 'creem'));
