# I｜Case Study 固定模板

**唯一 Case Master：`seo-growth/case-studies.csv`**（32 列）

本文件是**录入模板**，不是第二份案例库。每得到一个真实结果，就按下面的结构往 Case Master 里填一行。

> 当前状态：**NO REAL CASE DATA YET**（Case Master 只有表头，0 条真实案例）
> 在拿到真实案例之前，不得创建任何公开页面、不得写任何"客户案例"文案、不得用占位案例演示。

---

## 一、录入顺序（从发现到可复用）

```
Lead/Candidate → Consent Pending → Evidence Pending → Draft → Review → Approved → Published
                                                                        └→ Archived
```

- **Lead**：只是"这个用户可能成为案例"，什么都还没确认
- **Consent Pending**：正在取得同意（没同意不得公开身份）
- **Evidence Pending**：同意有了，但证据还没拿到
- **Draft**：叙事写完，证据待补
- **Review**：证据齐了，等人工复核
- **Approved**：复核通过，可以在内部/一对一场景使用
- **Published**：已经在某个渠道真实发布

**没有证据不能进入 Approved；没有同意不得公开可识别身份。**

---

## 二、一张案例要填什么

```
CASE-[id]

Situation:            （用户是谁、什么类型的站点/业务）
Problem:              （challenge —— 具体问题，不要"SEO 不好"）
What we checked:      （seeo_used —— 用了 SeeO 的哪个真实能力）
What changed:         （actions_taken —— 用户实际做了什么修改）
Evidence:             （evidence_type + evidence_location —— 证据在哪）
Result:               （result + metric + before/after + result_period；没有就当 "no-result"）
Quote:                （quote / quote_original / quote_edited）
Consent:              （quote_consent / site_consent / logo_consent / anonymize_required）
Reusable Channels:    （channels）
Related Content:      （related_content —— F 的 content_id）
Related SEO Page:     （related_seo_page —— H 的真实页面路径）
Community Posts:      （community_posts —— G 的 post_id）
```

---

## 三、真实数据规则（最容易违反的一条）

| 允许的来源 | 说明 |
|---|---|
| User Provided | 用户自己提供的数字 |
| SeeO Audit | 导出/截图自 SeeO 审计结果 |
| GSC | Search Console 数据 |
| Product Analytics | SeeO 自己的 analytics（page_view / audit / signup 等） |
| Public Data | 公开可查的数据 |
| Public Review | 用户公开发表的评价 |

**禁止**：瞎猜、估算冒充真实、用 AI 生成数字、写"某 SaaS"/"某网站"/"典型客户"这类无法核实的假主体。

**没有结果数据怎么办**：不要把案例写成成功案例。把 `result` 填成 `no-result`（或"未产生可量化结果"），它仍然是一条有价值的 **Audit Example**。

**出现任何数字时**，`evidence_type` 必须是可支撑数字的类型，且 `evidence_location` 必须写明证据在哪。

---

## 四、同意与匿名

| 字段 | 取值 | 规则 |
|---|---|---|
| `anonymize_required` | yes | `website` 必须留空或写匿名描述（如 "B2B SaaS website"） |
| `site_consent` | yes / no / 空 | 公开可识别网站必须 `yes` |
| `logo_consent` | yes / no / 空 | 用 logo 必须 `yes` |
| `quote_consent` | yes / no / 空 | 公开引用必须 `yes`；**空 = 未同意 = 不得公开** |

**默认不公开身份**：只要没有明确写 `yes`，就当作没有同意。

---

## 五、引用处理

- 保留原文在 `quote_original`
- 如果需要润色：`quote_edited=yes`，并且**必须**保留 `quote_original`
- 不得改变原意、不得把多句话拼成新的语义、不得为了更像 testimonial 而加工
- `quote` 与 `quote_original` 不一致却没标 `quote_edited=yes` → 会被校验拒绝

---

## 六、本阶段明确不做的事

- ❌ 不创建 `/case-studies` `/customer-stories` `/testimonials` 等公开页面
- ❌ 不把 E（Lead Master）里的联系人变成案例 —— 被联系过 ≠ 案例
- ❌ 不把姓名 / 邮箱 / 电话写进 Case Master（那是 E 的字段）
- ❌ 不因为 H 有页面就往里塞"真实案例"文案
