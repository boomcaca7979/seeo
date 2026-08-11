# SeeO Pricing Migration — 最终交接文档

> 本文档为 SeeO Pricing Migration 收尾阶段的最终交接文档，由 Phase 5 收尾审计生成。
> 替代 Phase 1 之前生成的旧版 `SEEO_PRICING_MIGRATION_HANDOFF.md`（旧文档描述了迁移目标，本文档记录最终完成状态）。

---

## 1. 项目当前 Pricing 状态

SeeO Pricing Migration 已完成 5 个阶段的代码改造：

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | PlanTier / billing limits / Feature Gate 迁移到 free / lite / pro | ✅ 已完成 |
| Phase 2 | Stripe checkout / Price ID 映射迁移到 lite / pro | ✅ 已完成 |
| Phase 3 | 新增 `supabase/migrations/0007_pricing_migration.sql`，迁移数据库约束和旧用户套餐 | ✅ 已完成 |
| Phase 4 | Pricing / Settings / Sidebar / Topbar / UpgradeModal 等前端迁移 | ✅ 已完成 |
| Phase 5 | Free / Lite / Pro 权限、Checkout、Webhook、PDF、Backlinks Feature Gate 测试与 bug 修复 | ✅ 已完成 |

**重要状态：**

- 代码已完成 Pricing Migration
- **未 commit**
- **未 push**
- **未部署**
- **未修改 Stripe Dashboard**
- **未配置生产 Stripe Price ID**
- **未配置生产 Stripe Webhook endpoint**
- **未执行生产数据库 migration**

---

## 2. Free / Lite / Pro 最终价格

| 套餐 | 价格 | Plan Key | 定位 |
|---|---|---|---|
| Free | $0 | `free` | 个人站长入门 |
| Lite | $9.9/月 | `lite` | 个人 SEO 入门 |
| Pro | $29.9/月 | `pro` | 专业 SEO 从业者 |

**重要商业决策记录：**

最终套餐定价为：

- Free = $0
- Lite = $9.9/month
- Pro = $29.9/month

**不要把之前的 ¥29 / ¥99、team / enterprise 当成当前套餐。**

价格统一来源：[`src/lib/billing.ts`](file:///Users/boomcaca/projects/SeeO/src/lib/billing.ts) 中的 `PLAN_DISPLAY_INFO` 常量。前端所有页面（Pricing / Settings / UpgradeModal / Sidebar / Topbar）从此常量读取，不再硬编码价格。

---

## 3. Free / Lite / Pro 全部权限和额度

代码真实来源：[`src/lib/billing.ts`](file:///Users/boomcaca/projects/SeeO/src/lib/billing.ts) 中的 `DEFAULT_PLAN_LIMITS`，与 [`supabase/migrations/0007_pricing_migration.sql`](file:///Users/boomcaca/projects/SeeO/supabase/migrations/0007_pricing_migration.sql) 中的 `plan_limits` 表 upsert 完全一致。

### Free 套餐

| 项 | 值 |
|---|---|
| max_projects | 1 |
| max_tracked_keywords | 5 |
| max_competitors | 3 |
| max_keyword_groups | 3 |
| serpapi_monthly_limit | 50 |
| dataforseo_monthly_limit | 0 |
| content_check_monthly_limit | 10 |
| audit_daily_limit | 3 |
| audit_max_depth | 1 |
| can_export_pdf | false |
| can_export_excel | false |
| can_email_report | false |

### Lite 套餐

| 项 | 值 |
|---|---|
| max_projects | 3 |
| max_tracked_keywords | 30 |
| max_competitors | 10 |
| max_keyword_groups | 10 |
| serpapi_monthly_limit | 300 |
| dataforseo_monthly_limit | 5 |
| content_check_monthly_limit | 50 |
| audit_daily_limit | 10 |
| audit_max_depth | 2 |
| can_export_pdf | false |
| can_export_excel | false |
| can_email_report | false |

### Pro 套餐

| 项 | 值 |
|---|---|
| max_projects | 10 |
| max_tracked_keywords | 200 |
| max_competitors | 50 |
| max_keyword_groups | 50 |
| serpapi_monthly_limit | 2000 |
| dataforseo_monthly_limit | 30 |
| content_check_monthly_limit | 300 |
| audit_daily_limit | 50 |
| audit_max_depth | 5 |
| can_export_pdf | true |
| can_export_excel | true |
| can_email_report | true |

> 注：`can_white_label` / `can_team_collaboration` / `max_seats` 字段在数据库 schema 中保留以兼容旧 migration，但当前所有套餐均为 false / 1，不作为业务 Feature Gate 使用。

---

## 4. Feature Gate

代码真实来源：[`src/lib/billing.ts`](file:///Users/boomcaca/projects/SeeO/src/lib/billing.ts) 中的 `FEATURE_PLAN_GATE` 常量。

| Feature | 所需套餐 | 对应 flagField | 后端校验入口 |
|---|---|---|---|
| pdf_export | pro | can_export_pdf | `requireFeature(userId, "pdf_export")` |
| excel_export | pro | can_export_excel | `requireFeature(userId, "excel_export")` |
| email_report | pro | can_email_report | `requireFeature(userId, "email_report")` |
| full_audit | pro | audit_max_depth | `requireFeature(userId, "full_audit")` |
| backlinks | pro | dataforseo_monthly_limit | `requireFeature(userId, "backlinks")` |

**Plan Rank：**

```
free = 0
lite = 1
pro  = 2
```

`checkFeature` 逻辑：用户套餐 rank >= Feature 所需套餐 rank **AND** 对应 flagField 为 true（或数值字段 > 0）。

---

## 5. Stripe Checkout 架构

### 5.1 Price ID 映射（服务端唯一入口）

代码真实来源：[`src/lib/stripe.ts`](file:///Users/boomcaca/projects/SeeO/src/lib/stripe.ts)

```typescript
export function getStripePriceId(plan: "lite" | "pro"): string | null {
  const envKey = plan === "lite" ? "STRIPE_PRICE_LITE" : "STRIPE_PRICE_PRO";
  return process.env[envKey] ?? null;
}
```

**关键安全点：**

- 客户端不能传 Stripe Price ID
- Price ID 始终由服务端根据 plan 映射
- 只接受 `lite` 和 `pro` 两个值

### 5.2 Checkout API 路由

文件：[`src/app/api/checkout/route.ts`](file:///Users/boomcaca/projects/SeeO/src/app/api/checkout/route.ts)

**接受的 plan：** `lite` | `pro`（其他值返回 400）

**Stripe Checkout Session 参数：**

| 参数 | 值 |
|---|---|
| mode | `subscription` |
| payment_method_types | `["card"]` |
| line_items | `[{ price: priceId, quantity: 1 }]` |
| customer_email | 从 supabase.auth.getUser() 获取（失败不阻断） |
| metadata.user_id | userId（必须写入） |
| metadata.plan | `lite` 或 `pro`（必须写入） |
| subscription_data.metadata.user_id | userId |
| subscription_data.metadata.plan | plan |
| success_url | `${APP_URL}/settings?checkout=success` |
| cancel_url | `${APP_URL}/pricing?checkout=cancel` |

**演示模式：** 返回 503，不创建真实 Checkout Session。

---

## 6. Stripe Price ID 环境变量

| 环境变量 | 用途 | 是否已配置 |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe server client 初始化 | ⚠️ 待生产配置 |
| `STRIPE_PRICE_LITE` | Lite 套餐对应的 Stripe Price ID | ⚠️ 待生产配置 |
| `STRIPE_PRICE_PRO` | Pro 套餐对应的 Stripe Price ID | ⚠️ 待生产配置 |
| `STRIPE_WEBHOOK_SECRET` | Webhook 签名验证 | ⚠️ 待生产配置 |
| `NEXT_PUBLIC_APP_URL` | Checkout 跳转地址拼接 | ⚠️ 待生产配置 |

**已删除的环境变量引用：**

- ~~`STRIPE_PRICE_TEAM`~~（已从代码中完全移除）
- ~~`STRIPE_PRICE_ENTERPRISE`~~（已从代码中完全移除）

---

## 7. Webhook 事件

代码真实来源：[`src/app/api/webhooks/stripe/route.ts`](file:///Users/boomcaca/projects/SeeO/src/app/api/webhooks/stripe/route.ts)

### 7.1 处理的事件

仅以下三种事件会被处理，其他事件返回 `{ received: true, ignored: true }`：

| 事件 | 处理逻辑 |
|---|---|
| `checkout.session.completed` | 写入 `profiles.plan = metadata.plan`，`subscription_status = active`，`subscription_id = subscription.id` |
| `customer.subscription.updated` | 更新 `subscription_status`、`subscription_id`、`current_period_end`；若 metadata.plan 存在则一并更新 plan |
| `customer.subscription.deleted` | 设置 `profiles.plan = free`，`subscription_status = canceled`，`current_period_end = null` |

### 7.2 Plan 提取白名单

```typescript
function extractPlanFromMetadata(metadata): PlanTier | null {
  const plan = metadata?.plan;
  if (plan === "free" || plan === "lite" || plan === "pro") return plan;
  return null;
}
```

**只接受 free / lite / pro**，team / enterprise 返回 null。

### 7.3 签名验证

- 必须配置 `STRIPE_WEBHOOK_SECRET`
- 使用 `stripe.webhooks.constructEvent(payload, signature, webhookSecret)` 验证签名
- 失败返回 400

### 7.4 数据库写入

- 使用 `getAdminClient()`（service_role key，绕过 RLS）
- 失败返回 500 让 Stripe 重试

---

## 8. 数据库 0007 Migration

文件：[`supabase/migrations/0007_pricing_migration.sql`](file:///Users/boomcaca/projects/SeeO/supabase/migrations/0007_pricing_migration.sql)

### 8.1 操作清单

1. **profiles.plan 数据迁移**
   - `team` → `pro`
   - `enterprise` → `pro`
   - `free` 保持 `free`
   - `pro` 保持 `pro`

2. **profiles.plan CHECK 约束**
   - DROP 旧 CHECK（动态识别 + 默认名兜底）
   - ADD 新 CHECK：`plan in ('free', 'lite', 'pro')`

3. **plan_limits CHECK 约束**
   - DROP 旧 CHECK（显式名 + 按定义兜底）
   - ADD 新 CHECK：`plan in ('free', 'lite', 'pro')`

4. **plan_limits 数据**
   - UPSERT `free` 行（与 `DEFAULT_PLAN_LIMITS.free` 一致）
   - UPSERT `lite` 行（与 `DEFAULT_PLAN_LIMITS.lite` 一致）
   - UPSERT `pro` 行（与 `DEFAULT_PLAN_LIMITS.pro` 一致）
   - DELETE `team` 行
   - DELETE `enterprise` 行

### 8.2 安全保证

- ✅ 不删除用户
- ✅ 不修改 `subscription_id` / `subscription_status` / `current_period_end` / `trial_ends_at`
- ✅ 不影响 RLS 策略
- ✅ 不影响登录触发器（`handle_new_user`、`update_updated_at`、`handle_new_project`）
- ✅ 幂等可重复执行

### 8.3 幂等性验证

| 步骤 | 二次执行行为 |
|---|---|
| UPDATE profiles (team/enterprise → pro) | 0 行匹配，无副作用 |
| DROP CONSTRAINT IF EXISTS | no-op |
| ADD CONSTRAINT IF NOT EXISTS | no-op |
| INSERT ... ON CONFLICT DO UPDATE | upsert 更新为相同值 |
| DELETE team / enterprise 行 | 0 行匹配，无副作用 |

### 8.4 约束变更顺序

```
1. UPDATE profiles（在旧 CHECK 下合法，pro 值允许）
2. DROP 旧 CHECK on profiles
3. ADD 新 CHECK on profiles
4. DROP 旧 CHECK on plan_limits
5. UPSERT free / lite / pro 行
6. DELETE team / enterprise 行
7. ADD 新 CHECK on plan_limits
```

---

## 9. 旧用户迁移策略

| 旧 plan | 新 plan | 说明 |
|---|---|---|
| free | free | 保持不变 |
| pro | pro | 保持不变 |
| team | pro | 升级到 Pro |
| enterprise | pro | 升级到 Pro |

**保持不变的字段：**

- `subscription_id`
- `subscription_status`
- `current_period_end`
- `trial_ends_at`
- 所有其他 profiles 字段

**风险提示：**

- 旧 team / enterprise 用户的 Stripe subscription 仍指向旧的 team / enterprise Price ID
- 0007 migration 只修改 `profiles.plan` 字段，不修改 Stripe 端的 subscription
- 这些用户在 Stripe 端仍按 team / enterprise 计费，但代码层面会按 Pro 套餐提供服务
- **建议生产部署前在 Stripe Dashboard 中将这些用户的 subscription 迁移到 Pro Price ID，或通知他们重新订阅**

---

## 10. 当前 git status

```
On branch main
Your branch is ahead of 'origin/main' by 5 commits.

Changes not staged for commit:
        modified:   src/app/(dashboard)/app/settings/page.tsx
        modified:   src/app/api/audit/start/route.ts
        modified:   src/app/api/backlinks/route.ts
        modified:   src/app/api/checkout/route.ts
        modified:   src/app/api/content/check/route.ts
        modified:   src/app/api/projects/route.ts
        modified:   src/app/api/webhooks/stripe/route.ts
        modified:   src/app/pricing/page.tsx
        modified:   src/components/billing/UpgradeModal.tsx
        modified:   src/components/dashboard/Sidebar.tsx
        modified:   src/components/dashboard/Topbar.tsx
        modified:   src/lib/auth.ts
        modified:   src/lib/billing.ts
        modified:   src/lib/seo/cache.ts
        modified:   src/lib/stripe.ts
        modified:   src/lib/supabase/admin.ts

Untracked files:
        docs/SEEO_PRICING_MIGRATION_HANDOFF.md       (旧文档，Phase 1 之前生成)
        docs/SEE0_PRICING_MIGRATION_HANDOFF.md       (本文档，最终交接)
        supabase/migrations/0007_pricing_migration.sql
```

**敏感文件检查：**

- ✅ 无 `.env`、`.env.local` 被修改
- ✅ 无 `service_role key`、`STRIPE_SECRET_KEY` 等密钥被修改
- ✅ 无 `node_modules`、`.next`、构建产物被修改
- ✅ 所有 16 个 modified 文件均属于 Pricing Migration

---

## 11. 当前未提交文件列表

### Modified（16 个）

| 文件 | 改动内容 |
|---|---|
| [src/app/(dashboard)/app/settings/page.tsx](file:///Users/boomcaca/projects/SeeO/src/app/(dashboard)/app/settings/page.tsx) | 删除 Team Tab、PLAN_LABELS 改为 3 套餐、checkoutPlan 类型改为 lite/pro |
| [src/app/api/audit/start/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/audit/start/route.ts) | 注释更新为 free/lite/pro |
| [src/app/api/backlinks/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/backlinks/route.ts) | **Phase 5 修复：新增 requireFeature("backlinks")** |
| [src/app/api/checkout/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/checkout/route.ts) | 只接受 lite/pro，服务端 price 映射 |
| [src/app/api/content/check/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/content/check/route.ts) | 注释更新 |
| [src/app/api/projects/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/projects/route.ts) | 注释更新 |
| [src/app/api/webhooks/stripe/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/webhooks/stripe/route.ts) | extractPlanFromMetadata 只接受 free/lite/pro |
| [src/app/pricing/page.tsx](file:///Users/boomcaca/projects/SeeO/src/app/pricing/page.tsx) | checkoutPlan/loadingPlan 类型改为 lite/pro，grid 3 列，移除 team/enterprise feature |
| [src/components/billing/UpgradeModal.tsx](file:///Users/boomcaca/projects/SeeO/src/components/billing/UpgradeModal.tsx) | PLAN_ORDER/LABELS 改为 free/lite/pro，getNextPlan 返回 null for pro |
| [src/components/dashboard/Sidebar.tsx](file:///Users/boomcaca/projects/SeeO/src/components/dashboard/Sidebar.tsx) | PLAN_LABELS 改为 Free/Lite/Pro，showUpgradeCta 扩展 free+lite |
| [src/components/dashboard/Topbar.tsx](file:///Users/boomcaca/projects/SeeO/src/components/dashboard/Topbar.tsx) | PLAN_LABELS/BADGE_STYLES 改为 3 套餐，升级提示扩展 free+lite |
| [src/lib/auth.ts](file:///Users/boomcaca/projects/SeeO/src/lib/auth.ts) | PlanTier 类型改为 free/lite/pro |
| [src/lib/billing.ts](file:///Users/boomcaca/projects/SeeO/src/lib/billing.ts) | 全部套餐配置改为 free/lite/pro，价格 $0/$9.9/$29.9 |
| [src/lib/seo/cache.ts](file:///Users/boomcaca/projects/SeeO/src/lib/seo/cache.ts) | cache 相关调整 |
| [src/lib/stripe.ts](file:///Users/boomcaca/projects/SeeO/src/lib/stripe.ts) | getStripePriceId 只接受 lite/pro，删除 team/enterprise |
| [src/lib/supabase/admin.ts](file:///Users/boomcaca/projects/SeeO/src/lib/supabase/admin.ts) | admin client 调整 |

### Untracked（3 个）

| 文件 | 说明 |
|---|---|
| docs/SEEO_PRICING_MIGRATION_HANDOFF.md | 旧交接文档（Phase 1 之前），保留不修改 |
| docs/SEE0_PRICING_MIGRATION_HANDOFF.md | **本文档（最终交接）** |
| supabase/migrations/0007_pricing_migration.sql | Phase 3 新增的数据库 migration |

---

## 12. lint / typecheck / build 结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run lint` | 0 | ✅ 通过 |
| `npx tsc --noEmit` | 0 | ✅ 通过 |
| `npm run build` | 0 | ✅ 通过（所有路由编译成功） |

---

## 13. 已发现并修复的问题

| # | 阶段 | 问题 | 严重度 | 修复方式 | 状态 |
|---|---|---|---|---|---|
| 1 | Phase 5 | `/api/backlinks GET/POST` 缺少 `requireFeature("backlinks")`，Lite 用户可绕过 Feature Gate 调用 backlinks（因 `dataforseo_monthly_limit = 5 > 0` 使 `consumeQuota` 成功） | **高（安全漏洞）** | 在 GET/POST 的 `consumeQuota` 之前添加 `requireFeature(userId, "backlinks")` | ✅ 已修复 |
| 2 | Phase 5 | `billing.ts` 中 Free 价格显示为 `"¥0"` 而非 `"$0"`，与 Lite/Pro 美元定价不一致 | 中（展示不一致） | 修改 `PLAN_DISPLAY_INFO.free.price` 为 `"$0"` | ✅ 已修复 |

---

## 14. 当前仍存在的问题

### 14.1 已知非阻塞问题

| # | 问题 | 严重度 | 建议处理方式 |
|---|---|---|---|
| 1 | 数据库 schema 仍保留 `can_team_collaboration`、`can_white_label`、`max_seats` 字段 | 低 | 按约束保留以兼容旧 migration，不作为业务 feature gate。未来如需清理可新增 migration 删除字段 |
| 2 | 旧 team / enterprise 用户的 Stripe subscription 仍指向旧 Price ID | 中 | 0007 migration 只改 `profiles.plan`，不改 Stripe 端 subscription。建议生产部署前在 Stripe Dashboard 中迁移这些用户到 Pro Price ID |
| 3 | Lite 套餐 $9.9 的 API 成本占比偏高（主要在 SerpApi 300 次/月） | 中 | Phase 5 已分析，未修改。建议关注实际 SerpApi plan 单价与 Lite 转化率数据后再调整 limits |
| 4 | Phase 1 之前的旧交接文档 `SEEO_PRICING_MIGRATION_HANDOFF.md` 仍存在于 docs/ | 低 | 按用户约束保留不删除。本文档（`SEE0_PRICING_MIGRATION_HANDOFF.md`）已替代其作为最终交接 |

### 14.2 无阻塞性问题

经 Phase 5 完整测试，**未发现任何阻塞性 bug**。所有 Pro-only Feature（pdf_export / excel_export / email_report / full_audit / backlinks）后端均有 `requireFeature` 校验，不依赖前端隐藏按钮。

---

## 15. Stripe Dashboard 尚未完成的配置

> **代码层面已完成 Stripe 迁移，但 Stripe Dashboard 端尚未做任何配置。**

### 15.1 必须创建的 Product 与 Price

| Product | Price | Recurrence | 用途 |
|---|---|---|---|
| SeeO Lite | $9.9 | month | 对应 `STRIPE_PRICE_LITE` |
| SeeO Pro | $29.9 | month | 对应 `STRIPE_PRICE_PRO` |

### 15.2 必须删除（或归档）的旧 Product / Price

- ~~SeeO Team（旧 ¥299 套餐）~~ → 归档或删除
- ~~SeeO Enterprise（旧套餐）~~ → 归档或删除
- ~~SeeO Pro（旧 ¥99 套餐，如存在）~~ → 归档或删除（新 Pro = $29.9）

### 15.3 必须创建的 Webhook endpoint

- URL: `https://<production-domain>/api/webhooks/stripe`
- 事件:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Signing secret → 配置到 `STRIPE_WEBHOOK_SECRET`

### 15.4 旧 team / enterprise 用户处理

- 在 Stripe Dashboard 中找到所有 team / enterprise subscription
- 迁移到新 Pro Price ID（$29.9/月），或通知用户重新订阅
- 0007 migration 只修改数据库 `profiles.plan`，不修改 Stripe 端 subscription

---

## 16. Vercel Environment Variables 尚未完成的配置

> **生产环境变量必须在 Vercel Dashboard 中配置，代码不会自动读取本地 `.env`。**

### 16.1 必须配置的环境变量

| 变量 | 值 | 说明 |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_xxx` 或 `sk_test_xxx` | Stripe server client |
| `STRIPE_PRICE_LITE` | `price_xxx` | Lite 套餐 Price ID（来自 Stripe Dashboard） |
| `STRIPE_PRICE_PRO` | `price_xxx` | Pro 套餐 Price ID（来自 Stripe Dashboard） |
| `STRIPE_WEBHOOK_SECRET` | `whsec_xxx` | Webhook 签名验证 |
| `NEXT_PUBLIC_APP_URL` | `https://<production-domain>` | Checkout 跳转地址拼接 |
| `NEXT_PUBLIC_ENABLE_AUTH` | `true` | 生产环境开启鉴权 |
| `SUPABASE_SERVICE_ROLE_KEY` | `<service_role_key>` | Webhook 写入 profiles 所需 |
| 其他 Supabase / SerpApi / DataForSEO 变量 | 按现状 | 不在本次 migration 范围 |

### 16.2 已删除的环境变量（无需配置）

- ~~`STRIPE_PRICE_TEAM`~~
- ~~`STRIPE_PRICE_ENTERPRISE`~~

---

## 17. Webhook 尚未完成的配置

> **Webhook endpoint 必须在生产域名可访问后才能在 Stripe Dashboard 创建。**

### 17.1 配置步骤

1. 部署代码到生产环境
2. 确认 `https://<production-domain>/api/webhooks/stripe` 可访问
3. 在 Stripe Dashboard → Developers → Webhook endpoints 创建 endpoint
4. 订阅事件：
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. 复制 Signing secret（`whsec_xxx`）到 Vercel Environment Variables 的 `STRIPE_WEBHOOK_SECRET`
6. 重新部署 Vercel 使环境变量生效
7. 在 Stripe Dashboard 中点击 "Send test webhook" 验证

### 17.2 验证 Webhook 工作

- 测试用户完成 Lite checkout → 检查 `profiles.plan = lite`
- 测试用户完成 Pro checkout → 检查 `profiles.plan = pro`
- 测试用户取消 subscription → 检查 `profiles.plan = free` + `subscription_status = canceled`

---

## 18. 部署前必须做什么

### 18.1 Stripe Dashboard 配置

- [ ] 创建 SeeO Lite Product（$9.9/月）
- [ ] 创建 SeeO Pro Product（$29.9/月）
- [ ] 复制 Lite Price ID（`price_xxx`）
- [ ] 复制 Pro Price ID（`price_xxx`）
- [ ] 处理旧 team / enterprise 用户的 subscription

### 18.2 Vercel Environment Variables 配置

- [ ] 配置 `STRIPE_SECRET_KEY`
- [ ] 配置 `STRIPE_PRICE_LITE`
- [ ] 配置 `STRIPE_PRICE_PRO`
- [ ] 配置 `STRIPE_WEBHOOK_SECRET`（需先创建 Webhook endpoint）
- [ ] 配置 `NEXT_PUBLIC_APP_URL`
- [ ] 确认 `NEXT_PUBLIC_ENABLE_AUTH=true`
- [ ] 确认 `SUPABASE_SERVICE_ROLE_KEY` 已配置

### 18.3 数据库 migration

- [ ] 在生产 Supabase 上执行 `supabase/migrations/0007_pricing_migration.sql`
- [ ] 验证 `profiles.plan` CHECK 约束已更新为 `free / lite / pro`
- [ ] 验证 `plan_limits` 表存在 `free / lite / pro` 三行
- [ ] 验证 `plan_limits` 表中 `team / enterprise` 行已删除
- [ ] 验证旧 team / enterprise 用户已迁移到 pro

### 18.4 代码 commit 与 push

- [ ] `git add` 相关文件（不包括 `.env`、密钥等）
- [ ] `git commit -m "feat: complete pricing migration to free/lite/pro"`
- [ ] `git push origin main`

### 18.5 部署

- [ ] Vercel 自动部署（或手动触发）
- [ ] 确认生产环境可访问
- [ ] 配置 Stripe Webhook endpoint
- [ ] 配置 `STRIPE_WEBHOOK_SECRET` 并重新部署

---

## 19. 部署后必须测试什么

### 19.1 基础功能

- [ ] Free 用户可登录、可创建 1 个 project、可做 3 次/天 audit
- [ ] Free 用户被拒绝 PDF / Excel / Email / Full audit / Backlinks
- [ ] Pricing 页面展示三个套餐，价格 $0 / $9.9 / $29.9
- [ ] Settings 页面无 Team Tab

### 19.2 Stripe Checkout

- [ ] 点击 Lite 升级 → 跳转 Stripe Checkout → 完成 $9.9 支付
- [ ] 点击 Pro 升级 → 跳转 Stripe Checkout → 完成 $29.9 支付
- [ ] Checkout success 跳转回 `/settings?checkout=success` 并显示 toast
- [ ] Checkout cancel 跳转回 `/pricing?checkout=cancel` 并显示 toast

### 19.3 Webhook

- [ ] 完成支付后，数据库 `profiles.plan` 正确更新为 `lite` 或 `pro`
- [ ] `subscription_status` 更新为 `active`
- [ ] `subscription_id` 写入
- [ ] `current_period_end` 写入

### 19.4 权限校验

- [ ] Lite 用户点击 PDF → 403 → UpgradeModal（推荐升级 Pro）
- [ ] Lite 用户调用 `/api/backlinks` → 403（Phase 5 修复点）
- [ ] Lite 用户请求 full audit → 403
- [ ] Pro 用户可正常使用 PDF / Excel / Email / Full audit / Backlinks

### 19.5 订阅取消降级

- [ ] 在 Stripe Customer Portal 取消订阅
- [ ] 触发 `customer.subscription.deleted` webhook
- [ ] 数据库 `profiles.plan` 更新为 `free`
- [ ] `subscription_status` 更新为 `canceled`
- [ ] 用户失去 Pro 权限

### 19.6 旧用户迁移验证

- [ ] 旧 `team` 用户 → `profiles.plan = pro`
- [ ] 旧 `enterprise` 用户 → `profiles.plan = pro`
- [ ] 旧 `free` 用户保持 `free`
- [ ] 旧 `pro` 用户保持 `pro`

---

## 20. 下一阶段建议执行顺序

### 20.1 审计与确认（已完成）

1. ✅ Phase 5 收尾审计
2. ✅ 确认 0007 migration 内容
3. ✅ 全局搜索 team / enterprise 残留
4. ✅ lint / typecheck / build 通过

### 20.2 部署前操作（按依赖顺序）

5. 审计结果确认（本文档）
6. 检查 / 确认 0007 migration 内容
7. commit Pricing Migration（16 个 modified + 2 个 untracked）
8. push 到远程仓库

### 20.3 Stripe Dashboard 配置（需先于部署）

9. 在 Stripe Dashboard 创建 Lite Product + Price（$9.9/月，recurring）
10. 在 Stripe Dashboard 创建 Pro Product + Price（$29.9/月，recurring）
11. 处理旧 team / enterprise 用户的 subscription（迁移到 Pro Price 或通知重新订阅）
12. 复制 Lite / Pro 的 Price ID

### 20.4 Vercel 环境变量配置

13. 配置 `STRIPE_SECRET_KEY`
14. 配置 `STRIPE_PRICE_LITE`
15. 配置 `STRIPE_PRICE_PRO`
16. 配置 `NEXT_PUBLIC_APP_URL`（生产域名）
17. 确认 `NEXT_PUBLIC_ENABLE_AUTH=true`
18. 确认 `SUPABASE_SERVICE_ROLE_KEY` 已配置

### 20.5 数据库 migration

19. 在生产 Supabase SQL Editor 中执行 `supabase/migrations/0007_pricing_migration.sql`
20. 验证 `profiles.plan` CHECK 已更新为 `free / lite / pro`
21. 验证 `plan_limits` 表存在 `free / lite / pro` 三行，无 `team / enterprise`
22. 验证旧 team / enterprise 用户已迁移到 pro

### 20.6 部署

23. Vercel 部署（自动或手动触发）
24. 确认生产环境可访问

### 20.7 Stripe Webhook 配置（需部署后）

25. 在 Stripe Dashboard 创建 Webhook endpoint（`https://<domain>/api/webhooks/stripe`）
26. 订阅 `checkout.session.completed` / `customer.subscription.updated` / `customer.subscription.deleted`
27. 复制 Signing secret 到 Vercel `STRIPE_WEBHOOK_SECRET`
28. 重新部署 Vercel 使环境变量生效

### 20.8 生产验收测试

29. 测试 Free 用户权限
30. 测试 Lite $9.9 完整 checkout 流程
31. 测试 Pro $29.9 完整 checkout 流程
32. 测试 Stripe Webhook 正确写入 profiles
33. 测试订阅取消降级（Pro → Free）
34. 测试旧 team / enterprise 用户已迁移到 pro
35. 最终生产验收

---

## 附录：关键文件路径速查

| 文件 | 用途 |
|---|---|
| [src/lib/billing.ts](file:///Users/boomcaca/projects/SeeO/src/lib/billing.ts) | 套餐配置真实来源（PLAN_DISPLAY_INFO / DEFAULT_PLAN_LIMITS / FEATURE_PLAN_GATE / PLAN_RANK） |
| [src/lib/stripe.ts](file:///Users/boomcaca/projects/SeeO/src/lib/stripe.ts) | Stripe client + Price ID 映射（getStripePriceId） |
| [src/lib/guards.ts](file:///Users/boomcaca/projects/SeeO/src/lib/guards.ts) | 统一权限入口（requireFeature / requireQuota / requirePlanLimit） |
| [src/app/api/checkout/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/checkout/route.ts) | Stripe Checkout Session 创建 |
| [src/app/api/webhooks/stripe/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/webhooks/stripe/route.ts) | Stripe Webhook 处理 |
| [src/app/api/backlinks/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/backlinks/route.ts) | Phase 5 修复：新增 backlinks Feature Gate |
| [src/app/api/reports/pdf/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/reports/pdf/route.ts) | PDF 导出权限校验 |
| [src/app/api/audit/start/route.ts](file:///Users/boomcaca/projects/SeeO/src/app/api/audit/start/route.ts) | full_audit Feature Gate |
| [src/app/pricing/page.tsx](file:///Users/boomcaca/projects/SeeO/src/app/pricing/page.tsx) | Pricing 页面 |
| [src/components/billing/UpgradeModal.tsx](file:///Users/boomcaca/projects/SeeO/src/components/billing/UpgradeModal.tsx) | 升级弹窗 |
| [supabase/migrations/0007_pricing_migration.sql](file:///Users/boomcaca/projects/SeeO/supabase/migrations/0007_pricing_migration.sql) | 数据库 Pricing Migration |

---

**文档生成时间：** Phase 5 收尾审计
**Pricing Migration 状态：** 代码已完成，待 commit / 部署 / 配置生产环境
