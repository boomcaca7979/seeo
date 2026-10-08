// ===== L｜Operations 命令行：doctor / today / weekly / log =====
// 唯一 canonical 运营文档是 seo-growth/operations/OPERATING_SYSTEM.md；
// 机器可读规则在 src/lib/operations/index.ts。
//
// 结构性保证：本文件**没有任何网络调用**，因此不存在自动发信、自动 DM、自动发帖、
// 自动邀请、自动 referral、自动抓取联系人、自动 Product Hunt 动作的可能。
//
// 用法：
//   npm run ops -- doctor                 体检：文件 / schema / 引用 / 虚假记录 / 隐私 / 反自动化
//   npm run ops -- today                  只输出「今天要做什么」
//   npm run ops -- weekly [--week=YYYY-MM-DD]  本周运营动作 + B 来源结果 + 未完成项
//   npm run ops -- log --date=YYYY-MM-DD --outreach=10 --notes="..." [--signup=0 ...]

import fs from "node:fs";
import path from "node:path";
import {
  B_PROVENANCE_MARKER,
  B_SOURCED_COUNTS,
  CORE_FUNNEL,
  DAILY_LOG_FIELDS,
  DAILY_QUOTAS,
  OPS_FILES,
  OUTREACH_SEND_HOLD,
  QUOTA_DISCLAIMER,
  auditOperations,
  buildLogRow,
  dailyChecklist,
  readCsvRows,
  weeklySummary,
  type DailyLogRow,
} from "../src/lib/operations/index.ts";
import { serializeCsv } from "../src/lib/data/csv.ts";

type Flags = Record<string, string>;

function parseArgs(argv: string[]): { cmd: string; flags: Flags } {
  const [cmd = "", ...rest] = argv;
  const flags: Flags = {};
  for (const t of rest) {
    if (!t.startsWith("--")) continue;
    const body = t.slice(2);
    const eq = body.indexOf("=");
    if (eq < 0) flags[body] = "true";
    else flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return { cmd, flags };
}

// ---------------- doctor ----------------
function cmdDoctor(): void {
  const a = auditOperations();
  console.log("=== Operations doctor ===");
  if (OUTREACH_SEND_HOLD.active) {
    console.log(
      `\n⛔ OUTREACH 发送暂停中（自 ${OUTREACH_SEND_HOLD.since}）—— ${OUTREACH_SEND_HOLD.reason}\n`
    );
  }
  console.log("\n文件：");
  for (const [k, v] of Object.entries(a.filesPresent)) {
    console.log(`  ${v ? "✓" : "✗"} ${k.padEnd(18)} ${OPS_FILES[k as keyof typeof OPS_FILES]}`);
  }
  console.log("\n既有 Master 记录数（L 只读，不拥有）：");
  for (const [k, n] of Object.entries(a.counts)) console.log(`  ${k.padEnd(16)} ${n}`);
  console.log(`\n核心漏斗与 B 契约一致：${a.funnelInSync ? "yes" : "NO"}`);
  console.log(`  漏斗：${CORE_FUNNEL.join(" → ")}`);

  console.log("\n每日起始配额（不是成功承诺）：");
  const q = DAILY_QUOTAS;
  console.log(`  新目标 ${q.newProspects} ｜ outreach ${q.personalizedOutreach} ｜ follow-up ${q.followupsMin}–${q.followupsMax}`);
  console.log(`  社区互动 ${q.communityInteractions} ｜ 内容 ${q.contentPublished} ｜ analytics ${q.analyticsReviewMinutes} 分钟`);
  console.log(`  ${QUOTA_DISCLAIMER}`);

  console.log(`\n未决项（${a.openItems.length}，不在 L 中关闭）：`);
  for (const i of a.openItems) console.log(`  - ${i.id} [${i.owner}] ${i.status}：${i.detail}`);

  console.log(`\n人工检查项（NEED MANUAL，${a.manualChecks.length}）：`);
  for (const m of a.manualChecks) console.log(`  - [ ] ${m}`);

  console.log(`\n问题：${a.issues.length}`);
  for (const i of a.issues) console.log(`  !! [${i.area}] ${i.message}`);
  if (a.issues.length) process.exitCode = 1;
}

// ---------------- today ----------------
function cmdToday(): void {
  const { items, due } = dailyChecklist();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== 今天要做什么（${today}）===\n`);
  if (OUTREACH_SEND_HOLD.active) {
    console.log(`  ⛔ OUTREACH 发送暂停中（自 ${OUTREACH_SEND_HOLD.since}）`);
    console.log(`     事由：${OUTREACH_SEND_HOLD.reason}`);
    console.log("     暂停期间：不发新 cold outreach、不回复、不发 follow-up。\n");
  }
  for (const i of items) console.log(`  [ ] ${i}`);
  console.log(`\n${QUOTA_DISCLAIMER}`);
  console.log(`\n到期跟进（读自 ${OPS_FILES.leads}，只读）：`);
  if (due.length === 0) console.log("  （无到期项 —— 潜客库为空或都未设 next_followup_at）");
  else for (const d of due) console.log(`  - ${d}`);
  console.log("\n说明：本命令只输出清单，不会自动发送任何内容。");
}

// ---------------- weekly ----------------
function cmdWeekly(flags: Flags): void {
  const s = weeklySummary(process.cwd(), flags.week);
  console.log(`=== Weekly Review（${s.week}）===\n`);
  console.log(`有记录的天数：${s.days}`);
  console.log("\n我们做了什么（来自 daily-log）：");
  for (const [k, v] of Object.entries(s.actions)) console.log(`  ${k.padEnd(24)} ${v}`);
  console.log(`\n用户发生了什么（daily-log 中标注 ${B_PROVENANCE_MARKER} 的 B 来源数字）：`);
  for (const [k, v] of Object.entries(s.bResults)) console.log(`  ${k.padEnd(24)} ${v}`);
  console.log("  注意：这是从 daily-log 抄录的 B 数字，不是 L 自建 analytics；有疑问以 B 为准。");

  console.log("\n未完成项目：");
  const q = DAILY_QUOTAS;
  const gaps: string[] = [];
  if (s.days === 0) gaps.push("本周没有任何 daily-log 记录 —— 先补记录，再谈结论");
  else {
    const perDay = (n: number) => Math.round((n / s.days) * 10) / 10;
    if (perDay(s.actions.new_leads) < q.newProspects) gaps.push(`新目标日均 ${perDay(s.actions.new_leads)} < 起始配额 ${q.newProspects}`);
    if (perDay(s.actions.outreach_sent) < q.personalizedOutreach) gaps.push(`outreach 日均 ${perDay(s.actions.outreach_sent)} < 起始配额 ${q.personalizedOutreach}`);
    if (perDay(s.actions.community_interactions) < q.communityInteractions) gaps.push(`社区互动日均 ${perDay(s.actions.community_interactions)} < 起始配额 ${q.communityInteractions}`);
    if (perDay(s.actions.content_published) < q.contentPublished) gaps.push(`内容发布日均 ${perDay(s.actions.content_published)} < 起始配额 ${q.contentPublished}`);
  }
  if (gaps.length === 0) console.log("  （按起始配额衡量，没有明显缺口）");
  else for (const g of gaps) console.log(`  - ${g}`);

  console.log(`\n复盘模板：${OPS_FILES.weeklyReview}`);
  console.log("只根据真实记录与 B 数据描述，不做渠道评分、不虚构 ROI、样本不足不下结论。");
}

// ---------------- log ----------------
function cmdLog(flags: Flags): void {
  const input: Partial<DailyLogRow> = { date: flags.date ?? new Date().toISOString().slice(0, 10), notes: flags.notes ?? "" };
  const map: Record<string, string> = {
    "new-leads": "new_leads",
    outreach: "outreach_sent",
    followups: "followups_sent",
    community: "community_interactions",
    content: "content_published",
    "positive-replies": "positive_replies",
    signup: "signup_count",
    activation: "activation_count",
    payment: "payment_count",
  };
  for (const [flag, field] of Object.entries(map)) {
    if (flags[flag] !== undefined) input[field as keyof DailyLogRow] = flags[flag];
  }
  // B 来源计数必须显式声明，避免把估算写进日志
  const counts = B_SOURCED_COUNTS.map((f) => Number(input[f as keyof DailyLogRow] ?? 0));
  if (counts.some((n) => n > 0) && !(input.notes ?? "").includes(B_PROVENANCE_MARKER)) {
    input.notes = `${B_PROVENANCE_MARKER} ${input.notes ?? ""}`.trim();
    console.log(`  已在 notes 前自动加上来源标记 ${B_PROVENANCE_MARKER}（计数须来自 B）`);
  }

  const r = buildLogRow(input);
  if (!r.ok) {
    console.error(`写入被拒绝：${r.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  const row = r.row!;
  const file = path.join(process.cwd(), OPS_FILES.dailyLog);
  const header = DAILY_LOG_FIELDS.join(",");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${header}\n`, "utf-8");

  const existing = readCsvRows(process.cwd(), OPS_FILES.dailyLog) as DailyLogRow[];
  if (existing.some((e) => e.date === row.date)) {
    console.error(`写入被拒绝：${row.date} 已有记录（一天一行，请手工修订而不是追加第二条）`);
    process.exitCode = 1;
    return;
  }
  const rows = [...existing, row].map((e) => DAILY_LOG_FIELDS.map((f) => e[f] ?? ""));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serializeCsv(DAILY_LOG_FIELDS, rows), "utf-8");
  fs.renameSync(tmp, file);
  console.log(`已写入 ${OPS_FILES.dailyLog}：${row.date}`);
  for (const f of DAILY_LOG_FIELDS) if (row[f]) console.log(`  ${f.padEnd(22)} ${row[f]}`);
  console.log(`\n提醒：${B_SOURCED_COUNTS.join(" / ")} 必须来自 B；没有数据就填 0，不要估。`);
}

const { cmd, flags } = parseArgs(process.argv.slice(2));
switch (cmd) {
  case "doctor": cmdDoctor(); break;
  case "today": cmdToday(); break;
  case "weekly": cmdWeekly(flags); break;
  case "log": cmdLog(flags); break;
  default:
    console.log(`用法：npm run ops -- <doctor|today|weekly|log>
  doctor                     体检：文件 / schema / 引用 / 虚假记录 / 隐私 / 反自动化
  today                      输出今天要做什么（只输出清单，不执行）
  weekly [--week=YYYY-MM-DD] 本周运营动作 + B 来源结果 + 未完成项
  log --date=YYYY-MM-DD --outreach=10 --notes="..." [--new-leads= --community= --content= --signup= --activation= --payment=]

唯一 canonical 运营文档：${OPS_FILES.operatingSystem}
唯一数据来源：E leads.csv ｜ F content-bank.csv ｜ G community-*.csv ｜ I case-studies.csv ｜ H seo-landing-master.csv ｜ B analytics
本命令没有任何网络调用，不会自动发送、自动发帖、自动抓取或自动 invite。`);
}
