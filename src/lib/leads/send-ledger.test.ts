// ===== E｜Send Ledger 对账测试 =====
// 覆盖 2026-10-08 合规修复的核心不变量：
//   1. Resend 实际发件记录是「历史 outreach 事实」的最高可信来源
//   2. 只回填缺失 email / 记退信 / 记「收件域名 ≠ 主库 website 域名」；
//      绝不改 website / status / template / 触达日期
//   3. 幂等（重跑 0 写入）、不增加发送计数、无网络（纯函数）
//   4. lifecycle（产品/事务）邮件不得污染 outreach 去重基
//
// 全部在临时目录中进行，绝不碰真实的 seo-growth/leads.csv 与 send-ledger.csv。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emptyLead, type Lead } from "./schema";
import { countOutboundSendRecords } from "./reconcile";
import { readLeads, reconcileSendLedger, suppressComplaint, writeLeads } from "./store";
import {
  LEDGER_NOTE_MARKER,
  SEND_LEDGER_FIELDS,
  SEND_LEDGER_RELATIVE_PATH,
  applyLedgerReconciliation,
  buildLedgerNote,
  ledgerDomainSet,
  ledgerRecipientSet,
  outreachRecords,
  parseSendLedger,
  planLedgerReconciliation,
  readSendLedger,
  recipientDomain,
  type SendLedgerRecord,
} from "./send-ledger";
import { COMPLAINT_SUPPRESSION_NOTE } from "./prospecting-rules";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-ledger-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 合法的 Resend id 形态（8-4-4-4-12 小写 hex）
const RID_A = "6ef4d1ab-1234-4abc-89de-0123456789ab";
const RID_B = "0a1b2c3d-4567-489a-bcde-f01234567890";

function rec(overrides: Partial<SendLedgerRecord> = {}): SendLedgerRecord {
  return {
    resend_id: RID_A,
    sent_at: "2026-09-29T09:07:35.000Z",
    recipient: "yuki@example.com",
    kind: "outreach",
    status: "delivered",
    subject: "Quick SEO issue on example.com",
    ...overrides,
  };
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    ...emptyLead(),
    lead_id: "L-EXAMPLE",
    website: "example.com",
    company: "Example Inc",
    email: "yuki@example.com",
    lead_type: "SaaS",
    specific_issue: "Duplicate title tags on / and /pricing",
    status: "Contacted",
    first_contacted_at: "2026-09-29",
    last_contacted_at: "2026-09-29",
    ...overrides,
  };
}

/** 写一个真实 ledger 文件到临时目录（用于 store 层测试） */
function writeLedgerFile(cwd: string, records: readonly SendLedgerRecord[]): void {
  const file = path.join(cwd, SEND_LEDGER_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = SEND_LEDGER_FIELDS.join(",");
  const lines = records.map((r) =>
    [r.resend_id, r.sent_at, r.recipient, r.kind, r.status, `"${r.subject}"`].join(",")
  );
  fs.writeFileSync(file, [header, ...lines].join("\n"), "utf-8");
}

// ================= E14：解析与去重基 =================

describe("E14 Send Ledger 解析与去重基", () => {
  it("跳过不完整行；未知 kind 视为 lifecycle；未知 status 视为 sent", () => {
    const text = [
      SEND_LEDGER_FIELDS.join(","),
      `${RID_A},2026-09-29T09:07:35Z,a@x.com,outreach,delivered,hello`,
      `,2026-09-29T09:07:36Z,missing-id@x.com,outreach,delivered,hello`,
      `${RID_B},2026-09-29T09:07:37Z,,outreach,delivered,no-recipient`,
      `${RID_B},2026-09-29T09:07:38Z,b@x.com,weird-kind,weird-status,hi`,
    ].join("\n");

    const rows = parseSendLedger(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ resend_id: RID_A, kind: "outreach", status: "delivered" });
    // 未识别的枚举不猜成 outreach —— 宁可当 lifecycle（不参与潜客触达去重）
    expect(rows[1]).toMatchObject({ kind: "lifecycle", status: "sent" });
  });

  it("空文本 / 只有表头 → 空数组", () => {
    expect(parseSendLedger("")).toEqual([]);
    expect(parseSendLedger(SEND_LEDGER_FIELDS.join(","))).toEqual([]);
  });

  it("ledger 文件不存在 → 返回空数组（CI / 新克隆没有这个被 gitignore 的文件）", () => {
    expect(readSendLedger(tmp)).toEqual([]);
    expect(fs.existsSync(path.join(tmp, SEND_LEDGER_RELATIVE_PATH))).toBe(false);
  });

  it("lifecycle 邮件不进 outreach 去重基（产品/事务邮件不算潜客触达）", () => {
    const records = [
      rec({ resend_id: RID_A, recipient: "customer@paying-user.com", kind: "outreach" }),
      rec({ resend_id: RID_B, recipient: "signup@lifecycle-only.com", kind: "lifecycle" }),
    ];
    expect(outreachRecords(records)).toHaveLength(1);
    expect([...ledgerRecipientSet(records)]).toEqual(["customer@paying-user.com"]);
    expect([...ledgerDomainSet(records)]).toEqual(["paying-user.com"]);
  });

  it("recipientDomain 对非字符串入参返回空串（回归：曾经把 record 对象当地址传进来 → TypeError）", () => {
    // 故意传错类型：必须安全返回 ""，而不是抛异常
    expect(recipientDomain(rec() as unknown as string)).toBe("");
    expect(recipientDomain("")).toBe("");
    expect(recipientDomain("no-at-sign")).toBe("");
    expect(recipientDomain("Yuki@WWW.Example.com")).toBe("example.com");
  });
});

// ================= E15：对账计划（纯函数） =================

describe("E15 Send Ledger 对账计划", () => {
  it("主库 email 为空 + ledger 有真实收件人 → backfill-email（且要写库）", () => {
    const l = lead({ email: "", notes: `outreach sent, resend_id=${RID_A}` });
    const plan = planLedgerReconciliation([l], [rec({ recipient: "info@example.com" })]);

    const e = plan.entries[0];
    expect(e.actions).toContain("backfill-email");
    expect(e.ledgerRecipient).toBe("info@example.com");
    expect(e.writes).toBe(true);
    expect(plan.summary.backfilledEmail).toBe(1);
    expect(plan.summary.writable).toBe(1);
  });

  it("主库 email 与 ledger 一致 → matched，不写库", () => {
    const plan = planLedgerReconciliation([lead()], [rec()]);
    const e = plan.entries[0];
    expect(e.actions).toContain("matched");
    expect(e.actions).not.toContain("backfill-email");
    expect(e.writes).toBe(false);
    expect(plan.summary.matched).toBe(1);
    expect(plan.summary.writable).toBe(0);
  });

  it("收件域名 ≠ 主库 website 域名 → domain-mismatch：只留痕，绝不改 website", () => {
    const l = lead({ website: "acme.com", email: "", notes: `resend_id=${RID_A}` });
    const plan = planLedgerReconciliation([l], [rec({ recipient: "info@acme-mail.com" })]);
    const e = plan.entries[0];

    expect(e.actions).toContain("domain-mismatch");
    expect(plan.summary.domainMismatch).toBe(1);

    const [next] = applyLedgerReconciliation([l], plan, { noteDate: "2026-10-08" });
    expect(next.website).toBe("acme.com"); // 域名绝不改
    expect(next.email).toBe("info@acme-mail.com"); // 回填的是真实收件地址
    expect(next.notes).toContain("未修改 website");
  });

  it("退信 → 记 reply_status=bounced；已有 reply_status 时不覆盖", () => {
    const bounced = rec({ status: "bounced" });
    const empty = planLedgerReconciliation([lead()], [bounced]);
    expect(empty.entries[0].actions).toContain("bounce");
    expect(empty.summary.bounce).toBe(1);

    const [next] = applyLedgerReconciliation([lead()], empty, { noteDate: "2026-10-08" });
    expect(next.reply_status).toBe("bounced");

    // 已经有人工记录的回复状态 → 退信不覆盖它
    const replied = planLedgerReconciliation([lead({ reply_status: "replied" })], [bounced]);
    expect(replied.entries[0].actions).not.toContain("bounce");
    expect(applyLedgerReconciliation([lead({ reply_status: "replied" })], replied, { noteDate: "2026-10-08" })[0].reply_status).toBe("replied");
  });

  it("投诉 → complaint：对账只负责暴露，绝不自己改 status（压制必须走 suppress-complaint）", () => {
    const plan = planLedgerReconciliation([lead()], [rec({ status: "complained" })]);
    const e = plan.entries[0];
    expect(e.actions).toContain("complaint");
    expect(e.writes).toBe(false); // 纯投诉不触发写库 —— 压制由状态机单独完成
    expect(plan.summary.complaint).toBe(1);

    const onlyComplaint = lead();
    const [next] = applyLedgerReconciliation([onlyComplaint], plan, { noteDate: "2026-10-08" });
    expect(next).toBe(onlyComplaint); // 未列入写库计划 → 原对象原样返回
    expect(next.status).toBe("Contacted");
  });

  it("重复发送 → duplicate-send；发送次数计 2 次、唯一收件人仍是 1（不合并计数）", () => {
    const records = [rec({ resend_id: RID_A }), rec({ resend_id: RID_B, sent_at: "2026-09-30T01:00:00Z" })];
    const plan = planLedgerReconciliation([lead()], records);

    expect(plan.entries[0].actions).toContain("duplicate-send");
    expect(plan.summary.duplicate).toBe(1);
    expect(plan.summary.outreachSends).toBe(2); // 真实发送次数
    expect(plan.summary.distinctRecipients).toBe(1); // 唯一收件人
  });

  it("主库声称已触达但 ledger 无记录 → unmatched，且不得反向补任何东西", () => {
    const plan = planLedgerReconciliation([lead()], []);
    const e = plan.entries[0];
    expect(e.actions).toEqual(["unmatched"]);
    expect(e.writes).toBe(false);
    expect(plan.summary.unmatched).toBe(1);
    expect(applyLedgerReconciliation([lead()], plan, { noteDate: "2026-10-08" })[0]).toEqual(lead());
  });

  it("没有触达时间、也没有 ledger 记录的行完全不入 entries（绝不凭空升成 Contacted）", () => {
    const fresh = lead({ status: "New", first_contacted_at: "", last_contacted_at: "" });
    const plan = planLedgerReconciliation([fresh], []);
    expect(plan.entries).toHaveLength(0);
    expect(plan.summary.unmatched).toBe(0);
  });

  it("纯函数：不改动入参，重复调用结果一致", () => {
    const l = lead({ email: "", notes: `resend_id=${RID_A}` });
    const before = JSON.stringify(l);
    const a = planLedgerReconciliation([l], [rec({ recipient: "info@example.com" })]);
    const b = planLedgerReconciliation([l], [rec({ recipient: "info@example.com" })]);
    expect(JSON.stringify(l)).toBe(before);
    expect(a.summary).toEqual(b.summary);
  });

  it("ledger 里有、主库完全没有对应行的收件地址 → unmatchedRecipients 暴露出来", () => {
    const plan = planLedgerReconciliation([lead()], [rec({ recipient: "ghost@nowhere.com" })]);
    expect(plan.unmatchedRecipients).toEqual(["ghost@nowhere.com"]);
  });
});

// ================= E16：应用对账（幂等 + 边界） =================

describe("E16 应用对账的幂等与边界", () => {
  it("回填 email，但 website / status / template / 触达日期一律不动", () => {
    const l = lead({
      email: "",
      notes: `outreach sent, resend_id=${RID_A}`,
      template: "A_website_issue_v1",
      utm_content: "A_website_issue_v1",
    });
    const plan = planLedgerReconciliation([l], [rec({ recipient: "info@example.com" })]);
    const [next] = applyLedgerReconciliation([l], plan, { noteDate: "2026-10-08" });

    expect(next.email).toBe("info@example.com");
    expect(next.website).toBe(l.website);
    expect(next.status).toBe(l.status);
    expect(next.template).toBe(l.template);
    expect(next.first_contacted_at).toBe(l.first_contacted_at);
    expect(next.last_contacted_at).toBe(l.last_contacted_at);
    expect(next.notes).toContain(LEDGER_NOTE_MARKER);
    expect(next.notes).toContain("未改动 first/last_contacted_at");
  });

  it("幂等：第二次 apply 不再追加注记，计划变为 already-reconciled 且 0 写入", () => {
    const l = lead({ email: "", notes: `resend_id=${RID_A}` });
    const records = [rec({ recipient: "info@example.com" })];
    const plan1 = planLedgerReconciliation([l], records);
    const applied = applyLedgerReconciliation([l], plan1, { noteDate: "2026-10-08" });

    const plan2 = planLedgerReconciliation(applied, records);
    expect(plan2.entries[0].actions).toContain("already-reconciled");
    expect(plan2.entries[0].writes).toBe(false);
    expect(plan2.summary.writable).toBe(0);

    const reapplied = applyLedgerReconciliation(applied, plan2, { noteDate: "2026-10-08" });
    expect(reapplied[0]).toBe(applied[0]); // 原对象返回 = 一个字节都没改
    const marks = reapplied[0].notes.split(LEDGER_NOTE_MARKER).length - 1;
    expect(marks).toBe(1);
  });

  it("不增加发送计数：countOutboundSendRecords 对账前后完全一致", () => {
    const l = lead({ email: "", notes: `outreach sent via resend, resend_id=${RID_A}` });
    const records = [rec({ recipient: "info@example.com", status: "bounced" })];
    const before = countOutboundSendRecords([l]);

    const plan = planLedgerReconciliation([l], records);
    const after = applyLedgerReconciliation([l], plan, { noteDate: "2026-10-08" });

    expect(countOutboundSendRecords(after)).toBe(before);
    expect(before).toBe(1);
    // 对账注记本身不得被误读成一次新的发送
    expect(buildLedgerNote(plan.entries[0], "2026-10-08")).not.toMatch(/outreach sent|sent via resend|已发首封|已发跟进/i);
  });

  it("未列入写库计划的行返回原对象（保证「数据不变」可断言）", () => {
    const a = lead({ lead_id: "A" });
    const b = lead({ lead_id: "B", website: "other.com", email: "" });
    const plan = planLedgerReconciliation([a, b], [rec()]);
    const next = applyLedgerReconciliation([a, b], plan, { noteDate: "2026-10-08" });
    expect(next[0]).toBe(a);
    expect(next[1]).toBe(b);
  });
});

// ================= E17：store 层（写库必须显式、ledger 缺失即拒绝） =================

describe("E17 store 层对账与投诉压制", () => {
  it("默认 dry-run：不写库；ledger 缺失时 apply 直接拒绝", () => {
    writeLeads([lead({ email: "", notes: `resend_id=${RID_A}` })], tmp);

    const dry = reconcileSendLedger({ cwd: tmp });
    expect(dry.ok).toBe(true);
    expect(dry.dryRun).toBe(true);
    expect(dry.written).toBe(0);
    expect(dry.ledgerPresent).toBe(false);

    const refused = reconcileSendLedger({ cwd: tmp, apply: true });
    expect(refused.ok).toBe(false);
    expect(refused.written).toBe(0);
    expect(refused.reasons?.join(" ")).toContain("send-ledger.csv");
    expect(readLeads(tmp)[0].email).toBe(""); // 没写
  });

  it("有 ledger 时 apply 回填；再跑一次 written=0（幂等）", () => {
    writeLeads([lead({ email: "", notes: `outreach sent, resend_id=${RID_A}` })], tmp);
    writeLedgerFile(tmp, [rec({ recipient: "info@example.com" })]);

    const first = reconcileSendLedger({ cwd: tmp, apply: true });
    expect(first.ok).toBe(true);
    expect(first.written).toBe(1);
    expect(readLeads(tmp)[0].email).toBe("info@example.com");

    const second = reconcileSendLedger({ cwd: tmp, apply: true });
    expect(second.ok).toBe(true);
    expect(second.written).toBe(0);
    expect(second.plan.summary.writable).toBe(0);
  });

  it("suppressComplaint：走官方状态机 → Suppressed + 清空 next_followup_at + 标准句追加到 notes", () => {
    writeLeads([lead({ lead_id: "L-GC", website: "goatcounter.com", email: "support@goatcounter.com" })], tmp);

    const r = suppressComplaint("L-GC", { cwd: tmp });
    expect(r.ok).toBe(true);

    const saved = readLeads(tmp).find((l) => l.lead_id === "L-GC")!;
    expect(saved.status).toBe("Suppressed");
    expect(saved.next_followup_at).toBe("");
    expect(saved.notes.endsWith(COMPLAINT_SUPPRESSION_NOTE)).toBe(true);
    // 历史证据链保留（不覆盖 notes）
    expect(saved.email).toBe("support@goatcounter.com");
    expect(saved.first_contacted_at).toBe("2026-09-29");
  });

  it("suppressComplaint 幂等：第二次不重复追加标准句", () => {
    writeLeads([lead({ lead_id: "L-GC" })], tmp);
    suppressComplaint("L-GC", { cwd: tmp });
    const again = suppressComplaint("L-GC", { cwd: tmp });
    expect(again.ok).toBe(true);

    const saved = readLeads(tmp).find((l) => l.lead_id === "L-GC")!;
    const hits = saved.notes.split(COMPLAINT_SUPPRESSION_NOTE).length - 1;
    expect(hits).toBe(1);
  });

  it("suppressComplaint：不存在的 lead_id 直接失败，不凭空创建", () => {
    writeLeads([lead({ lead_id: "L-1" })], tmp);
    const r = suppressComplaint("NOPE", { cwd: tmp });
    expect(r.ok).toBe(false);
    expect(readLeads(tmp)).toHaveLength(1);
  });
});
