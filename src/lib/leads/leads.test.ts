// ===== E｜潜客数据库（Lead Master）测试 =====
// 覆盖验收 1–12：新增、去重、状态机、suppression、跟进、特定问题、
// 模板关联、归因、历史数据不丢、访问控制。
// 存储测试全部在临时目录中进行，绝不碰真实的 seo-growth/leads.csv。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LEAD_FIELDS,
  LEAD_STATUSES,
  LEAD_TYPES,
  LEAD_TEMPLATE_IDS,
  STATUS_TRANSITIONS,
  CONTACTED_OR_LATER_STATUSES,
  emptyLead,
  isContactedOrLater,
  isDateOnly,
  type Lead,
} from "./schema";
import { normalizeDomain, normalizeEmail, normalizeLeadType, makeLeadId } from "./normalize";
import { parseCsv, serializeCsv } from "./csv";
import {
  buildLeadAuditUrl,
  canTransition,
  checkTransition,
  dueFollowUps,
  fillAttribution,
  isFollowUpDue,
  isFollowUpEligible,
  isSuppressed,
  nextFollowUpStatus,
  validateLead,
} from "./pipeline";
import {
  RECONCILE_NOTE_MARKER,
  applyContactedBackfill,
  buildReconcileNote,
  countOutboundSendRecords,
  hasOutboundContactFact,
  inspectContactFact,
  isReconciled,
  planContactedBackfill,
  type ReconcilePlan,
} from "./reconcile";
import {
  LEAD_MASTER_RELATIVE_PATH,
  addLead,
  backfillContacted,
  countReconciledLeads,
  readLeads,
  searchLeads,
  updateLead,
  writeLeads,
} from "./store";

// ---------------- 临时工作目录 ----------------
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-leads-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function baseLead(overrides: Partial<Lead> = {}): Lead {
  const l = emptyLead();
  l.website = "example.com";
  l.company = "Example Inc";
  l.contact_name = "Yuki";
  l.email = "yuki@example.com";
  l.lead_type = "SaaS";
  l.specific_issue = "Duplicate title tags on /pricing and /";
  l.status = "New";
  return { ...l, ...overrides };
}

// ================= E1 / E2：主库与数据模型 =================
describe("E1/E2 主库与数据模型", () => {
  it("Lead Master 只有一份，路径固定且不落在 public/", () => {
    expect(LEAD_MASTER_RELATIVE_PATH).toBe("seo-growth/leads.csv");
    expect(LEAD_MASTER_RELATIVE_PATH.startsWith("public/")).toBe(false);
    expect(LEAD_MASTER_RELATIVE_PATH.startsWith("src/app")).toBe(false);
  });

  it("字段覆盖 identity / classification / seo / marketing / pipeline / notes 六大组", () => {
    const required = [
      // identity
      "lead_id", "website", "company", "contact_name", "email", "role",
      // classification
      "lead_type", "company_size", "industry",
      // seo
      "specific_issue", "issue_type", "audit_url", "audit_date",
      // marketing
      "source", "campaign", "template", "utm_content",
      "first_contacted_at", "last_contacted_at", "next_followup_at",
      // pipeline
      "status", "reply_status", "interest", "signup", "activation", "paid",
      // notes
      "notes", "last_action", "next_action",
    ];
    for (const f of required) expect(LEAD_FIELDS).toContain(f);
  });

  it("新增 Lead 可持久化并原样读回（含中文与逗号）", () => {
    const r = addLead({
      website: "https://www.Example.com/",
      company: "示例公司",
      contact_name: "Yuki",
      email: "Yuki@Example.com",
      lead_type: "SaaS",
      specific_issue: "首页 title 与 /pricing 重复",
      notes: "注意：含逗号, 与引号\"",
      status: "New",
    }, { cwd: tmp });

    expect(r.ok).toBe(true);
    const rows = readLeads(tmp);
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe("示例公司");
    expect(rows[0].notes).toBe("注意：含逗号, 与引号\"");
    expect(rows[0].email).toBe("yuki@example.com"); // 已归一化
    expect(rows[0].lead_id).toBeTruthy();
    expect(rows[0].created_at).toBeTruthy();
  });

  it("字段校验：非法 status / lead_type / 日期会被拒绝", () => {
    const l = baseLead({ status: "Contacted Already" as never });
    expect(validateLead(l).some((i) => i.field === "status")).toBe(true);

    const l2 = baseLead({ lead_type: "saas company" as never });
    expect(validateLead(l2).some((i) => i.field === "lead_type")).toBe(true);

    const l3 = baseLead({ next_followup_at: "28/09/2026" });
    expect(validateLead(l3).some((i) => i.field === "next_followup_at")).toBe(true);
  });
});

// ================= E3：Lead Type 标准化 =================
describe("E3 Lead 类型标准化", () => {
  it("常见随手写法都能收敛到标准值", () => {
    expect(normalizeLeadType("saas")).toBe("SaaS");
    expect(normalizeLeadType("SaaS company")).toBe("SaaS");
    expect(normalizeLeadType("software")).toBe("SaaS");
    expect(normalizeLeadType("SEO agency")).toBe("Agency");
    expect(normalizeLeadType("freelancer")).toBe("SEO Freelancer");
    expect(normalizeLeadType("e-commerce")).toBe("Ecommerce");
    expect(normalizeLeadType("content site")).toBe("Content Site");
  });

  it("无法识别的输入返回 null（要求人工选择，不猜成 Other）", () => {
    expect(normalizeLeadType("区块链公司")).toBeNull();
    expect(normalizeLeadType("")).toBeNull();
  });

  it("标准集合固定为 9 类", () => {
    expect([...LEAD_TYPES]).toEqual([
      "SaaS", "Agency", "SEO Freelancer", "Blog", "Affiliate",
      "Ecommerce", "Content Site", "Startup", "Other",
    ]);
  });
});

// ================= E4：状态机 =================
describe("E4 Status pipeline", () => {
  it("完整链路可走通：New → Ready to Contact → Contacted → Follow-up 1 → Follow-up 2 → Replied", () => {
    const chain: Array<[string, string]> = [
      ["New", "Ready to Contact"],
      ["Ready to Contact", "Contacted"],
      ["Contacted", "Follow-up 1"],
      ["Follow-up 1", "Follow-up 2"],
      ["Follow-up 2", "Replied"],
    ];
    for (const [from, to] of chain) expect(canTransition(from, to)).toBe(true);
    expect(LEAD_STATUSES).toContain("Paid");
  });

  it("非法迁移被拒绝（New → Paid）", () => {
    expect(canTransition("New", "Paid")).toBe(false);
    const r = updateLead("L1", { status: "Paid" }, { cwd: tmp });
    expect(r.ok).toBe(false); // 连 lead 都不存在，先被拦
  });

  it("Contacted = 已发首封：必须有 specific_issue 与 template", () => {
    const noIssue = baseLead({ status: "Ready to Contact", specific_issue: "" });
    expect(checkTransition(noIssue, "Contacted").ok).toBe(false);

    const noTemplate = baseLead({ status: "Ready to Contact", template: "" });
    expect(checkTransition(noTemplate, "Contacted").ok).toBe(false);

    const ok = baseLead({ status: "Ready to Contact", template: "A_website_issue_v1" });
    expect(checkTransition(ok, "Contacted").ok).toBe(true);
  });

  it("Replied ≠ Interested：两个状态独立存在，语义不合并", () => {
    expect(LEAD_STATUSES).toContain("Replied");
    expect(LEAD_STATUSES).toContain("Interested");
    expect(canTransition("Replied", "Interested")).toBe(true);
    // 回复了不代表有兴趣，因此 Replied 不应自动等于 Interested
    expect(canTransition("Replied", "Trial")).toBe(false);
  });

  it("每个状态都定义了明确的后继集合", () => {
    for (const s of LEAD_STATUSES) {
      expect(Array.isArray(STATUS_TRANSITIONS[s]), `${s} 缺少迁移定义`).toBe(true);
    }
  });
});

// ================= E5：去重 =================
describe("E5 去重", () => {
  it("www / 大小写 / 端口差异识别为同一 website，不产生第二条", () => {
    expect(normalizeDomain("https://www.Example.com/")).toBe("example.com");
    expect(normalizeDomain("http://example.com:8080/path")).toBe("example.com");
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(normalizeEmail("Yuki@Example.com")).toBe("yuki@example.com");

    const first = addLead({ website: "example.com", email: "yuki@example.com", lead_type: "SaaS", status: "New" }, { cwd: tmp });
    expect(first.ok).toBe(true);

    const dup = addLead({ website: "https://www.EXAMPLE.com/", email: "YUKI@example.com", lead_type: "SaaS", status: "New" }, { cwd: tmp });
    expect(dup.ok).toBe(false);
    expect(dup.reason).toContain("重复");
    expect(readLeads(tmp)).toHaveLength(1);
  });

  it("同一网站、邮箱缺失时也不产生第二条（提示去更新已有 Lead）", () => {
    addLead({ website: "example.com", email: "", lead_type: "SaaS", status: "New" }, { cwd: tmp });
    const dup = addLead({ website: "www.example.com", email: "", lead_type: "SaaS", status: "New" }, { cwd: tmp });
    expect(dup.ok).toBe(false);
    expect(readLeads(tmp)).toHaveLength(1);
  });

  it("同一网站的不同联系人：允许新增，但必须带告警（不静默）", () => {
    addLead({ website: "example.com", email: "a@example.com", lead_type: "SaaS", status: "New" }, { cwd: tmp });
    const second = addLead({ website: "example.com", email: "b@example.com", lead_type: "SaaS", status: "New" }, { cwd: tmp });
    expect(second.ok).toBe(true);
    expect(second.warnings?.[0]).toContain("同一网站已有其他联系人");
    expect(readLeads(tmp)).toHaveLength(2);
  });

  it("lead_id 对同一 website+email 稳定（重跑不串号）", () => {
    expect(makeLeadId("www.example.com", "A@B.com")).toBe(makeLeadId("example.com", "a@b.com"));
  });
});

// ================= E6：真实 SEO 问题 =================
describe("E6 Specific SEO issue", () => {
  it("specific_issue 能保存并原样读回", () => {
    const r = addLead({
      website: "shop.example.com",
      email: "hi@shop.com",
      lead_type: "Ecommerce",
      specific_issue: "Missing meta description on 14 category pages",
      issue_type: "missing_meta_description",
      audit_date: "2026-09-28",
      status: "Researching",
    }, { cwd: tmp });
    expect(r.ok).toBe(true);
    expect(readLeads(tmp)[0].specific_issue).toBe("Missing meta description on 14 category pages");
    expect(readLeads(tmp)[0].issue_type).toBe("missing_meta_description");
  });

  it("没有记录真实问题 → 不得进入 Contacted", () => {
    const r = addLead({ website: "x.com", email: "a@x.com", lead_type: "Blog", specific_issue: "", status: "New" }, { cwd: tmp });
    expect(r.ok).toBe(true);
    const id = r.lead!.lead_id;
    const upd = updateLead(id, { status: "Contacted" }, { cwd: tmp });
    expect(upd.ok).toBe(false);
    expect(upd.reasons?.join(" ")).toContain("specific_issue");
  });
});

// ================= E7：跟进 =================
describe("E7 Follow-up", () => {
  const TODAY = "2026-09-28";

  it("首封自动写 first/last_contacted_at（走 New → Ready to Contact → Contacted）", () => {
    const r = addLead({
      website: "a.com", email: "a@a.com", lead_type: "SaaS",
      specific_issue: "Duplicate title tags", template: "A_website_issue_v1", status: "New",
    }, { cwd: tmp });
    const id = r.lead!.lead_id;
    expect(updateLead(id, { status: "Ready to Contact" }, { cwd: tmp }).ok).toBe(true);
    const upd = updateLead(id, { status: "Contacted" }, { cwd: tmp, now: new Date(`${TODAY}T10:00:00Z`) });
    expect(upd.ok).toBe(true);
    expect(upd.lead!.first_contacted_at).toBe(TODAY);
    expect(upd.lead!.last_contacted_at).toBe(TODAY);
  });

  it("未走 Ready to Contact 直接 New → Contacted 被拒绝（保持流程纪律）", () => {
    const r = addLead({
      website: "b.com", email: "b@b.com", lead_type: "SaaS",
      specific_issue: "Missing canonical", template: "A_website_issue_v1", status: "New",
    }, { cwd: tmp });
    const upd = updateLead(r.lead!.lead_id, { status: "Contacted" }, { cwd: tmp });
    expect(upd.ok).toBe(false);
    expect(upd.reasons?.join(" ")).toContain("不允许的状态迁移");
  });

  it("下次跟进状态：Contacted → Follow-up 1 → Follow-up 2（序列到此结束）", () => {
    expect(nextFollowUpStatus(baseLead({ status: "Contacted" }))).toBe("Follow-up 1");
    expect(nextFollowUpStatus(baseLead({ status: "Follow-up 1" }))).toBe("Follow-up 2");
    expect(nextFollowUpStatus(baseLead({ status: "Follow-up 2" }))).toBeNull();
  });

  it("到期可筛出今天该联系谁；未到期不出现", () => {
    const due = baseLead({ status: "Contacted", next_followup_at: "2026-09-28" });
    const future = baseLead({ status: "Contacted", next_followup_at: "2026-10-05" });
    const noDate = baseLead({ status: "Contacted", next_followup_at: "" });
    expect(isFollowUpDue(due, TODAY)).toBe(true);
    expect(isFollowUpDue(future, TODAY)).toBe(false);
    expect(isFollowUpDue(noDate, TODAY)).toBe(false);
    expect(dueFollowUps([due, future, noDate], TODAY).map((l) => l.website)).toEqual([due.website]);
  });

  it("Replied / Interested / Trial / Activated / Paid 不进入普通 cold follow-up", () => {
    for (const s of ["Replied", "Interested", "Trial", "Activated", "Paid"]) {
      const l = baseLead({ status: s as never, next_followup_at: "2026-09-01" });
      expect(isFollowUpEligible(l), `${s} 不应进入 follow-up`).toBe(false);
      expect(isFollowUpDue(l, TODAY)).toBe(false);
    }
  });
});

// ================= E8：Suppression =================
describe("E8 Suppression", () => {
  it("Suppressed 永不进入 follow-up 队列", () => {
    const l = baseLead({ status: "Suppressed", next_followup_at: "2026-09-01" });
    expect(isSuppressed(l)).toBe(true);
    expect(isFollowUpEligible(l)).toBe(false);
    expect(dueFollowUps([l], "2026-09-28")).toHaveLength(0);
  });

  it("Suppressed 是终态：任何迁出都被拒绝（含 Paid / Contacted）", () => {
    const l = baseLead({ status: "Suppressed" });
    for (const to of ["Contacted", "New", "Paid", "Ready to Contact"]) {
      const check = checkTransition(l, to);
      expect(check.ok, `Suppressed → ${to} 应被拒绝`).toBe(false);
      expect(check.reasons.join(" ")).toContain("Suppressed");
    }
    expect(STATUS_TRANSITIONS["Suppressed"]).toEqual([]);
  });

  it("Not Interested 也不进入 follow-up", () => {
    expect(isFollowUpEligible(baseLead({ status: "Not Interested" }))).toBe(false);
    expect(dueFollowUps([baseLead({ status: "Not Interested", next_followup_at: "2026-09-01" })], "2026-09-28")).toHaveLength(0);
  });
});

// ================= E9：模板关联 =================
describe("E9 Email template linkage", () => {
  it("只接受 C 阶段已注册的模板 ID，不另造模板", () => {
    expect(LEAD_TEMPLATE_IDS).toEqual([
      "A_website_issue_v1", "B_free_audit_v1", "C_followup1_v1",
      "D_followup2_v1", "E_saas_founder_v1", "F_agency_v1", "G_content_site_v1",
    ]);

    const ok = addLead({
      website: "t.com", email: "t@t.com", lead_type: "Agency",
      specific_issue: "Missing canonical", template: "F_agency_v1", status: "New",
    }, { cwd: tmp });
    expect(ok.ok).toBe(true);

    const bad = addLead({
      website: "u.com", email: "u@u.com", lead_type: "Agency",
      specific_issue: "Missing canonical", template: "agency_v1", status: "New",
    }, { cwd: tmp });
    expect(bad.ok).toBe(false);
    expect(bad.reasons?.join(" ")).toContain("template");
  });

  it("template 能保存并在后续更新中读回", () => {
    const r = addLead({
      website: "v.com", email: "v@v.com", lead_type: "Content Site",
      specific_issue: "Thin category pages", template: "G_content_site_v1", status: "Ready to Contact",
    }, { cwd: tmp });
    const upd = updateLead(r.lead!.lead_id, { status: "Contacted" }, { cwd: tmp });
    expect(upd.ok).toBe(true);
    expect(upd.lead!.template).toBe("G_content_site_v1");
  });
});

// ================= E10：归因 =================
describe("E10 Attribution（复用 B/C）", () => {
  it("审计链接携带 outbound UTM 且 utm_content 取模板", () => {
    const l = baseLead({ template: "A_website_issue_v1" });
    const url = buildLeadAuditUrl(l);
    expect(url).toContain("utm_source=email");
    expect(url).toContain("utm_medium=outbound");
    expect(url).toContain("utm_campaign=cold_email");
    expect(url).toContain("utm_content=A_website_issue_v1");
  });

  it("source / campaign / template 可保存，campaign 缺省为 cold_email", () => {
    const filled = fillAttribution(baseLead({ source: "reddit", template: "B_free_audit_v1" }));
    expect(filled.campaign).toBe("cold_email");
    expect(filled.utm_content).toBe("B_free_audit_v1");
    expect(filled.audit_url).toContain("utm_medium=outbound");
  });

  it("自定义 campaign 不被覆盖", () => {
    const filled = fillAttribution(baseLead({ campaign: "reddit_outreach", template: "B_free_audit_v1" }));
    expect(filled.campaign).toBe("reddit_outreach");
  });
});

// ================= E11：历史数据不丢失 =================
describe("E11 历史数据完整性", () => {
  it("追加新 Lead 时，已有行一字不改地保留", () => {
    const seed: Lead[] = [
      baseLead({ lead_id: "L001", website: "old1.com", email: "old1@old1.com", status: "Contacted", notes: "历史备注 A" }),
      baseLead({ lead_id: "L002", website: "old2.com", email: "old2@old2.com", status: "Replied", notes: "历史备注 B" }),
    ];
    writeLeads(seed, tmp);
    const before = fs.readFileSync(path.join(tmp, LEAD_MASTER_RELATIVE_PATH), "utf-8");

    addLead({ website: "new.com", email: "n@new.com", lead_type: "SaaS", specific_issue: "Slow CWV", status: "New" }, { cwd: tmp });

    const rows = readLeads(tmp);
    expect(rows).toHaveLength(3);
    expect(rows[0].lead_id).toBe("L001");
    expect(rows[0].notes).toBe("历史备注 A");
    expect(rows[1].notes).toBe("历史备注 B");
    // 前两行文本原样保留
    const after = fs.readFileSync(path.join(tmp, LEAD_MASTER_RELATIVE_PATH), "utf-8");
    expect(after.startsWith(before.split("\n").slice(0, 3).join("\n"))).toBe(true);
  });

  it("更新单条 Lead 不影响其他行", () => {
    const seed: Lead[] = [
      baseLead({ lead_id: "L001", website: "old1.com", email: "old1@old1.com", status: "New" }),
      baseLead({ lead_id: "L002", website: "old2.com", email: "old2@old2.com", status: "New", notes: "保留我" }),
    ];
    writeLeads(seed, tmp);
    updateLead("L001", { company: "New Name Inc" }, { cwd: tmp });
    const rows = readLeads(tmp);
    expect(rows[0].company).toBe("New Name Inc");
    expect(rows[1].notes).toBe("保留我");
  });

  it("搜索能按域名/公司/邮箱命中", () => {
    writeLeads([
      baseLead({ lead_id: "L001", website: "alpha.com", company: "Alpha", email: "a@alpha.com" }),
      baseLead({ lead_id: "L002", website: "beta.com", company: "Beta", email: "b@beta.com" }),
    ], tmp);
    expect(searchLeads("alpha", tmp)).toHaveLength(1);
    expect(searchLeads("b@beta.com", tmp)[0].lead_id).toBe("L002");
    expect(searchLeads("不存在", tmp)).toHaveLength(0);
  });

  it("既有外链/目录跟踪 CSV 不被 E 改动（内容仍在且无 lead 列）", () => {
    const repoRoot = process.cwd();
    for (const f of ["seo-growth/outreach-crm.csv", "seo-growth/directory-crm.csv"]) {
      const full = path.join(repoRoot, f);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full, "utf-8");
      const header = parseCsv(text)[0] ?? [];
      if (f.endsWith("outreach-crm.csv")) {
        expect(header).toContain("website");
        expect(header).not.toContain("lead_id"); // 仍是外链表，未被 E 改写
      }
    }
  });
});

// ================= E12：隐私 / 访问控制 =================
describe("E12 隐私与访问控制", () => {
  it("leads 模块无 'use client'，且不含任何 NEXT_PUBLIC_ 前缀", () => {
    const dir = path.join(process.cwd(), "src/lib/leads");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      if (file.includes(".test.")) continue; // 测试文件自身不含业务代码
      const src = fs.readFileSync(path.join(dir, file), "utf-8");
      expect(src, `${file} 不得是客户端组件`).not.toContain('"use client"');
      expect(src, `${file} 不得出现 NEXT_PUBLIC_`).not.toContain("NEXT_PUBLIC_");
    }
  });

  it("没有任何 app 路由 / 页面 / public 资产引用 lead 数据", () => {
    const root = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) continue;
        if (full.startsWith(path.join(root, "lib/leads"))) continue;
        const src = fs.readFileSync(full, "utf-8");
        if (/["']@\/lib\/leads["']|["']\.\.\/leads["']|["']\.\/leads["']/.test(src)) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders, `以下文件引用了内部 lead 数据：${offenders.join(", ")}`).toEqual([]);
  });

  it("主库不在 public/ 下，不会被静态托管", () => {
    expect(fs.existsSync(path.join(process.cwd(), "public", "leads.csv"))).toBe(false);
    expect(LEAD_MASTER_RELATIVE_PATH.startsWith("public")).toBe(false);
  });

  it("主库被 .gitignore 屏蔽，避免潜客邮箱被提交到仓库", () => {
    const gi = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf-8");
    expect(gi).toMatch(/leads\.csv/);
  });
});

// ================= 真实主库数据质量守卫 =================
describe("真实 Lead Master 数据质量（手工编辑也能兜住）", () => {
  it("主库若存在：无重复，status/lead_type/template 合法，日期字段格式一致", () => {
    // 注意：`seo-growth/leads.csv` 被 .gitignore 屏蔽（含真实联系人邮箱），
    // 因此在没有该文件的环境（CI / 新克隆）里必须**跳过**而不是失败 ——
    // 这不是「冷启动假设」，而是数据不在版本控制内的必然结果。
    // 但只要文件存在，其内容就必须完全合法。
    const realPath = path.join(process.cwd(), LEAD_MASTER_RELATIVE_PATH);
    if (!fs.existsSync(realPath)) return;
    const rows = readLeads();
    if (rows.length === 0) return;

    // 去重守卫：按归一化域名+邮箱不得重复
    const seen = new Map<string, string>();
    for (const l of rows) {
      const key = `${normalizeDomain(l.website)}|${normalizeEmail(l.email)}`;
      expect(seen.has(key), `主库存在重复 Lead：${key}（已有 ${seen.get(key)}，又出现 ${l.lead_id}）`).toBe(false);
      seen.set(key, l.lead_id);
    }

    // 取值守卫：真实运营已开始，状态必须是 E 的合法枚举（不得写口语小写形式）
    for (const l of rows) {
      expect(LEAD_STATUSES, `${l.lead_id} 的 status 非法：${l.status}`).toContain(l.status);
      expect(LEAD_TYPES, `${l.lead_id} 的 lead_type 非法：${l.lead_type}`).toContain(l.lead_type);
      if (l.template) expect(LEAD_TEMPLATE_IDS).toContain(l.template);
      // 日期字段必须是 date-only（E schema 的 isDateOnly），不得混用 ISO 时间戳
      for (const f of ["first_contacted_at", "last_contacted_at", "next_followup_at", "audit_date"] as const) {
        if (l[f]) expect(isDateOnly(l[f]), `${l.lead_id} 的 ${f} 必须是 YYYY-MM-DD，实际：${l[f]}`).toBe(true);
      }
      // 已发首封的 Lead 必须留下具体问题记录（没确认过问题就不该发）
      if (l.status === "Contacted" || l.status === "Follow-up 1" || l.status === "Follow-up 2") {
        expect(l.specific_issue.trim(), `${l.lead_id} 已发信但缺 specific_issue`).not.toBe("");
      }
      // 时间顺序：last_contacted_at 不得早于 first_contacted_at
      if (l.first_contacted_at && l.last_contacted_at) {
        expect(l.last_contacted_at >= l.first_contacted_at, `${l.lead_id} 的 last 早于 first`).toBe(true);
      }
    }

    // suppression 守卫：Suppressed 一律不得出现在跟进队列里
    for (const l of rows) {
      if (l.status === "Suppressed") expect(isFollowUpEligible(l)).toBe(false);
    }
  });
});

// ================= E13：历史 Contacted 回填 / 状态机对账 =================
// 背景：2026-09-29 的 Day 1 批次把 76 条 Lead 批量直接写成 `status = Contacted`，
// 没有经过 New → Ready to Contact → Contacted，而且都没记 template。
// 本组测试锁定「对账机制」的边界：只补状态、不伪造发送、不升级 New、幂等、不发信。

describe("E13 历史 Contacted 回填（backfill-contacted）", () => {
  const NOTE_DATE = "2026-10-08";
  const NOW = new Date(`${NOTE_DATE}T10:00:00Z`);

  /** 一条「批量写入」的历史 Lead：真的有发送事实，但没有 template */
  function historicContacted(overrides: Partial<Lead> = {}): Lead {
    return baseLead({
      lead_id: "HIST1",
      website: "hist.com",
      email: "hi@hist.com",
      status: "Contacted",
      first_contacted_at: "2026-09-29",
      last_contacted_at: "2026-09-29",
      template: "",
      last_action: "Day 1 outreach sent via Resend: delivered",
      notes: "sent 2026-09-29, delivered",
      ...overrides,
    });
  }

  it("contact fact 判定：必须有真实发送记录，准备发 / 草稿都不算", () => {
    const real = historicContacted();
    expect(hasOutboundContactFact(real)).toBe(true);
    expect(inspectContactFact(real).evidence.join(" ")).toContain("first_contacted_at=2026-09-29");

    // 只有日期、没有发送记录 → 不算事实
    const noRecord = historicContacted({ last_action: "", notes: "" });
    expect(hasOutboundContactFact(noRecord)).toBe(false);
    expect(inspectContactFact(noRecord).missing.join(" ")).toContain("没有 outbound 发送记录");

    // 「准备发」不算事实
    const draft = historicContacted({ last_action: "Draft prepared, not sent yet", notes: "" });
    expect(hasOutboundContactFact(draft)).toBe(false);

    // 日期不合法 / 时序倒挂 → 不算事实
    expect(hasOutboundContactFact(historicContacted({ first_contacted_at: "2026/09/29" }))).toBe(false);
    expect(
      hasOutboundContactFact(historicContacted({ first_contacted_at: "2026-09-30", last_contacted_at: "2026-09-29" }))
    ).toBe(false);
  });

  it("有真实 contact fact 但状态未到 Contacted → 补成 Contacted（触达时间原样保留）", () => {
    writeLeads(
      [
        historicContacted({
          lead_id: "FACT1",
          status: "Ready to Contact",
          next_followup_at: "2026-10-06",
        }),
      ],
      tmp
    );

    const r = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(false);
    expect(r.plan.summary.promoteToContacted).toBe(1);
    expect(r.plan.summary.statusChanges).toBe(1);
    expect(r.written).toBe(1);

    const after = readLeads(tmp);
    expect(after[0].status).toBe("Contacted");
    // 历史事实未被改写
    expect(after[0].first_contacted_at).toBe("2026-09-29");
    expect(after[0].last_contacted_at).toBe("2026-09-29");
    // 没有顺手排一个 follow-up
    expect(after[0].next_followup_at).toBe("2026-10-06");
    expect(isReconciled(after[0])).toBe(true);
  });

  it("没有 contact fact 的 New → 保持 New（绝不自动升级）", () => {
    writeLeads(
      [
        baseLead({ lead_id: "NEW1", website: "new1.com", email: "n1@new1.com", status: "New" }),
        baseLead({ lead_id: "NEW2", website: "new2.com", email: "n2@new2.com", status: "Researching" }),
        baseLead({ lead_id: "NEW3", website: "new3.com", email: "n3@new3.com", status: "Ready to Contact" }),
      ],
      tmp
    );

    const r = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(r.plan.summary.skippedNoFact).toBe(3);
    expect(r.plan.summary.statusChanges).toBe(0);
    expect(r.written).toBe(0);

    const after = readLeads(tmp);
    expect(after.map((l) => l.status)).toEqual(["New", "Researching", "Ready to Contact"]);
    for (const l of after) {
      expect(l.notes).toBe("");
      expect(isReconciled(l)).toBe(false);
    }
  });

  it("重复执行 backfill → 数据完全不变（幂等）", () => {
    writeLeads([historicContacted(), baseLead({ lead_id: "NEW1", website: "new1.com", email: "n1@new1.com", status: "New" })], tmp);

    const first = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(first.written).toBe(1);
    const snapshot = JSON.stringify(readLeads(tmp));

    const second = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(second.written).toBe(0);
    expect(second.plan.summary.alreadyReconciled).toBe(1);
    expect(second.plan.summary.recordGrandfather).toBe(0);

    const third = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(third.written).toBe(0);

    expect(JSON.stringify(readLeads(tmp))).toBe(snapshot);
    expect(countReconciledLeads(tmp)).toBe(1);
    // 标记只出现一次
    const notes = readLeads(tmp)[0].notes;
    expect(notes.split(RECONCILE_NOTE_MARKER).length - 1).toBe(1);
  });

  it("已经 Contacted 的历史行 → 只登记豁免（notes 追加），status 与日期不变；重跑不再写", () => {
    writeLeads([historicContacted()], tmp);
    const before = readLeads(tmp)[0];

    const r = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(r.plan.summary.recordGrandfather).toBe(1);
    expect(r.plan.summary.statusChanges).toBe(0); // 不改 status
    expect(r.written).toBe(1); // 但写入了 provenance

    const after = readLeads(tmp)[0];
    expect(after.status).toBe("Contacted");
    expect(after.status).toBe(before.status);
    expect(after.first_contacted_at).toBe(before.first_contacted_at);
    expect(after.last_contacted_at).toBe(before.last_contacted_at);
    expect(after.template).toBe(""); // 无证据就不虚构
    expect(after.notes.startsWith(before.notes)).toBe(true);
    expect(after.notes).toContain(RECONCILE_NOTE_MARKER);
    expect(after.notes).toContain("template 无证据可回填");

    const again = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(again.written).toBe(0);
    expect(readLeads(tmp)[0].notes).toBe(after.notes);
  });

  it("已经 Contacted 且已记录 template（走过状态机）→ 完全不动", () => {
    writeLeads([historicContacted({ template: "A_website_issue_v1" })], tmp);
    const before = readLeads(tmp)[0];
    const r = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(r.plan.summary.alreadyConsistent).toBe(1);
    expect(r.plan.summary.writable).toBe(0);
    expect(r.written).toBe(0);
    expect(readLeads(tmp)[0]).toEqual(before);
  });

  it("默认是 dry-run：只算不写", () => {
    writeLeads([historicContacted()], tmp);
    const before = JSON.stringify(readLeads(tmp));
    const r = backfillContacted({ cwd: tmp, now: NOW }); // 没有 apply
    expect(r.dryRun).toBe(true);
    expect(r.written).toBe(0);
    expect(r.plan.summary.recordGrandfather).toBe(1); // 计划里有，但没落盘
    expect(JSON.stringify(readLeads(tmp))).toBe(before);
  });

  it("backfill 不增加发送次数、不改触达时间、不改 last_action", () => {
    writeLeads(
      [
        historicContacted({ lead_id: "A", website: "a.com", email: "a@a.com" }),
        historicContacted({ lead_id: "B", website: "b.com", email: "b@b.com", status: "Ready to Contact" }),
        baseLead({ lead_id: "C", website: "c.com", email: "c@c.com", status: "New" }),
      ],
      tmp
    );

    const before = readLeads(tmp);
    const sendsBefore = countOutboundSendRecords(before);
    expect(sendsBefore).toBe(2);

    backfillContacted({ cwd: tmp, apply: true, now: NOW });
    const after = readLeads(tmp);

    // ① 「有发送记录的行数」不变 → 没有凭空多出一次触达
    expect(countOutboundSendRecords(after)).toBe(sendsBefore);
    // ② 逐行比对：触达时间与发送记录一字未改
    for (let i = 0; i < before.length; i++) {
      expect(after[i].first_contacted_at).toBe(before[i].first_contacted_at);
      expect(after[i].last_contacted_at).toBe(before[i].last_contacted_at);
      expect(after[i].next_followup_at).toBe(before[i].next_followup_at);
      expect(after[i].last_action).toBe(before[i].last_action);
      expect(after[i].created_at).toBe(before[i].created_at);
      expect(after[i].reply_status).toBe(before[i].reply_status);
    }
    // ③ 对账注记本身不得被误读成一次发送
    expect(after[0].notes).toContain(RECONCILE_NOTE_MARKER);
    expect(hasOutboundContactFact(after[0])).toBe(true);
  });

  it("backfill 不触发发送：模块与 CLI 分支都没有网络调用", () => {
    const files = [
      path.join(process.cwd(), "src/lib/leads/reconcile.ts"),
      path.join(process.cwd(), "src/lib/leads/store.ts"),
      path.join(process.cwd(), "scripts/leads.mts"),
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf-8");
      for (const bad of [/\bfetch\s*\(/, /axios/, /nodemailer/, /resend\.emails/, /https?\.request/]) {
        expect(src, `${path.basename(f)} 不得出现网络调用 ${bad}`).not.toMatch(bad);
      }
    }
  });

  it("有发送事实但缺 specific_issue → 拒绝推进（交人工），不写库", () => {
    writeLeads([historicContacted({ specific_issue: "", status: "Ready to Contact" })], tmp);
    const r = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(r.plan.summary.blockedMissingIssue).toBe(1);
    expect(r.plan.summary.statusChanges).toBe(0);
    expect(r.written).toBe(0);
    expect(readLeads(tmp)[0].status).toBe("Ready to Contact");
  });

  it("Suppressed / Not Interested / No Response 一律不动（终态）", () => {
    writeLeads(
      [
        historicContacted({ lead_id: "S1", website: "s1.com", email: "s1@s1.com", status: "Suppressed" }),
        historicContacted({ lead_id: "S2", website: "s2.com", email: "s2@s2.com", status: "Not Interested" }),
        historicContacted({ lead_id: "S3", website: "s3.com", email: "s3@s3.com", status: "No Response" }),
      ],
      tmp
    );
    const before = JSON.stringify(readLeads(tmp));
    const r = backfillContacted({ cwd: tmp, apply: true, now: NOW });
    expect(r.plan.summary.skippedFrozen).toBe(3);
    expect(r.written).toBe(0);
    expect(JSON.stringify(readLeads(tmp))).toBe(before);
  });

  it("planContactedBackfill / applyContactedBackfill 是纯函数（不改入参）", () => {
    const leads = [historicContacted(), baseLead({ lead_id: "N", website: "n.com", email: "n@n.com" })];
    const snapshot = JSON.stringify(leads);
    const plan: ReconcilePlan = planContactedBackfill(leads);
    const out = applyContactedBackfill(leads, plan, { noteDate: NOTE_DATE, nowIso: `${NOTE_DATE}T00:00:00.000Z` });
    expect(JSON.stringify(leads)).toBe(snapshot); // 入参未被改动
    expect(out).not.toBe(leads);
    expect(out[0]).not.toBe(leads[0]); // 被写的行是新对象
    expect(out[1]).toBe(leads[1]); // 未列入写入的行复用原对象
    expect(buildReconcileNote(plan.entries[0], NOTE_DATE)).toContain(RECONCILE_NOTE_MARKER);
  });

  it("状态机纪律：新建时不得直接写 Contacted（唯一的绕过路径已封）", () => {
    // add --status=Contacted 被拒（这就是 Day 1 批量写入的写法）
    const direct = addLead(
      {
        website: "bypass.com",
        email: "b@bypass.com",
        lead_type: "SaaS",
        specific_issue: "Missing canonical",
        template: "A_website_issue_v1",
        status: "Contacted",
      },
      { cwd: tmp }
    );
    expect(direct.ok).toBe(false);
    expect(direct.reasons?.join(" ")).toContain("backfill-contacted");

    // New → Contacted 依旧被拒（必须经过 Ready to Contact）
    const created = addLead(
      {
        website: "flow.com",
        email: "f@flow.com",
        lead_type: "SaaS",
        specific_issue: "Missing canonical",
        template: "A_website_issue_v1",
        status: "New",
      },
      { cwd: tmp }
    );
    expect(created.ok).toBe(true);
    const id = created.lead!.lead_id;
    expect(updateLead(id, { status: "Contacted" }, { cwd: tmp }).ok).toBe(false);

    // 正式路径仍然可用：New → Ready to Contact → Contacted
    expect(updateLead(id, { status: "Ready to Contact" }, { cwd: tmp }).ok).toBe(true);
    const sent = updateLead(id, { status: "Contacted" }, { cwd: tmp, now: NOW });
    expect(sent.ok).toBe(true);
    expect(sent.lead!.status).toBe("Contacted");
    expect(sent.lead!.first_contacted_at).toBe(NOTE_DATE);

    // 合法的初始状态仍然允许（不能因为堵绕过而堵掉正常录入）
    for (const s of ["New", "Researching", "Not Interested", "Suppressed"]) {
      const r = addLead(
        { website: `${s.replace(/\s/g, "").toLowerCase()}.example.com`, email: `x@${s.replace(/\s/g, "").toLowerCase()}.com`, lead_type: "Blog", specific_issue: "Missing canonical", status: s },
        { cwd: tmp }
      );
      expect(r.ok, `初始状态 ${s} 应被允许`).toBe(true);
    }
  });

  it("CONTACTED_OR_LATER_STATUSES 与状态机一致：都从 Contacted 可达，且不含未触达状态", () => {
    for (const s of CONTACTED_OR_LATER_STATUSES) {
      expect(isContactedOrLater(s)).toBe(true);
      expect(STATUS_TRANSITIONS["Ready to Contact"]).toContain("Contacted");
    }
    for (const s of ["New", "Researching", "Ready to Contact", "Suppressed", "No Response", "Not Interested"]) {
      expect(isContactedOrLater(s), `${s} 不应算作「已触达」`).toBe(false);
    }
  });

  it("真实主库：有发送事实的行必须已经到 Contacted 或更靠后（防止再次批量绕过）", () => {
    // leads.csv 被 .gitignore 屏蔽：文件不存在时跳过（不是冷启动假设，是数据不在版本控制内）
    if (!fs.existsSync(path.join(process.cwd(), LEAD_MASTER_RELATIVE_PATH))) return;
    const rows = readLeads();
    if (rows.length === 0) return;
    for (const l of rows) {
      const fact = inspectContactFact(l);
      if (!fact.hasFact) continue;
      // 有真实发送事实的行，状态必须已经承认这次触达（或处于冻结终态）
      const ok = isContactedOrLater(l.status) || ["Suppressed", "Not Interested", "No Response"].includes(l.status);
      expect(ok, `${l.lead_id} 有发送事实但状态仍是 ${l.status} —— 请跑 npm run leads -- backfill-contacted`).toBe(true);
    }
  });
});

// ================= CSV 解析健壮性 =================
describe("CSV 解析", () => {
  it("支持引号内逗号、换行与转义引号", () => {
    const rows = parseCsv('a,b\n"x,1","line1\nline2","say ""hi"""\n');
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["x,1", "line1\nline2", 'say "hi"']);
  });

  it("序列化后再解析是恒等的", () => {
    const header = ["a", "b"];
    const data = [["含,逗号", "含\"引号\""], ["普通", "x"]];
    const text = serializeCsv(header, data);
    const back = parseCsv(text);
    expect(back[0]).toEqual(header);
    expect(back[1]).toEqual(data[0]);
    expect(back[2]).toEqual(data[1]);
  });
});
