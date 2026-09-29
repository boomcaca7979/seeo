// ===== I｜案例基地 命令行 =====
// 只做「录入 → 看状态 → 推进审核 → 体检」。不发布任何内容、不发邮件、不建公开页面。
//
// 用法（Node 22+ 原生运行 TS）：
//   npm run cases -- list [--status=Review]
//   npm run cases -- show CASE-001
//   npm run cases -- add --id=CASE-001 --subject="Technical SEO" --challenge="..." --used="..." [--status=Lead ...]
//   npm run cases -- status CASE-001 Approved [--evidence=Audit --evidence-location="..."]
//   npm run cases -- doctor

import {
  CASE_CHANNELS,
  CASE_MASTER_RELATIVE_PATH,
  CASE_SOURCES,
  CASE_STATUSES,
  CASE_TYPES,
  EVIDENCE_TYPES,
  addCase,
  auditCases,
  crossReferenceIssues,
  emptyCase,
  readCases,
  setStatus,
  type CaseStatus,
} from "../src/lib/cases/index.ts";
import { readTopics } from "../src/lib/content/index.ts";
import { LOCALE_ROUTED_PATHS } from "../src/i18n/locale-routed-paths.ts";

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

function printRow(c: Record<string, string>): void {
  console.log(
    `  ${c.case_id.padEnd(12)} ${c.status.padEnd(18)} ${(c.subject_type || "—").padEnd(18)} evidence=${(c.evidence_type || "—").padEnd(16)} published=${c.published || "—"}`
  );
}

function cmdList(flags: Args): void {
  let rows = readCases();
  if (flags.status) rows = rows.filter((c) => c.status === flags.status);
  console.log(`Case Master（${CASE_MASTER_RELATIVE_PATH}）共 ${rows.length} 条：`);
  for (const c of rows) printRow(c);
  if (rows.length === 0) console.log("  （0 条 —— NO REAL CASE DATA YET）");
}

function cmdShow(positional: string[]): void {
  const id = positional[0];
  if (!id) {
    console.error("缺少 case_id");
    process.exitCode = 1;
    return;
  }
  const c = readCases().find((x) => x.case_id === id);
  if (!c) {
    console.error(`未找到 case_id=${id}`);
    process.exitCode = 1;
    return;
  }
  for (const [k, v] of Object.entries(c)) {
    if (v) console.log(`  ${k.padEnd(20)} ${v}`);
  }
}

function cmdAdd(flags: Args): void {
  const record = emptyCase();
  record.case_id = flags.id ?? "";
  record.status = flags.status ?? "Lead";
  record.source = flags.source ?? "";
  record.subject_type = flags.subject ?? "";
  record.website = flags.website ?? "";
  record.industry = flags.industry ?? "";
  record.challenge = flags.challenge ?? "";
  record.seeo_used = flags.used ?? "";
  record.evidence_type = flags.evidence ?? "";
  record.evidence_location = flags["evidence-location"] ?? "";
  record.result = flags.result ?? "";
  record.metric = flags.metric ?? "";
  record.before_value = flags.before ?? "";
  record.after_value = flags.after ?? "";
  record.result_period = flags["result-period"] ?? "";
  record.anonymize_required = flags.anonymize ?? "";
  record.site_consent = flags["site-consent"] ?? "";
  record.logo_consent = flags["logo-consent"] ?? "";
  record.quote_consent = flags["quote-consent"] ?? "";
  record.channels = flags.channels ?? "";
  record.related_content = flags["related-content"] ?? "";
  record.related_seo_page = flags["related-seo-page"] ?? "";

  if (!record.case_id) {
    console.error("缺少 --id=CASE-001");
    process.exitCode = 1;
    return;
  }
  const r = addCase(record);
  if (!r.ok) {
    console.error(`新增失败：${r.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`已新增 ${record.case_id}（status=${record.status}）`);
}

function cmdStatus(positional: string[], flags: Args): void {
  const [id, status] = positional;
  if (!id || !status) {
    console.error(`用法：npm run cases -- status <case_id> <${CASE_STATUSES.join("|")}>`);
    process.exitCode = 1;
    return;
  }
  const patch: Record<string, string> = {};
  for (const [flag, field] of [
    ["evidence", "evidence_type"],
    ["evidence-location", "evidence_location"],
    ["result", "result"],
    ["source", "source"],
    ["subject", "subject_type"],
    ["site-consent", "site_consent"],
    ["quote-consent", "quote_consent"],
    ["published", "published"],
  ] as const) {
    if (flags[flag] !== undefined) patch[field] = flags[flag];
  }
  const r = setStatus(id, status as CaseStatus, patch);
  if (!r.ok) {
    console.error(`推进失败：${r.reasons?.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`已更新 ${id} → ${r.record!.status}`);
}

function cmdDoctor(): void {
  const audit = auditCases();
  console.log(`Case Master：${CASE_MASTER_RELATIVE_PATH}`);
  console.log(`案例总数：${audit.total}${audit.total === 0 ? "  （NO REAL CASE DATA YET）" : ""}`);
  console.log(`状态分布：${Object.entries(audit.byStatus).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);
  console.log(`重复 case_id：${audit.duplicates.length ? audit.duplicates.join(", ") : "无"}`);
  console.log(`校验问题：${audit.issues.length}`);
  for (const i of audit.issues) console.log(`  - ${i.case_id} ${i.field}: ${i.message}`);

  const knownContent = readTopics().map((t) => t.content_id.trim());
  const allowedPaths = [...LOCALE_ROUTED_PATHS];
  const cross = crossReferenceIssues(readCases(), knownContent, allowedPaths);
  console.log(`跨库引用问题：${cross.length}`);
  for (const i of cross) console.log(`  - ${i.case_id} ${i.field}: ${i.message}`);

  console.log("");
  console.log(`可用枚举：`);
  console.log(`  status       ${CASE_STATUSES.join(" | ")}`);
  console.log(`  source       ${CASE_SOURCES.join(" | ")}`);
  console.log(`  subject_type ${CASE_TYPES.join(" | ")}`);
  console.log(`  evidence     ${EVIDENCE_TYPES.join(" | ")}`);
  console.log(`  channels     ${CASE_CHANNELS.join(" | ")}`);
  console.log(`  F 内容主题数：${knownContent.length} ｜ 可引用页面：${allowedPaths.length}`);

  if (audit.duplicates.length || audit.issues.length || cross.length) process.exitCode = 1;
}

function main(): void {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "list": cmdList(flags); break;
    case "show": cmdShow(positional); break;
    case "add": cmdAdd(flags); break;
    case "status": cmdStatus(positional, flags); break;
    case "doctor": cmdDoctor(); break;
    default:
      console.log(`用法：npm run cases -- <list|show|add|status|doctor>
  list   [--status=Review|Approved|...]
  show   <case_id>
  add    --id=CASE-001 --subject="Technical SEO" --challenge="..." --used="..." [--source= --evidence= --evidence-location= ...]
  status <case_id> <status> [--evidence= --evidence-location= --result= --published=yes ...]
  doctor 体检（枚举 / 重复 / 校验 / 跨库引用）
唯一 Case Master：${CASE_MASTER_RELATIVE_PATH}
允许 0 条：没有真实案例时不要造（NO REAL CASE DATA YET 是合法状态）`);
  }
}

main();
