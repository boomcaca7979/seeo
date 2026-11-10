// ===== IndexNow 统一执行入口 =====
//
//   npm run indexnow -- --mode dry-run   （默认：只算不发）
//   npm run indexnow -- --mode submit --deployment-id <id>
//   npm run indexnow -- --mode all --confirm SUBMIT-ALL
//
// 三种模式的边界（严格）：
//   dry-run  读真实部署快照、完整计算，**不发 POST、不写 Check Run**
//   submit   只提交本次变更 URL（added ∪ updated ∪ deleted-verified）
//   all      提交当前正式 Sitemap 全部公开 URL，必须先过 confirm === SUBMIT-ALL
//
// 自动与人工的记录互不干扰：自动用 indexnow/deployment-<id>，人工用 indexnow/manual/<run_id>。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  SITE_LOCALES,
  SITE_ORIGIN,
  buildPathIndex,
  canonicalUrl,
  changedMessageNamespaces,
  computeAffectedPaths,
  isNeverSubmitPath,
  urlsToPaths,
  urlsForNamespaces,
  type SiteLocale,
} from "../src/lib/seo/indexnow-map.ts";
import {
  assertAllConfirm,
  conclusionFor,
  findKeyFile,
  partitionSubmittable,
  requireHeadSha,
  resolveHeadSha,
  submitIndexNow,
  verificationOutcome,
  verifyKeyFile,
  type SubmitOutcome,
} from "../src/lib/seo/indexnow.ts";
import {
  autoCheckRunName,
  assertCanonicalOrigin,
  buildSummary,
  createCheckRun,
  decideIdempotency,
  fetchDeploymentSitemap,
  findCheckRun,
  findLatestProductionDeployment,
  findPreviousProductionDeployment,
  getDeployment,
  latestUsableStatus,
  listAllDeploymentStatuses,
  probeGone,
  updateCheckRun,
  type GithubContext,
} from "../src/lib/seo/indexnow-github.ts";

// ===== CLI =====

type Mode = "dry-run" | "submit" | "all";

interface Args {
  mode: Mode;
  trigger: "auto" | "manual";
  /** verification-only：完整计算 + 写记录，但绝不调用 submitIndexNow */
  noSubmit: boolean;
  deploymentId?: number;
  confirm?: string;
  runId?: string;
  environmentUrl?: string;
  sha?: string;
  repo?: string;
  root: string;
  maxAttempts: number;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const rawMode = (get("mode") ?? "dry-run").trim();
  if (rawMode !== "dry-run" && rawMode !== "submit" && rawMode !== "all") {
    throw new Error(`非法 mode：${rawMode}（只接受 dry-run | submit | all）`);
  }
  const rawTrigger = (get("trigger") ?? "manual").trim();
  if (rawTrigger !== "auto" && rawTrigger !== "manual") {
    throw new Error(`非法 trigger：${rawTrigger}（只接受 auto | manual）`);
  }
  const idRaw = get("deployment-id");
  const deploymentId = idRaw ? Number(idRaw) : undefined;
  if (idRaw && (!Number.isFinite(deploymentId) || (deploymentId as number) <= 0)) {
    throw new Error(`非法 --deployment-id：${idRaw}`);
  }
  return {
    mode: rawMode,
    trigger: rawTrigger,
    noSubmit: argv.includes("--no-submit"),
    deploymentId,
    confirm: get("confirm"),
    runId: get("run-id") ?? process.env.GITHUB_RUN_ID,
    environmentUrl: get("environment-url"),
    sha: get("sha"),
    repo: get("repo") ?? process.env.GITHUB_REPOSITORY,
    root: get("root") ?? process.cwd(),
    maxAttempts: Number(get("max-attempts") ?? 3),
  };
}

const lines: string[] = [];
function log(msg = ""): void {
  lines.push(msg);
  process.stdout.write(`${msg}\n`);
}

function fail(message: string): never {
  log(`\n✗ FAIL-CLOSED: ${message}`);
  flushSummary();
  process.exit(1);
}

function flushSummary(): void {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try {
    fs.appendFileSync(target, `${lines.join("\n")}\n`);
  } catch {
    /* 摘要写不进去不影响主流程 */
  }
}

// ===== git =====

function git(args: string[], root: string): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

interface GitChange {
  status: string;
  file: string;
}

function changedFiles(prevSha: string, curSha: string, root: string): GitChange[] {
  let out: string;
  try {
    out = git(["diff", "--name-status", "--find-renames", `${prevSha}..${curSha}`], root);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`git diff ${prevSha.slice(0, 9)}..${curSha.slice(0, 9)} 失败（历史被改写？）：${msg}`);
  }
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 2)
    .map((cols) => ({ status: cols[0][0], file: cols[cols.length - 1] }));
}

function readJsonAt(sha: string, rel: string, root: string): unknown {
  try {
    const raw = git(["show", `${sha}:${rel}`], root);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ===== 主流程 =====

interface Plan {
  curUrls: string[];
  prevUrls: string[];
  added: string[];
  updated: string[];
  deleted: string[];
  deletedVerified: string[];
  deletedDropped: Array<{ url: string; detail: string }>;
  impacts: Array<{ file: string; kind: string; paths: string[] }>;
  curRef: string;
  prevRef: string;
  curSha: string | null;
  prevSha: string | null;
}

async function buildPlan(args: Args, ctx: GithubContext | null): Promise<Plan> {
  const root = args.root;

  // ---- all 模式：只读生产别名 sitemap ----
  if (args.mode === "all") {
    const snap = await fetchDeploymentSitemap(SITE_ORIGIN);
    if (!snap.ok) fail(`无法读取生产 Sitemap（${snap.failure}）：${snap.detail}`);
    return {
      curUrls: snap.urls,
      prevUrls: [],
      added: snap.urls,
      updated: [],
      deleted: [],
      deletedVerified: [],
      deletedDropped: [],
      impacts: [],
      curRef: `${SITE_ORIGIN}/sitemap.xml`,
      prevRef: "(all 模式不比对前序)",
      curSha: args.sha ?? null,
      prevSha: null,
    };
  }

  if (!ctx) fail("缺少 GITHUB_TOKEN / --repo，无法解析部署");
  if (args.mode === "submit" && !args.deploymentId && !args.sha) {
    fail("submit 模式必须提供 --deployment-id（或至少 --sha），不猜默认值");
  }

  // ---- 定位当前部署 ----
  let deployment;
  let preResolvedStatus = null;
  if (args.deploymentId) {
    deployment = await getDeployment(ctx, args.deploymentId);
  } else if (args.mode === "dry-run") {
    const latest = await findLatestProductionDeployment(ctx);
    if (!latest) fail("找不到任何「最新状态为 success」的 Production 部署");
    deployment = latest.deployment;
    preResolvedStatus = latest.status;
    log(`[target] dry-run 未指定 --deployment-id，使用最新成功部署 ${deployment.id}`);
  } else {
    fail("缺少 --deployment-id：submit 模式不接受「运行时最新部署」作为隐式目标");
  }

  log(`[target] deployment=${deployment.id} env=${deployment.environment} sha=${deployment.sha.slice(0, 9)} created=${deployment.created_at}`);
  if (deployment.environment !== "Production") {
    fail(`目标部署环境为 ${deployment.environment}，不是 Production，拒绝提交`);
  }

  const statuses = preResolvedStatus ? [preResolvedStatus] : await listAllDeploymentStatuses(ctx, deployment.id);
  const usable = latestUsableStatus(statuses);
  if (!usable) {
    fail(`部署 ${deployment.id} 的最新状态不是 success（共 ${statuses.length} 条状态），拒绝提交`);
  }
  const curBase = (args.environmentUrl || usable.environment_url || "").replace(/\/+$/, "");
  if (!curBase) fail("当前部署缺少 environment_url");

  // ---- 前序 Production 部署 ----
  const prev = await findPreviousProductionDeployment(ctx, { id: deployment.id, created_at: deployment.created_at });
  if (!prev) {
    fail(
      "找不到可比较的前序 Production 部署（其最新状态须为 success）。按设计不回退到 git 重建，也不自动全量提交；" +
        "如确需重建基线，请人工执行 --mode all。",
    );
  }
  const prevBase = (prev.status.environment_url ?? "").replace(/\/+$/, "");
  if (!prevBase) fail("前序部署的 success 状态缺少 environment_url");
  log(`[prev]   deployment=${prev.deployment.id} sha=${prev.deployment.sha.slice(0, 9)} created=${prev.deployment.created_at}`);

  // ---- 两份真实快照 ----
  const curSnap = await fetchDeploymentSitemap(curBase);
  if (!curSnap.ok) fail(`当前部署 Sitemap 不可用（${curSnap.failure}）：${curSnap.detail}`);
  const prevSnap = await fetchDeploymentSitemap(prevBase);
  if (!prevSnap.ok) fail(`前序部署 Sitemap 不可用（${prevSnap.failure}）：${prevSnap.detail}`);
  log(`[snapshot] cur=${curSnap.urls.length} urls @ ${curBase}`);
  log(`[snapshot] prev=${prevSnap.urls.length} urls @ ${prevBase}`);

  assertCanonicalOrigin(curSnap.urls);
  assertCanonicalOrigin(prevSnap.urls);

  // ---- added / deleted ----
  const curSet = new Set(curSnap.urls);
  const prevSet = new Set(prevSnap.urls);
  const added = [...curSet].filter((u) => !prevSet.has(u)).sort();
  const deletedRaw = [...prevSet].filter((u) => !curSet.has(u)).sort();

  // ---- updated：git diff + 闭包 + messages ----
  const curPaths = urlsToPaths(curSnap.urls);
  const index = buildPathIndex(curPaths, root);

  const changes = changedFiles(prev.deployment.sha, deployment.sha, root);
  const codeFiles = changes.filter((c) => c.status !== "D").map((c) => c.file);
  const affected = computeAffectedPaths(codeFiles, index);

  const updatedPaths = new Map<string, string[]>();
  for (const [p, files] of affected.paths) {
    updatedPaths.set(p, [...files]);
  }

  // messages：按 locale 分侧（en 只影响 EN，zh 只影响 ZH）
  const namespaceUrls = new Set<string>();
  const messageChanges: Array<{ locale: SiteLocale; file: string; namespaces: string[] }> = [];
  for (const locale of SITE_LOCALES) {
    const rel = `messages/${locale}.json`;
    const touched = changes.some((c) => c.file === rel);
    if (!touched) continue;
    const before = readJsonAt(prev.deployment.sha, rel, root);
    const after = readJsonAt(deployment.sha, rel, root);
    const namespaces = changedMessageNamespaces(before, after);
    messageChanges.push({ locale, file: rel, namespaces });
    for (const u of urlsForNamespaces(namespaces, locale)) namespaceUrls.add(u);
  }

  for (const mc of messageChanges) {
    const mapped = mc.namespaces.filter((ns) => urlsForNamespaces([ns], mc.locale).length > 0);
    const unmapped = mc.namespaces.filter((ns) => urlsForNamespaces([ns], mc.locale).length === 0);
    log(`[messages] ${mc.file} 变更命名空间=${mc.namespaces.length} 触发=${mapped.join(",") || "-"} 不触发=${unmapped.join(",") || "-"}`);
  }

  // 代码改动 → 两条 URL；messages → 单侧 URL
  const updatedUrls = new Set<string>(namespaceUrls);
  for (const p of updatedPaths.keys()) {
    if (isNeverSubmitPath(p)) continue;
    for (const l of SITE_LOCALES) updatedUrls.add(canonicalUrl(l, p));
  }

  // ---- deleted：必须 404/410 实证 ----
  const deletedVerified: string[] = [];
  const deletedDropped: Array<{ url: string; detail: string }> = [];
  const probeLimit = 50;
  for (const url of deletedRaw.slice(0, probeLimit)) {
    const logical = urlsToPaths([url])[0] ?? "";
    if (!logical || isNeverSubmitPath(logical)) {
      deletedDropped.push({ url, detail: "in never-submit list" });
      continue;
    }
    const probe = await probeGone(url);
    if (probe.gone) deletedVerified.push(url);
    else deletedDropped.push({ url, detail: probe.detail });
  }
  if (deletedRaw.length > probeLimit) {
    for (const url of deletedRaw.slice(probeLimit)) deletedDropped.push({ url, detail: "probe limit exceeded" });
  }

  return {
    curUrls: curSnap.urls,
    prevUrls: prevSnap.urls,
    added,
    updated: [...updatedUrls].sort(),
    deleted: deletedRaw,
    deletedVerified,
    deletedDropped,
    impacts: affected.impacts.filter((i) => i.paths.length > 0),
    curRef: `${curBase} (deployment ${deployment.id})`,
    prevRef: `${prevBase} (deployment ${prev.deployment.id})`,
    curSha: deployment.sha,
    prevSha: prev.deployment.sha,
  };
}

function finalUrls(plan: Plan): string[] {
  const set = new Set<string>();
  for (const u of plan.added) set.add(u);
  for (const u of plan.updated) set.add(u);
  for (const u of plan.deletedVerified) set.add(u);
  const { accepted } = partitionSubmittable([...set]);
  return accepted.sort();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  log(`# IndexNow · mode=${args.mode}${args.runId ? ` · run=${args.runId}` : ""}`);
  log("");

  // Key 必须自洽，否则任何提交都会 403，直接在本地失败
  const keyFile = findKeyFile(path.join(root, "public"));
  log(`[key] ${keyFile.file}（内容与文件名一致）`);

  const token = process.env.GITHUB_TOKEN;
  const ctx: GithubContext | null = token && args.repo ? { repo: args.repo, token } : null;

  // 非 dry-run 必须有写入 Check Run 的能力：没有记录通道就不许提交（否则会出现"发了但查不到"）
  if (args.mode !== "dry-run" && !ctx) {
    fail(
      `mode=${args.mode} 需要 GITHUB_TOKEN 与 GITHUB_REPOSITORY 来写 Check Run 记录；缺少时拒绝提交（已在任何网络请求之前中止）`,
    );
  }

  // all 模式的确认闸门：仍在任何网络请求之前
  if (args.mode === "all") assertAllConfirm(args.confirm);

  const plan = await buildPlan(args, ctx);

  log("");
  log(`[snapshot] cur=${plan.curRef}`);
  log(`[snapshot] prev=${plan.prevRef}`);
  log(`[diff] added=${plan.added.length} updated=${plan.updated.length} deleted(verified)=${plan.deletedVerified.length}`);
  for (const imp of plan.impacts) {
    log(`  · ${imp.file}  [${imp.kind}] → ${imp.paths.join(", ")}`);
  }
  if (plan.deletedDropped.length) {
    for (const d of plan.deletedDropped) log(`  · 删除项丢弃 ${d.url}（${d.detail}）`);
  }

  const urls = finalUrls(plan);
  log("");
  log(`[urls] 待提交 ${urls.length} 条`);
  for (const u of urls) log(`  ${u}`);

  if (args.mode === "dry-run") {
    log("");
    log("[dry-run] 未发送任何 HTTP POST，未创建/更新任何 Check Run。");
    flushSummary();
    return;
  }

  // ---- 记录标识：自动与人工必须完全不同 ----
  const isAuto = args.trigger === "auto";
  if (isAuto && !args.deploymentId) fail("自动模式必须提供 --deployment-id");
  const checkName = isAuto
    ? autoCheckRunName(args.deploymentId as number)
    : `indexnow/manual/${args.runId ?? "local"}${args.mode === "all" ? "-all" : ""}`;
  const externalId = isAuto ? String(args.deploymentId) : `manual:${args.runId ?? "local"}:${args.mode}`;

  // head SHA 优先级：真实部署 SHA > --sha > GITHUB_SHA；缺失/非法则在这里抛错，
  // 早于 createCheckRun 与 submitIndexNow，绝不出现"跳过记录却照常提交"。
  const shaResolution = resolveHeadSha({
    planCurSha: plan.curSha,
    argSha: args.sha,
    envSha: process.env.GITHUB_SHA,
  });
  const headSha = requireHeadSha(shaResolution.sha, args.mode);
  log(
    `[sha] head=${headSha.slice(0, 9)} 来源=${shaResolution.source}` +
      (shaResolution.source === "plan" ? "（部署 SHA，优先于 GITHUB_SHA）" : ""),
  );

  const detailsUrl =
    process.env.GITHUB_RUN_ID && args.repo
      ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${args.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;

  // ---- 幂等：读既有记录（人工记录与自动记录互不影响）----
  let attempt = 1;
  if (ctx && headSha) {
    const existing = await findCheckRun(ctx, { sha: headSha, name: checkName, externalId }).catch(() => null);
    if (existing) {
      const decision = decideIdempotency(existing, new Date(), args.maxAttempts);
      if (decision.action === "skip") {
        log("");
        log(`[idempotent] 跳过：${decision.reason}`);
        flushSummary();
        return;
      }
      attempt = decision.attempt;
      log("");
      log(`[idempotent] 继续：${decision.reason} → attempt=${attempt}`);
    }
  }

  // ---- verification-only：只算、只记录，绝不 POST ----
  // 首次上线的默认开关。分支必须整体 return，任何路径都不得落到 submitIndexNow。
  if (args.noSubmit) {
    const keyCheck = await verifyKeyFile(keyFile.key);
    const record = verificationOutcome(urls.length);
    const verifySummary = buildSummary({
      outcome: urls.length === 0 ? "no-op" : "verification-only",
      attempt: Math.max(attempt, 1),
      added: plan.added.length,
      updated: plan.updated.length,
      deleted: plan.deletedVerified.length,
      urls: urls.length,
      cur: plan.curRef,
      prev: plan.prevRef,
    });

    log("");
    log(`[verify] key file: ${keyCheck.ok ? "ok（内容与文件名一致）" : keyCheck.reason}`);
    log(`[verify] 计划 ${urls.length} 条；verification-only，不调用 submitIndexNow`);

    if (ctx && headSha) {
      const run = await createCheckRun(ctx, {
        name: checkName,
        headSha,
        externalId,
        detailsUrl,
        title: "IndexNow verification (no submission)",
        summary: verifySummary,
        text: urls.length ? urls.join("\n") : "0 URLs planned.",
      }).catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        fail(`创建 Check Run 失败（需要 checks:write）：${msg}`);
      });

      await updateCheckRun(ctx, run.id, {
        conclusion: record.conclusion,
        title: record.headline,
        summary: verifySummary,
        text: [...(urls.length ? urls : ["0 URLs planned."]), "", `key file: ${keyCheck.reason}`].join("\n"),
      }).catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        log(`[warn] 更新 Check Run 失败：${msg}`);
      });
    }

    log(`[conclusion] ${record.conclusion} — ${record.headline}`);
    flushSummary();
    return;
  }

  // ---- 无变化也要落记录，避免同一部署被反复处理 ----
  if (urls.length === 0) {
    log("");
    log("[no-op] 没有需要通知的 URL。");
    if (ctx && headSha) {
      const run = await createCheckRun(ctx, {
        name: checkName,
        headSha,
        externalId,
        detailsUrl,
        title: "IndexNow: no changes",
        summary: buildSummary({
          outcome: "no-op",
          attempt: Math.max(attempt, 1),
          added: plan.added.length,
          updated: plan.updated.length,
          deleted: plan.deletedVerified.length,
          urls: 0,
          cur: plan.curRef,
          prev: plan.prevRef,
        }),
      }).catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        fail(`创建 Check Run 失败（需要 checks:write）：${msg}`);
      });
      await updateCheckRun(ctx, run.id, {
        conclusion: "success",
        title: "IndexNow: no changes detected",
        summary: buildSummary({
          outcome: "no-op",
          attempt: Math.max(attempt, 1),
          added: plan.added.length,
          updated: plan.updated.length,
          deleted: plan.deletedVerified.length,
          urls: 0,
          cur: plan.curRef,
          prev: plan.prevRef,
        }),
        text: "0 URLs to submit.",
      }).catch(() => undefined);
    }
    flushSummary();
    return;
  }

  const budget = Math.max(1, args.maxAttempts - (attempt - 1));
  log(`[budget] 本次允许 ${budget} 次 HTTP POST（累计上限 ${args.maxAttempts}）`);

  let runId: number | null = null;
  if (ctx && headSha) {
    const run = await createCheckRun(ctx, {
      name: checkName,
      headSha,
      externalId,
      detailsUrl,
      title: `IndexNow: submitting ${urls.length} URL(s)`,
      summary: buildSummary({
        outcome: "submitting",
        attempt,
        added: plan.added.length,
        updated: plan.updated.length,
        deleted: plan.deletedVerified.length,
        urls: urls.length,
        cur: plan.curRef,
        prev: plan.prevRef,
      }),
      text: urls.join("\n"),
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      fail(`创建 Check Run 失败（需要 checks:write）：${msg}`);
    });
    runId = run.id;
  }

  log("");
  log("[submit] POST https://api.indexnow.org/indexnow");
  const result = await submitIndexNow({ key: keyFile.key, urls, maxAttempts: budget });
  const totalAttempt = attempt + result.attempts - 1;

  log(`[result] outcome=${result.outcome} http=${result.httpStatus ?? "-"} attempts=${result.attempts} urls=${result.urlCount}`);
  log(`[result] ${result.reason}`);
  if (result.rejectedUrls.length) log(`[result] 被白名单拒绝 ${result.rejectedUrls.length} 条`);

  // 202：只复检 Key 文件，绝不重发整批
  let keyNote = "";
  if (result.outcome === "accepted_pending_key") {
    const check = await verifyKeyFile(keyFile.key);
    keyNote = check.ok ? "key file reachable; awaiting engine validation" : `key file problem: ${check.reason}`;
    log(`[202] ${keyNote}（不重发整批）`);
  }

  await recordOutcome(args, ctx, plan, result.outcome, totalAttempt, urls.length, runId, result.reason, keyNote, result.body);
  flushSummary();

  if (result.outcome === "rejected" || result.outcome === "retryable") {
    process.exit(1);
  }
}

async function recordOutcome(
  args: Args,
  ctx: GithubContext | null,
  plan: Plan,
  outcome: SubmitOutcome | "no-op",
  attempt: number,
  urlCount: number,
  runId: number | null,
  reason: string,
  keyNote = "",
  body = "",
): Promise<void> {
  const conclusion = outcome === "no-op" ? "success" : conclusionFor(outcome as SubmitOutcome);
  const headline =
    conclusion === "success"
      ? "IndexNow received the URLs. This does not confirm crawling or indexing."
      : conclusion === "neutral"
        ? "IndexNow accepted the URLs. Key validation is still pending."
        : conclusion === "failure"
          ? "IndexNow rejected the request (configuration or key problem)."
          : "Outcome unknown or budget exhausted. Manual action required.";

  const summaryText = buildSummary({
    outcome,
    attempt: Math.max(attempt, 1),
    added: plan.added.length,
    updated: plan.updated.length,
    deleted: plan.deletedVerified.length,
    urls: urlCount,
    cur: plan.curRef,
    prev: plan.prevRef,
  });

  const text = [
    `reason: ${reason}`,
    keyNote ? `key: ${keyNote}` : "",
    body ? `body: ${body}` : "",
    "",
    "cur sitemap: " + plan.curRef,
    "prev sitemap: " + plan.prevRef,
  ]
    .filter(Boolean)
    .join("\n");

  if (ctx && runId !== null) {
    await updateCheckRun(ctx, runId, { conclusion, title: headline, summary: summaryText, text }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      log(`[warn] 更新 Check Run 失败：${msg}`);
    });
  }

  log("");
  log(`[conclusion] ${conclusion} — ${headline}`);
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? `${error.message}` : String(error);
  fail(msg);
});
