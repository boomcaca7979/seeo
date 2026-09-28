// ===== G｜社区基地 日常命令行 =====
// 只做「选内容 → 看各平台怎么发 → 生成链接 → 登记 → 回填 URL」。
// **不会发布任何东西**：没有 API 调用、没有自动发帖/评论/DM（§15）。
//
// 用法（Node 22+ 原生运行 TS）：
//   npm run community -- list
//   npm run community -- show reddit
//   npm run community -- fit C005
//   npm run community -- link C005 --platform=reddit [--path=/]
//   npm run community -- add C005 --platform=reddit --community=r/SEO [--cta=free_audit]
//   npm run community -- publish C005-R1 --url="https://..."
//   npm run community -- posts [--content=C005] [--platform=reddit]
//   npm run community -- doctor

import {
  COMMUNITY_MASTER_RELATIVE_PATH,
  COMMUNITY_POSTS_RELATIVE_PATH,
  PLATFORMS,
  PLATFORM_FIT,
  PLATFORM_LABEL,
  PLATFORM_RULES,
  PLATFORMS as ALL_PLATFORMS,
  accountFor,
  addPost,
  auditCommunity,
  buildCommunityUrl,
  campaignFor,
  emptyPost,
  isPlatform,
  markPublished,
  postsForContent,
  postsForPlatform,
  readAccounts,
  readPosts,
  splitList,
  strongTypesFor,
  isCanonicalSourceFor,
  type Platform,
} from "../src/lib/community/index.ts";
import { readTopics } from "../src/lib/content/index.ts";

type Args = Record<string, string>;

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Args } {
  const [cmd = "", ...rest] = argv;
  const positional: string[] = [];
  const flags: Args = {};
  for (const t of rest) {
    if (t.startsWith("--")) {
      const body = t.slice(2);
      const eq = body.indexOf("=");
      if (eq < 0) flags[body] = "true";
      else flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else positional.push(t);
  }
  return { cmd, positional, flags };
}

function requirePlatform(v: string | undefined): Platform | null {
  if (!v) {
    console.error(`缺少 --platform。可选：${PLATFORMS.join(" | ")}`);
    return null;
  }
  if (!isPlatform(v)) {
    console.error(`未知平台 ${v}。可选：${PLATFORMS.join(" | ")}`);
    return null;
  }
  return v;
}

function cmdList(): void {
  const accounts = readAccounts();
  console.log(`Community Master（${COMMUNITY_MASTER_RELATIVE_PATH}）共 ${accounts.length} 个平台：`);
  for (const a of accounts) {
    console.log(
      `  ${a.platform.padEnd(14)} ${a.status.padEnd(8)} profile=${a.profile_status.padEnd(17)} cta=${a.primary_cta.padEnd(18)} rules=${a.rules_checked_at || "未核对"}`
    );
  }
}

function cmdShow(positional: string[]): void {
  const platform = requirePlatform(positional[0]);
  if (!platform) {
    process.exitCode = 1;
    return;
  }
  const a = accountFor(platform);
  if (!a) {
    console.error(`Community Master 里没有 ${platform}`);
    process.exitCode = 1;
    return;
  }
  const rule = PLATFORM_RULES[platform];
  console.log(`# ${PLATFORM_LABEL[platform]}（${platform}）`);
  console.log(`账号        : ${a.account_name}`);
  console.log(`主页        : ${a.profile_url || "（尚未创建）"}`);
  console.log(`状态        : ${a.status} · profile_status=${a.profile_status}`);
  console.log(`受众        : ${a.audience}`);
  console.log(`目的        : ${a.purpose}`);
  console.log(`定位        : ${a.positioning}`);
  console.log(`Bio         : ${a.bio}`);
  console.log(`网站        : ${a.website}`);
  console.log(`主 CTA      : ${a.primary_cta}`);
  console.log(`内容类型    : ${splitList(a.content_types).join(", ")}`);
  console.log(`频率        : ${a.posting_frequency}`);
  console.log(`规则核对    : ${a.rules_checked_at || "未核对（Needs Manual Check）"}`);
  console.log(`自我推广    : ${a.self_promo_notes}`);
  console.log(`链接政策    : ${a.link_policy}`);
  console.log(`频率备注    : ${a.frequency_notes}`);
  if (a.notes) console.log(`备注        : ${a.notes}`);
  console.log("");
  console.log(`平台规则：self_promo_allowed=${rule.selfPromoAllowed}`);
  console.log(`最契合类型（strong）：${strongTypesFor(platform).join(", ")}`);
  console.log(`归因：utm_source=${buildCommunityUrl({ platform, path: "/" }).match(/utm_source=([^&]+)/)?.[1]}` +
    ` utm_medium=${campaignFor(platform).medium} utm_campaign=${campaignFor(platform).campaign}` +
    `（B canonical source 校验：${isCanonicalSourceFor(platform) ? "通过" : "失败"}）`);
}

function cmdFit(positional: string[]): void {
  const contentId = positional[0];
  if (!contentId) {
    console.error("缺少 content_id，例如：npm run community -- fit C005");
    process.exitCode = 1;
    return;
  }
  const topic = readTopics().find((t) => t.content_id === contentId);
  if (!topic) {
    console.error(`F 的 Content Master 里没有 ${contentId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`# ${topic.content_id} · ${topic.title}`);
  console.log(`类型：${topic.content_type} · 状态：${topic.status} · 已用 ${topic.times_used} 次`);
  console.log(`建议 CTA（来自 F）：${topic.cta}`);
  console.log("");
  console.log("各平台契合度：");
  const order: Platform[] = ["reddit", "indie_hackers", "linkedin", "x", "product_hunt"];
  for (const p of order) {
    const cell = PLATFORM_FIT[p][topic.content_type];
    if (!cell) continue;
    const inFit = splitList(topic.channel_fit).includes(p);
    console.log(
      `  ${PLATFORM_LABEL[p].padEnd(14)} fit=${cell.fit.padEnd(7)} cta_level=${cell.cta.padEnd(7)} self_promo=${cell.selfPromoAllowed}` +
        `  ${inFit ? "（F 已标记该渠道）" : ""}`
    );
  }
  console.log("");
  console.log(`写作格式：见 seo-growth/content/CHANNEL_PLAYBOOK.md（F）—— G 不重复定义格式`);
  console.log(`社区规则：全部 Needs Manual Check，发帖前必须自行核对`);
  console.log("");
  console.log(`生成链接示例：npm run community -- link ${contentId} --platform=reddit --path=/`);
}

function cmdLink(positional: string[], flags: Args): void {
  const contentId = positional[0];
  const platform = requirePlatform(flags.platform);
  if (!platform) {
    process.exitCode = 1;
    return;
  }
  if (!contentId) {
    console.error("缺少 content_id");
    process.exitCode = 1;
    return;
  }
  const known = readTopics().some((t) => t.content_id === contentId);
  if (!known) {
    console.error(`F 的 Content Master 里没有 ${contentId}`);
    process.exitCode = 1;
    return;
  }
  const path = flags.path ?? "/";
  console.log(buildCommunityUrl({ platform, path, contentId }));
}

function cmdAdd(positional: string[], flags: Args): void {
  const contentId = positional[0];
  const platform = requirePlatform(flags.platform);
  if (!platform) {
    process.exitCode = 1;
    return;
  }
  if (!contentId) {
    console.error("缺少 content_id");
    process.exitCode = 1;
    return;
  }
  const existing = postsForContent(contentId).filter((p) => p.platform === platform);
  const post = emptyPost();
  post.post_id = flags["post-id"] ?? `${contentId}-${platform.slice(0, 1).toUpperCase()}${existing.length + 1}`;
  post.content_id = contentId;
  post.platform = platform;
  post.community = flags.community ?? "";
  post.status = "Draft";
  post.cta = flags.cta ?? "";
  post.notes = flags.notes ?? "";

  const r = addPost(post);
  if (!r.ok) {
    console.error(`登记失败：${r.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`已登记 ${post.post_id}（Draft）—— 发布后用 publish 回填 URL`);
  if (existing.length > 0) {
    console.warn(`⚠ 该主题在 ${platform} 已发过 ${existing.length} 次，确认不是重复发布`);
  }
}

function cmdPublish(positional: string[], flags: Args): void {
  const postId = positional[0];
  if (!postId || !flags.url) {
    console.error('用法：npm run community -- publish <post_id> --url="https://..."');
    process.exitCode = 1;
    return;
  }
  const r = markPublished(postId, flags.url, { cta: flags.cta });
  if (!r.ok) {
    console.error(`回填失败：${r.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`已标记 Published：${r.post!.post_id} ${r.post!.url} @ ${r.post!.published_at}`);
}

function cmdPosts(flags: Args): void {
  let list = readPosts();
  if (flags.content) list = list.filter((p) => p.content_id === flags.content);
  if (flags.platform) list = postsForPlatform(flags.platform);
  console.log(`发布记录（${COMMUNITY_POSTS_RELATIVE_PATH}）共 ${list.length} 条：`);
  for (const p of list) {
    console.log(
      `  ${p.post_id.padEnd(14)} ${p.content_id.padEnd(6)} ${p.platform.padEnd(14)} ${p.status.padEnd(10)} ${p.published_at || "—"} ${p.url}`
    );
  }
}

function cmdDoctor(): void {
  const r = auditCommunity();
  console.log(`Community Master：${COMMUNITY_MASTER_RELATIVE_PATH}（${r.accounts} 个平台）`);
  console.log(`发布记录：${COMMUNITY_POSTS_RELATIVE_PATH}（${r.posts} 条）`);
  console.log(`重复 platform：${r.duplicatePlatforms.length ? r.duplicatePlatforms.join(", ") : "无"}`);
  console.log(`重复 post_id：${r.duplicatePostIds.length ? r.duplicatePostIds.join(", ") : "无"}`);
  console.log(`账号校验问题：${r.accountIssues.length}`);
  for (const i of r.accountIssues) console.log(`  - ${i.platform} ${i.field}: ${i.message}`);
  console.log(`发布记录校验问题：${r.postIssues.length}`);
  for (const i of r.postIssues) console.log(`  - ${i.post_id} ${i.field}: ${i.message}`);

  const unchecked = ALL_PLATFORMS.filter((p) => !PLATFORM_RULES[p].rulesCheckedAt);
  console.log(`社区规则未核对：${unchecked.length}/${ALL_PLATFORMS.length}（${unchecked.join(", ")}）`);
  if (r.duplicatePlatforms.length || r.duplicatePostIds.length || r.accountIssues.length || r.postIssues.length) {
    process.exitCode = 1;
  }
}

function main(): void {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "list": cmdList(); break;
    case "show": cmdShow(positional); break;
    case "fit": cmdFit(positional); break;
    case "link": cmdLink(positional, flags); break;
    case "add": cmdAdd(positional, flags); break;
    case "publish": cmdPublish(positional, flags); break;
    case "posts": cmdPosts(flags); break;
    case "doctor": cmdDoctor(); break;
    default:
      console.log(`用法：npm run community -- <list|show|fit|link|add|publish|posts|doctor>
  list                              列出 5 个平台账号
  show  <platform>                  账号详情 + 规则 + 最契合内容类型
  fit   <content_id>                某个 F 主题在各平台的契合度与 CTA 强度
  link  <content_id> --platform= [--path=/]   生成带 UTM 的链接
  add   <content_id> --platform= --community= [--cta=] [--post-id=]   登记一条待发帖
  publish <post_id> --url="..."     回填真实 URL（发布后才做）
  posts [--content=] [--platform=]  查发布记录
  doctor                            体检（重复 / 校验 / 规则核对进度）
主库：${COMMUNITY_MASTER_RELATIVE_PATH}
发布记录：${COMMUNITY_POSTS_RELATIVE_PATH}`);
  }
}

main();
