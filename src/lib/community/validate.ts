// ===== G｜Community Master / 发布记录 校验 =====
// 纯函数。关键约束：
//   - primary_cta 必须来自 F 的 CTA 库（§12）
//   - 帖子的 content_id 必须真实存在于 F 的 Content Master（§11/§17）
//   - Published 必须有 url 与 published_at（§13）
//   - Removed 必须记录原因（§13：社区删除要记原因，不偷偷重发）
//   - 规则未核对时必须写 Needs Manual Check，不得声称已核对（§14）
//   - 不得出现邮箱 / 凭据（§19）

import { CTA_IDS } from "../content/ctas.ts";
import {
  BANNED_PROMO_PHRASES,
  FORBIDDEN_SECRET_PATTERNS,
  isAccountStatus,
  isDateOrEmpty,
  isPlatform,
  isPostStatus,
  isProfileStatus,
  splitList,
  type CommunityAccount,
  type CommunityPost,
} from "./schema.ts";

export interface Issue {
  field: string;
  message: string;
}

function accountText(a: CommunityAccount): string {
  return [a.account_name, a.profile_url, a.bio, a.positioning, a.purpose, a.audience, a.notes].join("\n");
}

export function validateAccount(a: CommunityAccount): Issue[] {
  const issues: Issue[] = [];
  const push = (field: string, message: string) => issues.push({ field, message });

  if (!isPlatform(a.platform)) push("platform", `platform 必须是 5 个渠道之一，当前：${a.platform || "(空)"}`);
  if (!a.account_name.trim()) push("account_name", "account_name 不能为空");
  if (!a.profile_status || !isProfileStatus(a.profile_status)) {
    push("profile_status", `profile_status 必须是 not_created / created / needs_manual_check，当前：${a.profile_status}`);
  }
  if (!a.status || !isAccountStatus(a.status)) {
    push("status", `status 必须是 Planned / Ready / Active / Paused，当前：${a.status}`);
  }
  if (!a.audience.trim()) push("audience", "audience 不能为空");
  if (!a.purpose.trim()) push("purpose", "purpose 不能为空");
  if (!a.positioning.trim()) push("positioning", "positioning 不能为空");
  if (!a.bio.trim()) push("bio", "bio 不能为空");
  if (!a.primary_cta.trim()) {
    push("primary_cta", "primary_cta 不能为空");
  } else if (!CTA_IDS.includes(a.primary_cta)) {
    push("primary_cta", `primary_cta 必须来自 F 的 CTA 库（src/lib/content/ctas.ts）：${a.primary_cta}`);
  }
  const types = splitList(a.content_types);
  if (types.length === 0) push("content_types", "content_types 至少一项");

  if (a.website && !/^https?:\/\//.test(a.website)) push("website", "website 必须是完整 URL");
  if (a.profile_url && !/^https?:\/\//.test(a.profile_url)) push("profile_url", "profile_url 必须是完整 URL");
  if (!isDateOrEmpty(a.rules_checked_at)) push("rules_checked_at", "rules_checked_at 必须是 YYYY-MM-DD 或留空");

  // §14：没有真正核对过就不要声称已核对
  if (!a.rules_checked_at && !/needs manual check/i.test(a.self_promo_notes)) {
    push("self_promo_notes", "未核对平台规则时必须明确写 Needs Manual Check，不得写 PASS / allowed");
  }
  if (a.rules_checked_at && !isDateOrEmpty(a.rules_checked_at)) {
    push("rules_checked_at", "已核对时间格式不正确");
  }

  // §5/§10：无证据的夸大宣传
  const text = accountText(a).toLowerCase();
  for (const phrase of BANNED_PROMO_PHRASES) {
    if (text.includes(phrase.toLowerCase())) push("bio", `命中无证据宣传话术：「${phrase}」`);
  }

  // §19：不得出现邮箱 / 凭据
  for (const { re, why } of FORBIDDEN_SECRET_PATTERNS) {
    const hit = accountText(a).match(re);
    if (hit) push("notes", `Community Master ${why}：${hit[0].slice(0, 24)}…`);
  }

  return issues;
}

export function validatePost(p: CommunityPost, knownContentIds: readonly string[]): Issue[] {
  const issues: Issue[] = [];
  const push = (field: string, message: string) => issues.push({ field, message });

  if (!p.post_id.trim()) push("post_id", "post_id 不能为空");
  if (!isPlatform(p.platform)) push("platform", `platform 非法：${p.platform || "(空)"}`);
  if (!p.content_id.trim()) {
    push("content_id", "content_id 不能为空（每条社区帖子都必须能追溯到 F 的主题）");
  } else if (!knownContentIds.includes(p.content_id.trim())) {
    push("content_id", `F 的 Content Master 里不存在 ${p.content_id}`);
  }
  if (!p.status || !isPostStatus(p.status)) {
    push("status", `status 必须是 Draft / Ready / Published / Removed / Archived，当前：${p.status}`);
  }
  if (!isDateOrEmpty(p.published_at)) push("published_at", "published_at 必须是 YYYY-MM-DD 或留空");
  if (p.cta && !CTA_IDS.includes(p.cta)) push("cta", `cta 必须来自 F 的 CTA 库：${p.cta}`);

  if (p.status === "Published") {
    if (!p.url.trim()) push("url", "Published 状态必须记录帖子 URL");
    else if (!/^https?:\/\//.test(p.url)) push("url", "url 必须是完整 URL");
    if (!p.published_at.trim()) push("published_at", "Published 状态必须记录 published_at");
  }
  if (p.status === "Removed" && !p.notes.trim()) {
    push("notes", "被删除的帖子必须记录原因（不得静默重发）");
  }

  for (const { re, why } of FORBIDDEN_SECRET_PATTERNS) {
    const hit = [p.url, p.notes, p.community].join("\n").match(re);
    if (hit) push("notes", `发布记录 ${why}：${hit[0].slice(0, 24)}…`);
  }

  return issues;
}

/** 重复 post_id */
export function findDuplicatePostIds(posts: readonly CommunityPost[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const p of posts) {
    const id = p.post_id.trim();
    if (!id) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/** 重复 platform（每个平台只允许一行主记录） */
export function findDuplicatePlatforms(accounts: readonly CommunityAccount[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const a of accounts) {
    const p = a.platform.trim();
    if (!p) continue;
    if (seen.has(p)) dup.add(p);
    seen.add(p);
  }
  return [...dup];
}
