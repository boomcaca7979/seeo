# K｜Referral / Share Base —— 规则与边界（唯一 canonical 文档）

> **单一事实来源**：`src/lib/referral/index.ts`。
> 本文件由 `npm run referral -- render` 生成，**不要手改**；改规则请改代码后重新渲染。
>
> **本阶段没有真实推广能力**：不邀请用户、不发邮件、不发社区内容、不建公开 referral 页面、
> 不做积分/返现/排行榜/联盟。代码里没有任何网络调用。

---

## 1. Referral model（最小化）

K 第一阶段只解决一件事：

```
一个用户分享 SeeO → 新用户打开分享链接 → SeeO 识别来源 → 注册/激活时保留这次归因
```

**不做**：奖励、积分、返现、排行榜、联盟系统、多级分销。

**零数据库迁移**：K 不新建表。归因复用 B 阶段已经在管的 `analytics_identities`。

## 2. Share link format

```
https://www.seeo.asia/?ref=R7K3M9PQZ4XX
```

- 参数名：`?ref=`（唯一别名，不提供第二种写法）
- code 格式：R + 10 位（去歧义字母表）+ 1 位校验 = 12 字符
- 熵：约 50 bit（不可通过递增推测）
- 有效期：90 天
- 落点：首页（**不建 referral landing page**）
- **不带任何 `utm_*` 参数** —— 避免污染真实 UTM 归因；code 在客户端上报时注入 `utm_content`

CLI 校验：

```
npm run referral -- validate R7K3M9PQZ4XX
npm run referral -- inspect "https://www.seeo.asia/?ref=R7K3M9PQZ4XX"
```

## 3. Source / medium / campaign 规范

| 维度 | 取值 | 说明 |
|---|---|---|
| utm_source | `referral` | 实测会被 B 归一化为 `source="other"`（见未决项 K-OPEN-1） |
| utm_content | `<code>` | code 的无损载体 → 落到 `first_touch_content` |
| utm_medium / utm_campaign | **不设置** | K 不占用这两个维度，避免与 G / J 的渠道归因冲突 |

**不新增 canonical source**，**不新增事件名**（见第 9 节）。

## 4. Attribution rules

- 首次记录即固定，后续同 code 只更新时间与次数；出现另一个有效 code 时不覆盖（first-touch wins）
- last_touch 由 B 的 recordVisit 负责，且有真实渠道时才更新；K 不参与、不覆盖
- 沿用 B：匿名期 first_touch 已写入 analytics_identities；bindIdentity 负责承接，K 不需要用户重填 code
- 同一 (identity, code, 视图) 只计一次；没有 userId 时只算 visit，不算 signup/activation

## 5. Referral lifecycle

```
visit（匿名到访，first_touch_content = code）
  → signup（bindIdentity 把 anonymous_id 接到 user_id）
  → activation（沿用 B 的 activation_completed）
```

「点击分享链接」**不等于**转化：visit 只是 visit。

## 6. First-touch / last-touch 边界

- **first_touch**：K 负责。首次记录即固定；同 code 只更新时间与次数；**出现另一个有效 code 时不覆盖**。
- **last_touch**：**B 负责**（`recordVisit` 只在有真实渠道时更新）。K 不参与、不覆盖。
- 客户端持久化键：`seeo:ref`（与 B 的 `seeo:aid` / `seeo:sid` 同风格）。

## 7. Self-referral / duplicate / replay 防护

- 自助分享：分享者本人访问自己的 code 不计转化（K1 只处理可判定的明确情况）
- 去重：`同一 (identity, code, 视图) 只计一次；没有 userId 时只算 visit，不算 signup/activation`
- 重放 / 刷新：同一 (identity, code, 视图) 只计一次，刷新不重复累计
- 同一注册身份（user_id）不会被重复计数

## 8. Expired / invalid referral 行为

- **非法 code**：安全忽略：不报错、不阻塞页面、不写入任何归因
- **过期**：超过 90 天的归因视为过期，重新访问会按新归因处理
- **参数异常**：不污染正常 UTM 归因 —— 只有当本次请求没有任何真实 utm_* 参数时才注入

## 9. Analytics event contract（接入 B，不造第二套）

| 派生的视图 | 来源（全部由 B 管理） |
|---|---|
| `referral_visit` | 该 anonymous_id 的 `first_touch_content` 是合法 code |
| `referral_signup` | 该 anonymous_id 已被 `bindIdentity` 绑到某个 user_id |
| `referral_activation` | 该 user 存在 B 的 `activation_completed`（**沿用 B 的 activation 定义**） |

- **新增事件名：0 个**
- **新增 canonical source：0 个**
- 复用的 B 资产：表 `analytics_identities`；函数 `recordVisit`、`bindIdentity`、`getFirstTouchByAnonymousId`、`trackActivationIfFirst`

字段可表达性（全部由 B 既有结构承载）：`anonymous_id` / `user_id` / `referral_code`（= first_touch_content）/
`referral_source`（= referral）/ first_touch / last_touch / timestamp —— **K 不另存一份**。

## 10. Privacy boundaries

禁止出现在 referral URL 里：邮箱、手机号、内部 user id、UUID、token / session / 密码、任何 secret。

CLI 的 `inspect` 会对 URL 做隐私检查（含「是否出现未许可的查询参数」）。

## 11. SEO

- referral URL 不进 sitemap、不建 landing page、canonical 仍指向正常页面；参数化 URL 不产生可索引页面
- referral 基础逻辑不进入不必要的公共 client chunk。

## 12. Future extension points

- 把 `referral` 加入 B 的 `CANONICAL_SOURCES`（需要改 B，见 K-OPEN-1）
- code → owner 的反查存储（严格版自助分享防护，见 K-OPEN-2）
- 服务端撤销名单（见 K-OPEN-4）
- 奖励 / 积分体系 —— **明确不在 K1 范围内**，需要单独阶段与合规评估

---

## 13. 未决项（不允许静默视为完成）

- **K-OPEN-1**（NEEDS DECISION）：B 的 CANONICAL_SOURCES 不含 referral，因此 utm_source=referral 会被归一化成 source="other"（实测）。是否把 referral 加进 B 的白名单需要你决定 —— B 已封板，K1 未改。当前 code 走 utm_content，归因无损可反解。
- **K-OPEN-2**（NEEDS DECISION）：referral code 的归属者（owner）当前没有存储（零迁移）。若要做「自助分享防护」的严格版本，需要一处能反查 code→owner 的存储。
- **K-OPEN-3**（NEED MANUAL）：分享入口组件已实现但**未挂载**到任何页面，因此真实浏览器端到端流程尚未人工验证（挂载点建议 /app）。
- **K-OPEN-4**（NEED MANUAL）：code 失效 / 撤销只做了格式与时效校验，没有服务端撤销名单；真实撤销行为未验证。

## 14. 人工检查项（NEED MANUAL）

以下每一项都必须由真实浏览器 / 真实 production 流程验证，**不得写成 PASS**：

- [ ] 在真实浏览器里从 /app 复制分享链接，确认剪贴板内容正确
- [ ] 用无痕窗口打开该链接，确认归因被记录且页面正常（不要求登录）
- [ ] 在无痕窗口完成注册，确认归因被承接（不要求用户重新输入 code）
- [ ] 确认完成一次真实 activation 后，派生视图 activation 变为 true 且不重复计数
- [ ] 确认分享者本人打开自己的链接不会计转化
- [ ] 确认刷新页面不会重复累计 visit/seenCount 之外的转化计数
- [ ] 确认 referral URL 未进入 sitemap，且 canonical 仍指向正常页面

## 15. 反自动化边界

禁止（代码层面已做静态检查，见 doctor）：

- 自动邀请、自动发 referral email、自动发帖、自动请求 upvote
- 自动发放奖励 / 积分 / 优惠
- 向任何第三方 referral / invite 平台发起请求

结构性保证：`src/lib/referral/` 与 `scripts/referral.mts` 内**不存在任何网络调用**。

## 16. 与 J 的 Product Hunt 归因的关系

J 的 `utm_source=producthunt&utm_medium=community&utm_campaign=launch` 是 Product Hunt 的
canonical 归因，K **不修改、不介入**。J 内部记录的 `ATTRIBUTION_OPEN_ITEM`
（G 的 `campaignFor("product_hunt")` 返回 `medium=launch`）在本阶段**仍然未解决**，
K 只在本文档引用它，不处理它。
