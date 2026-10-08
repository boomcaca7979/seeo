# Sitemap 误报复核报告 — 2026-10-08（Filebase 事件）

> 本文件是**事故记录 + 复核证据**，不是第二份运营规则。规则本体在
> `seo-growth/operations/OPERATING_SYSTEM.md`（§2.1）与 `src/lib/operations/index.ts`
> （`SITEMAP_VERIFICATION_STEPS` / `SITEMAP_VERDICT_RULES` / `OUTREACH_SEND_HOLD`）。

## 1. 触发事件

- 2026-09-29 我方发信给 Filebase 的公开联系邮箱（具体地址见 E 主库 `KQVOMKIT` 行，**不在此处
  重复记录**），正文断言「`https://filebase.com/sitemap.xml` 返回 404 —— 没有 sitemap」。
- 2026-10-02 Filebase 回复：*"You are wrong. If you understood how the internet works, you'd
  know that a webpage can tell you how and where to find a website's sitemap. Filebase has
  one, learn how to find it. Unsubscribe."*
- **对方是对的。** 实测 `https://filebase.com/robots.txt`（HTTP 200）第 3 行即：

  ```
  Sitemap: https://filebase.com/sitemap-index.xml
  ```

  该 index 返回 HTTP 200，`<sitemapindex>` 合法，子 sitemap `sitemap-0.xml` 返回 HTTP 200 的
  `<urlset>`。

## 2. 规则缺陷（已修正）

| | 内容 |
|---|---|
| 错误规则 | `/sitemap.xml` = 404 ⇒ 站点没有 sitemap |
| 正确规则 | 必须先读 `robots.txt` → 取所有 `Sitemap:` → 逐个验证 → 是 index 则跟子 sitemap → robots 未声明才查 HTML/框架兜底 → 全都找不到才能判 `NO SITEMAP` |

判定映射：robots 声明了但不可达 = `sitemap-invalid`（**不是** `no-sitemap`）。

## 3. 已发批次回查（2026-09-29 Day 1 extended batch）

复核方法：对每个域名执行修正后的 6 步核验（HTTP 实测，非缓存、跟随跳转）。

### 3.1 `issue_type = no-sitemap` 的 Lead —— 共 17 条，误报 14 条

| # | lead_id | 域名 | robots.txt | robots 声明的 sitemap | 实测结果 | 判定 |
|---|---|---|---|---|---|---|
| 1 | 6823XSM1 | aptabase.com | 200 | `/sitemap-index.xml` | index 200 → 子 `sitemap-0.xml` 200 urlset | 误报 |
| 2 | 2MCXB0Q7 | matomo.org | 200 | `/sitemap_index.xml` | index 200 → 子 `post-sitemap.xml` 200 | 误报 |
| 3 | **KQVOMKIT** | **filebase.com** | 200 | `/sitemap-index.xml` | index 200 → 子 `sitemap-0.xml` 200 | **误报（事件）** |
| 4 | 078TJBG1 | goatcounter.com | 200 | （无） | 兜底入口全部未命中 | **成立** |
| 5 | E91EWS4J | requestly.com | 200 | `/sitemap-index.xml` | index 200（另 `video-sitemap.xml` 200） | 误报 |
| 6 | 1S1PNTJU | porkbun.com | 200 | `/sitemap.xml` | 200 urlset | 误报 |
| 7 | EJPRMCEO | rows.com | 200 | `/sitemaps/sitemap.xml` | index 200 → 子 `sitemap_website.xml` 200 | 误报 |
| 8 | D3EJ4IGH | honeybadger.io | 200 | `www.honeybadger.io/sitemap-index.xml` | index 200 → 子 200 | 误报 |
| 9 | 49NJG4TO | mailcoach.app | 200 | `www.mailcoach.app/sitemaps/index.xml` | index 200 | 误报 |
| 10 | UWX5BCG1 | adapty.io | 200 | `/sitemap_index.xml` | index 200 → 子 `page-sitemap.xml` 200 | 误报 |
| 11 | 5IAVYWU7 | aeroleads.com | 200 | `/sitemap.xml` | **声明的 URL 返回 404** | 分类错误（应为 `sitemap-invalid`） |
| 12 | BEBD0NWJ | airparser.com | 200 | `/sitemap_index.xml` | index 200 → 子 `__sitemap__/en-US.xml` 200 | 误报 |
| 13 | Y09J1E7Y | eraser.io | 200 | `www.eraser.io/sitemap-index.xml` | index 200 → 子 200 | 误报 |
| 14 | FGBKF8AT | are.na | 200 | （无） | 兜底入口全部未命中 | **成立** |
| 15 | LCTVC2BY | zight.com | 200 | `/sitemap-index.xml` | index 200 → 子 `sitemap-0.xml` 200 | 误报 |
| 16 | 5JWH29WG | klipfolio.com | 200 | `www.klipfolio.com/sitemap-index.xml` | index 200 → 子 200 | 误报 |
| 17 | IHIN86KH | castmagic.io | 200 | `www.castmagic.io/sitemap-index.xml` | 200 urlset | 误报 |

**小计：误报 14 / 17；成立 3（其中 1 条属分类错误）。**

### 3.2 邮件正文提到 sitemap、但 `issue_type` 不是 `no-sitemap` 的 Lead —— 共 5 条，误报 0 条

| lead_id | 域名 | issue_type | 实测 | 判定 |
|---|---|---|---|---|
| KBA0XKN9 | heptabase.com | no-robots | robots 404；无可发现 sitemap | 陈述成立 |
| 3DZZL9BR | wordcab.com | no-robots | robots 404；无可发现 sitemap（该信已退信） | 陈述成立 |
| L6TZAOV6 | filen.io | missing-canonical | robots 404；无可发现 sitemap | 陈述成立 |
| Z2RS662W | pretix.eu | missing-canonical | robots 200 但未声明；兜底未命中 | 陈述成立 |
| 8L7QX8X6 | billsby.com | missing-canonical | robots 404；无可发现 sitemap | 陈述成立 |

> 另：`0FFDBP8U fathom.video`、`7W41JRYL doctave.com` 的 `issue_type = no-robots`，
> 且实测 `robots.txt` 确为 404（陈述成立）；但两者 `https://.../sitemap.xml` 均为 HTTP 200，
> 说明**它们的 sitemap 必须在信中被排除**（本批次确实没提 sitemap，未造成误报）。

### 3.3 合计口径

- 已发信中声称「没有 sitemap」的 Lead：**22 条**（17 + 5）
- 其中误报：**14 条**（全部落在 `issue_type = no-sitemap` 这一组）
- 误报占该组比例：14/17 ≈ 82%

## 4. 处理动作

| 对象 | 动作 | 状态 |
|---|---|---|
| Filebase (KQVOMKIT) | `Suppressed` + DO NOT CONTACT | 已完成；未回复、未发 follow-up |
| 其余 13 条误报 Lead | 仅标记为已复核，**未发送任何更正信** | 按用户指令：不发回复 |
| 新的 cold outreach | `OUTREACH_SEND_HOLD.active = true` | 已置位 |
| 判定规则 | OPERATING_SYSTEM §2.1 + `SITEMAP_VERIFICATION_STEPS` | 已修正 |

## 5. 复核中发现的旁支问题（**未处理**，需用户决定）

1. **`leads.csv` 状态列不规范**：**75 行**写成小写 `contacted`，不在 `LEAD_STATUSES` 枚举内
   （主库共 108 条：75 条 `contacted`、32 条 `New`、1 条 `Suppressed`）。
   后果：E 的状态机拒绝这些行的一切状态迁移（本次 Filebase 的压制必须先手工修正才能落库），
   且 `npm run ops -- doctor` 会逐行报 `status 非法`（当前 doctor 输出 **75 个问题，全部属于此项**）。
   建议一次性归一化（`contacted` → `Contacted`，并把 ISO 时间戳的
   `first_contacted_at` / `last_contacted_at` 改为 `YYYY-MM-DD`），**但未在本轮执行**。
2. **既有守卫测试已红**（本轮开始前即红，非本次改动引入）：5 个失败用例全部由 Day 1 的手工写入引起，
   例如 `operations.test.ts` 断言「真实仓库 daily-log 为空」「doctor 0 问题」、
   `leads.test.ts` 断言「主库 status 合法」。这些断言编码的是「尚未开始真实运营」的前置状态，
   与已开始的运营事实冲突，需要单独决定是修数据还是修断言。
3. **产品侧审计引擎的兜底较窄**（非本次误报成因）：`src/lib/seo/site-reports.ts`
   在 robots 未声明时只兜底探测 `/sitemap.xml`，未覆盖 `/sitemap_index.xml`、
   `/wp-sitemap.xml` 等框架默认入口。本批次 14 条误报**全部**由「没读 robots.txt」造成，
   与引擎无关；是否扩宽引擎兜底属产品决策，未改动。
4. `leads.csv` 中 `aeroleads.com` 的 `issue_type` 仍为 `no-sitemap`，按规则应为 `sitemap-invalid`。

## 6. 复现方式

复核脚本（未入库，避免破坏 L 层「无网络调用」的结构性约束）逻辑：
`robots.txt` → 提取 `Sitemap:` → 逐个请求并识别 `urlset`/`sitemapindex` → index 跟一个子 sitemap
→ robots 无声明时探测 `/sitemap.xml`、`/sitemap_index.xml`、`/sitemap-index.xml`、`/sitemap/`、
`/wp-sitemap.xml` 等 → 仍无则检查首页 `<link rel="sitemap">`。
