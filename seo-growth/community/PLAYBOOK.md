# G｜社区 Playbook（Reddit / Indie Hackers / LinkedIn / X / Product Hunt）

**单一事实来源**
- Community Master（账号与定位）：`seo-growth/community-master.csv`
- 发布记录（唯一发布库）：`seo-growth/community-posts.csv`
- 内容主库（**不是这里**）：`seo-growth/content-bank.csv`（F）
- 写作格式（**不是这里**）：`seo-growth/content/CHANNEL_PLAYBOOK.md`（F）

本文件只负责**社区维度**：账号、规则、自我推广许可、CTA 强度、频率、以及
「从 F 的某条主题 → 某个社区的帖子」的适配流程。
**不重复定义写作格式**，避免出现第二套内容体系。

> ⚠️ 规则诚实性：目前**没有任何一个平台的社区规则被实际核对过**。
> `community-master.csv` 的 `rules_checked_at` 全部为空，`self_promo_notes` 全部写
> `Needs Manual Check`。**发帖前必须逐个打开社区规则确认**，不得假设允许自我推广。

---

## 一、每天的工作流

```bash
# 1) 从 F 选一条内容
npm run content -- list --status=Ready

# 2) 看它在各平台该怎么发（社区契合度）
npm run community -- fit C005

# 3) 生成带 UTM 的落地链接
npm run community -- link C005 --platform=reddit --path=/

# 4) 准备发布：先登记一条记录
npm run community -- add C005 --platform=reddit --community=r/SEO --cta=free_audit

# 5) 真正发出去之后，回填 URL
npm run community -- publish C005-R1 --url="https://www.reddit.com/r/SEO/comments/..."

# 6) 以后查：这个主题都在哪发过
npm run community -- posts --content=C005
```

`post_id` 命名约定：`<content_id>-<平台缩写>-<序号>`，例如 `C005-R1`（Reddit 第 1 条）。

---

## 二、Reddit

**写作格式**：沿用 F 的 `CHANNEL_PLAYBOOK.md` → Reddit 段
（问题 → 具体观察 → 实用解释 → 示例 → 可选 SeeO context）。

**社区维度规则**

| 项 | 规则 |
|---|---|
| topic_type | 用 F 的 13 种 content_type（见 `fit` 命令输出） |
| community_fit | `strong`（SEO Problem / Audit Insight / Technical SEO / Affiliate SEO / Website Growth 最契合） |
| self_promo_allowed | **Needs Manual Check** —— 每个 subreddit 规则不同，必须看侧栏 |
| cta_level | 默认 `soft`；纯教育类（SEO Education）用 `none` |

**绝对禁止**：把帖子写广告、同一帖复制到多个 subreddit、自动发帖、自动评论、
自动 DM、购买账号、制造假身份、伪造案例、编造数据。

**选题建议**：优先 `r/SEO`、`r/TechSEO`、`r/bigseo`、`r/SaaS`，但**发帖前**才决定，
并且先看该社区最近在讨论什么——不要按日历硬凑。

---

## 三、Indie Hackers

**写作格式**：沿用 F → Indie Hackers 段
（Problem → What we observed → What we built → What we learned → Practical takeaway）。

**社区维度规则**

| 项 | 规则 |
|---|---|
| community_fit | `strong`：SaaS SEO / Website Growth / Founder Insight |
| self_promo_allowed | **Needs Manual Check** |
| cta_level | `soft`（把链接放进 build 语境里，不做独立 CTA 段） |

**不要**把每个帖子都写成「我做了 SeeO，来试试」。以真实进展和踩坑为节奏。
不得虚构增长数字、收入数据、客户数量。

---

## 四、LinkedIn

**写作格式**：沿用 F → LinkedIn 段
（Hook → Observation → 3 points → Takeaway → soft CTA）。

**社区维度规则**

| 项 | 规则 |
|---|---|
| community_fit | `strong`：SEO Problem / SEO Education / Audit Insight / Competitor SEO / SaaS SEO / Website Growth / Founder Insight |
| self_promo_allowed | **Needs Manual Check** |
| cta_level | `soft` |

**禁止**：夸张流量数字、虚假客户案例、虚假收入、虚假专家身份。
外链通常会压低触达——**优先把洞察写在正文**，链接只作为结尾补充。

---

## 五、X

**写作格式**：沿用 F → X 段（Observation → Explanation → Example → CTA）。
一条 F 主题可以派生成：**1 条短帖** 或 **3–7 条 thread**（同一主题不要同日既发短帖又发 thread）。

**社区维度规则**

| 项 | 规则 |
|---|---|
| community_fit | `strong`：SEO Problem / Audit Insight / Founder Insight |
| self_promo_allowed | **Needs Manual Check** |
| cta_level | `soft`（整个 thread 最多一次 CTA） |

**禁止**：自动发帖、自动 follow、自动 DM、点赞机器人、批量重复。

---

## 六、Product Hunt

本轮**只准备素材，不 Launch**。素材见 `PRODUCT_HUNT_KIT.md`。

| 项 | 规则 |
|---|---|
| community_fit | `strong`：Product Education |
| self_promo_allowed | **Needs Manual Check** —— launch 当天规则需现场核对 |
| cta_level | `soft` |

描述必须与站点/C 的既有描述一致，**不另起一套产品描述**。

---

## 七、CTA 与归因

CTA 只能取 F 的 CTA 库（`src/lib/content/ctas.ts`）。
社区第一目标是**访问 → 免费审计 → 注册**，不是即时付费：不用 `Buy now` / `Upgrade now`。

链接由 `npm run community -- link` 生成，复用 B 的 attribution：

| 平台 | utm_source | utm_medium | utm_campaign |
|---|---|---|---|
| Reddit | `reddit` | `community` | `community` |
| Indie Hackers | `indiehackers` | `community` | `community` |
| LinkedIn | `linkedin` | `community` | `community` |
| X | `x` | `community` | `community` |
| Product Hunt | `producthunt` | `launch` | `launch` |

再加 `utm_content=<content_id>`，就能在 B 的漏斗里把社区流量回溯到具体主题。
**G 不建立第二套 analytics。**

---

## 八、与 E（潜客库）的边界

G **不存**任何潜客联系方式。Community Master 只记录公开的账号信息与内部内容状态。
如果有人从社区私信里留下邮箱，**记到 E 的 Lead Master**，不要写进这里的任何文件。
