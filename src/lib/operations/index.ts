// ===== L｜Daily Marketing Operations：机器可读规则层 =====
//
// 定位：把已经上线的 A–K 变成一个**每天可重复执行**的运营系统。
//
// 三条不可违反的原则（有测试强制）：
//   1. **不建第二份数据源**：潜客/内容/社区/案例/SEO 落地页/分析 的唯一来源仍是
//      E / F / G / I / H / B 各自的 Master。本模块只**读取与校验**，不复制枚举、不另建库。
//   2. **Daily Log 不是 analytics**：它只记录「我们做了什么」；「用户发生了什么」永远来自 B。
//      signup / activation / payment 三个计数必须来自 B，禁止填估算值；没有数据就填 0。
//   3. **无任何自动执行能力**：模块与脚本内不得出现真实网络调用 —— L 是运营系统，不是营销机器人。
//
// 用户要求的下游动作（发信、发帖、抓联系人、invite、发奖励、Product Hunt launch）在本层
// **不存在实现**，只有人工清单与配额。

import fs from "node:fs";
import path from "node:path";

import { parseCsv } from "../data/csv.ts";
import { LEAD_STATUSES, LEAD_FIELDS, REPLY_STATUSES } from "../leads/schema.ts";
import { CONTENT_STATUSES, CONTENT_FIELDS } from "../content/schema.ts";
import { PLATFORMS, POST_STATUSES } from "../community/schema.ts";
import { CASE_STATUSES, CASE_FIELDS } from "../cases/schema.ts";
// 注意：这里刻意**不**从 ../analytics/server.ts 导入 ALL_EVENTS —— server.ts 用了
// `@/lib/db/migrations` 别名，Node 直跑 TS 的 CLI 无法解析。改为从 B 的源码解析事件名
// （仍在读同一份事实来源，没有复制第二份契约）。
import { LOCALE_ROUTED_PATHS } from "../../i18n/locale-routed-paths.ts";
// sitemap 判定规则：唯一来源在产品层共享模块（见下方 re-export 处的说明）
import { classifySitemap } from "../seo/sitemap-rules.ts";
// E 的「状态 ↔ 真实触达事实」对账判定：同样只有一份实现，L 只读复用（第 13 项自检）
import { isContactedOrLater, type Lead } from "../leads/schema.ts";
import { RECONCILE_FROZEN_STATUSES, inspectContactFact } from "../leads/reconcile.ts";

// ================= 目录与文件（唯一事实来源清单） =================

export const OPS_DIR = "seo-growth/operations";

/** 运营层使用的全部文件；每一项都指向**既有** Master 或 L 新建的运营文档 */
export const OPS_FILES = {
  operatingSystem: `${OPS_DIR}/OPERATING_SYSTEM.md`,
  dailyLog: `${OPS_DIR}/daily-log.csv`,
  weeklyReview: `${OPS_DIR}/WEEKLY_REVIEW.md`,
  // 既有 Master（L 只读，不拥有）
  leads: "seo-growth/leads.csv",
  contentBank: "seo-growth/content-bank.csv",
  communityMaster: "seo-growth/community-master.csv",
  communityPosts: "seo-growth/community-posts.csv",
  caseMaster: "seo-growth/case-studies.csv",
  seoLandingMaster: "seo-growth/seo-landing-master.csv",
  productHuntKit: "seo-growth/product-hunt/LAUNCH_KIT.md",
  referralRules: "seo-growth/referral/RULES.md",
} as const;

/**
 * 只允许存在的 CSV Master 名单（用于「不得出现第二份数据库」的检查）。
 * 出现名单外的同名语义文件（如 daily-leads.csv / leads-2.csv）即为违规。
 */
export const SOLE_MASTER_NAMES: readonly string[] = [
  "leads.csv",
  "content-bank.csv",
  "community-master.csv",
  "community-posts.csv",
  "case-studies.csv",
  "seo-landing-master.csv",
  "daily-log.csv",
];

// ================= 每日循环与起始配额 =================

/** 每日标准循环（顺序有意义：先找问题，再触达，再看数据） */
export const DAILY_LOOP: readonly string[] = [
  "Find prospects",
  "Personalize outreach",
  "Follow up",
  "Community participation",
  "Publish one useful piece",
  "Watch product activity",
  "Record replies",
  "Review analytics",
  "Repeat",
];

/**
 * 这是**运营起始配额**，不是成功承诺。
 * 不要把它读成 KPI、增长保证或营收预测 —— 它只定义「一天默认做多少动作」。
 */
export const DAILY_QUOTAS = {
  newProspects: 10,
  personalizedOutreach: 10,
  followupsMin: 3,
  followupsMax: 5,
  communityInteractions: 5,
  contentPublished: 1,
  replyToAllActiveConversations: true,
  analyticsReviewMinutes: 10,
} as const;

export const QUOTA_DISCLAIMER =
  "起始运营配额，不是成功承诺、KPI 或增长/营收预测。完成与否只描述动作量，不代表结果。";

// ================= Outreach =================

/** 三类可复用模板骨架；实际发送必须人工个性化，且 C 仍是唯一发送基础 */
export const OUTREACH_TEMPLATE_KINDS = [
  {
    id: "problem-led",
    when: "观察到对方站点上的具体问题",
    skeleton: "指出一个真实可核验的问题 → 说明它为什么会影响搜索表现 → 说明怎么自查 → 提供免费审计 → 不施压",
  },
  {
    id: "audit-led",
    when: "对方公开讨论过搜索流量或 SEO 问题",
    skeleton: "引用对方公开说过的内容 → 说明审计会检查哪些项 → 给出免费审计入口 → 询问是否愿意看结果",
  },
  {
    id: "follow-up",
    when: "首封发出后一段时间无回复",
    skeleton: "一句话提醒 → 补充一条新的有用信息（不是催促）→ 给退出选项 → 不再重复追",
  },
] as const;

/** Outreach 红线：不得出现的话术 */
export const OUTREACH_FORBIDDEN = [
  "Best SEO tool / #1 platform / revolutionary 之类的无证据断言",
  "虚构的客户案例、客户 quote 或使用体验",
  "虚构的排名、流量或营收结果",
  "虚假的「我看过你的站」——必须先真的看过",
  "群发同一条未个性化的模板",
];

/** Outreach 第一步永远是「先观察真实问题」 */
export const OUTREACH_RULE = "先指出真实问题 → 再提供帮助 → 再给 Free SEO Audit。缺少第一步就不算合格 outreach。";

/** 默认 CTA 优先免费审计，不强推付费 */
export const DEFAULT_CTA_POLICY = "默认 CTA = Free SEO Audit；只有在对方明确询问付费能力时才讨论套餐。";

// ================= sitemap 核验规则：唯一来源在产品层，L 只复用不复制 =================
//
// 规则本体在 `src/lib/seo/sitemap-rules.ts`（产品层共享模块）。产品审计引擎
// （`src/lib/seo/site-reports.ts` 负责发现、`src/lib/seo/audit-checks.ts` 负责出结论）
// 与运营层（本文件）都从那一份取用 —— 2026-10-02 的 Filebase 事故正是因为
// 「同一条规则在不同地方各写了一份、且只探了一个路径」。
//
// 依赖方向：**L → 产品共享模块**。绝不允许产品层反向 import L（营销运营数据与规则
// 不得进入产品代码或 client bundle）。所以这里只 re-export，不重新定义。

export {
  SITEMAP_VERIFICATION_STEPS,
  SITEMAP_VERDICT_RULES,
  SITEMAP_FALLBACK_PATHS,
  PROSPECTING_VERIFICATION_RULE,
  classifySitemap,
  extractSitemapDeclarations,
} from "../seo/sitemap-rules.ts";

/**
 * 冷启动 outreach 发送暂停开关（人工置位 / 复位）。
 *
 * 事由 2026-10-08（Filebase 事件）：prospecting 的 sitemap 判定规则有缺陷，在规则修正
 * 并复核完已发批次之前，暂停一切新的冷启动发送。
 *
 * 注意：本层**没有任何发送实现**，这个开关不会「阻止」什么自动流程 —— 它是给人工执行者
 * 看的硬性状态位，`ops -- today / doctor` 会显著提示。恢复发送必须由用户显式改回 false。
 */
export const OUTREACH_SEND_HOLD: { active: boolean; since: string; reason: string } = {
  active: true,
  since: "2026-10-08",
  reason: "sitemap 判定规则误报（Filebase 事件）；规则修正 + 已发批次复核完成前暂停新 outreach",
};

// ================= Daily Log =================

/** daily-log.csv 的列（唯一 schema；与 §13 要求一致） */
export const DAILY_LOG_FIELDS = [
  "date",
  "new_leads",
  "outreach_sent",
  "followups_sent",
  "community_interactions",
  "content_published",
  "positive_replies",
  "signup_count",
  "activation_count",
  "payment_count",
  "notes",
] as const;
export type DailyLogField = (typeof DAILY_LOG_FIELDS)[number];
export type DailyLogRow = Record<DailyLogField, string>;

/** 三个「结果类」计数必须来自 B —— 禁止估算 */
export const B_SOURCED_COUNTS: readonly DailyLogField[] = ["signup_count", "activation_count", "payment_count"];

/** notes 中标注数据来源的标记；有结果类计数时必须出现 */
export const B_PROVENANCE_MARKER = "[B]";

export const NUMERIC_LOG_FIELDS: readonly DailyLogField[] = [
  "new_leads",
  "outreach_sent",
  "followups_sent",
  "community_interactions",
  "content_published",
  "positive_replies",
  "signup_count",
  "activation_count",
  "payment_count",
];

// ================= 与 B 的关系 =================

/** 每日只看的核心漏斗；必须与 B 的既有事件契约保持一致（测试强制） */
export const CORE_FUNNEL: readonly string[] = [
  "page_view",
  "audit_started",
  "audit_completed",
  "signup_completed",
  "activation_completed",
  "returning_user",
  "pricing_viewed",
  "upgrade_started",
  "payment_completed",
];

export const ANALYTICS_RULE =
  "B 是唯一数据事实来源。Daily Log 只记录「我们做了什么」，不得替代 B 记录「用户发生了什么」；两侧数字不一致时以 B 为准。";

/**
 * 从 B 的事件契约源码里读出真实事件名。
 * 读的是同一份事实来源（src/lib/analytics/server.ts），因此没有复制第二份契约；
 * 这样 CLI 不必导入带 `@/` 别名的模块（Node 直跑 TS 无法解析别名）。
 */
export function readBEventNames(cwd: string = process.cwd()): string[] {
  const file = path.join(cwd, "src/lib/analytics/server.ts");
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, "utf-8");
  const names = new Set<string>();
  for (const m of src.matchAll(/^\s*"([a-z_]+)",\s*$/gm)) names.add(m[1]);
  return [...names];
}

// ================= 各阶段交接（只读引用，不复制） =================

export const STAGE_HANDOFFS = {
  /** E：唯一的潜客库 */
  leads: {
    owner: "E",
    file: OPS_FILES.leads,
    statuses: [...LEAD_STATUSES],
    forbidden: "不得另建 daily-leads.csv 等第二份联系人库；不得自动生成姓名/邮箱/职位",
  },
  /** F：唯一的内容库 */
  content: {
    owner: "F",
    file: OPS_FILES.contentBank,
    statuses: [...CONTENT_STATUSES],
    dailyPickStatus: "Ready",
    forbidden: "不得另建 content bank；只选 Ready 主题",
  },
  /** G：唯一的社区主库 */
  community: {
    owner: "G",
    file: OPS_FILES.communityPosts,
    platforms: [...PLATFORMS],
    postStatuses: [...POST_STATUSES],
    defaultDailyInteractions: DAILY_QUOTAS.communityInteractions,
    forbidden: "只有真实发布才能写入 community-posts；不得提前填「已发布」",
  },
  /** I：案例库；当前无真实案例 */
  cases: {
    owner: "I",
    file: OPS_FILES.caseMaster,
    statuses: [...CASE_STATUSES],
    expectedRealCases: 0,
    forbidden: "没有证据不得进入 Published；不得为营销需要制造案例",
  },
  /** H：已上线的搜索入口；L 不再增加 landing page */
  seo: {
    owner: "H",
    file: OPS_FILES.seoLandingMaster,
    weeklyTopics: "1–2 个 H problem-intent 页面做外部分发",
    forbidden: "不继续大规模新增 landing page；目标是给已有页面带真实相关流量",
  },
  /** J：仍是准备态 */
  productHunt: {
    owner: "J",
    file: OPS_FILES.productHuntKit,
    state: { realLaunch: false, submission: false, upvoteRequest: false },
    attribution: "NEEDS RECONCILIATION",
    forbidden: "不得自动 Launch、请求 upvote、伪造 maker 身份或客户证据",
  },
  /** K：基础能力；无真实数据 */
  referral: {
    owner: "K",
    file: OPS_FILES.referralRules,
    state: { realReferralData: 0, realInvites: 0, realRewards: 0 },
    forbidden: "不得制造 referral 数据；未挂载分享入口前不作为主要运营渠道",
  },
} as const;

/** 运营层人工确认项（未经真实执行不得勾选） */
export const OPS_MANUAL_CHECKS: readonly string[] = [
  "用 doctor 确认四个既有 Master 与三个运营文件全部存在且 schema 正确",
  "确认今天产出的每条 outreach 都先观察过对方的真实问题",
  "确认今天指出的问题都按核验规则实测过（sitemap 类必须走完 SITEMAP_VERIFICATION_STEPS，不得凭 /sitemap.xml 404 断言无 sitemap）",
  "确认没有任何 outreach 绕过状态机写入（必须 New → Ready to Contact → Contacted；历史已发信的行用 `npm run leads -- backfill-contacted` 对账，不得 add --status=Contacted）",
  "确认写入 community-posts 的每一条都真的已经发布（含 url 与时间）",
  "确认 daily-log 的 signup/activation/payment 三个数字来自 B，而不是估计",
  "确认没有把任何运营文件放进公开站点或 client bundle",
  "确认本轮没有触发任何自动发送 / 自动发帖 / 自动抓取",
];

/** 运营层未决项（不在 L 中关闭） */
export const OPS_OPEN_ITEMS: readonly { id: string; owner: string; status: string; detail: string }[] = [
  { id: "K-OPEN-1", owner: "K", status: "NEEDS DECISION", detail: "referral 是否进入 B 的 canonical source 白名单" },
  { id: "K-OPEN-2", owner: "K", status: "NEEDS DECISION", detail: "code → owner 的服务端反查存储" },
  { id: "K-OPEN-3", owner: "K", status: "NEED MANUAL", detail: "分享入口 UI 尚未挂载" },
  { id: "K-OPEN-4", owner: "K", status: "NEED MANUAL", detail: "服务端撤销名单" },
  { id: "J-OPEN-1", owner: "J", status: "NEEDS RECONCILIATION", detail: "Product Hunt 归因与 G 的 campaignFor 冲突" },
  { id: "I-OPEN-1", owner: "I", status: "NEED MANUAL", detail: "真实案例数仍为 0，尚无任何 Approved 案例" },
];

// ================= 读取既有 Master（只读） =================

export function readCsvRows(cwd: string, rel: string): Record<string, string>[] {
  const file = path.join(cwd, rel);
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf-8"));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}

export function readHeader(cwd: string, rel: string): string[] {
  const file = path.join(cwd, rel);
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf-8"));
  return rows.length ? rows[0].map((h) => h.trim()) : [];
}

// ================= doctor：运营体检 =================

export interface OpsIssue {
  area: string;
  message: string;
}

export interface OpsAudit {
  filesPresent: Record<string, boolean>;
  counts: Record<string, number>;
  funnelInSync: boolean;
  issues: OpsIssue[];
  manualChecks: readonly string[];
  openItems: readonly { id: string; owner: string; status: string; detail: string }[];
}

function emptyRow(fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f, ""]));
}

export function auditOperations(cwd: string = process.cwd()): OpsAudit {
  const issues: OpsIssue[] = [];
  const push = (area: string, message: string) => issues.push({ area, message });

  // ---- 1. 文件存在性 ----
  const filesPresent: Record<string, boolean> = {};
  for (const [key, rel] of Object.entries(OPS_FILES)) {
    const exists = fs.existsSync(path.join(cwd, rel));
    filesPresent[key] = exists;
    if (!exists) push("files", `缺少文件 ${rel}`);
  }

  // ---- 2. 唯一数据源：不得出现第二份库 ----
  const masters = path.join(cwd, "seo-growth");
  if (fs.existsSync(masters)) {
    const allowed = new Set(SOLE_MASTER_NAMES.map((n) => n.toLowerCase()));
    // 语义名匹配：任何看起来像「潜客/内容/社区/案例/落地页/运营日志」的第二份 csv 都算违规
    const suspicious = /lead|content-?bank|community|case-?stud|seo-?landing|daily-?log|prospect|contact-db/;
    for (const name of fs.readdirSync(masters)) {
      if (!name.endsWith(".csv")) continue;
      const lower = name.toLowerCase();
      if (allowed.has(lower)) continue;
      if (suspicious.test(lower)) push("sources", `出现疑似第二份 Master：seo-growth/${name}`);
    }
  }

  // ---- 3. Daily Log schema ----
  const logHeader = readHeader(cwd, OPS_FILES.dailyLog);
  if (logHeader.length && logHeader.join(",") !== DAILY_LOG_FIELDS.join(",")) {
    push("dailyLog", `daily-log 列不匹配：${logHeader.join(",")}`);
  }
  const logRows = readCsvRows(cwd, OPS_FILES.dailyLog);
  for (const r of logRows) {
    for (const f of NUMERIC_LOG_FIELDS) {
      const v = (r[f] ?? "").trim();
      if (v && !/^\d+$/.test(v)) push("dailyLog", `${r.date || "(无日期)"} 的 ${f} 不是非负整数：${v}`);
    }
    const hasCount = B_SOURCED_COUNTS.some((f) => Number(r[f] ?? 0) > 0);
    if (hasCount && !(r.notes ?? "").includes(B_PROVENANCE_MARKER)) {
      push("dailyLog", `${r.date || "(无日期)"} 有结果类计数但 notes 未标注来源 ${B_PROVENANCE_MARKER}`);
    }
  }

  // ---- 4. E：潜客状态必须是 E 的真实枚举 ----
  const leads = readCsvRows(cwd, OPS_FILES.leads);
  if (leads.length && !readHeader(cwd, OPS_FILES.leads).includes("status")) push("leads", "leads.csv 缺少 status 列");
  for (const [i, r] of leads.entries()) {
    if (r.status && !(LEAD_STATUSES as readonly string[]).includes(r.status)) {
      push("leads", `第 ${i + 2} 行 status 非法：${r.status}`);
    }
    if (r.reply_status && !(REPLY_STATUSES as readonly string[]).includes(r.reply_status)) {
      push("leads", `第 ${i + 2} 行 reply_status 非法：${r.reply_status}`);
    }
  }

  // ---- 5. F：内容状态与引用 ----
  const content = readCsvRows(cwd, OPS_FILES.contentBank);
  const contentIds = new Set(content.map((c) => c.content_id?.trim()).filter(Boolean));
  for (const [i, c] of content.entries()) {
    if (c.status && !(CONTENT_STATUSES as readonly string[]).includes(c.status)) {
      push("content", `第 ${i + 2} 行 status 非法：${c.status}`);
    }
  }

  // ---- 6. G：社区引用与「不伪造已发布」 ----
  const posts = readCsvRows(cwd, OPS_FILES.communityPosts);
  const postIds = new Set(posts.map((p) => p.post_id?.trim()).filter(Boolean));
  for (const [i, p] of posts.entries()) {
    if (p.content_id && !contentIds.has(p.content_id.trim())) {
      push("community", `第 ${i + 2} 行引用了不存在的内容：${p.content_id}`);
    }
    if (p.platform && !(PLATFORMS as readonly string[]).includes(p.platform)) {
      push("community", `第 ${i + 2} 行 platform 非法：${p.platform}`);
    }
    if (p.status && !(POST_STATUSES as readonly string[]).includes(p.status)) {
      push("community", `第 ${i + 2} 行 status 非法：${p.status}`);
    }
    // 声称已发布却没有 url / 时间 = 伪造发布记录
    if (p.status === "Published" && (!p.published_at?.trim() || !p.url?.trim())) {
      push("community", `第 ${i + 2} 行标记 Published 但缺少 published_at 或 url（疑似伪造发布）`);
    }
  }

  // ---- 7. I：案例状态与引用 ----
  const cases = readCsvRows(cwd, OPS_FILES.caseMaster);
  for (const [i, c] of cases.entries()) {
    if (c.status && !(CASE_STATUSES as readonly string[]).includes(c.status)) {
      push("cases", `第 ${i + 2} 行 status 非法：${c.status}`);
    }
    for (const cid of (c.related_content ?? "").split("|").map((s) => s.trim()).filter(Boolean)) {
      if (!contentIds.has(cid)) push("cases", `第 ${i + 2} 行 related_content 引用不存在：${cid}`);
    }
    for (const pid of (c.community_posts ?? "").split("|").map((s) => s.trim()).filter(Boolean)) {
      if (!postIds.has(pid)) push("cases", `第 ${i + 2} 行 community_posts 引用不存在：${pid}`);
    }
    for (const p of (c.related_seo_page ?? "").split("|").map((s) => s.trim()).filter(Boolean)) {
      if (!LOCALE_ROUTED_PATHS.has(p)) push("cases", `第 ${i + 2} 行 related_seo_page 不是已收录路径：${p}`);
    }
  }

  // ---- 8. H：落地页路径必须是真实已收录路径 ----
  const landings = readCsvRows(cwd, OPS_FILES.seoLandingMaster);
  for (const [i, l] of landings.entries()) {
    if (l.path && !LOCALE_ROUTED_PATHS.has(l.path.trim())) {
      push("seo", `第 ${i + 2} 行 path 不是已收录路径：${l.path}`);
    }
  }

  // ---- 9. funnel 与 B 契约一致（读 B 的源码，不复制契约） ----
  const bEvents = readBEventNames(cwd);
  const missingEvents = CORE_FUNNEL.filter((e) => !bEvents.includes(e));
  const funnelInSync = bEvents.length > 0 && missingEvents.length === 0;
  if (!funnelInSync) {
    push("analytics", `核心漏斗出现 B 未定义的事件：${missingEvents.join(", ") || "(读不到 B 的事件契约)"}`);
  }

  // ---- 10. 公开暴露面：运营文件不得被站点引用 ----
  const appRoot = path.join(cwd, "src");
  if (fs.existsSync(appRoot)) {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        const rel = path.relative(cwd, full);
        if (["node_modules", ".next", ".git", ".workbuddy"].some((a) => rel === a || rel.startsWith(`${a}/`))) continue;
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || e.name.includes(".test.")) continue;
        if (rel.startsWith("src/lib/operations/")) continue;
        if (/from\s+["'][^"']*lib\/operations["']/.test(fs.readFileSync(full, "utf-8"))) offenders.push(rel);
      }
    };
    walk(appRoot);
    if (offenders.length) push("privacy", `以下文件引用了运营模块：${offenders.join(", ")}`);
  }
  for (const rel of [OPS_FILES.leads, OPS_FILES.dailyLog, OPS_FILES.caseMaster]) {
    if (fs.existsSync(path.join(cwd, "public", path.basename(rel)))) {
      push("privacy", `运营文件出现在 public/：${rel}`);
    }
  }
  const sitemapFile = path.join(cwd, "src/app/sitemap.ts");
  if (fs.existsSync(sitemapFile)) {
    const sm = fs.readFileSync(sitemapFile, "utf-8");
    for (const k of ["operations", "daily-log", "leads", "case-studies"]) {
      if (sm.includes(k)) push("privacy", `sitemap 中出现运营/内部关键词：${k}`);
    }
  }

  // ---- 11. 反自动化：真实调用形态 ----
  const opsFiles = ["src/lib/operations/index.ts", "scripts/ops.mts"];
  const netPattern = new RegExp(
    [String.raw`\bfetch\s*\(`, "axios\\.", "new " + "XMLH" + "ttpRequest", String.raw`sendBeacon\s*\(`, String.raw`https?\.request\s*\(`].join("|")
  );
  for (const rel of opsFiles) {
    const file = path.join(cwd, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => !/const netPattern\s*=|new RegExp\(|String\.raw/.test(l))
      .join("\n");
    if (netPattern.test(src)) push("automation", `${rel} 出现对外调用形态`);
    if (/from\s+["'](axios|node-fetch|got|undici|nodemailer|resend)["']/.test(src)) {
      push("automation", `${rel} 引入了会发请求的依赖`);
    }
  }

  // ---- 12. sitemap 判定规则自检（回归 2026-10-02 Filebase 事故）----
  // 直接消费共享规则跑三个标准场景：一旦规则退化成「/sitemap.xml 404 ⇒ no-sitemap」，这里立刻报警。
  const declaredButUnreachable = classifySitemap({
    found: false,
    declaredUrls: ["https://example.com/sitemap-index.xml"],
    firstResponseStatus: 404,
  });
  if (declaredButUnreachable.verdict !== "sitemap-invalid") {
    push(
      "sitemapRule",
      `判定规则退化：robots 已声明 sitemap 但不可达，应记 sitemap-invalid，实际得到 ${declaredButUnreachable.verdict}`
    );
  }
  const nothingDeclared = classifySitemap({ found: false, declaredUrls: [], firstResponseStatus: 404 });
  if (nothingDeclared.verdict !== "no-sitemap") {
    push(
      "sitemapRule",
      `判定规则退化：robots 未声明且兜底入口全部失败，应记 no-sitemap，实际得到 ${nothingDeclared.verdict}`
    );
  }
  const foundSomewhere = classifySitemap({ found: true, declaredUrls: [], firstResponseStatus: 200 });
  if (foundSomewhere.verdict !== "found") {
    push("sitemapRule", `判定规则退化：已发现可访问 sitemap，实际得到 ${foundSomewhere.verdict}`);
  }

  // ---- 13. E：状态与真实触达事实是否一致（历史 Contacted 对账的持续守卫）----
  // 只读。有 outbound contact 事实的行，状态必须已经承认这次触达（Contacted 及之后）或处于冻结终态；
  // 否则说明又出现了「批量写库但没更新状态」的绕过 —— 修复动作是 `npm run leads -- backfill-contacted`。
  // 判定逻辑复用 E 的唯一实现（src/lib/leads/reconcile.ts），L 不复制第二份。
  for (const [i, r] of leads.entries()) {
    const lead = r as unknown as Lead;
    if (!inspectContactFact(lead).hasFact) continue;
    const statusOk = isContactedOrLater(r.status ?? "") || RECONCILE_FROZEN_STATUSES.includes(r.status ?? "");
    if (!statusOk) {
      push(
        "leadsReconcile",
        `第 ${i + 2} 行 ${r.lead_id || "(无 lead_id)"} 有 outbound contact 事实但 status=${r.status} —— 跑 npm run leads -- backfill-contacted`
      );
    }
  }

  const counts: Record<string, number> = {
    leads: leads.length,
    content: content.length,
    communityPosts: posts.length,
    cases: cases.length,
    landings: landings.length,
    dailyLog: logRows.length,
  };

  return { filesPresent, counts, funnelInSync, issues, manualChecks: OPS_MANUAL_CHECKS, openItems: OPS_OPEN_ITEMS };
}

/** 生成今天应执行的清单（只描述动作，不执行） */
export function dailyChecklist(cwd: string = process.cwd()): { items: string[]; due: string[] } {
  const q = DAILY_QUOTAS;
  const items = [
    `${q.newProspects} new prospects → 只写入 ${OPS_FILES.leads}`,
    `${q.personalizedOutreach} personalized outreach（先观察真实问题；sitemap 类必须按 SITEMAP_VERIFICATION_STEPS 核验）`,
    `${q.followupsMin}–${q.followupsMax} follow-ups`,
    `${q.communityInteractions} community interactions（有实际价值，不强贴链接）`,
    `${q.contentPublished} content publication（从 ${OPS_FILES.contentBank} 选 status=Ready）`,
    "reply to all active conversations",
    `review today's analytics（${q.analyticsReviewMinutes} 分钟，只看核心漏斗与 source）`,
    `最后写入 ${OPS_FILES.dailyLog}（结果类计数必须来自 B，没有就填 0）`,
  ];

  // 到期跟进（只读 E）
  const due = readCsvRows(cwd, OPS_FILES.leads)
    .filter((r) => (r.next_followup_at ?? "").trim() && r.status !== "Suppressed")
    .sort((a, b) => (a.next_followup_at ?? "").localeCompare(b.next_followup_at ?? ""))
    .slice(0, 20)
    .map((r) => `${r.lead_id} ${r.website} status=${r.status} next=${r.next_followup_at}`);

  return { items, due };
}

/** 汇总某一周的运营动作（读 daily-log；B 的结果数字由 daily-log 的 B 来源列承载） */
export function weeklySummary(cwd: string = process.cwd(), weekStartISO?: string): {
  week: string;
  actions: Record<string, number>;
  bResults: Record<string, number>;
  days: number;
  rows: DailyLogRow[];
} {
  const rows = readCsvRows(cwd, OPS_FILES.dailyLog) as DailyLogRow[];
  const anchor = weekStartISO ? new Date(weekStartISO) : new Date();
  const day = anchor.getUTCDay() || 7; // 周一起算
  const monday = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - (day - 1)));
  const start = monday.toISOString().slice(0, 10);
  const end = new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  const inWeek = rows.filter((r) => (r.date ?? "") >= start && (r.date ?? "") <= end);

  const sum = (fields: readonly DailyLogField[]) =>
    fields.reduce((acc, f) => acc + (Number(inWeek.reduce((s, r) => s + Number(r[f] ?? 0), 0)) || 0), 0);

  return {
    week: `${start} → ${end}`,
    days: inWeek.length,
    actions: {
      new_leads: sum(["new_leads"]),
      outreach_sent: sum(["outreach_sent"]),
      followups_sent: sum(["followups_sent"]),
      community_interactions: sum(["community_interactions"]),
      content_published: sum(["content_published"]),
      positive_replies: sum(["positive_replies"]),
    },
    bResults: {
      signup_count: sum(["signup_count"]),
      activation_count: sum(["activation_count"]),
      payment_count: sum(["payment_count"]),
    },
    rows: inWeek,
  };
}

/** 校验并构造一行 daily-log（不写入；写入由脚本负责，且必须人工确认） */
export function buildLogRow(input: Partial<DailyLogRow>): { ok: boolean; row?: DailyLogRow; reasons?: string[] } {
  const reasons: string[] = [];
  const row = emptyRow(DAILY_LOG_FIELDS) as DailyLogRow;
  for (const f of DAILY_LOG_FIELDS) row[f] = (input[f] ?? "").toString().trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) reasons.push("date 必须是 YYYY-MM-DD");
  for (const f of NUMERIC_LOG_FIELDS) {
    const v = row[f] === "" ? "0" : row[f];
    if (!/^\d+$/.test(v)) reasons.push(`${f} 必须是非负整数（不要填估计值）`);
    row[f] = v;
  }
  const hasCount = B_SOURCED_COUNTS.some((f) => Number(row[f]) > 0);
  if (hasCount && !row.notes.includes(B_PROVENANCE_MARKER)) {
    reasons.push(`结果类计数（${B_SOURCED_COUNTS.join("/")}）必须来自 B：请在 notes 中标注 ${B_PROVENANCE_MARKER}`);
  }
  if (!row.notes.trim()) reasons.push("notes 不能为空（至少写今天做了什么/遇到什么）");

  return reasons.length ? { ok: false, reasons } : { ok: true, row };
}

/** 供测试与 CLI 使用的只读清单 */
export const OPS_FIELD_REFS = {
  leads: [...LEAD_FIELDS],
  content: [...CONTENT_FIELDS],
  cases: [...CASE_FIELDS],
} as const;
