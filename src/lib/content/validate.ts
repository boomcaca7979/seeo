// ===== F｜Content Master 校验 =====
// 纯函数，供测试与 CLI 共用。校验哪些字段、以什么标准，全部集中在这里。

import {
  BANNED_PHRASES,
  MAX_SUPPORTING_POINTS,
  MIN_CORE_POINT_LEN,
  MIN_PROBLEM_LEN,
  MIN_SUPPORTING_POINTS,
  isContentChannel,
  isContentSource,
  isContentStatus,
  isContentType,
  isCtaId,
  isDateOrEmpty,
  isNonNegInt,
  isReuseGap,
  splitList,
  type ContentTopic,
} from "./schema.ts";

export interface ContentIssue {
  field: string;
  message: string;
}

function allText(t: ContentTopic): string {
  return [
    t.title,
    t.problem,
    t.core_point,
    t.supporting_points,
    t.example,
    t.notes,
    t.source_detail,
  ].join("\n");
}

export function validateTopic(t: ContentTopic): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const push = (field: string, message: string) => issues.push({ field, message });

  // ---- 必填 ----
  if (!t.content_id.trim()) push("content_id", "content_id 不能为空");
  if (!t.title.trim()) push("title", "title 不能为空");
  if (!t.audience.trim()) push("audience", "audience 不能为空（写给谁看）");
  if (!t.cta.trim()) push("cta", "cta 不能为空");
  if (!t.source.trim()) push("source", "source 不能为空（内容来源必须记录）");
  if (!t.content_type.trim()) push("content_type", "content_type 不能为空");
  if (!t.status.trim()) push("status", "status 不能为空");

  // ---- 枚举 ----
  if (t.content_type && !isContentType(t.content_type)) {
    push("content_type", `content_type 非法：${t.content_type}`);
  }
  if (t.status && !isContentStatus(t.status)) push("status", `status 非法：${t.status}`);
  if (t.source && !isContentSource(t.source)) push("source", `source 非法：${t.source}`);
  if (t.cta && !isCtaId(t.cta)) push("cta", `cta 必须来自 CTA 库（ctas.ts）：${t.cta}`);
  if (t.recommended_reuse_gap && !isReuseGap(t.recommended_reuse_gap)) {
    push("recommended_reuse_gap", `recommended_reuse_gap 只能是 14 / 21 / 30，当前：${t.recommended_reuse_gap}`);
  }
  if (t.email_compatible && t.email_compatible !== "yes" && t.email_compatible !== "no") {
    push("email_compatible", `email_compatible 只能是 yes / no，当前：${t.email_compatible}`);
  }

  // ---- 渠道 ----
  const channels = splitList(t.channel_fit);
  if (channels.length === 0) push("channel_fit", "channel_fit 至少一个渠道");
  for (const c of channels) {
    if (!isContentChannel(c)) push("channel_fit", `未知渠道：${c}`);
  }

  // ---- 质量下限（§20：必须能回答「用户遇到什么问题 / 有什么真正有用的信息」）----
  if (t.problem.trim().length < MIN_PROBLEM_LEN) {
    push("problem", `problem 过于空泛（至少 ${MIN_PROBLEM_LEN} 字，要能说清用户到底卡在哪）`);
  }
  if (t.core_point.trim().length < MIN_CORE_POINT_LEN) {
    push("core_point", `core_point 过于空泛（至少 ${MIN_CORE_POINT_LEN} 字）`);
  }
  const points = splitList(t.supporting_points);
  if (points.length < MIN_SUPPORTING_POINTS || points.length > MAX_SUPPORTING_POINTS) {
    push("supporting_points", `supporting_points 需要 ${MIN_SUPPORTING_POINTS}–${MAX_SUPPORTING_POINTS} 条，当前 ${points.length} 条`);
  }
  if (!t.example.trim()) push("example", "example 不能为空（需要具体例子 / 具体检查项）");

  // ---- 禁用空话（逐个字段定位，便于直接改到点上）----
  for (const field of ["title", "problem", "core_point", "supporting_points", "example", "notes"] as const) {
    const text = (t[field] ?? "").toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      if (text.includes(phrase.toLowerCase())) {
        push(field, `命中禁用空泛话术：「${phrase}」`);
      }
    }
  }

  // ---- 状态与时间 ----
  if (!isDateOrEmpty(t.created_at)) push("created_at", "created_at 必须是 YYYY-MM-DD");
  if (!isDateOrEmpty(t.last_used_at)) push("last_used_at", "last_used_at 必须是 YYYY-MM-DD 或留空");
  if (!isNonNegInt(t.times_used)) push("times_used", "times_used 必须是非负整数");
  if (t.status === "Published" && !t.last_used_at) {
    push("last_used_at", "Published 状态必须记录 last_used_at");
  }
  if (t.times_used && Number(t.times_used) > 0 && !t.last_used_at) {
    push("last_used_at", "times_used > 0 时必须记录 last_used_at");
  }

  // ---- 隐私（§13 / §17）：来自用户问题的主题只能存匿名化问题描述 ----
  if (t.source === "User Question") {
    const detail = t.source_detail ?? "";
    if (!detail.trim()) {
      push("source_detail", "source = User Question 时必须填写匿名化说明");
    }
    if (/@/.test(detail) || /https?:\/\//i.test(detail) || /\bwww\./i.test(detail)) {
      push("source_detail", "source_detail 不得包含邮箱或网址（必须匿名化）");
    }
  }
  // 全字段兜底：Content Bank 不允许出现可识别个人的邮箱
  const emailHit = allText(t).match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (emailHit) push("title", `内容中出现邮箱（${emailHit[0]}），Content Bank 禁止存放个人身份信息`);

  return issues;
}

/** 一批主题里的重复 content_id（返回重复的 id 列表） */
export function findDuplicateIds(topics: readonly ContentTopic[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const t of topics) {
    const id = t.content_id.trim();
    if (!id) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}
