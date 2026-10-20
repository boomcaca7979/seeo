// ===== 预警（alerts）文案的双语写入与读取本地化 =====
// 预警由后台任务生成（审计完成、排名刷新），执行时没有请求 locale，
// 早期实现因此把中文标题直接写进 alerts 表，EN 界面出现中文。
// 新数据写 LText（读取端按 locale 选取）；历史中文行在读取端按模板映射，
// 未知文本（用户关键词、demo 自有文案）原样返回，绝不编造。

import type { LText, LocalizedText } from "@/lib/seo/audit-ltext";

export type AlertLocale = "en" | "zh";

/**
 * 入库序列化。同日去重（hasAlertToday）比较的是这一列的字符串，
 * 所以 LText 必须固定键序，否则同一条事实会因键序不同产生重复预警。
 */
export function serializeAlertText(text: LocalizedText): string {
  if (typeof text === "string") return text;
  return JSON.stringify({ en: text.en, zh: text.zh });
}

/** 出库反序列化：只认 {"en":string,"zh":string}，其余按历史纯文本返回 */
export function parseAlertText(raw: string | null | undefined): LocalizedText | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { en?: unknown; zh?: unknown };
    if (typeof parsed.en === "string" && typeof parsed.zh === "string") {
      return { en: parsed.en, zh: parsed.zh };
    }
  } catch {
    // 不是 LText JSON（用户数据里出现花括号也走这里）
  }
  return trimmed;
}

interface Template {
  re: RegExp;
  build: (m: RegExpMatchArray) => string;
}

const plural = (n: string, one: string, many: string) =>
  Number(n) === 1 ? one : many;

/** 历史中文预警 → EN */
const zhToEn: Template[] = [
  { re: /^(.+) 检测到 404 死链$/, build: (m) => `404 broken links detected on ${m[1]}` },
  { re: /^(.+) 审计错误数增加$/, build: (m) => `More audit errors on ${m[1]}` },
  { re: /^(.+) 审计完成$/, build: (m) => `Audit finished for ${m[1]}` },
  { re: /^关键词「(.+)」从排名 (\d+) 掉出前 100$/, build: (m) => `Keyword "${m[1]}" fell from #${m[2]} out of the top 100` },
  { re: /^关键词「(.+)」排名下降 (\d+) 位$/, build: (m) => `Keyword "${m[1]}" dropped ${m[2]} ${plural(m[2], "position", "positions")}` },
  { re: /^关键词「(.+)」排名上升 (\d+) 位$/, build: (m) => `Keyword "${m[1]}" climbed ${m[2]} ${plural(m[2], "position", "positions")}` },
  { re: /^健康分 良好 · (\d+) 个问题$/, build: (m) => `Health: good · ${m[1]} ${plural(m[1], "issue", "issues")}` },
  { re: /^健康分 (\d+) 个错误 · (\d+) 个问题$/, build: (m) => `Health: ${m[1]} ${plural(m[1], "error", "errors")} · ${m[2]} ${plural(m[2], "issue", "issues")}` },
  { re: /^本次 (\d+) 个错误，上次 (\d+) 个$/, build: (m) => `${m[1]} ${plural(m[1], "error", "errors")} this run vs ${m[2]} last run` },
  { re: /^审计 #(\d+) 发现 404 错误页面，建议添加 301 重定向$/, build: (m) => `Audit #${m[1]} found 404 pages; add 301 redirects` },
  { re: /^域名 (.+) · 上次排名 (\d+)（(.+)）$/, build: (m) => `Domain ${m[1]} · previous rank ${m[2]} (${m[3]})` },
  { re: /^域名 (.+) · (\d+) → (\d+)$/, build: (m) => `Domain ${m[1]} · ${m[2]} → ${m[3]}` },
];

/** 双语预警的 EN 侧 → ZH（历史 EN 行 / demo 数据在中文界面同样要能读） */
const enToZh: Template[] = [
  { re: /^404 broken links detected on (.+)$/, build: (m) => `${m[1]} 检测到 404 死链` },
  { re: /^More audit errors on (.+)$/, build: (m) => `${m[1]} 审计错误数增加` },
  { re: /^Audit finished for (.+)$/, build: (m) => `${m[1]} 审计完成` },
  { re: /^Keyword "(.+)" fell from #(\d+) out of the top 100$/, build: (m) => `关键词「${m[1]}」从排名 ${m[2]} 掉出前 100` },
  { re: /^Keyword "(.+)" dropped (\d+) positions?$/, build: (m) => `关键词「${m[1]}」排名下降 ${m[2]} 位` },
  { re: /^Keyword "(.+)" climbed (\d+) positions?$/, build: (m) => `关键词「${m[1]}」排名上升 ${m[2]} 位` },
  { re: /^Health: good · (\d+) issues?$/, build: (m) => `健康分 良好 · ${m[1]} 个问题` },
  { re: /^Health: (\d+) errors? · (\d+) issues?$/, build: (m) => `健康分 ${m[1]} 个错误 · ${m[2]} 个问题` },
  { re: /^(\d+) errors? this run vs (\d+) last run$/, build: (m) => `本次 ${m[1]} 个错误，上次 ${m[2]} 个` },
  { re: /^Audit #(\d+) found 404 pages; add 301 redirects$/, build: (m) => `审计 #${m[1]} 发现 404 错误页面，建议添加 301 重定向` },
  { re: /^Domain (.+) · previous rank (\d+) \((.+)\)$/, build: (m) => `域名 ${m[1]} · 上次排名 ${m[2]}（${m[3]}）` },
  { re: /^Domain (.+) · (\d+) → (\d+)$/, build: (m) => `域名 ${m[1]} · ${m[2]} → ${m[3]}` },
  // 演示种子预警（scripts/seed-demo-screenshots.mjs 以英文撰写）：中文界面必须可读
  { re: /^Keyword dropped out of top 10$/, build: () => "关键词跌出前 10" },
  { re: /^Keyword ranking dropped$/, build: () => "关键词排名下降" },
  { re: /^Daily rank refresh completed$/, build: () => "每日排名刷新完成" },
  { re: /^Broken internal link detected$/, build: () => "检测到站内死链" },
  { re: /^Health score changed$/, build: () => "健康分变化" },
  { re: /^(\d+) pages? missing meta description$/, build: (m) => `${m[1]} 个页面缺少 meta 描述` },
  { re: /^'(.+)' moved from #(\d+) to #(\d+) for (.+)$/, build: (m) => `「${m[1]}」在 ${m[4]} 的排名从 #${m[2]} 变为 #${m[3]}` },
  { re: /^'(.+)' fell from #(\d+) to #(\d+)$/, build: (m) => `「${m[1]}」从 #${m[2]} 跌至 #${m[3]}` },
  { re: /^Latest full audit found (\d+) critical issues on (.+)$/, build: (m) => `最新完整审计在 ${m[2]} 发现 ${m[1]} 个严重问题` },
  { re: /^(\d+) keywords refreshed for (.+)$/, build: (m) => `已为 ${m[2]} 刷新 ${m[1]} 个关键词` },
  { re: /^(.+) health score (\d+) → (\d+) after latest audit$/, build: (m) => `${m[1]} 健康分在最新审计后从 ${m[2]} 变为 ${m[3]}` },
  { re: /^([\d/.A-Za-z_-]+) returns HTTP (\d+)$/, build: (m) => `${m[1]} 返回 HTTP ${m[2]}` },
];

function map(templates: Template[], text: string): string | null {
  for (const tpl of templates) {
    const m = text.match(tpl.re);
    if (m) return tpl.build(m);
  }
  return null;
}

/** 渲染端唯一入口：DB 里的 title/detail → 当前 locale 可读文本 */
export function alertText(value: LocalizedText | null | undefined, locale: AlertLocale): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return value[locale];
  const hit = map(locale === "en" ? zhToEn : enToZh, value);
  return hit ?? value;
}

/** 双语字面量（写端使用，保证键序与类型一致） */
export function alertLText(zh: string, en: string): LText {
  return { en, zh };
}
