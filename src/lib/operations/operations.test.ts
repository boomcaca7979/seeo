// ===== L｜Daily Marketing Operations 验收测试 =====
//
// 原则：验证**真实数据关系**与**真实行为**，不做字符串存在检查。
// 覆盖：数据源唯一性 / 每日循环与配额 / 潜客状态映射 / 三类骨架 / 内容与社区与案例与 H 引用 /
//       B 契约同步 / daily-log schema 与来源标注 / 周聚合 / 无公开暴露 / 无自动化能力。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  B_PROVENANCE_MARKER,
  CORE_FUNNEL,
  DAILY_LOOP,
  DAILY_LOG_FIELDS,
  DAILY_QUOTAS,
  NUMERIC_LOG_FIELDS,
  OPS_DIR,
  OPS_FILES,
  OUTREACH_TEMPLATE_KINDS,
  OUTREACH_FORBIDDEN,
  OUTREACH_SEND_HOLD,
  PROSPECTING_VERIFICATION_RULE,
  SITEMAP_VERDICT_RULES,
  SITEMAP_VERIFICATION_STEPS,
  SOLE_MASTER_NAMES,
  STAGE_HANDOFFS,
  auditOperations,
  buildLogRow,
  dailyChecklist,
  readBEventNames,
  readCsvRows,
  weeklySummary,
} from "./index";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

// 既有阶段的唯一来源（L 只读引用，不复制数据）
import { LEAD_STATUSES, LEAD_FIELDS, STATUS_TRANSITIONS } from "../leads/schema.ts";
import { CONTENT_STATUSES } from "../content/schema.ts";
import { PLATFORMS, POST_STATUSES } from "../community/schema.ts";
import { ALL_EVENTS } from "../analytics/server.ts";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-ops-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function seed(cwd: string, rel: string, header: string, rows: string[][]): void {
  const file = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [header, ...rows.map((r) => r.join(","))];
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
}

// ================= L1-01 唯一数据源 =================
describe("L1-01 canonical sources", () => {
  it("清单里只有一个 SEO 落地页 Master、一个潜客库、一个内容库、一个案例库", () => {
    for (const f of ["leads.csv", "content-bank.csv", "case-studies.csv", "seo-landing-master.csv", "daily-log.csv"]) {
      expect(SOLE_MASTER_NAMES.filter((n) => n === f)).toHaveLength(1);
    }
    // 真实仓库中不得出现第二份
    const dir = path.join(ROOT, "seo-growth");
    const names = fs.readdirSync(dir).filter((n) => n.endsWith(".csv"));
    for (const dup of ["daily-leads.csv", "leads-2.csv", "leads-daily.csv", "content-bank-2.csv"]) {
      expect(names.includes(dup), `出现了疑似第二份数据源 ${dup}`).toBe(false);
    }
  });

  it("指向的既有 Master 在真实仓库中存在", () => {
    for (const [key, rel] of Object.entries(OPS_FILES)) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${key} 指向的文件不存在：${rel}`).toBe(true);
    }
    expect(fs.existsSync(path.join(ROOT, OPS_DIR, "OPERATING_SYSTEM.md"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, OPS_DIR, "WEEKLY_REVIEW.md"))).toBe(true);
  });

  it("不拥有 E/F/G/I/H 的数据：L 只读引用，不复制任何行", () => {
    // L 自己的文件里没有任何潜客/内容/案例的**数据行**。
    // 运营目录下允许有子目录（如 day1/ 与事故复核记录），只检查其中的**文件**。
    const opsFiles = fs
      .readdirSync(path.join(ROOT, OPS_DIR), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    expect(opsFiles).toContain("OPERATING_SYSTEM.md");
    for (const f of opsFiles) {
      const text = read(path.join(OPS_DIR, f));
      // 潜客库与内容库的表头不应出现在运营文档里整表复制
      expect(text).not.toContain("lead_id,website,company,contact_name,email");
      expect(text).not.toContain("content_id,title,content_type,audience");
    }
  });
});

// ================= L1-02 每日循环与配额 =================
describe("L1-02 daily loop & quotas", () => {
  it("每日循环顺序完整", () => {
    expect(DAILY_LOOP[0]).toBe("Find prospects");
    expect(DAILY_LOOP[DAILY_LOOP.length - 1]).toBe("Repeat");
    expect(DAILY_LOOP.some((s) => /community/i.test(s))).toBe(true);
    expect(DAILY_LOOP.some((s) => /analytics/i.test(s))).toBe(true);
  });

  it("配额是文档化的起始值，不是 KPI 承诺", () => {
    expect(DAILY_QUOTAS.newProspects).toBe(10);
    expect(DAILY_QUOTAS.personalizedOutreach).toBe(10);
    expect(DAILY_QUOTAS.followupsMin).toBe(3);
    expect(DAILY_QUOTAS.followupsMax).toBe(5);
    expect(DAILY_QUOTAS.followupsMin).toBeLessThanOrEqual(DAILY_QUOTAS.followupsMax);
    expect(DAILY_QUOTAS.communityInteractions).toBe(5);
    expect(DAILY_QUOTAS.contentPublished).toBe(1);
    // 文案里必须明确「不是成功承诺」
    expect(read("src/lib/operations/index.ts")).toMatch(/不是成功承诺|not a promise/i);
  });
});

// ================= L1-03 潜客流程 =================
describe("L1-03 lead flow", () => {
  it("运营口语状态映射到 E 的真实枚举（不新增第二套）", () => {
    const spoken = {
      new: "New", contacted: "Contacted", replied: "Replied", interested: "Interested",
      trial: "Trial", activated: "Activated", not_interested: "Not Interested",
      no_response: "No Response", do_not_contact: "Suppressed",
    };
    for (const status of Object.values(spoken)) {
      expect(LEAD_STATUSES as readonly string[]).toContain(status);
    }
    // 不得在 ops 里重新声明一套小写状态枚举
    const src = read("src/lib/operations/index.ts");
    expect(src).not.toContain('"new"|"contacted"|"replied"');
  });

  it("E 的真实状态机允许从 New 推进到 Contacted（并必须先过 Ready to Contact）", () => {
    const t = STATUS_TRANSITIONS as Record<string, readonly string[]>;
    expect(t.New).toContain("Researching");
    expect(t.New).toContain("Ready to Contact");
    // New 直接跳 Contacted 不被允许 —— 这就是「不能顺手把口语状态塞进表里」的原因
    expect(t.New).not.toContain("Contacted");
  });

  it("dailyChecklist 只输出清单，并指向唯一的 leads 文件", () => {
    const { items } = dailyChecklist(ROOT);
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.some((s) => s.includes(OPS_FILES.leads))).toBe(true);
    expect(items[items.length - 1]).toContain("daily-log.csv");
  });
});

// ================= L1-04 outreach =================
describe("L1-04 outreach workflow", () => {
  it("提供且仅提供三类骨架，每类都有适用场景", () => {
    expect(OUTREACH_TEMPLATE_KINDS.map((k) => k.id)).toEqual(["problem-led", "audit-led", "follow-up"]);
    for (const k of OUTREACH_TEMPLATE_KINDS) {
      expect(k.when.trim().length).toBeGreaterThan(6);
      expect(k.skeleton.trim().length).toBeGreaterThan(20);
    }
  });

  it("红线包含虚假证明与群发", () => {
    const all = OUTREACH_FORBIDDEN.join(" ");
    expect(all).toMatch(/虚构|群发/i);
    expect(OUTREACH_FORBIDDEN.length).toBeGreaterThanOrEqual(5);
  });

  it("默认 CTA 是免费审计而非强推付费", () => {
    const src = read("src/lib/operations/index.ts");
    expect(src).toMatch(/Free SEO Audit/);
    expect(src).not.toMatch(/Upgrade now|Buy now/);
  });
});

// ================= L1-05/06/07 内容・社区・SEO =================
describe("L1-05/06/07 content · community · seo distribution", () => {
  it("内容引用必须指向 F 的真实 content_id（运行时校验）", () => {
    const bank = readCsvRows(ROOT, OPS_FILES.contentBank);
    const ids = new Set(bank.map((b) => b.content_id));
    expect(ids.size).toBe(30);
    // J 引用的三个主题也必须真实存在
    for (const id of ["C005", "C007", "C008"]) expect(ids.has(id), `F 缺少 ${id}`).toBe(true);
  });

  it("内容状态取值来自 F 的真实枚举", () => {
    expect(CONTENT_STATUSES as readonly string[]).toContain("Ready");
    // 「每天选一个 Ready 主题」在 ops 里有明确依据
    expect(read("src/lib/operations/index.ts")).toMatch(/Ready/);
  });

  it("社区平台与发布状态取值来自 G 的真实枚举，且伪造发布会被查出", () => {
    expect(PLATFORMS as readonly string[]).toContain("product_hunt");
    expect(POST_STATUSES as readonly string[]).toContain("Published");

    seed(tmp, OPS_FILES.communityPosts, "post_id,content_id,platform,community,published_at,url,status,cta,notes", [
      ["P1", "C005", "reddit", "r/SEO", "2026-09-01", "https://www.reddit.com/r/SEO/x", "Published", "", ""],
      ["P2", "C005", "x", "", "", "", "Published", "", ""], // 标 Published 但无 url/时间
      ["P3", "C999", "x", "", "2026-09-02", "u", "Draft", "", ""], // 引用不存在的内容
    ]);
    const a = auditOperations(tmp);
    const msgs = a.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/疑似伪造发布/);
    expect(msgs).toMatch(/引用了不存在的内容：C999/);
  });

  it("SEO 分发引用的是 H 已上线的真实路径", () => {
    const landings = readCsvRows(ROOT, OPS_FILES.seoLandingMaster);
    expect(landings).toHaveLength(10);
    // 单独验证：伪造路径必须被 doctor 抓出来
    seed(tmp, OPS_FILES.seoLandingMaster, "page_id,path,path_zh,locale", [["L1", "/seo-issues", "/zh/seo-issues", "en+zh"], ["L2", "/not-a-real-page", "/zh/not-a-real-page", "en+zh"]]);
    const a = auditOperations(tmp);
    expect(a.issues.map((i) => i.message).join("\n")).toMatch(/不是已收录路径：\/not-a-real-page/);
    // H 的 10 条真实路径在白名单内
    const realPaths = landings.map((l) => l.path);
    expect(realPaths.length).toBe(10);
  });
});

// ================= L1-08/09/10 案例・PH・Referral 交接 =================
describe("L1-08/09/10 case · product hunt · referral handoff", () => {
  it("案例引用与状态走 I 的真实枚举与引用规则", () => {
    seed(tmp, OPS_FILES.caseMaster, "case_id,status,related_content,community_posts,related_seo_page,notes", [
      ["CASE-001", "Approved", "C005", "P1", "/seo-issues", ""],
      ["CASE-002", "Nope", "", "", "", ""],
    ]);
    const a = auditOperations(tmp);
    const m = a.issues.map((i) => i.message).join("\n");
    expect(m).toMatch(/status 非法：Nope/);
  });

  it("真实案例数保持 0（I 的事实不因 L 改变）", () => {
    expect(readCsvRows(ROOT, OPS_FILES.caseMaster)).toHaveLength(0);
    expect(STAGE_HANDOFFS.cases.expectedRealCases).toBe(0);
  });

  it("Product Hunt 状态保持未启动，且归因冲突仍记录在案", () => {
    expect(STAGE_HANDOFFS.productHunt.state.realLaunch).toBe(false);
    expect(STAGE_HANDOFFS.productHunt.state.submission).toBe(false);
    expect(STAGE_HANDOFFS.productHunt.state.upvoteRequest).toBe(false);
    expect(STAGE_HANDOFFS.productHunt.attribution).toBe("NEEDS RECONCILIATION");
    const kit = read(OPS_FILES.productHuntKit);
    expect(kit).toContain("NEEDS RECONCILIATION");
  });

  it("Referral 状态保持零数据，open items 未被关闭", () => {
    expect(STAGE_HANDOFFS.referral.state).toEqual({ realReferralData: 0, realInvites: 0, realRewards: 0 });
    const rules = read(OPS_FILES.referralRules);
    expect(rules).toContain("K-OPEN-1");
    expect(rules).toContain("K-OPEN-2");
    expect(rules).toContain("K-OPEN-3");
    expect(rules).toContain("K-OPEN-4");
  });
});

// ================= L1-11 analytics =================
describe("L1-11 analytics contract", () => {
  it("核心漏斗必须逐字等于 B 的事件契约（含 runtime 读取）", () => {
    expect(CORE_FUNNEL).toEqual([
      "page_view", "audit_started", "audit_completed", "signup_completed",
      "activation_completed", "returning_user", "pricing_viewed",
      "upgrade_started", "payment_completed",
    ]);
    // 与 B 的真实契约比对（Vitest 里别名可用）
    for (const e of CORE_FUNNEL) expect(ALL_EVENTS as readonly string[]).toContain(e);
    // runtime 读取（供 CLI 使用）
    const names = readBEventNames(ROOT);
    for (const e of CORE_FUNNEL) expect(names).toContain(e);
  });

  it("B 的事件契约没有被 L 扩充", () => {
    const server = read("src/lib/analytics/server.ts");
    expect(server).not.toMatch(/referral_visit|referral_signup|referral_activation/);
  });

  it("Daily Log 的结果类计数必须标注 B 来源", () => {
    // 注意：buildLogRow 的入参键是**字段名**（signup_count），不是 CLI 的旗标名（signup）
    const noMarker = buildLogRow({ date: "2026-09-29", notes: "x", signup_count: "3" });
    expect(noMarker.ok).toBe(false);
    expect(noMarker.reasons?.join(" ")).toMatch(/必须来自 B/);

    const withMarker = buildLogRow({ date: "2026-09-29", notes: `${B_PROVENANCE_MARKER} 来自 analytics`, signup_count: "3" });
    expect(withMarker.ok).toBe(true);
    expect(withMarker.row?.signup_count).toBe("3");
  });

  it("聚合正确：weekly 只汇总区间内的行", () => {
    seed(tmp, OPS_FILES.dailyLog, DAILY_LOG_FIELDS.join(","), [
      ["2026-09-28", "1", "2", "0", "0", "0", "0", "0", "0", "0", "[B] 一"],
      ["2026-09-29", "3", "4", "1", "0", "1", "1", "2", "1", "0", "[B] 二"],
      ["2026-10-10", "9", "9", "0", "0", "0", "0", "9", "9", "9", "[B] 区间外"],
    ]);
    const s = weeklySummary(tmp, "2026-09-28");
    expect(s.week).toBe("2026-09-28 → 2026-10-04");
    expect(s.days).toBe(2);
    expect(s.actions.new_leads).toBe(4);
    expect(s.actions.outreach_sent).toBe(6);
    expect(s.actions.content_published).toBe(1);
    expect(s.bResults.signup_count).toBe(2);
    expect(s.bResults.activation_count).toBe(1);
    expect(s.bResults.payment_count).toBe(0);
  });

  it("结果类计数禁止估计值，但没有数据时必须填 0", () => {
    const bad = buildLogRow({ date: "2026-09-29", notes: "x", signup_count: "约三条" as unknown as string });
    expect(bad.ok).toBe(false);
    const zero = buildLogRow({ date: "2026-09-29", notes: "没数据" });
    expect(zero.row?.signup_count).toBe("0");
  });
});

// ================= L1-12 daily log =================
describe("L1-12 daily log schema", () => {
  it("表头列与要求完全一致", () => {
    expect(DAILY_LOG_FIELDS).toEqual([
      "date", "new_leads", "outreach_sent", "followups_sent", "community_interactions",
      "content_published", "positive_replies", "signup_count", "activation_count", "payment_count", "notes",
    ]);
    // 表头行必须逐字一致（真实仓库已经写入运营记录，不能再假设文件只有表头）
    const headerLine = read(path.join(OPS_DIR, "daily-log.csv")).split("\n")[0].trim();
    expect(headerLine).toBe(DAILY_LOG_FIELDS.join(","));
  });

  it("所有数值列都必须是非负整数（不能写估计值）", () => {
    const bad = buildLogRow({ date: "2026-09-29", notes: "x", outreach_sent: "十" as unknown as string });
    expect(bad.reasons?.join(" ")).toMatch(/非负整数/);
  });

  it("真实仓库的 daily-log 已含真实运营记录，且 schema 合法（不再假设为空）", () => {
    // 真实运营已于 2026-09-29（Day 1）开始：assert 的是「记录合法」，不是「记录为空」。
    const rows = readCsvRows(ROOT, OPS_FILES.dailyLog);
    expect(rows.length).toBeGreaterThan(0);

    const a = auditOperations(ROOT);
    expect(a.counts.dailyLog).toBe(rows.length);
    expect(a.issues.filter((i) => i.area === "dailyLog")).toEqual([]);

    // 一天一行（日期唯一）
    const dates = rows.map((r) => r.date ?? "");
    expect(new Set(dates).size).toBe(dates.length);

    for (const r of rows) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const f of NUMERIC_LOG_FIELDS) expect(r[f] ?? "", `${r.date} 的 ${f} 必须是非负整数`).toMatch(/^\d+$/);
      expect((r.notes ?? "").trim().length, `${r.date} 的 notes 不能为空`).toBeGreaterThan(0);
      // 有结果类计数时必须标注 B 来源（[B]），没有数据就填 0
      const hasCount = ["signup_count", "activation_count", "payment_count"].some((f) => Number(r[f] ?? 0) > 0);
      if (hasCount) expect(r.notes).toContain(B_PROVENANCE_MARKER);
    }
  });
});

// ================= L1-13 weekly review =================
describe("L1-13 weekly review", () => {
  it("模板覆盖要求的八个问题，且禁止评分/ROI", () => {
    const tpl = read("seo-growth/operations/WEEKLY_REVIEW.md");
    for (const q of [
      "What did we do?", "What generated traffic?", "What generated signup?",
      "What generated activation?", "What generated payment?", "What received no response?",
      "What should we repeat next week?",
    ]) {
      expect(tpl, `模板缺少 ${q}`).toContain(q);
    }
    expect(tpl).toMatch(/不要做[\s\S]*渠道评分/);
    expect(tpl).toMatch(/虚构 ROI/);
    expect(tpl).toMatch(/没有数据/);
  });
});

// ================= L1-14 隐私 =================
describe("L1-14 privacy", () => {
  it("运营文件不出现在 public/", () => {
    for (const rel of [OPS_FILES.dailyLog, OPS_FILES.leads, OPS_FILES.caseMaster]) {
      expect(fs.existsSync(path.join(ROOT, "public", path.basename(rel))), `${rel} 泄漏到 public/`).toBe(false);
    }
  });

  it("运营数据不被 src/app 或 src/components 引用", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        const rel = path.relative(ROOT, full);
        if (["node_modules", ".next", ".git", ".workbuddy"].some((a) => rel === a || rel.startsWith(`${a}/`))) continue;
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || e.name.includes(".test.")) continue;
        const src = fs.readFileSync(full, "utf-8");
        if (/from\s+["'][^"']*lib\/operations["']/.test(src)) offenders.push(rel);
        if (full.startsWith(path.join(ROOT, "src/app")) && /daily-log|OPERATING_SYSTEM/.test(src)) offenders.push(rel);
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders, `以下文件引用了运营层：${offenders.join(", ")}`).toEqual([]);
  });

  it("sitemap 与 robots 不引用运营文件（Next 自带的 weekly/monthly 字段值不算）", () => {
    for (const f of ["src/app/sitemap.ts", "src/app/robots.ts"]) {
      const src = read(f);
      expect(src).not.toMatch(/operations\/|daily-log|leads\.csv|weekly_review|WEEKLY_REVIEW/);
    }
  });

  it("OPERATING_SYSTEM / WEEKLY_REVIEW / RULES 不是公开资源", () => {
    for (const rel of [
      "seo-growth/operations/OPERATING_SYSTEM.md",
      "seo-growth/operations/WEEKLY_REVIEW.md",
      "seo-growth/referral/RULES.md",
      "seo-growth/product-hunt/LAUNCH_KIT.md",
    ]) {
      expect(fs.existsSync(path.join(ROOT, "public", path.basename(rel))), `${rel} 泄漏到 public/`).toBe(false);
    }
  });

  it("运营文档中不得出现任何真实邮箱或手机号（运营目录下所有文件）", () => {
    const opsFiles = fs
      .readdirSync(path.join(ROOT, OPS_DIR), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(OPS_DIR, e.name));
    expect(opsFiles.length).toBeGreaterThan(3); // 规则文档 + 周报 + daily-log + 复核记录
    for (const rel of opsFiles) {
      const t = read(rel);
      expect(t, `${rel} 含邮箱形态`).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(t, `${rel} 含手机号形态`).not.toMatch(/(?:\+?86[-\s]?)?1[3-9]\d{9}/);
    }
  });
});

// ================= L1-15 无自动化 =================
describe("L1-15 no automation", () => {
  it("ops 模块与脚本无任何真实网络调用形态", () => {
    const files = ["src/lib/operations/index.ts", "scripts/ops.mts"];
    const netPattern = new RegExp(
      [String.raw`\bfetch\s*\(`, "axios\\.", "new " + "XMLH" + "ttpRequest", String.raw`sendBeacon\s*\(`, String.raw`https?\.request\s*\(`].join("|")
    );
    for (const f of files) {
      const src = read(f)
        .split("\n")
        .filter((l) => !/new RegExp\(|const netPattern/.test(l))
        .join("\n");
      expect(src, `${f} 出现对外调用`).not.toMatch(netPattern);
      expect(src).not.toMatch(/from\s+["'](axios|node-fetch|got|undici|nodemailer|resend)["']/);
    }
  });

  it("无自动奖励 / 邀请 / 发帖 / 抓取实现", () => {
    const combined = ["src/lib/operations/index.ts", "scripts/ops.mts"].map(read).join("\n").toLowerCase();
    for (const bad of ["grantreward", "addcredits", "issuecoupon", "sendinvite", "sendreferralemail", "autopost", "crawlcontacts", "scrapeprospects"]) {
      expect(combined, `命中自动化实现 ${bad}`).not.toContain(bad);
    }
  });

  it("ops 的 doctor/today/weekly/log 不会自动执行任何动作（源码里只有输出与本地写盘）", () => {
    const src = read("scripts/ops.mts");
    expect(src).toContain("不会自动发送任何内容");
    expect(src).not.toMatch(/puppeteer|playwright|child_process/i);
  });
});

// ================= L1-16 sitemap 核验规则与暂停开关（Filebase 事故后） =================
describe("L1-16 sitemap verification contract", () => {
  // 判定「站点没有 sitemap」必须走过的要素；机器可读常量与 canonical 文档都要覆盖。
  const REQUIRED = ["robots.txt", "Sitemap:", "sitemapindex", "NO SITEMAP", "sitemap-invalid"];

  it("机器可读规则是 6 步，顺序为 robots → 声明 → 验证 → index/子 sitemap → 兜底 → verdict", () => {
    expect(SITEMAP_VERIFICATION_STEPS).toHaveLength(6);
    expect(SITEMAP_VERIFICATION_STEPS[0]).toMatch(/robots\.txt/);
    expect(SITEMAP_VERIFICATION_STEPS[1]).toMatch(/Sitemap:/);
    expect(SITEMAP_VERIFICATION_STEPS[3]).toMatch(/sitemapindex/);
    expect(SITEMAP_VERIFICATION_STEPS[4]).toMatch(/框架|兜底|fallback|默认入口/i);
    expect(SITEMAP_VERIFICATION_STEPS[5]).toMatch(/NO SITEMAP/);

    const declared = `${SITEMAP_VERIFICATION_STEPS.join(" ")} ${SITEMAP_VERDICT_RULES.join(" ")}`;
    for (const kw of REQUIRED) expect(declared, `机器可读规则缺少 ${kw}`).toContain(kw);
  });

  it("红线：/sitemap.xml 404 ≠ 没有 sitemap；声明了但不可达是 sitemap-invalid", () => {
    expect(SITEMAP_VERDICT_RULES.join(" ")).toMatch(/404/);
    expect(SITEMAP_VERDICT_RULES.join(" ")).toMatch(/不能|不得|≠/);
    expect(SITEMAP_VERDICT_RULES.join(" ")).toMatch(/sitemap-invalid/);
    expect(PROSPECTING_VERIFICATION_RULE).toMatch(/SITEMAP_VERIFICATION_STEPS/);
    expect(PROSPECTING_VERIFICATION_RULE).toMatch(/不发信|不得进入 outreach/);
  });

  it("OPERATING_SYSTEM.md 与机器可读规则描述同一件事（不得只写一处）", () => {
    const doc = read(path.join(OPS_DIR, "OPERATING_SYSTEM.md"));
    for (const kw of REQUIRED) expect(doc, `OPERATING_SYSTEM.md 缺少核验要素 ${kw}`).toContain(kw);
    // 文档必须引用常量名，避免两处各维护一套文字
    expect(doc).toContain("SITEMAP_VERIFICATION_STEPS");
    expect(doc).toContain("SITEMAP_VERDICT_RULES");
    // 且必须写明「/sitemap.xml 返回 404 ≠ 站点没有 sitemap」
    expect(doc.replace(/\s+/g, " ")).toMatch(/sitemap\.xml`?\s*返回\s*404[\s\S]{0,40}≠/);
  });

  it("outreach 暂停开关：有明确事由与起始日，文档记录，且需人工恢复", () => {
    expect(typeof OUTREACH_SEND_HOLD.active).toBe("boolean");
    expect(OUTREACH_SEND_HOLD.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(OUTREACH_SEND_HOLD.reason.trim().length).toBeGreaterThan(10);

    const doc = read(path.join(OPS_DIR, "OPERATING_SYSTEM.md"));
    expect(doc).toContain("OUTREACH_SEND_HOLD");
    expect(doc).toMatch(/暂停/);
    // 恢复必须由用户显式操作，不得由脚本代改
    expect(doc).toMatch(/用户显式|显式把/);

    // CLI 必须真的把开关呈现出来（源码级断言，不需要真跑一遍）
    const cli = read("scripts/ops.mts");
    expect(cli).toContain("OUTREACH_SEND_HOLD");
  });
});

// ================= 数据源唯一性（doctor 实测） =================
describe("doctor 实测", () => {
  it("真实仓库体检：0 问题（文件齐全、引用自洽、无泄漏）", () => {
    const a = auditOperations(ROOT);
    expect(a.filesPresent.operatingSystem).toBe(true);
    expect(a.filesPresent.dailyLog).toBe(true);
    expect(a.filesPresent.weeklyReview).toBe(true);
    expect(a.filesPresent.leads).toBe(true);
    expect(a.funnelInSync).toBe(true);
    expect(a.counts.cases).toBe(0);
    // 运营已经开始：leads 与 daily-log 都非空，且 doctor 的计数与实际行数一致。
    // 这里**不要求**任何 Master 为空 —— 空仓库不是业务目标，数据合法才是。
    expect(a.counts.leads).toBe(readCsvRows(ROOT, OPS_FILES.leads).length);
    expect(a.counts.dailyLog).toBe(readCsvRows(ROOT, OPS_FILES.dailyLog).length);
    expect(a.issues, a.issues.map((i) => `[${i.area}] ${i.message}`).join("\n")).toEqual([]);
  });

  it("第二份数据源会被 doctor 抓出来", () => {
    seed(tmp, "seo-growth/daily-leads.csv", "lead_id,website", [["L1", "example.com"]]);
    const a = auditOperations(tmp);
    expect(a.issues.some((i) => i.message.includes("疑似第二份 Master"))).toBe(true);
  });

  it("潜客状态非法会被 doctor 抓出来", () => {
    seed(tmp, OPS_FILES.leads, LEAD_FIELDS.join(","), [["L1", "e.com", "", "", "", "", "", "", "", "", "problem", "issue", "", "", "", "", "", "Super Active", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
    const a = auditOperations(tmp);
    expect(a.issues.some((i) => i.message.includes("status 非法：Super Active"))).toBe(true);
  });
});
