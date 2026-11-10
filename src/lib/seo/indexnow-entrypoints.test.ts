// ===== 两个入口（auto / manual）的参数契约测试 =====
//
// 目标：钉住「head SHA 从哪来」与「缺 SHA 时绝不产生任何写入」这两件事。
// 依据：上一轮审阅发现 manual `all` 拿不到 head_sha，会提交但不写 Check Run。
//
// 全部用 mock fetch，不联网、不写 GitHub、不发 IndexNow POST。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  PreconditionError,
  SHA40,
  assertAllConfirm,
  requireHeadSha,
  resolveHeadSha,
  submitIndexNow,
  verificationOutcome,
} from "./indexnow";
import { autoCheckRunName, buildSummary, createCheckRun, type GithubContext } from "./indexnow-github";

const ROOT = process.cwd();
const KEY = "k".repeat(32);
const DEPLOY_SHA = "a".repeat(40);
const MAIN_SHA = "b".repeat(40);

const ctx = (fetchImpl: typeof fetch): GithubContext => ({ repo: "o/r", token: "t", fetchImpl });

/** 记录每一次 fetch 的 URL / method / body */
function recorder(response: (url: string) => Response) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: String(init.method ?? "GET"),
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return response(url);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("A. manual all + 有效 SHA", () => {
  const runId = "1234567890";
  const name = `indexnow/manual/${runId}-all`;

  it("从 GITHUB_SHA 取 SHA，Check Run 的 head_sha / name / external_id 都正确", async () => {
    const resolved = resolveHeadSha({ planCurSha: null, argSha: null, envSha: MAIN_SHA });
    expect(resolved).toEqual({ sha: MAIN_SHA, source: "env" });

    const { impl, calls } = recorder(
      () => new Response(JSON.stringify({ id: 42, name, status: "in_progress", conclusion: null }), { status: 201 }),
    );

    const run = await createCheckRun(ctx(impl), {
      name,
      headSha: requireHeadSha(resolved.sha, "all"),
      externalId: `manual:${runId}:all`,
      title: "IndexNow: submitting 58 URL(s)",
      summary: buildSummary({ outcome: "submitting", attempt: 1, added: 58, updated: 0, deleted: 0, urls: 58 }),
      text: "https://www.seeo.asia/",
    });

    expect(run.id).toBe(42);
    const body = calls[0].body as Record<string, unknown>;
    expect(calls[0].url).toContain("/repos/o/r/check-runs");
    expect(calls[0].method).toBe("POST");
    expect(body.head_sha).toBe(MAIN_SHA);
    expect(body.name).toBe(name);
    expect(body.external_id).toBe(`manual:${runId}:all`);
    expect(String(body.name)).toContain(runId);
    expect(String(body.name).endsWith("-all")).toBe(true);
    expect(String(body.name).startsWith("indexnow/manual/")).toBe(true);
  });

  it("同一 SHA 可以继续进入正常提交流程（200 → received）", async () => {
    const resolved = resolveHeadSha({ planCurSha: null, argSha: null, envSha: MAIN_SHA });
    const { impl, calls } = recorder(() => new Response("OK", { status: 200 }));

    const result = await submitIndexNow({
      key: KEY,
      urls: ["https://www.seeo.asia", "https://www.seeo.asia/zh"],
      fetchImpl: impl,
      sleep: async () => undefined,
    });

    expect(requireHeadSha(resolved.sha, "all")).toBe(MAIN_SHA);
    expect(result.outcome).toBe("received");
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.indexnow.org/indexnow");
    expect((calls[0].body as Record<string, unknown>).urlList).toHaveLength(2);
  });
});

describe("B. manual all + 缺失 SHA", () => {
  it("解析结果为空 → requireHeadSha 抛 PreconditionError", () => {
    const resolved = resolveHeadSha({ planCurSha: null, argSha: null, envSha: null });
    expect(resolved).toEqual({ sha: null, source: "none" });

    expect(() => requireHeadSha(resolved.sha, "all")).toThrow(PreconditionError);
    try {
      requireHeadSha(resolved.sha, "all");
    } catch (error) {
      expect((error as PreconditionError).code).toBe("HEAD_SHA_MISSING");
      expect((error as Error).message).toContain("已在创建 Check Run 与发送 IndexNow POST 之前中止");
    }
  });

  it("非 40 位 / 非十六进制一律视为无效", () => {
    for (const bad of ["", "deadbeef", "z".repeat(40), DEPLOY_SHA.slice(0, 39), `${DEPLOY_SHA}0`]) {
      expect(resolveHeadSha({ envSha: bad }).source).toBe("none");
      expect(() => requireHeadSha(bad, "submit")).toThrow(PreconditionError);
    }
    expect(SHA40.test(DEPLOY_SHA)).toBe(true);
  });

  it("缺 SHA 时既不发 POST 也不发任何请求", async () => {
    const { impl, calls } = recorder(() => new Response("OK", { status: 200 }));
    let thrown: unknown = null;

    try {
      // 复刻 CLI 的顺序：先 requireHeadSha，再 submitIndexNow
      const sha = requireHeadSha(resolveHeadSha({ envSha: null }).sha, "all");
      await submitIndexNow({ key: KEY, urls: ["https://www.seeo.asia/"], fetchImpl: impl, sleep: async () => undefined });
      expect(sha).toBeTruthy();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PreconditionError);
    expect(calls).toHaveLength(0);
  });
});

describe("C. manual submit 使用目标部署 SHA", () => {
  it("部署 SHA 优先于 workflow 的 GITHUB_SHA", () => {
    const resolved = resolveHeadSha({ planCurSha: DEPLOY_SHA, argSha: MAIN_SHA, envSha: MAIN_SHA });
    expect(resolved).toEqual({ sha: DEPLOY_SHA, source: "plan" });
  });

  it("即使没有部署 SHA，--sha 也优先于 GITHUB_SHA", () => {
    const resolved = resolveHeadSha({ planCurSha: null, argSha: DEPLOY_SHA, envSha: MAIN_SHA });
    expect(resolved).toEqual({ sha: DEPLOY_SHA, source: "arg" });
  });
});

describe("D. 自动 Production 使用 deployment.sha", () => {
  it("deployment.sha 压过任何人工参数", () => {
    const resolved = resolveHeadSha({ planCurSha: DEPLOY_SHA, argSha: MAIN_SHA, envSha: "c".repeat(40) });
    expect(resolved).toEqual({ sha: DEPLOY_SHA, source: "plan" });
  });

  it("自动记录名只由 deployment.id 决定，不带 manual 前缀", () => {
    const name = autoCheckRunName(7594198579);
    expect(name).toBe("indexnow/deployment-7594198579");
    expect(name.startsWith("indexnow/manual/")).toBe(false);
  });
});

describe("E. all 模式确认闸门", () => {
  it("只有精确的 SUBMIT-ALL 才通过", () => {
    expect(() => assertAllConfirm("SUBMIT-ALL")).not.toThrow();
  });

  it.each([undefined, "", "submit-all", "SubMit-All", "SUBMIT-ALL ", " SUBMIT-ALL", "SUBMIT-ALL\n", "SUBMIT_ALL"])(
    "%j 被拒绝",
    (value) => {
      expect(() => assertAllConfirm(value as string | undefined)).toThrow(PreconditionError);
    },
  );

  it("失败信息包含收到的原值与 SUBMIT-ALL 要求", () => {
    try {
      assertAllConfirm("nope");
    } catch (error) {
      expect((error as PreconditionError).code).toBe("CONFIRM_MISMATCH");
      expect((error as Error).message).toContain('"nope"');
      expect((error as Error).message).toContain("SUBMIT-ALL");
    }
  });
});

describe("F. verification-only（首次上线闸门）", () => {
  it("0 条计划 → success，文案写明没有变化", () => {
    const r = verificationOutcome(0);
    expect(r.conclusion).toBe("success");
    expect(r.headline).toContain("no changes detected");
    expect(r.headline).toContain("0 URLs planned");
  });

  it("非空计划 → neutral，且文案不得被读成已提交", () => {
    for (const n of [1, 2, 58]) {
      const r = verificationOutcome(n);
      expect(r.conclusion).toBe("neutral");
      expect(r.headline).toBe(`Verification completed; ${n} URLs planned; no URLs submitted.`);
      expect(r.headline).not.toMatch(/received|submitted;/i);
    }
  });

  it("verification 分支整体 return，且分支内不出现 submitIndexNow", () => {
    const cli = fs.readFileSync(path.join(ROOT, "scripts/indexnow.mts"), "utf-8");
    const iVerify = cli.indexOf("if (args.noSubmit)");
    const iSubmit = cli.indexOf("await submitIndexNow(");
    expect(iVerify).toBeGreaterThan(0);
    expect(iSubmit).toBeGreaterThan(0);
    expect(iVerify).toBeLessThan(iSubmit);

    const block = cli.slice(iVerify, iSubmit);
    expect(block).toContain("return;");
    // 只看"调用形态"，注释/日志里提到该名字不算
    expect(block).not.toContain("submitIndexNow(");
    // 分支内必须真的写了记录，否则等于静默跳过
    expect(block).toContain("createCheckRun");
    expect(block).toContain("updateCheckRun");
  });

  it("auto job 固定带 --no-submit；manual job 不带", () => {
    const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/indexnow.yml"), "utf-8");
    const doc = workflow.split(/^\s{2}manual:/m);
    const autoPart = doc[0];
    const manualPart = doc[1] ?? "";
    expect(autoPart).toContain("--no-submit");
    expect(manualPart).not.toContain("--no-submit");
  });
});

describe("CLI 与 workflow 的结构契约", () => {
  const cli = fs.readFileSync(path.join(ROOT, "scripts/indexnow.mts"), "utf-8");
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/indexnow.yml"), "utf-8");

  it("confirm 闸门在 buildPlan（首次网络请求）之前", () => {
    const iConfirm = cli.indexOf("assertAllConfirm(args.confirm)");
    const iPlan = cli.indexOf("await buildPlan(");
    expect(iConfirm).toBeGreaterThan(0);
    expect(iPlan).toBeGreaterThan(0);
    expect(iConfirm).toBeLessThan(iPlan);
  });

  it("缺 token 的闸门也在 buildPlan 之前", () => {
    const iCtx = cli.indexOf('args.mode !== "dry-run" && !ctx');
    const iPlan = cli.indexOf("await buildPlan(");
    expect(iCtx).toBeGreaterThan(0);
    expect(iCtx).toBeLessThan(iPlan);
  });

  it("headSha 校验早于 createCheckRun 与 submitIndexNow", () => {
    const iSha = cli.indexOf("const headSha = requireHeadSha(");
    const iCreate = cli.indexOf("await createCheckRun(");
    const iSubmit = cli.indexOf("await submitIndexNow(");
    expect(iSha).toBeGreaterThan(0);
    expect(iCreate).toBeGreaterThan(0);
    expect(iSubmit).toBeGreaterThan(0);
    expect(iSha).toBeLessThan(iCreate);
    expect(iSha).toBeLessThan(iSubmit);
  });

  it("仍只有一处 submitIndexNow 调用（无第三条入口）", () => {
    expect(cli.match(/await submitIndexNow\(/g)).toHaveLength(1);
  });

  it('manual job 传 --sha "$GITHUB_SHA"，且不覆盖 GitHub 默认变量', () => {
    expect(workflow).toContain('--sha "$GITHUB_SHA"');
    // GITHUB_SHA 是默认环境变量，出现在 env: 里会被忽略；这里断言我们没有尝试覆盖它
    expect(workflow).not.toMatch(/^\s+GITHUB_SHA:/m);
  });

  it("auto job 仍用部署 SHA，没有被 manual 的参数影响", () => {
    expect(workflow).toContain('--sha "$DEPLOY_SHA"');
    expect(workflow).toContain("--trigger auto");
    expect(workflow).toContain("--trigger manual");
  });
});
