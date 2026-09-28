// ===== F｜Content Bank 日常命令行 =====
// 每天只需要：看有哪些 Ready → 选一条 → 看各渠道骨架 → 发布后标记使用。
// 不做发布、不连任何平台、不发邮件（§19）。
//
// 用法（Node 22+ 原生运行 TS，无需编译）：
//   npm run content -- list [--status=Ready]
//   npm run content -- show C005
//   npm run content -- use C005 [--status=Published]
//   npm run content -- stale [--today=2026-09-28]
//   npm run content -- doctor
//   npm run content -- ctas

import {
  CONTENT_MASTER_RELATIVE_PATH,
  CONTENT_STATUSES,
  CTA_LIBRARY,
  auditMaster,
  getCta,
  listByStatus,
  markUsed,
  readTopics,
  showChannelSkeletons,
  splitList,
  staleTopics,
  type ContentStatus,
} from "../src/lib/content/index.ts";

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function printRow(t: Record<string, string>): void {
  console.log(
    `${t.content_id}  ${t.status.padEnd(10)} ${t.content_type.padEnd(22)} used=${String(t.times_used).padStart(2)}  last=${(t.last_used_at || "—").padEnd(10)}  ${t.title}`
  );
}

function cmdList(flags: Args): void {
  const status = flags.status;
  if (status && !(CONTENT_STATUSES as readonly string[]).includes(status)) {
    console.error(`未知状态 ${status}。可选：${CONTENT_STATUSES.join(" | ")}`);
    process.exitCode = 1;
    return;
  }
  const topics = status ? listByStatus(status as ContentStatus) : readTopics();
  console.log(`共 ${topics.length} 条${status ? `（status=${status}）` : ""}：`);
  for (const t of topics) printRow(t);
}

function cmdShow(args: string[]): void {
  const id = args[0];
  if (!id) {
    console.error("缺少 content_id");
    process.exitCode = 1;
    return;
  }
  const t = readTopics().find((x) => x.content_id === id);
  if (!t) {
    console.error(`未找到 content_id=${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(`# ${t.content_id} · ${t.title}`);
  console.log(`类型      : ${t.content_type}`);
  console.log(`受众      : ${t.audience}`);
  console.log(`Problem   : ${t.problem}`);
  console.log(`Core      : ${t.core_point}`);
  console.log(`Supporting:`);
  for (const p of splitList(t.supporting_points)) console.log(`  - ${p}`);
  console.log(`Example   : ${t.example}`);
  const cta = getCta(t.cta);
  console.log(`CTA       : ${cta ? `${cta.text}（${cta.id} → ${cta.href}）` : t.cta}`);
  console.log(`来源      : ${t.source}${t.source_detail ? ` — ${t.source_detail}` : ""}`);
  console.log(`渠道      : ${splitList(t.channel_fit).join(", ")}`);
  console.log(`复用间隔  : ${t.recommended_reuse_gap} 天`);
  console.log(`状态      : ${t.status} · used=${t.times_used} · last=${t.last_used_at || "—"}`);
  console.log(`可喂邮件  : ${t.email_compatible}（见 email-links.ts，不新建模板）`);
  if (t.notes) console.log(`备注      : ${t.notes}`);
  console.log("");
  console.log(showChannelSkeletons(t));
}

function cmdUse(args: string[], flags: Args): void {
  const id = args[0];
  if (!id) {
    console.error("缺少 content_id");
    process.exitCode = 1;
    return;
  }
  const r = markUsed(id, { status: (flags.status as ContentStatus) ?? "Published" });
  if (!r.ok) {
    console.error(`标记失败：${r.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`已标记 ${id}：status=${r.topic!.status} last_used_at=${r.topic!.last_used_at} times_used=${r.topic!.times_used}`);
}

function cmdStale(flags: Args): void {
  const day = flags.today ?? today();
  const list = staleTopics(day);
  console.log(`截至 ${day}，超过建议复用间隔未使用的主题 ${list.length} 条：`);
  for (const t of list) printRow(t);
}

function cmdDoctor(): void {
  const r = auditMaster();
  console.log(`主库：${CONTENT_MASTER_RELATIVE_PATH}`);
  console.log(`主题总数：${r.total}`);
  console.log(`重复 content_id：${r.duplicates.length === 0 ? "无" : r.duplicates.join(", ")}`);
  console.log(`校验问题：${r.issues.length}`);
  for (const i of r.issues) console.log(`  - ${i.content_id} ${i.field}: ${i.message}`);
  if (r.duplicates.length > 0 || r.issues.length > 0) process.exitCode = 1;
}

function cmdCtas(): void {
  console.log("CTA 库（内容只能从这里选）：");
  for (const c of CTA_LIBRARY) console.log(`  ${c.id.padEnd(20)} ${c.text.padEnd(42)} ${c.href}`);
}

function main(): void {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "list":
      cmdList(flags);
      break;
    case "show":
      cmdShow(positional);
      break;
    case "use":
      cmdUse(positional, flags);
      break;
    case "stale":
      cmdStale(flags);
      break;
    case "doctor":
      cmdDoctor();
      break;
    case "ctas":
      cmdCtas();
      break;
    default:
      console.log(`用法：npm run content -- <list|show|use|stale|doctor|ctas>
  list  [--status=Ready|Idea|Draft|Published|Repurpose|Retired]
  show  <content_id>          看 Core + 各渠道骨架
  use   <content_id>          发布后标记：Published / last_used_at / times_used+1
  stale [--today=YYYY-MM-DD]  列出超过复用间隔未用的主题
  doctor                      校验主库（schema / 枚举 / 重复 / CTA / 来源 / 隐私）
  ctas                        列出 CTA 库
主库：${CONTENT_MASTER_RELATIVE_PATH}`);
  }
}

main();
