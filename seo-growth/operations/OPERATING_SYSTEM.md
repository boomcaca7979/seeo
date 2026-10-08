# L｜Daily Marketing Operating System（唯一 canonical 运营文档）

> 本文件是**运营层的唯一规则文档**。不要另建第二份运营规则或运营 SOP。
> 机器可读部分在 `src/lib/operations/index.ts`（配额、schema、来源清单、体检规则），
> 两者描述同一件事；`npm run ops -- doctor` 会校验数据与引用是否自洽。

**本阶段只建立运营系统，不执行任何真实营销动作。**
没有发信、没有发帖、没有抓取联系人、没有邀请、没有 Launch。下面所有动作都由人工执行。

---

## ⛔ 当前状态：Outreach 发送暂停（自 2026-10-08）

机器可读开关：`OUTREACH_SEND_HOLD`（`src/lib/operations/index.ts`），当前 `active = true`。
`npm run ops -- today` / `ops -- doctor` 会显著提示。

**暂停期间：不发新的 cold outreach、不回复、不发 follow-up。**

事由：2026-10-02 Filebase 回复指出我们的「no sitemap」判定是错的 —— prospecting 把
`/sitemap.xml` 返回 404 直接当成「站点没有 sitemap」，而对方 `robots.txt` 明确声明了
`sitemap-index.xml`（HTTP 200 / 有效 sitemapindex）。规则缺陷已修正（见 §2.1），
已发批次已复核（见 `SITEMAP_FALSE_POSITIVE_REVIEW.md`）。

**恢复发送必须由用户显式把 `active` 改回 `false`**，不得由任何自动化或脚本代改。

---

## 0. 数据来源：只读，不重建

运营层**不拥有任何数据**。它只读下面这些已经存在的唯一来源：

| 维度 | 唯一来源 | 谁拥有 |
|---|---|---|
| 潜客 | `seo-growth/leads.csv` | E |
| 内容 | `seo-growth/content-bank.csv` | F |
| 社区主库 / 发布记录 | `seo-growth/community-master.csv`、`seo-growth/community-posts.csv` | G |
| 案例 | `seo-growth/case-studies.csv` | I |
| SEO 落地页 | `seo-growth/seo-landing-master.csv` | H |
| 真实用户行为 | B 的 analytics（`analytics_identities` + 事件） | B |
| Product Hunt 素材 | `seo-growth/product-hunt/LAUNCH_KIT.md` | J |
| Referral 规则 | `seo-growth/referral/RULES.md` | K |
| 运营动作记录 | `seo-growth/operations/daily-log.csv` | **L（本层新建）** |

**禁止**新建 `daily-leads.csv`、第二份 content bank、第二份 community 记录、第二份案例库、
第二份 SEO 落地页清单或第二套 analytics。`doctor` 会检查 `seo-growth/` 下是否出现疑似第二份 Master。

---

## 1. 每日循环

```text
Find prospects → Personalize outreach → Follow up → Community participation
→ Publish one useful piece → Watch product activity → Record replies
→ Review analytics → Repeat
```

### 每日起始配额

| 动作 | 默认数量 |
|---|---:|
| 新目标用户 | 10 |
| 个性化 outreach | 10 |
| follow-up | 3–5 |
| 有价值社区互动 | 5 |
| 内容发布 | 1 |
| 用户回复处理 | 全部 |
| Analytics review | 10 分钟 |

> **这是起始运营配额，不是成功承诺、KPI 或增长/营收预测。**
> 完成与否只描述"动作量"，不代表任何结果。

`npm run ops -- today` 会把上面这张表展开成当天清单（含 E 中到期的跟进），**只输出清单，不执行**。

---

## 2. 潜客流程（E 是唯一 Lead Master）

每日新增目标用户**只能写入** `seo-growth/leads.csv`。该表已有 31 列，运营关注字段对应关系：

| 运营字段 | leads.csv 中的列 | 说明 |
|---|---|---|
| date | `created_at` | 建档时间 |
| prospect | `lead_id` / `company` | 主体标识 |
| website | `website` | 目标站点 |
| source | `source` | 来源渠道 |
| problem_observed | `specific_issue` / `issue_type` | **必须先真实观察**出问题 |
| outreach_status | `status` | 见下方映射 |
| last_contact | `last_contacted_at` | 最近联系时间 |
| next_followup | `next_followup_at` | 下次跟进时间 |
| outcome | `interest` / `reply_status` / `signup` / `activation` / `paid` | 结果 |
| notes | `notes` | 备注 |

**运营口语状态 → E 的真实状态**（不新增第二套枚举，映射到 E 的既有值）：

| 运营口语 | E 的 status |
|---|---|
| new | `New` |
| contacted | `Contacted` |
| replied | `Replied` |
| interested | `Interested` |
| trial | `Trial` |
| activated | `Activated` |
| not_interested | `Not Interested` |
| no_response | `No Response` |
| do_not_contact | `Suppressed` |

规则：`Suppressed` 是终态；`New → Contacted` 必须经过 `Ready to Contact`（E 自身的状态机）。

**不得**创建虚假联系人，**不得**自动生成姓名、邮箱、职位或任何联系方式。

---

### 2.1 问题核验（写 `specific_issue` 之前必须做，禁止跳步）

**规则唯一来源：`src/lib/seo/sitemap-rules.ts`（产品层共享模块）**。
产品审计引擎（`src/lib/seo/site-reports.ts` 发现 + `src/lib/seo/audit-checks.ts` 出结论）
与运营层（`src/lib/operations/index.ts` re-export）都复用这一份，**不得在别处再写一套**。
机器可读名：`SITEMAP_VERIFICATION_STEPS` / `SITEMAP_VERDICT_RULES`；判定函数：`classifySitemap()`。

**红线：`/sitemap.xml` 返回 404 ≠ 站点没有 sitemap。**

判定「站点没有 sitemap」必须依次走完：

1. 请求 `/robots.txt`（跟随跳转，取最终响应体）
2. 提取其中所有 `Sitemap:` 行（大小写不敏感，可以有多条）
3. 逐个请求声明出来的 sitemap URL，记录 HTTP 状态
4. 若响应是 `sitemapindex`，继续抓取至少一个子 sitemap，确认能解析出 URL
5. `robots.txt` 未声明时，才走兜底：依次检查常见入口
   （`/sitemap.xml`、`/sitemap_index.xml`、`/sitemap-index.xml`、`/wp-sitemap.xml`、`/sitemap/`）
   与站点 HTML 的 `<link rel="sitemap">`
6. **只有以上全部确认不存在可发现的 sitemap**，才能标记 `NO SITEMAP`

判定映射（写 `issue_type` 时不得含糊）：

| 实际情况 | 正确的 issue_type |
|---|---|
| `/sitemap.xml` 404，但 robots.txt 声明了可用的 sitemap | **不是问题，不得发信** |
| robots.txt 声明了 `Sitemap:`，但该 URL 返回 4xx/5xx | `sitemap-invalid`（不是 `no-sitemap`） |
| robots.txt 未声明，且兜底入口也查不到 | `no-sitemap` |

核验必须发生在写 `specific_issue` 之前；**写不出 `robots.txt` 的实际内容，就不算核验过**。

---

## 3. Outreach 流程（C 是唯一发送基础）

三类可复用骨架：

| 类别 | 什么时候用 | 骨架 |
|---|---|---|
| `problem-led` | 观察到对方站点上的具体问题 | 指出真实可核验问题 → 说明为什么影响搜索表现 → 怎么自查 → 免费审计入口 → 不施压 |
| `audit-led` | 对方公开讨论过搜索流量/SEO 问题 | 引用对方公开说过的话 → 审计会查哪些项 → 免费审计入口 → 问是否愿意看结果 |
| `follow-up` | 首封后一段时间无回复 | 一句提醒 → 补一条**新的**有用信息 → 给退出选项 → 不再重复追 |

**核心原则：先指出真实问题 → 再提供帮助 → 再给 Free SEO Audit。** 缺少第一步就不算合格 outreach。

默认 CTA = **Free SEO Audit**，不强推付费；只有对方明确问付费能力时才谈套餐。

**禁止**：`Best SEO tool`、`#1 platform`、`revolutionary` 之类无证据断言；虚构客户案例/quote/使用体验/排名/流量/营收；群发同一条未个性化模板；声称"我看过你的站"但实际没看过。

**禁止（2026-10-08 增补，源自 Filebase 事件）**：仅凭 `/sitemap.xml` 返回 404 就断言对方
「没有 sitemap」。sitemap 类问题必须先走完 §2.1 的 6 步核验；核验不通过就不发信。

模板只是骨架，**实际发送必须人工个性化**，且 L 不含任何发送实现。

---

## 4. 内容流程（F 是唯一 Content Bank）

每天从 `seo-growth/content-bank.csv` 选**一个 `status = Ready`** 的主题。不得另建内容库。

每条内容记录：`topic` / `platform` / `hook` / `problem` / `useful_insight` / `cta` / `destination_url` / `utm` / `status`
（对应 F 的列：`title` / `channel_fit` / `core_point` / `problem` / `example` / `cta` / — / `utm` 由 B 的 contract 生成 / `status`）

优先围绕 H 的真实问题主题：duplicate title tags、missing canonical、pages not indexed、
broken internal links、sitemap errors、slow pages、thin content、orphan pages、keyword cannibalization。

**目标是帮用户解决真实 SEO 问题，不是每天发产品广告。**

---

## 5. 社区流程（G 是唯一 Community Master）

每日默认 **5 次有实际价值的互动**。"有价值"意味着：回答真实问题、提供具体信息、
不强贴链接、不复制粘贴同一宣传文、不伪装普通用户、不反复骚扰同一个人。

**只有上下文自然相关时才提及 SeeO。**

**只有真实发布过**才能写进 `seo-growth/community-posts.csv`（`status = Published` 必须同时有
`published_at` 与 `url`；`doctor` 会把缺少这两项的 Published 行判为疑似伪造发布记录）。

---

## 6. SEO 分发（H 已上线）

**不继续大规模新增 landing page。** 每周从 H 的 problem-intent 页面里选 **1–2 个**做外部分发：
社区讨论、内容引用、相关 outreach、内部链接、外部资源引用。

目标是**给已有 H 页面带真实相关流量**，不是无限增加页面数量。

---

## 7. 用户反馈 → 案例（I）

当前 `REAL CASE DATA = 0`，本文档必须保留这个事实。

出现真实用户反馈后，**只记录事实**：`problem` / `what they used` / `what changed` / `evidence` / `consent`。
没有证据**不得进入 Published**；不得为了营销需要制造案例。

---

## 8. Product Hunt（J）

当前状态：`REAL LAUNCH = NO`、`SUBMISSION = NO`、`UPVOTE REQUEST = NO`。

L 可以做的只有：累积真实反馈、累积真实使用、准备素材。
**禁止**自动 Launch、请求 upvote、伪造评论 / maker 身份 / 客户证据。

`ATTRIBUTION = NEEDS RECONCILIATION` 保持原样，**不在 L 中擅自解决**。

---

## 9. Referral（K）

K 保持基础能力：`REAL REFERRAL DATA = 0`、`REAL INVITES = 0`、`REAL REWARDS = 0`。

未挂载真实分享入口之前（`K-OPEN-3`），**不要把 referral 当作每天的主要运营渠道**。
K 的 open items **不在 L 中关闭**。

---

## 10. Analytics 复盘（B 是唯一事实来源）

每天只看核心漏斗，并**按 source 看**：

```text
page_view → audit_started → audit_completed → signup_completed → activation_completed
→ returning_user → pricing_viewed → upgrade_started → payment_completed
```

**Daily Log 只记录"我们做了什么"，不得替代 B 记录"用户发生了什么"。**
两侧数字不一致时**以 B 为准**。不要另建一套运营 analytics。

---

## 11. Daily Log

文件：`seo-growth/operations/daily-log.csv`，**一天一行**。

列：`date` / `new_leads` / `outreach_sent` / `followups_sent` / `community_interactions` /
`content_published` / `positive_replies` / `signup_count` / `activation_count` / `payment_count` / `notes`

**关于三个结果类计数（`signup_count` / `activation_count` / `payment_count`）：**

- 它们**必须来自 B**，不允许人工填"估计值"
- 有值时必须在 `notes` 里标注来源标记 **`[B]`**（`npm run ops -- log` 会在需要时自动补上）
- **没有数据就填 `0`，不要猜**

写入方式：`npm run ops -- log --date=YYYY-MM-DD --outreach=10 --notes="..."`。
同一天已有记录时会被拒绝（一天一行，请手工修订）。

---

## 12. Weekly Review

模板：`seo-growth/operations/WEEKLY_REVIEW.md`。每周只回答：

```text
What did we do?
What generated traffic?
What generated signup?
What generated activation?
What generated payment?
What received no response?
Which topic/problem generated meaningful engagement?
What should we repeat next week?
```

**不做**渠道评分、主观"最好渠道"、虚构 ROI、样本不足就下结论。
只根据真实记录与 B 数据描述。

`npm run ops -- weekly` 输出本周动作、B 来源结果与未完成项。

---

## 13. Operations CLI

```text
npm run ops -- doctor    文件 / schema / 引用 / 虚假记录 / 隐私 / 反自动化
npm run ops -- today     只输出今天要做什么
npm run ops -- weekly    本周动作 + B 来源结果 + 未完成项
npm run ops -- log       写入人工确认后的运营动作
```

`doctor` 会检查：文件是否存在、daily-log schema、E 的状态枚举、F/G/I/H 的引用有效性、
是否出现第二份 Master、是否伪造发布记录、运营文件是否被站点引用、
核心漏斗是否与 B 的契约一致、**以及模块内是否存在真实网络调用形态**。

---

## 14. 不允许自动执行（硬约束）

Operations 模块与脚本**不存在**任何自动：发邮件、DM、发帖、邀请、referral、Product Hunt、
upvote、抓取联系人。模块内**没有** `fetch` / `axios` / `webhook` 之类的真实调用。

L 是 **Operations System**，不是 **Marketing Bot**。它只做三件事：**记录、校验、提示**。

---

## 15. 隐私

运营数据**绝不进入公开站点**：

- `leads.csv`、`daily-log.csv`、社区发布记录、weekly review、Product Hunt 内部素材、referral 规则
  都**不是**公开资源
- 不进入 `sitemap`
- 不进入 client bundle
- 不被 `src/app` / `src/components` 引用

`doctor` 会校验这些。
