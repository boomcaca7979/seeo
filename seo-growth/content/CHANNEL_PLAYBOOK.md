# F｜Channel Playbook

**唯一内容主库：`seo-growth/content-bank.csv`**

本文件**不是**第二份内容库，它是「把同一条 Core Content 改造成各渠道版本」的固定格式说明。
渠道版本是按需派生的产物，不落成 30×5 份稿件（那样就变成一次性大量生产）。

> 事实纪律：任何 SEO score / 排名变化 / 流量变化都必须来自真实数据。
> 没有真实数据就不要写具体数字，只描述「去看什么」。见主库 `source` 与 `source_detail` 字段。

---

## 一、改造链

```
Core Content（主库里的 problem / core_point / supporting_points / example / cta）
   ↓
Reddit 版本
Indie Hackers 版本
LinkedIn 版本
X 版本
Email 版本
```

同一条 Core 可以多次复用：

```bash
npm run content -- list --status=Ready     # 今天用哪条
npm run content -- show C005               # 看 Core + 各渠道骨架
npm run content -- use C005                # 发布后：Published / last_used_at / times_used+1
npm run content -- stale                   # 超过 recommended_reuse_gap 没用的主题
```

---

## 二、各渠道固定格式

### Reddit
- **Problem**：用提问者的口吻写一句他真正会遇到的情况
- **Useful explanation**：给机制解释，不是结论口号
- **Example**：具体到某个检查项或页面结构
- **Optional SeeO mention**：只在真正相关时提一次，给链接
- **No hard sell**：不要 CTA 句、不要「注册即可」

### Indie Hackers
- **Problem**：作为 builder 遇到的同一个问题
- **What we learned**：我们自己踩过的具体结论
- **Practical takeaway**：对方明天能直接做的一件事
- **Product context when relevant**：只在能解释「为什么做这个」时提

### LinkedIn
- **Hook**：一句反直觉或具体的观察
- **Observation**：你在真实站点上看到的模式（不编数字）
- **3 points**：三条可执行要点
- **Conclusion**：一句收束
- **Soft CTA**：主库 `cta` 字段对应的那句，不加工

### X
- **One strong observation**：一条独立成立的判断
- **3–7 short posts if thread**：每条只说一件事
- **One CTA max**：整个 thread 最多一次

### Email
- **Problem** → **Useful insight** → **Example** → **CTA**
- 150–250 words；与 C 阶段现有邮件同一语气：克制、不制造焦虑、只描述真实能力

---

## 三、CTA 使用

CTA 只能取 `src/lib/content/ctas.ts` 里的 id（主库 `cta` 字段）。
库里刻意**没有** `Start now` / `Buy now` / `Best SEO tool` 这类话术，有测试把关。

CTA 必须与内容相关：讲 canonical 就用 `see_affected_pages`，讲修完怎么验证就用 `track_change`。

---

## 四、复用间隔

主库 `recommended_reuse_gap` 取 14 / 21 / 30 天：

- **14 天**：产品能力直接相关、可以频繁复用的主题
- **21 天**：大多数教育类主题
- **30 天**：技术性较强、重复看到会显得啰嗦的主题

`npm run content -- stale` 会列出「该复用但还没用」的主题，避免每天重复同一个。

---

## 五、与 C（Email 营销基地）的连接

**不新建邮件模板。** 主库 `email_compatible = yes` 的主题，
通过 `src/lib/content/email-links.ts` 关联到 C 阶段**已存在**的模板：

- `seo_education_v1`
- `feature_education_v1`

关联关系有测试强制：值必须是 C 注册表里真实存在的模板 key，
且被关联的主题在主库里必须存在并且 `email_compatible = yes`。
不出现 `content_email_v1` / `seo_email_v2` 这类第二套模板。

---

## 六、与 E（潜客库）的边界

F **不复制**任何潜客信息。

如果某个主题来自潜客遇到的问题，只记录**匿名化的问题模式**，例如
「Several SaaS homepages had unclear title targeting」——
不写客户姓名、邮箱、完整网站。主库校验会拒绝含邮箱的内容。
