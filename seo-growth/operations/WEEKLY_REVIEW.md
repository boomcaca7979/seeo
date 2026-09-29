# Weekly Review — 模板

> **每周一份，只回答下面的问题。**
> 只根据真实记录（`daily-log.csv`）与 B 的真实数据描述。
>
> **不要做**：渠道评分、"哪个渠道最好"、虚构 ROI、样本不足就下结论。
> **不要**把估算写成事实；没有数据就写"没有数据"。

本周区间：`YYYY-MM-DD` → `YYYY-MM-DD`
记录天数：`__`
数据来源：运营动作来自 `daily-log.csv`；用户行为来自 **B**（标注 `[B]` 的数字）

---

## What did we do?

（从 `npm run ops -- weekly` 抄录：新目标 / outreach / follow-up / 社区互动 / 内容发布 / 正面回复）

```text
new_leads =
outreach_sent =
followups_sent =
community_interactions =
content_published =
positive_replies =
```

值得记下的具体动作（做了哪几件事、针对哪些问题）：

-
-

## What generated traffic?  `[B]`

（按 source 看：organic / direct / community / email / producthunt / referral / other）

```text
来源            会话/页面浏览          备注（哪一条内容或互动带来了它）
```

## What generated signup?  `[B]`

```text
signup_completed =
来源归因（如有）=
```

## What generated activation?  `[B]`

```text
activation_completed =
```

## What generated payment?  `[B]`

```text
payment_completed =
```

> 若上面三项没有数据：**写"没有数据"，不要填 0 以外的估计值。**

## What received no response?

（列出没有得到回复的 outreach / 社区互动，以及它们的共同点）

-

## Which topic/problem generated meaningful engagement?

（哪个主题或问题真正引发了对话或点击；没有就写"没有"）

-

## What should we repeat next week?

（只写**有记录支持**的动作；不要写成增长承诺）

-

---

## 未完成项目

（`npm run ops -- weekly` 会对比起始配额列出缺口）

-

## 需要人工确认的事项

- [ ] 三个结果类计数确实来自 B，且已在 daily-log 的 `notes` 标注 `[B]`
- [ ] `community-posts.csv` 里每一条 Published 都真的发布过（有 `url` 与 `published_at`）
- [ ] 没有新增第二份数据源（潜客 / 内容 / 社区 / 案例 / SEO 落地页 / analytics）
- [ ] 没有触发任何自动发送 / 自动发帖 / 自动抓取 / 自动邀请
