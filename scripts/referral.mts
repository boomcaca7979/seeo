// ===== K｜Referral 命令行：render / doctor / validate / inspect =====
// 唯一 canonical source 是 src/lib/referral/index.ts；本脚本把它渲染成
// seo-growth/referral/RULES.md（可读版）并提供最小的校验/解析工具。
//
// 结构性保证：本文件没有任何网络调用 —— 不可能自动邀请、自动发信、自动发帖、自动发奖励。
//
// 用法：
//   npm run referral -- render             # 重新生成 RULES.md
//   npm run referral -- doctor             # 体检：同步 / 规则 / 未决项 / 人工项 / 反自动化
//   npm run referral -- validate <code>    # 校验一个 referral code
//   npm run referral -- inspect <url>      # 解析一个分享链接（含隐私检查）

import fs from "node:fs";
import path from "node:path";
import {
  B_MAPPING,
  MANUAL_CHECKS,
  OPEN_ITEMS,
  REFERRAL_RULES,
  REFERRAL_STORAGE_KEY,
  buildShareUrl,
  isOpaqueCode,
  isValidReferralCode,
  normalizeReferralCode,
  parseReferralFromUrl,
  urlPrivacyIssues,
} from "../src/lib/referral/index.ts";

const DOC_RELATIVE_PATH = "seo-growth/referral/RULES.md";

/**
 * 文档里的示例 code 必须**固定**。
 * 若用 generateReferralCode 现场生成，每次渲染结果都不同，doctor 的「与代码同步」
 * 检查将永远失败 —— 那是生成器的不确定性带来的假失败，不是文档真的漂移。
 */
const DOC_SAMPLE_CODE = "R7K3M9PQZ4XX";

function renderDoc(): string {
  const sample = DOC_SAMPLE_CODE;
  if (!isValidReferralCode(sample)) throw new Error("DOC_SAMPLE_CODE 不是合法 code");
  return `# K｜Referral / Share Base —— 规则与边界（唯一 canonical 文档）

> **单一事实来源**：\`src/lib/referral/index.ts\`。
> 本文件由 \`npm run referral -- render\` 生成，**不要手改**；改规则请改代码后重新渲染。
>
> **本阶段没有真实推广能力**：不邀请用户、不发邮件、不发社区内容、不建公开 referral 页面、
> 不做积分/返现/排行榜/联盟。代码里没有任何网络调用。

---

## 1. Referral model（最小化）

K 第一阶段只解决一件事：

\`\`\`
一个用户分享 SeeO → 新用户打开分享链接 → SeeO 识别来源 → 注册/激活时保留这次归因
\`\`\`

**不做**：奖励、积分、返现、排行榜、联盟系统、多级分销。

**零数据库迁移**：K 不新建表。归因复用 B 阶段已经在管的 \`analytics_identities\`。

## 2. Share link format

\`\`\`
${buildShareUrl({ code: sample })}
\`\`\`

- 参数名：\`?${REFERRAL_RULES.queryParam}=\`（唯一别名，不提供第二种写法）
- code 格式：${REFERRAL_RULES.codeFormat}
- 熵：约 ${REFERRAL_RULES.codeEntropyBits} bit（不可通过递增推测）
- 有效期：${REFERRAL_RULES.ttlDays} 天
- 落点：首页（**不建 referral landing page**）
- **不带任何 \`utm_*\` 参数** —— 避免污染真实 UTM 归因；code 在客户端上报时注入 \`utm_content\`

CLI 校验：

\`\`\`
npm run referral -- validate ${sample}
npm run referral -- inspect "${buildShareUrl({ code: sample })}"
\`\`\`

## 3. Source / medium / campaign 规范

| 维度 | 取值 | 说明 |
|---|---|---|
| utm_source | \`${B_MAPPING.utmSourceValue}\` | 实测会被 B 归一化为 \`source="${B_MAPPING.normalizedSource}"\`（见未决项 K-OPEN-1） |
| utm_content | \`<code>\` | code 的无损载体 → 落到 \`${B_MAPPING.persistedColumn}\` |
| utm_medium / utm_campaign | **不设置** | K 不占用这两个维度，避免与 G / J 的渠道归因冲突 |

**不新增 canonical source**，**不新增事件名**（见第 9 节）。

## 4. Attribution rules

- ${REFERRAL_RULES.firstTouch}
- ${REFERRAL_RULES.lastTouch}
- ${REFERRAL_RULES.anonymousToSignedIn}
- ${REFERRAL_RULES.dedupe}

## 5. Referral lifecycle

\`\`\`
visit（匿名到访，first_touch_content = code）
  → signup（bindIdentity 把 anonymous_id 接到 user_id）
  → activation（沿用 B 的 activation_completed）
\`\`\`

「点击分享链接」**不等于**转化：visit 只是 visit。

## 6. First-touch / last-touch 边界

- **first_touch**：K 负责。首次记录即固定；同 code 只更新时间与次数；**出现另一个有效 code 时不覆盖**。
- **last_touch**：**B 负责**（\`recordVisit\` 只在有真实渠道时更新）。K 不参与、不覆盖。
- 客户端持久化键：\`${REFERRAL_STORAGE_KEY}\`（与 B 的 \`seeo:aid\` / \`seeo:sid\` 同风格）。

## 7. Self-referral / duplicate / replay 防护

- 自助分享：${REFERRAL_RULES.selfReferral}
- 去重：\`${REFERRAL_RULES.dedupe}\`
- 重放 / 刷新：同一 (identity, code, 视图) 只计一次，刷新不重复累计
- 同一注册身份（user_id）不会被重复计数

## 8. Expired / invalid referral 行为

- **非法 code**：${REFERRAL_RULES.invalidCode}
- **过期**：${REFERRAL_RULES.expired}
- **参数异常**：${B_MAPPING.codeCarrier === "utm_content" ? "不污染正常 UTM 归因 —— 只有当本次请求没有任何真实 utm_* 参数时才注入" : ""}

## 9. Analytics event contract（接入 B，不造第二套）

| 派生的视图 | 来源（全部由 B 管理） |
|---|---|
| \`referral_visit\` | 该 anonymous_id 的 \`first_touch_content\` 是合法 code |
| \`referral_signup\` | 该 anonymous_id 已被 \`bindIdentity\` 绑到某个 user_id |
| \`referral_activation\` | 该 user 存在 B 的 \`activation_completed\`（**沿用 B 的 activation 定义**） |

- **新增事件名：${B_MAPPING.newEventNames.length} 个**
- **新增 canonical source：${B_MAPPING.newCanonicalSources.length} 个**
- 复用的 B 资产：表 \`${B_MAPPING.reusedTable}\`；函数 ${B_MAPPING.reusedFunctions.map((f) => `\`${f}\``).join("、")}

字段可表达性（全部由 B 既有结构承载）：\`anonymous_id\` / \`user_id\` / \`referral_code\`（= first_touch_content）/
\`referral_source\`（= referral）/ first_touch / last_touch / timestamp —— **K 不另存一份**。

## 10. Privacy boundaries

禁止出现在 referral URL 里：邮箱、手机号、内部 user id、UUID、token / session / 密码、任何 secret。

CLI 的 \`inspect\` 会对 URL 做隐私检查（含「是否出现未许可的查询参数」）。

## 11. SEO

- ${REFERRAL_RULES.seo}
- referral 基础逻辑不进入不必要的公共 client chunk。

## 12. Future extension points

- 把 \`referral\` 加入 B 的 \`CANONICAL_SOURCES\`（需要改 B，见 K-OPEN-1）
- code → owner 的反查存储（严格版自助分享防护，见 K-OPEN-2）
- 服务端撤销名单（见 K-OPEN-4）
- 奖励 / 积分体系 —— **明确不在 K1 范围内**，需要单独阶段与合规评估

---

## 13. 未决项（不允许静默视为完成）

${OPEN_ITEMS.map((i) => `- **${i.id}**（${i.status}）：${i.detail}`).join("\n")}

## 14. 人工检查项（NEED MANUAL）

以下每一项都必须由真实浏览器 / 真实 production 流程验证，**不得写成 PASS**：

${MANUAL_CHECKS.map((m) => `- [ ] ${m}`).join("\n")}

## 15. 反自动化边界

禁止（代码层面已做静态检查，见 doctor）：

- 自动邀请、自动发 referral email、自动发帖、自动请求 upvote
- 自动发放奖励 / 积分 / 优惠
- 向任何第三方 referral / invite 平台发起请求

结构性保证：\`src/lib/referral/\` 与 \`scripts/referral.mts\` 内**不存在任何网络调用**。

## 16. 与 J 的 Product Hunt 归因的关系

J 的 \`utm_source=producthunt&utm_medium=community&utm_campaign=launch\` 是 Product Hunt 的
canonical 归因，K **不修改、不介入**。J 内部记录的 \`ATTRIBUTION_OPEN_ITEM\`
（G 的 \`campaignFor("product_hunt")\` 返回 \`medium=launch\`）在本阶段**仍然未解决**，
K 只在本文档引用它，不处理它。
`;
}

function cmdRender(): void {
  const file = path.join(process.cwd(), DOC_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderDoc(), "utf-8");
  console.log(`已渲染 ${DOC_RELATIVE_PATH}`);
}

function cmdDoctor(): void {
  const file = path.join(process.cwd(), DOC_RELATIVE_PATH);
  const exists = fs.existsSync(file);
  const inSync = exists && fs.readFileSync(file, "utf-8") === renderDoc();
  console.log(`文档：${DOC_RELATIVE_PATH}`);
  console.log(`存在：${exists ? "yes" : "no"} ｜ 与代码同步：${inSync ? "yes" : "NO（请运行 render）"}`);
  console.log(`查询参数：?${REFERRAL_RULES.queryParam} ｜ code 长度：${REFERRAL_RULES.codeFormat}`);
  console.log(`有效期：${REFERRAL_RULES.ttlDays} 天 ｜ 持久化键：${REFERRAL_STORAGE_KEY}`);
  console.log(`新增事件名：${B_MAPPING.newEventNames.length} ｜ 新增 canonical source：${B_MAPPING.newCanonicalSources.length}`);
  console.log(`复用 B：表 ${B_MAPPING.reusedTable}；函数 ${B_MAPPING.reusedFunctions.length} 个`);
  console.log(``);

  // 反自动化静态检查：模块与脚本内不得出现任何对外调用
  const targets = ["src/lib/referral/index.ts", "scripts/referral.mts"];
  // 只匹配**真实调用形态**。模式本身用拼接构造，避免这个检查把自己的字面量判成违规。
  const XHR = "XMLH" + "ttpRequest";
  const pattern = new RegExp(
    [String.raw`\bfetch\s*\(`, "axios\\.", "new " + XHR, String.raw`sendBeacon\s*\(`, String.raw`https?\.request\s*\(`].join("|")
  );
  let offenders = 0;
  for (const t of targets) {
    const src = fs.readFileSync(path.join(process.cwd(), t), "utf-8");
    if (pattern.test(src)) {
      offenders++;
      console.log(`  !! ${t} 出现疑似对外调用`);
    }
  }
  console.log(`反自动化检查：${offenders === 0 ? "通过（无任何对外调用）" : `失败（${offenders} 个文件）`}`);
  console.log(`自动化奖励 / 积分 / 邀请逻辑：不存在（本模块不写任何用户奖励数据）`);
  console.log(`\n未决项（${OPEN_ITEMS.length}）：`);
  for (const i of OPEN_ITEMS) console.log(`  - ${i.id} [${i.status}] ${i.detail.slice(0, 60)}…`);
  console.log(`\n人工检查项（NEED MANUAL，${MANUAL_CHECKS.length}）：`);
  for (const m of MANUAL_CHECKS) console.log(`  - [ ] ${m}`);

  if (!exists || !inSync || offenders > 0) process.exitCode = 1;
}

function cmdValidate(code: string | undefined): void {
  if (!code) {
    console.error("用法：npm run referral -- validate <code>");
    process.exitCode = 1;
    return;
  }
  const ok = isValidReferralCode(code);
  console.log(`code：${normalizeReferralCode(code)}`);
  console.log(`合法：${ok ? "yes" : "no"}`);
  console.log(`不透明（无歧义字符、纯字母数字）：${isOpaqueCode(code) ? "yes" : "no"}`);
  if (!ok) console.log("→ 非法 code 的行为：安全忽略（不报错、不阻塞、不写归因）");
}

function cmdInspect(url: string | undefined): void {
  if (!url) {
    console.error("用法：npm run referral -- inspect <url>");
    process.exitCode = 1;
    return;
  }
  const parsed = parseReferralFromUrl(url);
  const issues = urlPrivacyIssues(url);
  console.log(`URL：${url}`);
  console.log(`解析结果：${parsed.reason}${parsed.code ? ` （code=${parsed.code}）` : ""}`);
  console.log(`隐私检查：${issues.length === 0 ? "通过" : issues.join("；")}`);
  if (parsed.reason === "invalid") console.log("→ 非法 code：安全忽略，页面正常使用");
  if (parsed.reason === "missing") console.log("→ 无 referral 参数：正常访问，不影响任何现有归因");
  if (issues.length > 0) process.exitCode = 1;
}

const [cmd = "", ...rest] = process.argv.slice(2);
switch (cmd) {
  case "render":
    cmdRender();
    break;
  case "doctor":
    cmdDoctor();
    break;
  case "validate":
    cmdValidate(rest[0]);
    break;
  case "inspect":
    cmdInspect(rest[0]);
    break;
  default:
    console.log(`用法：npm run referral -- <render|doctor|validate|inspect>
  render             重新生成 ${DOC_RELATIVE_PATH}
  doctor             体检：同步 / 规则 / 未决项 / 人工项 / 反自动化
  validate <code>    校验一个 referral code
  inspect  <url>     解析分享链接并做隐私检查

本阶段没有真实推广能力：本脚本无任何网络调用。`);
}
