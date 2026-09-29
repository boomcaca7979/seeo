// ===== I｜用户案例基地 验收测试 =====
// 覆盖 §20：schema / status / evidence_type / consent / anonymization /
// real-data validation / missing evidence blocked / Approved 门槛 /
// Published 需同意 / quote 处理 / before-after / E 分离 / F 与 G 集成 /
// H 引用兼容 / 公开资产无邮箱 / 不进客户端 bundle。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BANNED_CLAIM_PHRASES,
  CASE_CHANNELS,
  CASE_FIELDS,
  CASE_SOURCES,
  CASE_STATUSES,
  CASE_TYPES,
  EVIDENCE_TYPES,
  emptyCase,
  isCaseChannel,
  isCaseSource,
  isCaseStatus,
  isCaseType,
  isEvidenceType,
  joinList,
  splitList,
  type CaseRecord,
} from "./schema.ts";
import { declaresNoResult, findDuplicateCaseIds, hasNumericClaims, validateCase } from "./validate.ts";
import {
  CASE_MASTER_RELATIVE_PATH,
  addCase,
  auditCases,
  casesForCommunityPost,
  casesForContent,
  crossReferenceIssues,
  publishedCases,
  readCases,
  setStatus,
  writeCases,
} from "./store.ts";

// 只读比对（证明 I 与 F/G/H 是引用关系，不是复制）
import { readTopics } from "../content/store.ts";
import { LOCALE_ROUTED_PATHS } from "@/i18n/locale-routed-paths";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-cases-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function validCase(over: Partial<CaseRecord> = {}): CaseRecord {
  const c = emptyCase();
  c.case_id = "CASE-001";
  c.status = "Review";
  c.source = "SeeO Audit";
  c.subject_type = "Technical SEO";
  c.challenge = "分类页模板输出了重复标题，但团队不知道该改模板还是逐页改文案。";
  c.initial_state = "审计在分类页上成片报出重复标题。";
  c.seeo_used = "免费技术审计（duplicate-title / duplicate-h1 检查 + 受影响页面清单）";
  c.actions_taken = "在模板层统一标题规则，而不是逐页修改。";
  c.result = "复跑同一检查后，该类重复条目归零。";
  c.result_period = "2 周";
  c.evidence_type = "Audit";
  c.evidence_location = "SeeO 审计复跑截图（内部留档）";
  return { ...c, ...over };
}

// ---------------- schema / 枚举 ----------------
describe("I schema", () => {
  it("字段覆盖 §3 要求（含 consent 与 before/after），且不含任何联系信息", () => {
    for (const f of [
      "case_id", "status", "source", "subject_type", "website", "industry",
      "challenge", "initial_state", "seeo_used", "actions_taken", "result", "result_period",
      "evidence_type", "evidence_location", "quote", "quote_consent", "published", "channels", "notes",
    ]) {
      expect(CASE_FIELDS).toContain(f);
    }
    // E 的字段不得出现在案例库
    for (const pii of ["email", "contact_name", "phone", "role", "lead_id"]) {
      expect(CASE_FIELDS).not.toContain(pii);
    }
  });

  it("枚举取值固定", () => {
    expect([...CASE_STATUSES]).toEqual(["Lead", "Consent Pending", "Evidence Pending", "Draft", "Review", "Approved", "Published", "Archived"]);
    expect([...EVIDENCE_TYPES]).toContain("Audit");
    expect([...EVIDENCE_TYPES]).toContain("GSC");
    expect([...CASE_SOURCES]).toContain("User Provided");
    expect([...CASE_TYPES]).toContain("Indexing");
    expect([...CASE_CHANNELS]).toContain("product_hunt");
    expect(CASE_TYPES.length).toBeLessThanOrEqual(9);
  });

  it("枚举守卫函数正确", () => {
    expect(isCaseStatus("Review")).toBe(true);
    expect(isCaseStatus("Done")).toBe(false);
    expect(isCaseSource("SeeO Audit")).toBe(true);
    expect(isCaseSource("某客户")).toBe(false);
    expect(isEvidenceType("Before/After")).toBe(true);
    expect(isEvidenceType("Vibes")).toBe(false);
    expect(isCaseType("Internal Linking")).toBe(true);
    expect(isCaseChannel("x")).toBe(true);
    expect(isCaseChannel("facebook")).toBe(false);
  });
});

// ---------------- 真实数据规则 ----------------
describe("I3 real-data rule", () => {
  it("合法案例零问题", () => {
    expect(validateCase(validCase())).toEqual([]);
  });

  it("出现数字但没有证据 → 拒绝", () => {
    const c = validCase({ metric: "Indexed pages", before_value: "120", after_value: "147", evidence_type: "", evidence_location: "" });
    expect(hasNumericClaims(c)).toBe(true);
    const issues = validateCase(c);
    expect(issues.some((i) => i.field === "evidence_type")).toBe(true);
    expect(issues.some((i) => i.field === "evidence_location")).toBe(true);
  });

  it("数字 + 不支撑数字的证据类型（User Quote）→ 拒绝", () => {
    const c = validCase({ before_value: "120", after_value: "147", evidence_type: "User Quote", evidence_location: "用户的公开评论" });
    expect(validateCase(c).some((i) => i.field === "evidence_type")).toBe(true);
  });

  it("有 metric/before/after 必须写统计周期", () => {
    const c = validCase({ metric: "Rankings", before_value: "top 20", after_value: "top 8", result_period: "" });
    expect(validateCase(c).some((i) => i.field === "result_period")).toBe(true);
  });

  it("Review 阶段允许还没有结果；但进入 Approved 前必须给出结果或明确标记无结果", () => {
    const bare = { metric: "", before_value: "", after_value: "", before_issue: "", after_issue: "" };

    // 还在 Review：结果可以暂缺（不强制）
    const inReview = validCase({ ...bare, result: "" });
    expect(validateCase(inReview).some((i) => i.field === "result")).toBe(false);

    // 同一份内容推到 Approved：必须给出结果，或显式声明无结果
    const asApproved = { ...inReview, status: "Approved" as const };
    expect(declaresNoResult(asApproved)).toBe(false);
    expect(validateCase(asApproved).some((i) => i.field === "result")).toBe(true);

    // 显式声明无结果后可以通过 —— 无结果的案例仍是有价值的 Audit Example
    const marked = validCase({ ...bare, status: "Approved", result: "no-result（本次只作为 Audit Example 保留）" });
    expect(declaresNoResult(marked)).toBe(true);
    expect(validateCase(marked)).toEqual([]);
  });

  it("命中无证据宣传话术 → 拒绝", () => {
    for (const phrase of ["Best SEO tool", "保证排名第一", "10x traffic"]) {
      const c = validCase({ result: phrase });
      expect(validateCase(c).some((i) => i.field === "result"), `${phrase} 应被拒绝`).toBe(true);
    }
    expect(BANNED_CLAIM_PHRASES.length).toBeGreaterThan(0);
  });
});

// ---------------- 证据 / 同意 / 匿名 ----------------
describe("I4/I5/I6 evidence · consent · anonymization", () => {
  it("Approved 必须有 source + evidence + 结果（或明确无结果）", () => {
    expect(validateCase(validCase({ status: "Approved" }))).toEqual([]);

    const noEvidence = validCase({ status: "Approved", evidence_type: "", evidence_location: "" });
    expect(validateCase(noEvidence).some((i) => i.field === "evidence_location")).toBe(true);

    const noSource = validCase({ status: "Approved", source: "" });
    expect(validateCase(noSource).some((i) => i.field === "source")).toBe(true);
  });

  it("证据不足时只能停在 Draft / Evidence Pending（结构上允许，但不得 Approved）", () => {
    const pending = validCase({ status: "Evidence Pending", evidence_type: "", evidence_location: "" });
    expect(validateCase(pending)).toEqual([]);
    const asApproved = { ...pending, status: "Approved" as const };
    expect(validateCase(asApproved).length).toBeGreaterThan(0);
  });

  it("Published 需要同意：可识别网站要有 site_consent；引用要有 quote_consent", () => {
    const p = validCase({ status: "Published", published: "yes", website: "example.com", site_consent: "" });
    expect(validateCase(p).some((i) => i.field === "site_consent")).toBe(true);

    const okSite = validCase({ status: "Published", published: "yes", website: "example.com", site_consent: "yes" });
    expect(validateCase(okSite)).toEqual([]);

    const withQuote = validCase({ status: "Published", published: "yes", quote: "改模板比逐页改省事。", quote_consent: "" });
    expect(validateCase(withQuote).some((i) => i.field === "quote_consent")).toBe(true);
  });

  it("anonymize_required=yes 时不得记录可识别网站", () => {
    const c = validCase({ anonymize_required: "yes", website: "acme-saas.com" });
    expect(validateCase(c).some((i) => i.field === "website")).toBe(true);
    const ok = validCase({ anonymize_required: "yes", website: "" , industry: "B2B SaaS" });
    expect(validateCase(ok)).toEqual([]);
  });

  it("published=yes 但 status 不是 Published → 拒绝", () => {
    const c = validCase({ published: "yes", status: "Approved" });
    expect(validateCase(c).some((i) => i.field === "status")).toBe(true);
  });
});

// ---------------- 引用处理 ----------------
describe("I7 quote handling", () => {
  it("有引用必须明确 quote_consent（空 = 未同意）", () => {
    expect(validateCase(validCase({ quote: "好用的说。" })).some((i) => i.field === "quote_consent")).toBe(true);
  });

  it("润色过的引用必须保留原始 quote", () => {
    const c = validCase({ quote: "润色后的句子。", quote_edited: "yes", quote_consent: "yes" });
    expect(validateCase(c).some((i) => i.field === "quote_original")).toBe(true);
    const ok = validCase({ quote: "润色后的句子。", quote_original: "原话。", quote_edited: "yes", quote_consent: "yes" });
    expect(validateCase(ok)).toEqual([]);
  });

  it("quote 与 quote_original 不一致却没标 edited → 拒绝", () => {
    const c = validCase({ quote: "改了。", quote_original: "原话。", quote_edited: "no", quote_consent: "yes" });
    expect(validateCase(c).some((i) => i.field === "quote_edited")).toBe(true);
  });
});

// ---------------- 隐私 / E 分离 ----------------
describe("I13 privacy 与 E 分离", () => {
  it("案例库不得出现邮箱 / 手机号 / 凭据", () => {
    expect(validateCase(validCase({ notes: "可联系 owner@example.com" })).some((i) => i.field === "notes")).toBe(true);
    expect(validateCase(validCase({ notes: "电话 13800138000" })).some((i) => i.field === "notes")).toBe(true);
    expect(validateCase(validCase({ notes: "api_key: abcd1234" })).some((i) => i.field === "notes")).toBe(true);
  });

  it("cases 模块不引用 E 的 lead 库", () => {
    const dir = path.join(process.cwd(), "src/lib/cases");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf-8");
      expect(src, `${f} 不得引用 leads`).not.toMatch(/["'][^"']*leads[^"']*["']/);
    }
  });

  it("Case Master 文件本身不含邮箱 / 凭据", () => {
    const text = fs.readFileSync(path.join(process.cwd(), CASE_MASTER_RELATIVE_PATH), "utf-8");
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/(api[_-]?key|token|secret|password)\s*[:=]/i);
  });

  it("cases 模块无 'use client'，且没有任何 app/公开页面引用它", () => {
    const dir = path.join(process.cwd(), "src/lib/cases");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf-8");
      expect(src).not.toContain('"use client"');
      expect(src).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/);
    }
    const root = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) continue;
        if (full.startsWith(path.join(root, "lib/cases"))) continue;
        if (/from\s+["'][^"']*lib\/cases["']/.test(fs.readFileSync(full, "utf-8"))) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders, `以下文件引用了案例库：${offenders.join(", ")}`).toEqual([]);
  });

  it("本轮没有创建公开案例页面", () => {
    for (const p of ["case-studies", "customer-stories", "testimonials"]) {
      expect(fs.existsSync(path.join(process.cwd(), "src/app/(default)", p))).toBe(false);
      expect(fs.existsSync(path.join(process.cwd(), "src/app/[locale]", p))).toBe(false);
    }
    const sitemap = fs.readFileSync(path.join(process.cwd(), "src/app/sitemap.ts"), "utf-8");
    expect(sitemap).not.toMatch(/case-studies|customer-stories|testimonials/);
  });
});

// ---------------- 存储与门槛 ----------------
describe("I1/I2 Case Master 存储", () => {
  it("Case Master 路径唯一，允许 0 条", () => {
    expect(CASE_MASTER_RELATIVE_PATH).toBe("seo-growth/case-studies.csv");
    const csvs = fs.readdirSync(path.join(process.cwd(), "seo-growth")).filter((f) => f.endsWith(".csv"));
    const caseLike = csvs.filter((f) => /case|customer|testimonial|story/i.test(f));
    expect(caseLike).toEqual(["case-studies.csv"]);
  });

  it("真实主库当前为 0 条（NO REAL CASE DATA YET），且无占位数据", () => {
    const real = readCases();
    expect(real).toHaveLength(0);
    const audit = auditCases();
    expect(audit.total).toBe(0);
    expect(audit.issues).toEqual([]);
    expect(audit.duplicates).toEqual([]);
  });

  it("重复 case_id 被拒绝", () => {
    expect(findDuplicateCaseIds([validCase(), validCase()])).toEqual(["CASE-001"]);
    expect(addCase(validCase(), { cwd: tmp }).ok).toBe(true);
    const dup = addCase(validCase(), { cwd: tmp });
    expect(dup.ok).toBe(false);
    expect(dup.reasons?.join(" ")).toContain("已存在");
    expect(readCases(tmp)).toHaveLength(1);
  });

  it("校验不通过的案例不会落盘（不产生半成品）", () => {
    const bad = validCase({ challenge: "", seeo_used: "" });
    expect(addCase(bad, { cwd: tmp }).ok).toBe(false);
    expect(readCases(tmp)).toHaveLength(0);
  });

  it("setStatus 走 Approved 门槛：缺证据被拦，补齐后放行", () => {
    expect(addCase(validCase({ status: "Evidence Pending", evidence_type: "", evidence_location: "" }), { cwd: tmp }).ok).toBe(true);

    const blocked = setStatus("CASE-001", "Approved", {}, { cwd: tmp });
    expect(blocked.ok).toBe(false);
    expect(blocked.reasons?.join(" ")).toContain("evidence_location");

    const ok = setStatus("CASE-001", "Approved", { evidence_type: "Audit", evidence_location: "审计复跑截图" }, { cwd: tmp });
    expect(ok.ok).toBe(true);
    expect(ok.record!.status).toBe("Approved");
  });

  it("publishedCases 只返回已公开且状态为 Published 的案例", () => {
    writeCases([validCase({ case_id: "CASE-001", status: "Approved", published: "no" })], tmp);
    expect(publishedCases(tmp)).toHaveLength(0);
    const pub = validCase({ case_id: "CASE-002", status: "Published", published: "yes" });
    writeCases([validCase({ case_id: "CASE-001", status: "Approved", published: "no" }), pub], tmp);
    expect(publishedCases(tmp).map((c) => c.case_id)).toEqual(["CASE-002"]);
  });
});

// ---------------- F / G / H 集成 ----------------
describe("I9/I10/I11 F · G · H 集成", () => {
  const knownContent = readTopics().map((t) => t.content_id.trim());
  const allowedPaths = [...LOCALE_ROUTED_PATHS];

  it("related_content 必须存在于 F 的内容主库（只建立引用，不复制内容）", () => {
    expect(knownContent.length).toBeGreaterThanOrEqual(30);
    const bad = crossReferenceIssues([validCase({ related_content: "C999" })], knownContent, allowedPaths);
    expect(bad).toHaveLength(1);
    expect(bad[0].field).toBe("related_content");

    const good = crossReferenceIssues([validCase({ related_content: joinList(["C005", "C017"]) })], knownContent, allowedPaths);
    expect(good).toEqual([]);
  });

  it("related_seo_page 必须是 H 已收录的真实路径", () => {
    const bad = crossReferenceIssues([validCase({ related_seo_page: "/seo-issues/not-a-page" })], knownContent, allowedPaths);
    expect(bad).toHaveLength(1);
    const good = crossReferenceIssues([validCase({ related_seo_page: joinList(["/seo-issues", "/seo-issues/duplicate-title-tags"]) })], knownContent, allowedPaths);
    expect(good).toEqual([]);
  });

  it("可按 content_id / post_id 反向追溯（G 只存引用，不存案例正文）", () => {
    writeCases(
      [validCase({ case_id: "CASE-001", related_content: joinList(["C005"]), community_posts: joinList(["C005-R1"]) })],
      tmp
    );
    expect(casesForContent("C005", tmp).map((c) => c.case_id)).toEqual(["CASE-001"]);
    expect(casesForCommunityPost("C005-R1", tmp).map((c) => c.case_id)).toEqual(["CASE-001"]);
    expect(casesForContent("C001", tmp)).toHaveLength(0);
  });

  it("G 的发布记录里存在 C005-R1 这类 post_id 口径（引用格式一致）", () => {
    const gPosts = fs.readFileSync(path.join(process.cwd(), "seo-growth/community-posts.csv"), "utf-8");
    // G 的帖子列名包含 post_id / content_id，I 的 community_posts 用同样的 id 口径
    expect(gPosts.split("\n")[0]).toContain("post_id");
    expect(gPosts.split("\n")[0]).toContain("content_id");
    expect(splitList(joinList(["C005-R1", "C005-L1"]))).toEqual(["C005-R1", "C005-L1"]);
  });

  it("H 页面不因为 I 而出现任何未授信的真实案例文案（本轮不改 H）", () => {
    const content = fs.readFileSync(path.join(process.cwd(), "src/components/seo-issues/IssueLandingPage.tsx"), "utf-8");
    expect(content).not.toMatch(/lib\/cases/);
    expect(content).not.toMatch(/case-stud|testimonial/i);
  });
});
