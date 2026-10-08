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

# 5) 历史批量写入的 Contacted 对账（默认 dry-run，加 --apply 才写）
npm run leads -- backfill-contacted
npm run leads -- backfill-contacted --apply

# 6) 与 Resend 权威发件记录对账（默认 dry-run，加 --apply 才写）
npm run leads -- reconcile-ledger
npm run leads -- reconcile-ledger --apply

# 7) 收到垃圾邮件投诉（= 明确拒绝）→ 立即压制
npm run leads -- suppress-complaint <lead_id>

# 8) 查 / 筛
npm run leads -- list
npm run leads -- list --status=Contacted
npm run leads -- show L0HPSCTX
```

也可以直接用表格软件打开 `seo-growth/leads.csv` 批量查看与筛选；
但**新增和状态变更建议走上面的命令**，因为去重与状态机只在命令里强制
（手工直接改 CSV 会绕过状态机 —— 2026-09-29 的 Day 1 批次就是这么来的）。

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

### 唯一合法进入 `Contacted` 的路径

`New → Ready to Contact → Contacted`（两次 `update`，中间那次要求 `specific_issue`）。
`add --status=Contacted` 会被**直接拒绝**（2026-10-08 起）：批量新建一条 `Contacted`
正是 2026-09-29 Day 1 批次绕过状态机的写法，这个口子已封。

### 历史批量写入的豁免（`backfill-contacted`）

2026-09-29 的 76 条是**批量直接写入** `Contacted` 的：发送是真的（Resend 有
delivered / bounced 记录），但没有经过状态机，而且这批行都**没有记录 `template`**。

处理方式是对账，不是补写事实：

```bash
npm run leads -- backfill-contacted          # dry-run：只算不写（默认）
npm run leads -- backfill-contacted --apply   # 写库
```

它只做三件事，且**幂等**（重跑写 0 行，靠 `notes` 里的 `[reconcile-contacted]` 标记判断）：

| 情况 | 动作 |
|---|---|
| 有真实触达事实（两个触达日期 + 发送记录）但状态还没到 `Contacted` | 把 `status` 补成 `Contacted` |
| 有事实、状态已在 `Contacted` 及之后、但没有 `template` | 在 `notes` 追加**历史豁免**记录（证明这行是批量写入的） |
| 没有任何触达事实（普通 `New`） | **一律不动** —— 绝不自动升级 |

绝不修改 `first_contacted_at` / `last_contacted_at` / `next_followup_at` / `last_action`，
绝不新增一次发送，也**绝不虚构 `template`**（没有证据就是没有）。
`Suppressed` / `Not Interested` / `No Response` 是对账冻结状态，一字不改。

机器可读实现是 `src/lib/leads/reconcile.ts`（唯一一份）；`ops -- doctor` 会持续校验
「有触达事实的行状态是否已经跟上」，防止再次出现批量绕过。

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

### ⚠️ 只按主库字段去重是不够的（2026-10-08 修正）

主库的 `email` / `website` 两个字段**不足以**支撑去重，实测：

- 有若干 `Contacted` 行的 `email` 为空，但 Resend 里确有真实收件地址；
- 另有若干行的「主库 `website` 域名」与「实际收件域名」不是同一个域
  （例如主库记的是 A 域、邮件实际发到 B 域；也有主库记产品域名、邮件发到公司域的情况）。

结果就是按主库字段去重会漏掉**已经联系过的人** —— 2026-09-29 的 NodePing 重复发送正是这么来的。

**所以真正的去重基有两个，缺一不可**：

1. 主库自身（域名 / 邮箱）
2. **Send Ledger**：`seo-growth/send-ledger.csv`（Resend 实际发件记录）

---

## 九、Send Ledger：历史 outreach 的最高可信来源

**`seo-growth/send-ledger.csv`**（与 `leads.csv` 同级敏感，同样被 `.gitignore` 屏蔽）。
它不是第二份潜客库 —— 它是**银行对账单**：定期从 Resend 导出，只读、只用于对账与去重。

| 列 | 含义 |
|---|---|
| resend_id | Resend 的邮件 ID（与主库 `notes` 里记录的一致，用于精确挂接） |
| sent_at | 发送时间（ISO，保留原始精度） |
| recipient | **真实收件地址** |
| kind | `outreach`（冷启动外发）/ `lifecycle`（产品/生命周期邮件，**不算**潜客触达） |
| status | `delivered` / `bounced` / `complained` / `sent` / `failed` |
| subject | 主题（人工核对用） |

### 对账规则（`npm run leads -- reconcile-ledger`）

只做三件事，且**幂等**（重跑写 0 行，靠 `notes` 里的 `[send-ledger]` 标记判断）：

| 情况 | 动作 |
|---|---|
| 主库 `email` 为空，但 ledger 有真实 recipient | **回填真实 email** |
| 收件域名 ≠ 主库 `website` 域名 | 只在 `notes` 记录 `recipient domain mismatch`，**不修改 `website`** |
| ledger 记录为 `bounced` | 记 `reply_status=bounced` |
| 主库声称已触达但 ledger 里找不到记录 | 报 `unmatched`，**绝不反向补 `Contacted`** |
| 同一 recipient 被发送多次 | 报 `duplicate`（计数不合并） |
| ledger 记录为 `complained` | 报 `complaint` → 必须压制（见 §十一） |

**绝不修改** `website` / `status` / `template` / `first_contacted_at` / `last_contacted_at`，
**绝不**新增发送次数，**绝不**替没有证据的行填 `template`。
机器可读实现是 `src/lib/leads/send-ledger.ts`（唯一一份）；`ops -- doctor` 会持续校验主库与 ledger 是否一致。

---

## 十、只能发到「官网公开显示」的邮箱

**规则：只能发送到对方官网真实公开显示过的邮箱。地址本身没在公开网页上出现，就不得发送。**

允许的来源（必须是公开可核验的）：

- 官网公开的 `mailto:` 链接
- 官网 Contact / About / Support 页面明确显示的邮箱
- 官网公开的企业联系人信息（含 Imprint / Legal notice）

禁止的来源：

- 按域名模式推测（`info@domain`、`hello@domain`、`sales@domain` …）
- 根据域名或公司名猜测联系人姓名生成邮箱
- 第三方邮箱数据库 / 买名单
- 爬取邮箱（scrape / harvest）
- 任何未在公开网页上真实显示过的地址

### 怎么执行（可被机器检查）

录入时必须把「这个地址在哪个公开页面可见」写进 `notes`：

```
public-email:https://example.com/contact
```

- 没有 `public-email:<url>` 证据的行，**视为猜测**；
- `info@` / `hello@` / `sales@` 这类**通用角色前缀本身不违规** —— 官网自己印在 Contact 页上就完全合规；
  但用了这些前缀就**必须**有公开来源证据。

`ops -- doctor` 会对「即将发送」的行（`New` / `Researching` / `Ready to Contact`）与
规则生效日（`2026-10-09`）之后已发送的行做自检；此前的历史行不追溯。
规则本体（含允许/禁止来源清单）在 `src/lib/leads/prospecting-rules.ts`。

> 背景：2026-09-29 批次里至少有 2 封发给了**凭空构造**的地址 —— 对方站点上完全没有公开邮箱
> （只有 web form）。这违反 `src/lib/email/templates/cold-outreach.ts` 开头自己写下的边界
> 「不买名单、不爬邮箱：一次一封，面向真实收集到的联系人」。此规则即为此而设。

---

## 十一、投诉 = 明确拒绝（永久压制）

如果收件人把邮件标成垃圾邮件（Resend 的 `complained`），**等同于明确拒绝**：

```bash
npm run leads -- suppress-complaint <lead_id>
```

它会走官方状态机（`Contacted → Suppressed`），把标准句子**追加**到 `notes`
（不覆盖原有证据链），并清空 `next_followup_at`：

```
[complaint] Recipient marked message as spam; permanently suppress future outreach.
```

之后该 Lead 永久排除出 due / follow-up / candidate 查询（`Suppressed` 是终态）。
`ops -- doctor` 会校验「每一条 `complained` 记录对应的 Lead 都确实被压制且不可再被跟进」。

---

## 十二、候选池来源

允许用公开的 startup / SaaS / SMB 公司目录来**发现候选公司**，但目录只负责提供
`company + domain`，**不负责提供邮箱**。

`source` 必须可追溯，形如：

```
public-directory:<source-name>
```

每个候选进入 `Ready to Contact` 之前，必须逐项通过：

`website` → `public email`（含 `public-email:<url>` 证据）→ `specific SEO issue` →
`issue evidence` → `sitemap verification`（走完 6 步，禁止用 `/sitemap.xml` 404 断言无 sitemap）→
`dedupe against Lead Master` → `dedupe against authoritative Resend send history`

机器可读清单见 `src/lib/leads/prospecting-rules.ts` 的 `CANDIDATE_VERIFICATION_STEPS`
与 `DAY2_SEND_GATES`。
