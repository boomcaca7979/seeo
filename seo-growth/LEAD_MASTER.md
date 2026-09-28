# E｜潜客数据库（Lead Master）

**唯一主库：`seo-growth/leads.csv`**

只有这一个文件是潜客主库。同目录下的 `outreach-crm.csv` / `directory-crm.csv` / `resource-pages.csv`
是**外链与目录提交跟踪表**（目标站是 G2、Capterra、ProductHunt、竞品博客等用来获取外链的站点），
**不是潜客**，不要与 leads.csv 合并，也不要把潜客写进那几个文件。

> 隐私：`leads.csv` 含真实联系人邮箱，已被 `.gitignore` 屏蔽，不会进 Git、不会进任何页面或 client bundle。
> 本目录的 E 模块（`src/lib/leads/`）只允许服务端/脚本使用，有守卫测试禁止被任何页面或客户端组件引用。

---

## 一、每天怎么用

```bash
# 1) 今天该跟进谁
npm run leads -- due

# 2) 录入一个新潜客（lead-type 可随手写，会自动收敛到标准值）
npm run leads -- add \
  --website="https://www.example.com/" \
  --email="yuki@example.com" \
  --lead-type="saas company" \
  --specific-issue="Duplicate title tags on /pricing and /" \
  --source=reddit \
  --template=A_website_issue_v1 \
  --company="Example Inc" --contact="Yuki" --role="Founder"

# 3) 发完首封 / 跟进后改状态
npm run leads -- update L0HPSCTX --status=Contacted --next-followup=2026-10-02
npm run leads -- update L0HPSCTX --status="Follow-up 1"

# 4) 对方要求别再联系
npm run leads -- suppress L0HPSCTX --reason="asked to stop"

# 5) 查 / 筛
npm run leads -- list
npm run leads -- list --status=Contacted
npm run leads -- show L0HPSCTX
```

也可以直接用表格软件打开 `seo-growth/leads.csv` 批量查看与筛选；
但**新增和状态变更建议走上面的命令**，因为去重与状态机只在命令里强制。

---

## 二、字段

| 组 | 字段 |
|---|---|
| identity | lead_id, website, company, contact_name, email, role |
| classification | lead_type, company_size, industry |
| SEO | specific_issue, issue_type, audit_url, audit_date |
| marketing | source, campaign, template, utm_content, first_contacted_at, last_contacted_at, next_followup_at |
| pipeline | status, reply_status, interest, signup, activation, paid |
| notes | last_action, next_action, notes, created_at, updated_at |

日期字段统一 `YYYY-MM-DD`；`created_at` / `updated_at` 为 ISO 时间戳（自动维护）。
`interest` / `signup` / `activation` / `paid` 取值为空（未知）/ `yes` / `no`。

---

## 三、Lead Type（只能填这 9 个）

`SaaS` · `Agency` · `SEO Freelancer` · `Blog` · `Affiliate` · `Ecommerce` · `Content Site` · `Startup` · `Other`

随手写法会自动收敛：`saas` / `software` / `SaaS company` → `SaaS`；`SEO agency` → `Agency`；
`freelancer` / `consultant` → `SEO Freelancer`；`e-commerce` / `online store` → `Ecommerce`。
识别不了的值会被**拒绝**并要求人工选择，不会偷偷记成 `Other`。

---

## 四、Status（状态含义固定）

| 状态 | 含义 |
|---|---|
| New | 刚发现，还没看 |
| Researching | 正在看它的网站，还没找到具体问题 |
| Ready to Contact | 已确认具体问题，可以发首封了 |
| Contacted | **已经发出首封邮件** |
| Follow-up 1 | **已经发出第一次跟进** |
| Follow-up 2 | 已经发出第二次跟进（序列到此结束） |
| Replied | 对方回复了，**不代表有兴趣** |
| Interested | 明确表现出兴趣 |
| Trial | 已开始试用 |
| Activated | 已完成首次激活（跑过审计等核心动作） |
| Paid | 已付费 |
| Not Interested | 明确无兴趣 |
| No Response | 序列走完仍无回复 |
| Suppressed | 要求停止联系 —— **终态，任何自动化都不再碰** |

允许的迁移在 `src/lib/leads/schema.ts` 的 `STATUS_TRANSITIONS`；不在表里的一律拒绝。
硬性前置：**没有 `specific_issue` 不能进入 `Contacted`** —— 没亲眼确认过问题就不能发。

---

## 五、跟进队列规则

进入队列的条件：`status` 为 `Contacted` 或 `Follow-up 1`，且 `next_followup_at` 已到期。

永不进队列：`New`、`Researching`、`Ready to Contact`、`Replied`、`Interested`、`Trial`、
`Activated`、`Paid`、`Not Interested`、`No Response`、`Suppressed`。

---

## 六、邮件模板（复用 C，不另造）

`template` 只能填 C 阶段已注册的 ID：

`A_website_issue_v1` · `B_free_audit_v1` · `C_followup1_v1` · `D_followup2_v1` ·
`E_saas_founder_v1` · `F_agency_v1` · `G_content_site_v1`

模板正文在 `src/lib/email/templates/cold-outreach.ts`。本模块只记录用了哪个模板，不发送任何邮件。

---

## 七、归因（复用 B/C，不建第二套）

`audit_url` 自动生成，固定为：

```
utm_source=email & utm_medium=outbound & utm_campaign=cold_email & utm_content=<template>
```

E 只负责保存 `source` / `campaign` / `template` / `utm_content`，
访问→审计→注册→激活→付费的链路仍由 B 的 analytics 归因。

---

## 八、去重

按「归一化域名 + 归一化邮箱」判定：

- `www.example.com` / `example.com` / `http://example.com:8080/x` → 同一站点
- `Yuki@Example.com` / `yuki@example.com` → 同一邮箱
- 同域名且邮箱相同（或一方缺失）→ **拒绝新增**，提示去更新已有那条
- 同域名但邮箱不同且都非空 → 允许，但**打印告警**（确属不同联系人再保留）
