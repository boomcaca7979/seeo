// ===== J｜Product Hunt Launch Kit：渲染与体检 =====
// 唯一 canonical source 是 src/lib/product-hunt/launch-kit.ts；
// 本脚本把它渲染成 seo-growth/product-hunt/LAUNCH_KIT.md（可读版），并输出体检结果。
//
// 结构性保证：本文件与 launch-kit.ts 都没有任何网络调用 —— 不可能提交/发布/邀请/评论。
//
// 用法：
//   npm run product-hunt -- render     # 重新生成 LAUNCH_KIT.md
//   npm run product-hunt -- doctor     # 体检：URL / CTA / 引用 / 规则状态 / 反作弊

import fs from "node:fs";
import path from "node:path";
import {
  ANALYTICS_ATTRIBUTION,
  ANTI_ABUSE,
  ATTRIBUTION_OPEN_ITEM,
  CASE_USAGE,
  COMMENT_GUIDANCE,
  CONTENT_REFERENCES,
  DEMO_CHECKLIST,
  DESCRIPTIONS,
  FAQ,
  FINAL_PRE_LAUNCH_CHECKLIST,
  FIRST_COMMENT,
  FULL_DESCRIPTION_SECTIONS,
  KIT_VERSION,
  LAUNCH_TIMELINE,
  MAKER_BIO,
  PRIMARY_CTA,
  PRODUCT,
  RULES_TRACKING,
  SCREENSHOT_ASSET_STATUS,
  SCREENSHOTS,
  SCREENSHOT_MANUAL_CHECKS,
  TAGLINES,
  TAGLINE_RECOMMENDED_ID,
} from "../src/lib/product-hunt/launch-kit.ts";

export const KIT_RELATIVE_PATH = "seo-growth/product-hunt/LAUNCH_KIT.md";

function checklist(items: readonly { text: string; manual?: boolean }[]): string {
  return items.map((i) => `- [ ] ${i.text}${i.manual ? "  <!-- MANUAL -->" : ""}`).join("\n");
}

export function renderKit(): string {
  const rec = TAGLINES.find((t) => t.id === TAGLINE_RECOMMENDED_ID)!;
  return `# J｜Product Hunt Launch Kit（**不 Launch**）

> **单一事实来源**：\`src/lib/product-hunt/launch-kit.ts\`。
> 本文件由 \`npm run product-hunt -- render\` 生成，**不要手改**；要改文案请改代码后重新渲染。
> Kit 版本：\`${KIT_VERSION}\`
>
> 本轮只建设素材：**未提交 Product Hunt、未发布、未邀请、未请求 upvote**。
> 归因：\`Organic launch only\`。

---

## 1. Product Name

\`\`\`
${PRODUCT.name}
\`\`\`

## 2. Tagline

三个候选：

| ID | Tagline | 说明 |
|---|---|---|
${TAGLINES.map((t) => `| ${t.id} | ${t.text} | ${t.why} |`).join("\n")}

**Recommended candidate = ${TAGLINE_RECOMMENDED_ID}**

\`\`\`
${rec.text}
\`\`\`

选择理由（基于可核验事实，不做市场预测）：${rec.why}
最终主文案只有一个 —— 其余两条仅作备选留档。

## 3. Short Description

\`\`\`
${DESCRIPTIONS.short}
\`\`\`

## 4. Full Description

${FULL_DESCRIPTION_SECTIONS.map((s) => `**${s.heading}**\n\n${s.body}`).join("\n\n")}

> 长描述必须与站上 \`messages/en.json → meta.siteDescription\` **逐字一致**（有测试强制）：
>
> \`\`\`
> ${DESCRIPTIONS.siteLong}
> \`\`\`

## 5. Maker Bio

**状态：${MAKER_BIO.status}** —— 必须由你本人填写真实身份后才可使用。

\`\`\`
${MAKER_BIO.placeholders.name}
${MAKER_BIO.placeholders.background}
${MAKER_BIO.placeholders.contact}
\`\`\`

禁止填写：

${MAKER_BIO.forbidden.map((f) => `- ${f}`).join("\n")}

## 6. First Comment（launch 当天由 maker 自己发）

\`\`\`
${FIRST_COMMENT}
\`\`\`

不索取投票，不写"帮我冲榜"。

## 7. FAQ

${FAQ.map((f) => `**Q: ${f.q}**\nA: ${f.a}`).join("\n\n")}

## 8. Product URL

\`\`\`
${PRODUCT.productUrl}
\`\`\`

真实、公开、可直接跑免费审计的入口。**不得**指向内部路径、测试路径或任何 Master 文件。

## 9. Primary CTA

\`\`\`
${PRIMARY_CTA.label}   （F 的 CTA 库 id: ${PRIMARY_CTA.ctaId}）
\`\`\`

## 10. Screenshot checklist

**仓库内不保留任何截图文件**（历史截图与验收截图已全部清除）。这里只声明需要哪 6 张，
状态一律 **NEED MANUAL** —— 不写路径、不引用已删除的文件、不用空文件冒充素材。

| # | 用途 | 状态 |
|---|---|---|
${SCREENSHOTS.map((s) => `| ${s.slot} | ${s.purpose} | **${s.status}** |`).join("\n")}

> ${SCREENSHOT_ASSET_STATUS.note}

使用前必须人工确认（**尚未确认**）：

${checklist(SCREENSHOT_MANUAL_CHECKS)}

## 11. Demo checklist

**${DEMO_CHECKLIST.status}** —— ${DEMO_CHECKLIST.note}

${checklist(DEMO_CHECKLIST.steps)}

## 12. Launch-day checklist

${LAUNCH_TIMELINE.map((t) => `### ${t.when}\n\n${checklist(t.items.map((text) => ({ text })))}`).join("\n\n")}

## 13. Comment / reply guidance

${COMMENT_GUIDANCE.map((c) => `- ${c}`).join("\n")}

## 14. Analytics attribution

| 参数 | 值 |
|---|---|
| utm_source | \`${ANALYTICS_ATTRIBUTION.utmSource}\`（B 的 canonical source，不新建平行来源） |
| utm_medium | \`${ANALYTICS_ATTRIBUTION.utmMedium}\` |
| utm_campaign | \`${ANALYTICS_ATTRIBUTION.utmCampaign}\` |
| utm_content | \`${ANALYTICS_ATTRIBUTION.utmContent}\` |

\`\`\`
${ANALYTICS_ATTRIBUTION.url}
\`\`\`

复用现有 analytics，不新增第二套埋点。

> ⚠️ **待人工收敛的分歧**（${ATTRIBUTION_OPEN_ITEM.status}）：
> ${ATTRIBUTION_OPEN_ITEM.detail}

## 15. Final pre-launch checklist

${checklist(FINAL_PRE_LAUNCH_CHECKLIST)}

---

## 附：关联与边界

**F（内容）**：只建立引用关系，不复制正文 —— launch 内容来源 ${CONTENT_REFERENCES.launchContentSource.join("、")}；功能清单口径与 C 的 \`${CONTENT_REFERENCES.featureEducationTemplate}\` 一致。

**I（案例）**：当前使用 **${CASE_USAGE.approvedCasesUsed}** 条真实案例。${CASE_USAGE.note}

**规则跟踪（§18）**：

| 项 | 值 |
|---|---|
| rules_checked_at | ${RULES_TRACKING.rulesCheckedAt || "（未核对）"} |
| rules_source | ${RULES_TRACKING.rulesSource || "（未填写）"} |
| rules_status | **${RULES_TRACKING.rulesStatus}** |

动态规则随时可能变化，**不得**把未来 Launch Day 的规则写成永久 PASS。

**反作弊（§19）**：${ANTI_ABUSE.mode}

${ANTI_ABUSE.forbidden.map((f) => `- 禁止：${f}`).join("\n")}

结构性保证：本 kit 的代码与渲染脚本中不存在任何网络调用（hasNetworkCapability = ${ANTI_ABUSE.hasNetworkCapability}），因此不可能自动提交、邀请、评论或刷票。
`;
}

function cmdRender(): void {
  const file = path.join(process.cwd(), KIT_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderKit(), "utf-8");
  console.log(`已渲染 ${KIT_RELATIVE_PATH}`);
}

function cmdDoctor(): void {
  const file = path.join(process.cwd(), KIT_RELATIVE_PATH);
  const exists = fs.existsSync(file);
  const inSync = exists && fs.readFileSync(file, "utf-8") === renderKit();
  console.log(`Kit：${KIT_RELATIVE_PATH}`);
  console.log(`存在：${exists ? "yes" : "no"} ｜ 与代码同步：${inSync ? "yes" : "NO（请运行 render）"}`);
  console.log(`Tagline 推荐：${TAGLINE_RECOMMENDED_ID}（${TAGLINES.length} 个候选）`);
  console.log(`Product URL：${PRODUCT.productUrl}`);
  console.log(`CTA：${PRIMARY_CTA.ctaId}`);
  console.log(`Maker bio：${MAKER_BIO.status}（不得编造身份）`);
  console.log(`Demo 状态：${DEMO_CHECKLIST.status}（${DEMO_CHECKLIST.note}）`);
  console.log(`案例使用：${CASE_USAGE.approvedCasesUsed} 条`);
  console.log(`规则状态：${RULES_TRACKING.rulesStatus}`);
  console.log(`归因：${ANALYTICS_ATTRIBUTION.utmSource} / ${ANALYTICS_ATTRIBUTION.utmMedium} / ${ANALYTICS_ATTRIBUTION.utmCampaign}`);
  console.log(`待收敛项：${ATTRIBUTION_OPEN_ITEM.status}`);
  console.log(`反作弊：${ANTI_ABUSE.mode}（无网络能力 = ${ANTI_ABUSE.hasNetworkCapability}）`);
  console.log(`截图槽位：${SCREENSHOTS.length} ｜ 截图素材状态：${SCREENSHOT_ASSET_STATUS.status}`);
  console.log(`仓库内截图文件：0（不存在实体素材，不写路径、不用空文件冒充）`);
  console.log(`\n未完成的必须人工项：`);
  for (const i of FINAL_PRE_LAUNCH_CHECKLIST.filter((x) => x.manual)) console.log(`  - [ ] ${i.text}`);
  if (!exists || !inSync) process.exitCode = 1;
}

const [cmd = ""] = process.argv.slice(2);
switch (cmd) {
  case "render":
    cmdRender();
    break;
  case "doctor":
    cmdDoctor();
    break;
  default:
    console.log(`用法：npm run product-hunt -- <render|doctor>
  render  重新生成 ${KIT_RELATIVE_PATH}（从 src/lib/product-hunt/launch-kit.ts）
  doctor  体检：文件同步 / URL / CTA / 引用 / 规则状态 / 人工待办

本轮不会 Launch：本脚本没有任何网络调用。`);
}
