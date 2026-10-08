// ===== E｜潜客数据库（Lead Master）日常命令行工具 =====
// 目的只有一个：让「每天录入 / 跟进 / 标记状态」不需要打开数据库，且受去重与状态机保护。
// 不做 CRM UI、不做批量发送、不碰 Resend、不新增任何公开 URL。
//
// 用法（Node 22+ 可直接运行 TS，无需编译）：
//   node scripts/leads.ts init
//   node scripts/leads.ts add --website=example.com --email=a@a.com \
//        --lead-type=SaaS --specific-issue="Duplicate title tags" --source=reddit \
//        --template=A_website_issue_v1 [--company=..] [--contact=..] [--role=..]
//   node scripts/leads.ts due [--today=2026-09-28]
//   node scripts/leads.ts list [--status=Contacted] [关键词]
//   node scripts/leads.ts show <lead_id>
//   node scripts/leads.ts update <lead_id> --status=Contacted --next-followup=2026-10-05
//   node scripts/leads.ts suppress <lead_id> --reason="asked to stop"
//   node scripts/leads.ts backfill-contacted [--apply]   历史 Contacted 对账（默认 dry-run）
//
// 注意：--lead-type 支持随手写法（saas / software / SEO agency …），会自动收敛到标准值；
// 无法识别时会列出标准值并要求人工选择，绝不猜成 Other。

import {
  LEAD_MASTER_RELATIVE_PATH,
  LEAD_STATUSES,
  LEAD_TEMPLATE_IDS,
  LEAD_TYPES,
  RECONCILE_NOTE_MARKER,
  addLead,
  backfillContacted,
  dueFollowUps,
  isFollowUpEligible,
  nextFollowUpStatus,
  normalizeLeadType,
  readLeads,
  searchLeads,
  updateLead,
  writeLeads,
  type Lead,
  type LeadStatus,
} from "../src/lib/leads/index.ts";

type Args = Record<string, string>;

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Args } {
  const [cmd = "", ...rest] = argv;
  const positional: string[] = [];
  const flags: Args = {};
  for (const token of rest) {
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq < 0) flags[body] = "true";
      else flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      positional.push(token);
    }
  }
  return { cmd, positional, flags };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function printLead(l: Lead): void {
  console.log(
    `${l.lead_id}  ${l.status.padEnd(16)} ${l.website.padEnd(28)} ${l.email.padEnd(24)} ${l.lead_type}`
  );
}

function printLeadDetail(l: Lead): void {
  console.log(`lead_id      : ${l.lead_id}`);
  console.log(`website      : ${l.website}`);
  console.log(`company      : ${l.company}`);
  console.log(`contact      : ${l.contact_name} ${l.role ? `(${l.role})` : ""}`);
  console.log(`email        : ${l.email}`);
  console.log(`lead_type    : ${l.lead_type}`);
  console.log(`specific_issue: ${l.specific_issue}`);
  console.log(`issue_type   : ${l.issue_type}`);
  console.log(`status       : ${l.status}`);
  console.log(`template     : ${l.template}  campaign=${l.campaign}  utm_content=${l.utm_content}`);
  console.log(`contacted    : first=${l.first_contacted_at} last=${l.last_contacted_at} next=${l.next_followup_at}`);
  console.log(`pipeline     : reply=${l.reply_status} interest=${l.interest} signup=${l.signup} activation=${l.activation} paid=${l.paid}`);
  console.log(`audit        : ${l.audit_url}${l.audit_date ? ` (${l.audit_date})` : ""}`);
  console.log(`next_action  : ${l.next_action}`);
  console.log(`notes        : ${l.notes}`);
}

function cmdInit(): void {
  const existing = readLeads();
  if (existing.length > 0) {
    console.log(`主库已存在，共 ${existing.length} 条 Lead：${LEAD_MASTER_RELATIVE_PATH}`);
    return;
  }
  writeLeads([]);
  console.log(`已初始化 Lead Master（仅表头）：${LEAD_MASTER_RELATIVE_PATH}`);
}

function cmdAdd(flags: Args): void {
  const website = flags.website ?? "";
  if (!website) {
    console.error("缺少 --website");
    process.exitCode = 1;
    return;
  }
  const rawType = flags["lead-type"] ?? flags.lead_type ?? "";
  const leadType = normalizeLeadType(rawType);
  if (!leadType) {
    console.error(`无法识别的 --lead-type="${rawType}"。标准值：\n  ${LEAD_TYPES.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }
  const template = flags.template ?? "";
  if (template && !LEAD_TEMPLATE_IDS.includes(template)) {
    console.error(`未知模板 ${template}。C 阶段已注册模板：\n  ${LEAD_TEMPLATE_IDS.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }

  const result = addLead({
    website,
    email: flags.email ?? "",
    company: flags.company ?? "",
    contact_name: flags.contact ?? flags["contact-name"] ?? "",
    role: flags.role ?? "",
    lead_type: leadType,
    company_size: flags["company-size"] ?? "",
    industry: flags.industry ?? "",
    specific_issue: flags["specific-issue"] ?? "",
    issue_type: flags["issue-type"] ?? "",
    source: flags.source ?? "",
    campaign: flags.campaign ?? "",
    template,
    status: flags.status ?? "New",
    notes: flags.notes ?? "",
    next_action: flags["next-action"] ?? "",
  });

  if (!result.ok) {
    console.error(`新增失败：${result.reason ?? result.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  for (const w of result.warnings ?? []) console.warn(`⚠ ${w}`);
  console.log(`已新增 Lead ${result.lead!.lead_id} → ${LEAD_MASTER_RELATIVE_PATH}`);
  printLeadDetail(result.lead!);
}

function cmdDue(flags: Args): void {
  const day = flags.today ?? today();
  const due = dueFollowUps(readLeads(), day);
  console.log(`今天（${day}）该跟进 ${due.length} 条：`);
  for (const l of due) {
    const next = nextFollowUpStatus(l);
    console.log(`  ${l.lead_id}  ${l.website}  ${l.email}  ${l.status} → ${next ?? "(序列已结束)"}  due=${l.next_followup_at}`);
  }
}

function cmdList(flags: Args, positional: string[]): void {
  const q = positional[0] ?? "";
  let rows = q ? searchLeads(q) : readLeads();
  if (flags.status) rows = rows.filter((l) => l.status === flags.status);
  console.log(`共 ${rows.length} 条：`);
  for (const l of rows) printLead(l);
}

function cmdShow(positional: string[]): void {
  const id = positional[0];
  if (!id) {
    console.error("缺少 lead_id");
    process.exitCode = 1;
    return;
  }
  const hit = readLeads().find((l) => l.lead_id === id);
  if (!hit) {
    console.error(`未找到 lead_id=${id}`);
    process.exitCode = 1;
    return;
  }
  printLeadDetail(hit);
}

function cmdUpdate(positional: string[], flags: Args): void {
  const id = positional[0];
  if (!id) {
    console.error("缺少 lead_id");
    process.exitCode = 1;
    return;
  }
  if (flags.status && !LEAD_STATUSES.includes(flags.status as LeadStatus)) {
    console.error(`未知状态 ${flags.status}。标准值：${LEAD_STATUSES.join(" | ")}`);
    process.exitCode = 1;
    return;
  }
  if (flags.template && !LEAD_TEMPLATE_IDS.includes(flags.template)) {
    console.error(`未知模板 ${flags.template}`);
    process.exitCode = 1;
    return;
  }

  const patch: Partial<Lead> = {};
  for (const [flag, field] of [
    ["status", "status"],
    ["template", "template"],
    ["next-followup", "next_followup_at"],
    ["specific-issue", "specific_issue"],
    ["notes", "notes"],
    ["next-action", "next_action"],
    ["reply-status", "reply_status"],
    ["signup", "signup"],
    ["activation", "activation"],
    ["paid", "paid"],
    ["email", "email"],
  ] as Array<[string, keyof Lead]>) {
    const v = flags[flag];
    if (typeof v === "string") (patch as Record<string, string>)[field] = v;
  }

  const r = updateLead(id, patch);
  if (!r.ok) {
    console.error(`更新失败：${r.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`已更新 ${id} → status=${r.lead!.status}`);
}

function cmdSuppress(positional: string[], flags: Args): void {
  const id = positional[0];
  if (!id) {
    console.error("缺少 lead_id");
    process.exitCode = 1;
    return;
  }
  const r = updateLead(id, {
    status: "Suppressed",
    next_followup_at: "",
    notes: `已抑制：${flags.reason ?? flags.notes ?? "对方要求不再联系"}`,
  });
  if (!r.ok) {
    console.error(`抑制失败：${r.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`已标记 Suppressed：${id}（此后永不进入跟进队列：${isFollowUpEligible(r.lead!) === false}）`);
}

// ---------------- backfill-contacted（历史 Contacted 回填 / 对账） ----------------
//
// 只做对账：把「真实 outbound contact 事实」与「状态机模型」对齐。
// 默认 dry-run（只算不写）；写库必须显式 --apply。
// 不改触达时间、不新增发送、不发任何邮件、无任何网络调用。

function cmdBackfillContacted(flags: Args): void {
  const apply = "apply" in flags;
  const r = backfillContacted({ apply });

  console.log(`=== leads backfill-contacted（${apply ? "APPLY 写库" : "DRY-RUN 只算不写"}）===`);
  console.log(`主库：${LEAD_MASTER_RELATIVE_PATH}`);
  console.log(`标记：${RECONCILE_NOTE_MARKER}\n`);

  const s = r.plan.summary;
  console.log(`总数 ${s.total}`);
  console.log(`  会补状态为 Contacted（有事实但状态未到） : ${s.promoteToContacted}`);
  console.log(`  登记历史豁免（有事实、无 template）        : ${s.recordGrandfather}`);
  console.log(`  已与状态机一致                            : ${s.alreadyConsistent}`);
  console.log(`  已对账过（幂等，重跑不动）                : ${s.alreadyReconciled}`);
  console.log(`  拒绝推进（有事实但缺 specific_issue）     : ${s.blockedMissingIssue}`);
  console.log(`  无发送事实不动（不会自动升级 New）        : ${s.skippedNoFact}`);
  console.log(`  冻结状态不动（Suppressed / Not Interested / No Response）: ${s.skippedFrozen}`);
  console.log(`\nstatus 变更行数：${s.statusChanges}　会写库行数：${s.writable}`);

  const interesting = r.plan.entries.filter((e) => e.writes || e.action === "blocked-missing-issue");
  if (interesting.length > 0) {
    console.log("\n明细：");
    const shown = interesting.slice(0, 50);
    for (const e of shown) {
      console.log(`  ${apply ? "→" : "·"} ${e.lead_id.padEnd(10)} ${e.statusBefore.padEnd(14)} → ${e.statusAfter.padEnd(14)} ${e.action}`);
      console.log(`      ${e.reason}`);
    }
    if (interesting.length > shown.length) console.log(`  …还有 ${interesting.length - shown.length} 条（同上，未逐条列出）`);
  } else {
    console.log("\n明细：（没有需要改动的行）");
  }

  if (!r.ok) {
    console.error(`\n写库被拒绝（全表校验未通过，未写入任何内容）：\n  ${r.reasons?.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n结论：${r.dryRun ? "DRY-RUN，未写入任何内容（加 --apply 才写）" : `已写 ${r.written} 行（幂等：再跑一次应为 0）`}`
  );
  console.log("保证：未修改 first_contacted_at / last_contacted_at / next_followup_at；未新增任何发送；未发任何邮件。");

  if (s.blockedMissingIssue > 0) {
    console.error(`\n⚠ ${s.blockedMissingIssue} 条有发送事实但缺 specific_issue —— 需人工补录后再对账。`);
    process.exitCode = 1;
  }
}

function main(): void {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "init":
      cmdInit();
      break;
    case "add":
      cmdAdd(flags);
      break;
    case "due":
      cmdDue(flags);
      break;
    case "list":
      cmdList(flags, positional);
      break;
    case "show":
      cmdShow(positional);
      break;
    case "update":
      cmdUpdate(positional, flags);
      break;
    case "suppress":
      cmdSuppress(positional, flags);
      break;
    case "backfill-contacted":
      cmdBackfillContacted(flags);
      break;
    default:
      console.log(`用法：node scripts/leads.ts <init|add|due|list|show|update|suppress|backfill-contacted> [选项]
  init                       初始化主库（仅表头）
  add   --website= --lead-type= [--email= --specific-issue= --template= --source= ...]
  due   [--today=YYYY-MM-DD] 列出今天该跟进的 Lead
  list  [--status=...] [关键词]
  show  <lead_id>
  update <lead_id> --status=... [--next-followup=... --notes=...]
  suppress <lead_id> --reason="..."   标记永不联系
  backfill-contacted [--apply]        历史 Contacted 对账（默认 dry-run）

状态机纪律：新发送必须走 New → Ready to Contact → Contacted（update 逐次迁移）。
不得用 add --status=Contacted 绕过；历史已发信的行用 backfill-contacted 对账。
主库：${LEAD_MASTER_RELATIVE_PATH}`);
  }
}

main();
