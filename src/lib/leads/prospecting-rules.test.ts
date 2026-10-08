// ===== E｜潜客获取规则测试（公开邮箱 / 投诉压制 / 候选池 / Day 2 门槛） =====
// 覆盖 2026-10-08 合规修复的第二组不变量：
//
//   1. 「只能发到官网公开显示的邮箱」是机器可读规则，不是口头约定
//   2. 通用角色前缀（info@ / sales@ …）**本身不违规** ——
//      只有「拿不出公开来源证据」时才判红（回归：曾一度把官网公开的 info@ 也拦掉）
//   3. 投诉 = 明确拒绝 → Suppressed 终态，永久出队
//   4. 候选池只负责发现公司；source 必须可追溯；进入 Ready to Contact 前逐项核验
//
// 本文件只在 src/ 下（不受 seo-growth/operations/* 的隐私守卫约束），不碰真实数据。

import { describe, it, expect } from "vitest";

import { emptyLead, type Lead } from "./schema";
import { EMAIL_FROM_DEFAULT } from "../email/config";
import {
  ALLOWED_EMAIL_EVIDENCE_SOURCES,
  CANDIDATE_SOURCE_PREFIX,
  CANDIDATE_VERIFICATION_STEPS,
  COMPLAINT_NOTE_MARKER,
  COMPLAINT_SUPPRESSION_NOTE,
  DAY2_SEND_CHECKLIST,
  DAY2_SEND_GATES,
  FORBIDDEN_EMAIL_SOURCES,
  GENERIC_EMAIL_LOCALPARTS,
  OUTREACH_SENDER,
  PRE_SEND_STATUSES,
  PUBLIC_EMAIL_EVIDENCE_PATTERN,
  PUBLIC_EMAIL_RULE,
  PUBLIC_EMAIL_RULE_EFFECTIVE_FROM,
  auditPublicEmailRule,
  checkPublicEmailRule,
  hasPublicEmailEvidence,
  isComplaintSuppressed,
  isGenericEmail,
  isPublicDirectorySource,
  publicEmailEvidence,
} from "./prospecting-rules";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    ...emptyLead(),
    lead_id: "L-RULE",
    website: "example.com",
    company: "Example Inc",
    lead_type: "SaaS",
    specific_issue: "Missing canonical on /pricing",
    status: "New",
    ...overrides,
  };
}

/** notes 里带上「该邮箱在官网哪个公开页面真实显示过」的证据 */
const EVIDENCE = "public-email:https://example.com/contact";

// ================= E18：公开邮箱规则 =================

describe("E18 公开邮箱规则（无证据不发）", () => {
  it("规则文案本身写清「公开显示」与「不得发送」", () => {
    expect(PUBLIC_EMAIL_RULE).toContain("公开");
    expect(PUBLIC_EMAIL_RULE).toContain("不得发送");
  });

  it("发件人沿用 SeeO Team，地址取自 C 阶段唯一配置（不在这里重复写一遍地址）", () => {
    const addr = EMAIL_FROM_DEFAULT.replace(/^[^<]*</, "").replace(/>$/, "");
    expect(OUTREACH_SENDER).toBe(`SeeO Team <${addr}>`);
    expect(OUTREACH_SENDER).toContain("SeeO Team");
  });

  it("允许来源必须包含官网 mailto / Contact 页；禁止来源必须包含域名推测与买名单", () => {
    expect(ALLOWED_EMAIL_EVIDENCE_SOURCES.length).toBe(3);
    expect(ALLOWED_EMAIL_EVIDENCE_SOURCES.join(" ")).toMatch(/mailto/i);
    expect(ALLOWED_EMAIL_EVIDENCE_SOURCES.join(" ")).toMatch(/Contact/);
    expect(FORBIDDEN_EMAIL_SOURCES.join(" ")).toMatch(/info@domain/);
    expect(FORBIDDEN_EMAIL_SOURCES.join(" ")).toMatch(/第三方邮箱数据库/);
    expect(FORBIDDEN_EMAIL_SOURCES.join(" ")).toMatch(/爬/);
  });

  it("没填邮箱 = 还没准备好发，不是违规", () => {
    expect(checkPublicEmailRule(lead({ email: "" })).ok).toBe(true);
  });

  it("有公开来源证据 → 通过", () => {
    const l = lead({ email: "yuki@example.com", notes: `访客页可见 ${EVIDENCE}` });
    expect(hasPublicEmailEvidence(l)).toBe(true);
    expect(checkPublicEmailRule(l).ok).toBe(true);
  });

  it("没公开来源证据 → 判红，并要求补 public-email:<url>", () => {
    const r = checkPublicEmailRule(lead({ email: "yuki@example.com", notes: "从 https://example.com 推断" }));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toContain("public-email:<url>");
    expect(r.reasons.join(" ")).toContain(PUBLIC_EMAIL_RULE);
  });

  it("回归：通用前缀 info@/sales@ 只要有公开证据就**必须**通过", () => {
    const info = lead({ email: "info@example.com", notes: EVIDENCE });
    const sales = lead({ email: "sales@example.com", notes: EVIDENCE });
    expect(checkPublicEmailRule(info).ok).toBe(true);
    expect(checkPublicEmailRule(sales).ok).toBe(true);
  });

  it("通用前缀 + 无证据 → 判红，且额外说明「禁止由域名模式推测」", () => {
    const r = checkPublicEmailRule(lead({ email: "info@example.com" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(2);
    expect(r.reasons.join(" ")).toContain("通用角色前缀");
    expect(r.reasons.join(" ")).toContain("禁止由域名模式推测");
  });

  it("isGenericEmail 只认通用前缀，不误伤真实联系人", () => {
    for (const p of GENERIC_EMAIL_LOCALPARTS) expect(isGenericEmail(`${p}@x.com`)).toBe(true);
    expect(isGenericEmail("yuki@x.com")).toBe(false);
    expect(isGenericEmail("francois@schmidts.fr")).toBe(false);
    expect(isGenericEmail("")).toBe(false);
    expect(isGenericEmail("no-at-sign")).toBe(false);
  });

  it("publicEmailEvidence 支持多条证据、大小写不敏感", () => {
    expect(publicEmailEvidence(`${EVIDENCE} and PUBLIC-EMAIL: https://x.com/about`)).toEqual([
      "https://example.com/contact",
      "https://x.com/about",
    ]);
    expect(PUBLIC_EMAIL_EVIDENCE_PATTERN.test("public-email:https://a.com")).toBe(true);
    expect(publicEmailEvidence("没有任何证据")).toEqual([]);
  });
});

// ================= E19：批量自检与历史豁免 =================

describe("E19 批量自检：谁被检查、谁被豁免", () => {
  it("生效日之前已触达的历史行 → 豁免，不追溯判红", () => {
    const hist = lead({ email: "info@old.com", status: "Contacted", first_contacted_at: "2026-09-29" });
    const audit = auditPublicEmailRule([hist]);
    expect(audit.grandfathered).toBe(1);
    expect(audit.checked).toBe(0);
    expect(audit.issues).toEqual([]);
  });

  it("生效日之后才触达的行 → 纳入检查", () => {
    const post = lead({
      email: "yuki@new.com",
      status: "Contacted",
      first_contacted_at: PUBLIC_EMAIL_RULE_EFFECTIVE_FROM,
    });
    const audit = auditPublicEmailRule([post]);
    expect(audit.checked).toBe(1);
    expect(audit.issues).toHaveLength(1);
  });

  it("发送前状态（New / Researching / Ready to Contact）始终纳入检查", () => {
    for (const status of PRE_SEND_STATUSES) {
      const audit = auditPublicEmailRule([lead({ email: "yuki@x.com", status })]);
      expect(audit.checked).toBe(1);
      expect(audit.issues).toHaveLength(1);
    }
  });

  it("通用前缀 + 无证据会计两条（缺证据 + 前缀可疑），两条都属于同一行", () => {
    const audit = auditPublicEmailRule([lead({ email: "info@x.com", status: "Ready to Contact" })]);
    expect(audit.checked).toBe(1);
    expect(audit.issues).toHaveLength(2);
    expect(audit.issues.every((i) => i.lead_id === "L-RULE")).toBe(true);
  });

  it("发送前状态但还没填邮箱 → 不判红、也不计入 checked", () => {
    const audit = auditPublicEmailRule([lead({ email: "", status: "Ready to Contact" })]);
    expect(audit.checked).toBe(0);
    expect(audit.issues).toEqual([]);
  });

  it("全部合法 → issues 为空", () => {
    const audit = auditPublicEmailRule([
      lead({ email: "info@example.com", notes: EVIDENCE }),
      lead({ email: "yuki@example.com", notes: EVIDENCE }),
      lead({ email: "" }),
      lead({ status: "Contacted", first_contacted_at: "2026-09-29" }), // 历史豁免
    ]);
    expect(audit.issues).toEqual([]);
  });
});

// ================= E20：投诉 = 明确拒绝 =================

describe("E20 投诉压制", () => {
  it("标准句逐字固定（审计要能精确匹配，不得改写）", () => {
    expect(COMPLAINT_SUPPRESSION_NOTE).toBe(
      "[complaint] Recipient marked message as spam; permanently suppress future outreach."
    );
    expect(COMPLAINT_NOTE_MARKER).toBe("[complaint]");
  });

  it("只有「标记 + Suppressed」同时成立才算已压制", () => {
    expect(
      isComplaintSuppressed(lead({ notes: COMPLAINT_SUPPRESSION_NOTE, status: "Suppressed" }))
    ).toBe(true);
    // 只是记了投诉、状态还没压制 → false（这正是 doctor 要抓的中间态）
    expect(isComplaintSuppressed(lead({ notes: COMPLAINT_SUPPRESSION_NOTE, status: "Contacted" }))).toBe(false);
    // 压制了但没记投诉 → false
    expect(isComplaintSuppressed(lead({ notes: "对方要求停止", status: "Suppressed" }))).toBe(false);
  });
});

// ================= E21：候选池来源与 Day 2 硬门槛 =================

describe("E21 候选池来源与 Day 2 发送门槛", () => {
  it("候选来源必须带 public-directory: 前缀才合规", () => {
    expect(CANDIDATE_SOURCE_PREFIX).toBe("public-directory:");
    expect(isPublicDirectorySource("public-directory:awesome-selfhosted")).toBe(true);
    expect(isPublicDirectorySource("PUBLIC-DIRECTORY:awesome-selfhosted")).toBe(true);
    expect(isPublicDirectorySource("manual")).toBe(false);
    expect(isPublicDirectorySource("")).toBe(false);
  });

  it("候选核验步骤含 7 步，且 sitemap 一步必须引用 6 步规则并禁止用 404 断言无 sitemap", () => {
    expect(CANDIDATE_VERIFICATION_STEPS).toHaveLength(7);
    const sitemapStep = CANDIDATE_VERIFICATION_STEPS.join("\n");
    expect(sitemapStep).toContain("SITEMAP_VERIFICATION_STEPS");
    expect(sitemapStep).toMatch(/404/);
    expect(CANDIDATE_VERIFICATION_STEPS.join("\n")).toMatch(/public-email:<url>/);
    expect(CANDIDATE_VERIFICATION_STEPS.join("\n")).toMatch(/send-ledger\.csv/);
  });

  it("恢复发送前的 5 项硬门槛与用户要求逐条对应", () => {
    expect(DAY2_SEND_GATES.map((g) => g.id)).toEqual([
      "dedupe",
      "complaint",
      "public-email",
      "sitemap",
      "issue-evidence",
    ]);
    const text = DAY2_SEND_GATES.map((g) => g.requirement).join("\n");
    expect(text).toContain("Lead Master + Resend ledger dedupe = PASS");
    expect(text).toContain("Complaint suppression = PASS");
    expect(text).toContain("Public-email-only rule = PASS");
    expect(text).toContain("Sitemap verification = PASS");
    expect(text).toContain("Specific issue evidence = PASS");
  });

  it("每封邮件的形式要求含退订机制与发送后立即记账", () => {
    expect(DAY2_SEND_CHECKLIST).toHaveLength(6);
    const text = DAY2_SEND_CHECKLIST.join("\n");
    expect(text).toContain("List-Unsubscribe");
    expect(text).toContain("Resend message id");
    expect(text).toContain(OUTREACH_SENDER);
    expect(text).toContain("一次一封");
  });
});
