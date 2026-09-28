// ===== Cold Email 模板基地验收（C11 / C12）=====
// 目标：确认模板是「人工可复制使用」的成品，而不是半成品占位。
// 检查维度：
//   1. A–G 七类场景齐全，且 follow-up 序列首尾完整
//   2. 变量完整性：声明的每个变量都在正文里真实出现；替换后无残留占位符
//   3. 合规边界：不夸大、不恐吓、不伪造已完成的审计
//   4. outbound UTM 正确（utm_source=email / utm_medium=outbound / utm_campaign=cold_email）

import { describe, it, expect } from "vitest";
import {
  COLD_EMAIL_TEMPLATES,
  COLD_SEQUENCE,
  BASE_VARIABLES_NOTE,
  buildColdAuditUrl,
  type ColdEmailTemplate,
} from "./templates/cold-outreach";

const REQUIRED_GROUPS: Array<ColdEmailTemplate["group"]> = [
  "website_issue",
  "free_audit",
  "followup",
  "saas_founder",
  "agency",
  "content_site",
];

// 禁止出现的营销话术：夸大 / 恐吓 / 伪造人工审计 / 虚假紧迫感
const BANNED_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /guarantee/i, why: "不得做效果承诺" },
  { re: /act\s+now/i, why: "不得制造虚假紧迫感" },
  { re: /limited\s+time/i, why: "不得制造虚假紧迫感" },
  { re: /losing\s+(thousands|money|traffic)/i, why: "不得使用无法验证的损失恐吓" },
  { re: /#1\b/, why: "不得使用排名类夸大表述" },
  { re: /100%\s+(free|safe|guaranteed)/i, why: "不得使用绝对化承诺" },
  { re: /we\s+(audited|analyzed)\s+your\s+site/i, why: "不得暗示已完成人工审计" },
  { re: /our\s+audit\s+(found|showed)/i, why: "不得暗示已完成人工审计" },
  { re: /i\s+(fully\s+)?audited\s+your\s+site/i, why: "不得暗示已完成人工审计" },
];

function fill(t: ColdEmailTemplate): { subject: string; body: string } {
  let subject = t.subject;
  let body = t.body;
  for (const v of t.variables) {
    subject = subject.split(v.key).join(v.example);
    body = body.split(v.key).join(v.example);
  }
  return { subject, body };
}

describe("Cold Email 模板基地（C11）", () => {
  it("A–G 七类场景齐全", () => {
    expect(COLD_EMAIL_TEMPLATES).toHaveLength(7);
    const groups = new Set(COLD_EMAIL_TEMPLATES.map((t) => t.group));
    for (const g of REQUIRED_GROUPS) expect(groups.has(g)).toBe(true);
    // id 前缀按 A–G 命名，便于人工检索
    const ids = COLD_EMAIL_TEMPLATES.map((t) => t.id);
    for (const letter of ["A", "B", "C", "D", "E", "F", "G"]) {
      expect(ids.some((id) => id.startsWith(`${letter}_`))).toBe(true);
    }
  });

  it("follow-up 序列首尾完整（首封 → FU1 → FU2，时间递增）", () => {
    expect(COLD_SEQUENCE).toHaveLength(3);
    const steps = COLD_EMAIL_TEMPLATES.filter((t) => t.group === "followup").sort(
      (a, b) => a.sequenceStep - b.sequenceStep
    );
    expect(steps.map((s) => s.sequenceStep)).toEqual([1, 2]);
    expect(steps[0].dayOffset).toBeLessThan(steps[1].dayOffset);
    const firstTouches = COLD_EMAIL_TEMPLATES.filter((t) => t.sequenceStep === 0);
    expect(firstTouches.length).toBeGreaterThanOrEqual(5); // A/B/E/F/G
    for (const t of firstTouches) expect(t.dayOffset).toBe(0);
  });

  it("变量完整：声明的变量全部真实出现在正文中", () => {
    for (const t of COLD_EMAIL_TEMPLATES) {
      const raw = `${t.subject}\n${t.body}`;
      for (const v of t.variables) {
        expect(raw.includes(v.key), `${t.id} 声明了 ${v.key} 但正文未使用`).toBe(true);
      }
      expect(t.variables.length).toBeGreaterThan(0);
      // 每个变量都要有说明与示例，否则人工无法正确填写
      for (const v of t.variables) {
        expect(v.description.length, `${t.id}.${v.key} 缺少说明`).toBeGreaterThan(0);
        expect(v.example.length, `${t.id}.${v.key} 缺少示例`).toBeGreaterThan(0);
      }
    }
  });

  it("变量替换后无残留占位符（人工填完即可直接发送）", () => {
    for (const t of COLD_EMAIL_TEMPLATES) {
      const { subject, body } = fill(t);
      expect(subject, `${t.id} subject 残留占位符`).not.toMatch(/\[[^\]]+\]/);
      expect(body, `${t.id} body 残留占位符`).not.toMatch(/\[[^\]]+\]/);
      expect(body).not.toContain("undefined");
    }
  });

  it("合规边界：无夸大 / 恐吓 / 伪造人工审计话术", () => {
    for (const t of COLD_EMAIL_TEMPLATES) {
      const raw = `${t.subject}\n${t.body}`;
      for (const b of BANNED_PATTERNS) {
        expect(raw, `${t.id} 触发禁用话术：${b.why}（/${b.re.source}/）`).not.toMatch(b.re);
      }
    }
  });

  it("每个模板都写明使用前提（避免无观察就套模板）", () => {
    for (const t of COLD_EMAIL_TEMPLATES) {
      expect(t.whenToUse.length, `${t.id} 缺少 whenToUse`).toBeGreaterThan(20);
    }
    // 公共变量说明必须点明 [Specific Issue] 需亲眼确认
    expect(BASE_VARIABLES_NOTE).toContain("[Specific Issue]");
    expect(BASE_VARIABLES_NOTE).toContain("禁止编造");
  });

  it("邮件长度克制（正文不超过 1200 字符，适合冷邮件）", () => {
    for (const t of COLD_EMAIL_TEMPLATES) {
      expect(t.body.length, `${t.id} 正文过长`).toBeLessThan(1200);
    }
  });
});

describe("Cold Email UTM（C12）", () => {
  it("outbound 链接携带 utm_source=email / utm_medium=outbound / utm_campaign=cold_email", () => {
    const url = buildColdAuditUrl();
    expect(url).toContain("utm_source=email");
    expect(url).toContain("utm_medium=outbound");
    expect(url).toContain("utm_campaign=cold_email");
    expect(url).toContain("/app/audit");
  });

  it("与生命周期邮件共用同一套归因参数命名（不另造 attribution）", () => {
    // cold email 与 lifecycle 只在 utm_medium 上区分，utm_source 恒为 email
    const url = buildColdAuditUrl();
    const u = new URL(url);
    expect(u.searchParams.get("utm_source")).toBe("email");
    expect(u.searchParams.get("utm_medium")).toBe("outbound");
  });
});
