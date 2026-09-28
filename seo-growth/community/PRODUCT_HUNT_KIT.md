# G｜Product Hunt 素材包（**不 Launch**）

> 本轮只准备素材。不提交、不预热、不发评论、不邀请任何用户投票。
> 素材必须与站点 / C 阶段保持一致 —— 描述的唯一长文来源是站上文案
> `messages/en.json → meta.siteDescription`，本文件不另起一套产品描述。
> 禁止 "Best" / "#1" / "revolutionary" 等无证据说法。

---

## 1. Product name

```
SeeO
```

## 2. Tagline（60 字符以内）

```
SEO audits, rank tracking and keyword research in one workbench
```

备选（同为事实陈述，不夸大）：

```
Technical SEO audits plus rank and keyword tracking, in one place
```

## 3. Positioning（统一口径，与 Community Master 一致）

```
Affordable SEO tools for site owners, founders, and SEO practitioners.
```

## 4. Description（与站上 `meta.siteDescription` 完全一致）

```
SeeO is an all-in-one SEO analytics platform: keyword research, rank tracking, technical SEO audits, competitor analysis, content optimization, and backlink analysis.
```

补充一段（说明它解决什么问题，不夸大）：

```
Most SEO workflows are split across separate tools — a crawler here, a rank tracker there, a keyword tool somewhere else. SeeO puts audits, rank tracking, keyword research, competitor and backlink analysis in one workbench, so the data moves between modules without exports.
```

## 5. Maker bio

> ⚠️ **Needs Manual Check**：这里不填任何虚构身份、公司、团队规模或从业年限。
> 请由你本人填写真实身份与背景后再使用。

```
[FILL IN: your real name]
[FILL IN: what you actually do — e.g. "independent developer, building SeeO"]
[FILL IN: how to reach you publicly — the contact page https://www.seeo.asia/contact]
```

禁止填写：虚构公司主体、员工数量、客户数量、收入、奖项、"ex-Google" 之类头衔。

## 6. First comment（launch 当天由 maker 自己发）

```
Hi everyone — maker here.

I built SeeO because I kept repeating the same loop: run an audit somewhere, check rankings somewhere else, then dig through keyword tools to decide what to write next. SeeO puts those in one workbench so the output of one step feeds the next.

What it does today:
- Technical audit: crawls a site, runs the checks (titles, descriptions, canonicals, redirects, sitemap, internal links, structured data and more), and lists the affected pages per issue
- Rank tracking: positions over time, by location and device
- Keyword research: expand a seed keyword into related terms
- Competitor analysis: compare rankings and share of voice
- Content optimization: check a page against the current top results
- Backlink analysis: referring domains and anchor text distribution

There is a free plan that covers the audit, and a free audit you can run without an account.

Happy to answer anything about how the audit checks work, or where the data comes from — it is all documented on the site.
```

## 7. FAQ（launch 页面/评论区用，答案均为事实）

**Q: Is there a free plan?**
A: Yes. The free plan includes 2 projects, 3 tracked keywords and 3 audits per day. Paid plans raise those limits and add report exports.

**Q: Do I need an account to run an audit?**
A: No — you can run a free audit without signing up.

**Q: Where does the data come from?**
A: Depending on the module: our crawler for technical audits, a search API for rankings and SERP data, Google Search Console when you connect it, and a backlink data provider for referring domains. The docs page lists this per feature.

**Q: Does it replace my existing SEO tools?**
A: Not necessarily. It is designed so the audit, keyword, ranking, competitor and content steps share one data set. If you already have deeper tools, SeeO is a reasonable first pass before a deeper crawl.

**Q: Is it only for large sites?**
A: No. The free plan targets small sites; the limits are published on the pricing page.

## 8. Screenshot checklist

已有素材可直接复用（**不必重新截图**）：`seo-growth/directory-assets/screenshots/`

| # | 用途 | 现有文件 | 状态 |
|---|---|---|---|
| 01 | 工作台总览 | `01-dashboard.png` | 已存在 |
| 02 | 技术 SEO 审计 | `02-seo-audit.png` | 已存在 |
| 03 | 排名追踪 | `03-rank-tracking.png` | 已存在 |
| 04 | 竞品分析 | `04-competitor-analysis.png` | 已存在 |
| 05 | 内容优化 | `05-content-optimization.png` | 已存在 |
| 06 | 报告 | `06-seo-report.png` | 已存在 |

发布前需人工确认（**尚未确认**）：

- [ ] Needs Manual Check — 每张图里不含真实用户邮箱、域名或客户数据
- [ ] Needs Manual Check — 展示的数字与真实产品一致（不得用演示数字冒充真实数据）
- [ ] Needs Manual Check — 尺寸符合 Product Hunt 当天的展示要求

## 9. Launch CTA

使用 F 的 CTA 库，不用 `Buy now` / `Upgrade now`：

```
Try it on your own site          （CTA id: try_on_your_site）
```

链接（复用 B 的 attribution，`utm_content` 指向具体内容主题）：

```
https://www.seeo.asia/?utm_source=producthunt&utm_medium=launch&utm_campaign=launch
```

## 10. 与 C / F 的一致性检查

- 长描述 = `messages/en.json → meta.siteDescription`（**逐字一致**，有测试强制）
- 定位句 = Community Master 的 `positioning` 字段（同一句）
- CTA = F 的 CTA 库 id
- 功能清单 = C 阶段 `feature_education_v1` 邮件里列出的六个模块

若上述任一处需要改动，**改一处并同步**，不要产生第二套描述。
