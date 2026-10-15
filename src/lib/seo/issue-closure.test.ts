// ===== Action Center 闭环集成测试（隔离临时库，无网络 / 无生产依赖）=====
//
// 验证产品承诺里最容易被做假的三件事，必须全部为真：
//   1. 行动任务**来自真实检测结果**：队列里的技术任务直接由审计快照的失败规则派生，
//      并通过 evidence 指回具体 audit 与 URL；通过的规则不得出现在队列里。
//   2. **标记完成 ≠ 已验证解决**：用户只能置 fixed_claimed；
//      只有再次审计的真实检测证据能把状态推进到 verified_resolved。
//   3. **未检测 ≠ 已解决**：再次审计未执行该规则时必须判 inconclusive，不得误判为通过。
//
// 隔离：mkdtemp 临时库 + 显式关闭 Supabase 凭据，与 src/lib/admin/funnel.test.ts 同一套做法。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSnapshot } from "@/lib/seo/audit-dashboard";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-action-center-"));
const USER = "u-closure";

let audits: typeof import("@/lib/db/audits");
let resolutions: typeof import("@/lib/db/issue-resolutions");
let queueMod: typeof import("./work-queue");
let verifyMod: typeof import("./issue-verification");
let obsMod: typeof import("./task-observations");
let obsDb: typeof import("@/lib/db/task-observations");

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  vi.resetModules();
  audits = await import("@/lib/db/audits");
  resolutions = await import("@/lib/db/issue-resolutions");
  queueMod = await import("./work-queue");
  verifyMod = await import("./issue-verification");
  obsMod = await import("./task-observations");
  obsDb = await import("@/lib/db/task-observations");
  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

/** 只构造队列真正读取的字段（rules / partial / pagesCrawled / depth） */
function makeSnapshot(
  rules: Array<{ ruleId: string; status: "pass" | "fail"; severity?: "error" | "warning" | "notice"; findings?: number; affectedPages?: number; affectedRatio?: number; scoreImpact?: number; pattern?: "site-wide" | "repeated" | null; pageLevel?: "page" | "site"; sampleUrl?: string | null }>,
  opts: { depth?: "quick" | "full"; partial?: boolean; pagesCrawled?: number } = {}
): DashboardSnapshot {
  return {
    engineVersion: "v2",
    ruleSetVersion: "2.0",
    depth: opts.depth ?? "full",
    generatedAt: new Date().toISOString(),
    partial: opts.partial ?? false,
    pagesCrawled: opts.pagesCrawled ?? 3,
    indexablePages: 3,
    score: 80,
    grade: "good",
    rules: rules.map((r) => ({
      ruleId: r.ruleId,
      name: { en: r.ruleId, zh: r.ruleId },
      description: { en: "test rule", zh: "测试规则" },
      recommendation: { en: "fix it", zh: "修复它" },
      category: "onpage",
      severity: r.severity ?? "error",
      pageLevel: r.pageLevel ?? "page",
      scoreWeight: 1,
      status: r.status,
      findings: r.findings ?? 0,
      affectedPages: r.affectedPages ?? 0,
      affectedRatio: r.affectedRatio ?? 0,
      scoreImpact: r.scoreImpact ?? 0,
      sampleUrl: r.sampleUrl ?? null,
      sampleMessage: null,
      sampleMetrics: null,
      pattern: r.pattern ?? null,
    })),
    findings: [],
    pages: [],
    scoreBreakdown: [],
    categories: [],
    coverage: { passed: 1, failed: rules.filter((r) => r.status === "fail").length, total: rules.length, ratio: 0.5 },
    crawler: {
      pagesCrawled: opts.pagesCrawled ?? 3,
      htmlPages: 3,
      redirects: 0,
      errors: 0,
      loops: 0,
      avgResponseMs: 100,
      fastestMs: 50,
      slowestMs: 200,
      httpStatus: { "2xx": 3, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 },
    },
    content: { avgWordCount: 500, lowContent: 0, veryLowContent: 0, avgTextHtmlRatio: 0.2, byType: {} },
    linking: { avgInternalLinks: 10, zeroInternalLinks: 0, deepPages: 0, orphans: 0, linksToRedirects: 0, depthDistribution: {} },
    structuredData: { statusCounts: {}, schemaTypes: {}, pagesWithSD: 0 },
    aiSearch: { crawlers: {}, llmsTxt: null, semanticHtmlAffected: 0 },
    robots: { status: "found", httpStatus: 200, sitemapUrls: [], disallowAll: false },
    sitemap: null,
  } as unknown as DashboardSnapshot;
}

async function seedCompletedAudit(domain: string, snapshot: DashboardSnapshot): Promise<number> {
  const audit = await audits.createAudit(USER, domain, snapshot.depth);
  await audits.finishAudit(USER, audit.id, {
    health_score: snapshot.score,
    errors: 1,
    warnings: 0,
    notices: 0,
    status: "completed",
    comparison: null,
    pages_detail: null,
    engine_version: snapshot.engineVersion,
    rule_set_version: snapshot.ruleSetVersion,
    dashboard_json: JSON.stringify(snapshot),
  });
  return audit.id;
}

describe("1. 队列任务来自真实检测结果", () => {
  const DOMAIN = "queue.test";
  const AUDIT_SNAPSHOT = makeSnapshot([
    { ruleId: "missing-h1", status: "fail", severity: "error", findings: 2, affectedPages: 2, affectedRatio: 0.67, scoreImpact: 6, pattern: "repeated", sampleUrl: "https://queue.test/page-1" },
    { ruleId: "missing-canonical", status: "fail", severity: "warning", findings: 1, affectedPages: 1, affectedRatio: 0.33, scoreImpact: 1, sampleUrl: "https://queue.test/page-2" },
    { ruleId: "title-present", status: "pass", severity: "notice" },
  ]);

  beforeAll(async () => {
    await seedCompletedAudit(DOMAIN, AUDIT_SNAPSHOT);
  });

  it("失败规则派生出任务，且证据指回 audit 与具体 URL；通过规则不入队", async () => {
    const q = await queueMod.buildWorkQueue({ userId: USER, domain: DOMAIN, projectId: null });
    const ids = q.tasks.map((t) => t.id);
    expect(ids).toContain("audit:missing-h1");
    expect(ids).toContain("audit:missing-canonical");
    expect(ids).not.toContain("audit:title-present");

    const h1 = q.tasks.find((t) => t.id === "audit:missing-h1")!;
    expect(h1.systemDetected).toBe(true);
    expect(h1.target).toBe("https://queue.test/page-1");
    expect(h1.evidence.some((e) => e.source === "audit")).toBe(true);
    expect(h1.evidence.some((e) => e.ref === "https://queue.test/page-1")).toBe(true);
    // 优先级必须可解释（≥2 条理由）
    expect(h1.priority.reasons.length).toBeGreaterThanOrEqual(2);
    expect(h1.priority.level).toBe("P0");
    // 未处理 → open，且**未**被默认为已验证
    expect(h1.status).toBe("open");
    expect(h1.verification.status).toBeNull();
  });

  it("coverage 如实反映审计来源（可用 + 深度 + 页数），无审计时为缺口", async () => {
    const q = await queueMod.buildWorkQueue({ userId: USER, domain: DOMAIN, projectId: null });
    expect(q.coverage.audit.available).toBe(true);
    expect(q.coverage.audit.depth).toBe("full");
    expect(q.coverage.audit.pagesCrawled).toBe(3);

    const none = await queueMod.buildWorkQueue({ userId: USER, domain: "never-audited.test", projectId: null });
    expect(none.coverage.audit.available).toBe(false);
    expect(none.coverage.gaps).toContain("no_completed_audit");
    expect(none.tasks).toHaveLength(0);
    expect(none.counts.open).toBe(0);
  });
});

describe("2. 标记完成 ≠ 已验证解决（只有再审计证据能推进）", () => {
  const DOMAIN = "closure.test";
  let auditId = 0;

  beforeAll(async () => {
    auditId = await seedCompletedAudit(
      DOMAIN,
      makeSnapshot([{ ruleId: "missing-h1", status: "fail", severity: "error", findings: 1, affectedPages: 1, sampleUrl: "https://closure.test/" }])
    );
  });

  it("用户置位后状态为 fixed_claimed，且 verify_status 仍为空（未验证）", async () => {
    const res = await resolutions.setUserResolutionStatus(USER, DOMAIN, "missing-h1", "fixed_claimed");
    expect(res.ok).toBe(true);
    const map = await resolutions.listResolutionsByDomain(USER, DOMAIN);
    const row = map.get("missing-h1")!;
    expect(row.status).toBe("fixed_claimed");
    expect(row.verify_status).toBeNull();
    expect(row.verified_at).toBeNull();
  });

  it("用户直接提交 verified_resolved 被拒绝（不能自证已解决）", async () => {
    const res = await resolutions.setUserResolutionStatus(USER, DOMAIN, "missing-h1", "verified_resolved");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("status_not_user_settable");
  });

  it("再次审计仍失败 → 判 fail，状态保持 fixed_claimed，并记录检出数字", async () => {
    await verifyMod.reverifyClaimedIssues(
      USER,
      DOMAIN,
      auditId,
      makeSnapshot([{ ruleId: "missing-h1", status: "fail", severity: "error", findings: 3, affectedPages: 2 }])
    );
    const row = (await resolutions.listResolutionsByDomain(USER, DOMAIN)).get("missing-h1")!;
    expect(row.status).toBe("fixed_claimed");
    expect(row.verify_status).toBe("fail");
    expect(row.verified_at).toBeNull();
    expect(row.verify_detail).toContain('"findings":3');
  });

  it("再次审计未执行该规则 → 判 inconclusive，**不得**推进为已解决", async () => {
    await verifyMod.reverifyClaimedIssues(USER, DOMAIN, auditId, makeSnapshot([]));
    const row = (await resolutions.listResolutionsByDomain(USER, DOMAIN)).get("missing-h1")!;
    expect(row.verify_status).toBe("inconclusive");
    expect(row.status).toBe("fixed_claimed");
    expect(row.verified_at).toBeNull();
  });

  it("再次审计该规则通过 → 推进为 verified_resolved，并记录验证时间与审计 id", async () => {
    await verifyMod.reverifyClaimedIssues(
      USER,
      DOMAIN,
      auditId,
      makeSnapshot([{ ruleId: "missing-h1", status: "pass", severity: "error" }])
    );
    const row = (await resolutions.listResolutionsByDomain(USER, DOMAIN)).get("missing-h1")!;
    expect(row.status).toBe("verified_resolved");
    expect(row.verify_status).toBe("pass");
    expect(row.verified_audit_id).toBe(auditId);
    expect(row.verified_at).not.toBeNull();
  });

  it("已验证的记录不会被后续校验重复改写（只校验 fixed_claimed）", async () => {
    const summary = await verifyMod.reverifyClaimedIssues(
      USER,
      DOMAIN,
      auditId,
      makeSnapshot([{ ruleId: "missing-h1", status: "fail", severity: "error", findings: 9, affectedPages: 9 }])
    );
    expect(summary.evaluated).toBe(0);
    const row = (await resolutions.listResolutionsByDomain(USER, DOMAIN)).get("missing-h1")!;
    expect(row.status).toBe("verified_resolved");
    expect(row.verify_status).toBe("pass");
  });
});

describe("3. 统一队列反映处理状态（审计来源）", () => {
  const DOMAIN = "status.test";
  let auditId = 0;

  beforeAll(async () => {
    auditId = await seedCompletedAudit(
      DOMAIN,
      makeSnapshot([
        { ruleId: "missing-h1", status: "fail", severity: "error", findings: 1, affectedPages: 1, sampleUrl: "https://status.test/" },
        { ruleId: "thin-content", status: "fail", severity: "warning", findings: 1, affectedPages: 1 },
      ])
    );
    await resolutions.setUserResolutionStatus(USER, DOMAIN, "missing-h1", "fixed_claimed");
  });

  it("队列把 fixed_claimed 与 open 分开计数，并保留 verified 状态语义", async () => {
    const q = await queueMod.buildWorkQueue({ userId: USER, domain: DOMAIN, projectId: null });
    expect(q.counts.fixed_claimed).toBe(1);
    expect(q.counts.open).toBe(1);
    const claimed = q.tasks.find((t) => t.id === "audit:missing-h1")!;
    expect(claimed.status).toBe("fixed_claimed");
    // 已标记但未验证 → 验证状态必须为空（UI 据此提示"请再跑一次审计"）
    expect(claimed.verification.status).toBeNull();
  });

  it("验证通过后队列同步显示已验证解决", async () => {
    await verifyMod.reverifyClaimedIssues(USER, DOMAIN, auditId, makeSnapshot([
      { ruleId: "missing-h1", status: "pass", severity: "error" },
      { ruleId: "thin-content", status: "fail", severity: "warning", findings: 1, affectedPages: 1 },
    ]));
    const q = await queueMod.buildWorkQueue({ userId: USER, domain: DOMAIN, projectId: null });
    const claimed = q.tasks.find((t) => t.id === "audit:missing-h1")!;
    expect(claimed.status).toBe("verified_resolved");
    expect(claimed.verification.status).toBe("pass");
    expect(claimed.verification.auditId).toBe(auditId);
    expect(q.counts.verified_resolved).toBe(1);
  });
});

describe("4. 工作区摘要（项目首页决策面板数据源，含今日 top action）", () => {
  it("跨域名汇总未解决/处理中/待验证/已验证计数，且不抛错", async () => {
    const s = await queueMod.getWorkspaceActionSummary("u-no-data", ["nothing.test"]);
    // 增长机会字段为加性扩展：无数据时 top 为空、计数为 0，绝不伪造机会
    expect(s.open).toBe(0);
    expect(s.inProgress).toBe(0);
    expect(s.fixedClaimed).toBe(0);
    expect(s.verifiedResolved).toBe(0);
    expect(s.auditedDomains).toBe(0);
    expect(s.topAction).toBeNull();
    expect(s.growth.top).toEqual([]);
    expect(s.growth.counts).toEqual({ regain: 0, capture: 0, improve: 0 });
    expect(Array.isArray(s.growth.gaps)).toBe(true);
  });

  it("top action：从同一批队列里选出第一个 open 任务，执行入口真实可用（与 Action Center 同源）", async () => {
    const s = await queueMod.getWorkspaceActionSummary(USER, ["queue.test"]);
    expect(s.open).toBeGreaterThanOrEqual(1);
    expect(s.topAction).not.toBeNull();
    expect(s.topAction!.taskId).toBe("audit:missing-h1");
    expect(s.topAction!.source).toBe("audit");
    expect(s.topAction!.reasonCodes.length).toBeGreaterThan(0);
    expect(s.topAction!.execution.available).toBe(true);
    expect(s.topAction!.execution.href).toContain("/app/audit");
    // 与队列首个 open 任务一致（不重排、不另建优先级）
    const q = await queueMod.buildWorkQueue({ userId: USER, domain: "queue.test", projectId: null });
    const firstOpen = q.tasks.find((t) => t.status === "open");
    expect(s.topAction!.taskId).toBe(firstOpen!.id);
  });
});

describe("5. 结果反馈闭环：基线 → 后续观测 → 判定（状态边界）", () => {
  const DOMAIN = "observe.test";
  const TASK = "audit:missing-h1";

  beforeAll(async () => {
    await seedCompletedAudit(
      DOMAIN,
      makeSnapshot([
        { ruleId: "missing-h1", status: "fail", severity: "error", findings: 3, affectedPages: 2, sampleUrl: `https://${DOMAIN}/` },
      ])
    );
  });

  it("捕获基线：来自真实审计快照，verdict=pending 且 latest 为空（不伪造效果）", async () => {
    const created = await obsMod.captureAuditTaskBaseline(USER, DOMAIN, "missing-h1");
    expect(created).toBe(true);
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(TASK)!;
    expect(row).toBeTruthy();
    expect(JSON.parse(row.baseline_json ?? "{}")).toMatchObject({ findings: 3, affectedPages: 2 });
    expect(row.verdict).toBe("pending");
    expect(row.latest_json).toBeNull();
    expect(row.observations).toBe(0);
  });

  it("基线不可被覆盖（幂等）：再次捕获返回 false 且原基线不变", async () => {
    const again = await obsMod.captureAuditTaskBaseline(USER, DOMAIN, "missing-h1");
    expect(again).toBe(false);
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(TASK)!;
    expect(JSON.parse(row.baseline_json ?? "{}")).toMatchObject({ findings: 3 });
  });

  it("再审计检出减少 → improved（并累计观测次数）", async () => {
    const s = await obsMod.observeAfterAudit(
      USER,
      DOMAIN,
      makeSnapshot([{ ruleId: "missing-h1", status: "fail", severity: "error", findings: 1, affectedPages: 1 }])
    );
    expect(s.observed).toBeGreaterThanOrEqual(1);
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(TASK)!;
    expect(row.verdict).toBe("improved");
    expect(row.observations).toBe(1);
    expect(row.note).toBe("findings_decreased");
    // 基线仍然保留（不被最新观测覆盖）
    expect(JSON.parse(row.baseline_json ?? "{}")).toMatchObject({ findings: 3 });
    expect(JSON.parse(row.latest_json ?? "{}")).toMatchObject({ findings: 1 });
  });

  it("再审计检出增加 → worse", async () => {
    await obsMod.observeAfterAudit(
      USER,
      DOMAIN,
      makeSnapshot([{ ruleId: "missing-h1", status: "fail", severity: "error", findings: 9, affectedPages: 5 }])
    );
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(TASK)!;
    expect(row.verdict).toBe("worse");
    expect(row.observations).toBe(2);
  });

  it("再审计未执行该规则 → indeterminate（绝不误判为已改善）", async () => {
    await obsMod.observeAfterAudit(USER, DOMAIN, makeSnapshot([]));
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(TASK)!;
    expect(row.verdict).toBe("indeterminate");
    expect(row.note).toBe("rule_not_executed");
    expect(row.observations).toBe(3);
  });

  it("无基线的任务不会被观测（不凭用户声称产生观测记录）", async () => {
    const s = await obsMod.observeAfterAudit(USER, DOMAIN, makeSnapshot([]));
    expect(s.observed).toBe(1); // 仅上面那一条有基线的任务
  });

  it("结果反馈进队列：improved 降档 / worse 回升（observe → priority 闭环）", async () => {
    const ORDER = { P0: 0, P1: 1, P2: 2 } as const;
    const levelOf = async () =>
      (await queueMod.buildWorkQueue({ userId: USER, domain: DOMAIN, projectId: null }))
        .tasks.find((t) => t.id === TASK)!
        .priority;
    const before = await levelOf();

    await obsDb.recordObservation({
      userId: USER, domain: DOMAIN, taskId: TASK,
      metrics: { findings: 0, affectedPages: 0 }, verdict: "improved", note: "findings_decreased",
    });
    const afterImproved = await levelOf();
    // improved 至多降到当前档（已在 P2 底档时保持），理由必须如实标注
    expect(ORDER[afterImproved.level]).toBeLessThanOrEqual(ORDER[before.level]);
    expect(afterImproved.reasons.map((r) => r.code)).toContain("result_improved");

    await obsDb.recordObservation({
      userId: USER, domain: DOMAIN, taskId: TASK,
      metrics: { findings: 5, affectedPages: 3 }, verdict: "worse", note: "findings_increased",
    });
    const afterWorse = await levelOf();
    // worse 升一档：相对 improved 后的档位优先级必须更高（P2 → P1）
    expect(ORDER[afterWorse.level]).toBeLessThan(ORDER[afterImproved.level]);
    expect(afterWorse.reasons.map((r) => r.code)).toContain("result_worse");
  });
});

describe("6. 排名刷新后的观测（闭环最后一步：执行 → 刷新排名 → 判定）", () => {
  const DOMAIN = "rank-observe.test";
  const KW = "闭环测试词";
  let oppId = 0;

  beforeAll(async () => {
    const kwMod = await import("@/lib/db/keywords");
    const rankMod = await import("@/lib/db/rankings");
    const oppMod = await import("@/lib/db/opportunities");
    const projMod = await import("@/lib/db/projects");
    // 种子：项目 + 真实追踪词 + 排名历史（第 20 位）+ 排名类机会
    const project = await projMod.addProject(USER, "rank observe", DOMAIN);
    const tk = await kwMod.addTrackedKeyword(USER, { keyword: KW, location: "中国", device: "PC", domain: DOMAIN });
    await rankMod.upsertRankHistory(USER, { keyword_id: tk.id, date: "2026-10-01", position: 20, url: null });
    await oppMod.upsertOpportunity(USER, {
      user_id: USER,
      project_id: project.id,
      type: "lost_recovery",
      target_type: "keyword",
      target_value: KW,
      priority: "P0",
      impact: "high",
      confidence: "high",
      evidence: [{ source: "rank_history", ref: `keyword:${tk.id}`, summary: "test evidence", capturedAt: new Date().toISOString() }],
      signals: {},
      actionPlan: null,
    });
    const rows = await oppMod.listOpportunities(USER, { project_id: project.id, type: "lost_recovery" });
    oppId = rows[0].id;
  });

  it("排名类机会基线：来自真实排名历史（第 20 位），verdict=pending", async () => {
    const created = await obsMod.captureOpportunityBaseline(USER, DOMAIN, oppId);
    expect(created).toBe(true);
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(`opp:${oppId}`)!;
    expect(row.kind).toBe("rank");
    expect(JSON.parse(row.baseline_json ?? "{}")).toMatchObject({ position: 20 });
    expect(row.verdict).toBe("pending");
    expect(row.latest_json).toBeNull();
  });

  it("刷新后排名改善（20 → 10）→ improved（闭环不再断在'刷新了排名但 verdict 永远 pending'）", async () => {
    const updated = await obsMod.observeRankForRefresh(USER, DOMAIN, KW, 10);
    expect(updated).toBe(1);
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(`opp:${oppId}`)!;
    expect(row.verdict).toBe("improved");
    expect(row.note).toBe("position_up");
    expect(row.observations).toBe(1);
    expect(JSON.parse(row.latest_json ?? "{}")).toMatchObject({ position: 10 });
    // 基线不被覆盖
    expect(JSON.parse(row.baseline_json ?? "{}")).toMatchObject({ position: 20 });
  });

  it("重复刷新同一结果 → 判定稳定为 improved（相对基线判定，不产生重复行/状态损坏）", async () => {
    const updated = await obsMod.observeRankForRefresh(USER, DOMAIN, KW, 10);
    expect(updated).toBe(1);
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(`opp:${oppId}`)!;
    // 判定始终相对执行前基线（基线不可变）：20 → 10 之后再次刷新 10 仍是 improved
    expect(row.verdict).toBe("improved");
    expect(row.note).toBe("position_up");
    expect(row.observations).toBe(2);
  });

  it("回到基线水平（10 → 20）→ unchanged（相对基线无改善）", async () => {
    await obsMod.observeRankForRefresh(USER, DOMAIN, KW, 20);
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(`opp:${oppId}`)!;
    expect(row.verdict).toBe("unchanged");
    expect(row.note).toBe("position_same");
  });

  it("刷新后跌出榜单（null）→ worse（lost_ranking），不静默吞掉退化", async () => {
    await obsMod.observeRankForRefresh(USER, DOMAIN, KW, null);
    const row = (await obsDb.listObservations(USER, DOMAIN)).get(`opp:${oppId}`)!;
    expect(row.verdict).toBe("worse");
    expect(row.note).toBe("lost_ranking");
  });

  it("其他关键词的刷新不影响本任务（相同目标才比较）", async () => {
    const before = (await obsDb.listObservations(USER, DOMAIN)).get(`opp:${oppId}`)!;
    const updated = await obsMod.observeRankForRefresh(USER, DOMAIN, "别的关键词", 1);
    expect(updated).toBe(0);
    const after = (await obsDb.listObservations(USER, DOMAIN)).get(`opp:${oppId}`)!;
    expect(after.observations).toBe(before.observations);
    expect(after.verdict).toBe(before.verdict);
  });
});
