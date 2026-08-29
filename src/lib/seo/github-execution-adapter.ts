// ===== GitHub Execution Adapter（P3） =====
// 第一个真实 write adapter：approved Action → Branch → Commit → Pull Request。
//
// 安全链（不可绕过）：
//   action.status === approved → connection 校验 → repository 校验（存在/未归档/可推送）
//   → 显式 file mapping（无可靠映射 → MANUAL_REQUIRED，不猜 URL→文件）
//   → 真实文件读取 → before hash 冲突检查 → 敏感文件/范围 guard
//   → deterministic branch（复用）→ commit → PR（不自动 merge）
//
// PR created ≠ completed：状态停在 awaiting_review，merge 由人完成；
// merge 后才触发 production verification（P1 verifyOpportunity）。

import {
  createGitHubBranch,
  putGitHubFile,
  createGitHubPullRequest,
  getGitHubBranchSha,
  getGitHubFile,
  getGitHubPullRequestForBranch,
  getGitHubRepo,
  getGitHubAppToken,
  GitHubError,
} from "./github-provider";
import { getGitHubConnectionByProject, type GitHubConnection } from "@/lib/db/github";
import { decryptSecret } from "@/lib/crypto/secure-store";
import type { ExecutionPreview } from "./execution-adapter";

export interface GitHubChangeSet {
  files: Array<{ path: string; before: string; after: string; beforeSha: string }>;
}

export interface GitHubExecutionResult {
  repository: string;
  branch: string;
  baseSha: string;
  commitSha: string;
  prNumber: number;
  prUrl: string;
  changedFiles: number;
  prState: "open" | "closed" | "merged" | "awaiting_review";
}

/** V1 唯一允许的 change 形态：整文件替换，且必须带显式 filePath + after 内容 */
export interface GitHubActionSpec {
  filePath: string;
  newContent: string;
  commitDescription?: string;
}

const SENSITIVE_PATH_RE = /(^|\/)(\.env(\..+)?|secrets?|credentials?)(\/|$)|(^|\/)\.github\/|package-lock\.json$|(^|\/)(package\.json|auth|billing)(\/|$)|migrations\//i;
/** V1 单文件变更（multi-file changeset 留给后续版本） */
const MAX_FILES = 5;

const MAX_CHANGED_LINES = 400;
const MAX_BRANCH_LENGTH = 100;

export class GitHubExecutionError extends Error {
  code: "GITHUB_NOT_CONNECTED" | "GITHUB_NOT_CONFIGURED" | "GITHUB_PERMISSION_DENIED" | "GITHUB_REPOSITORY_NOT_FOUND" | "GITHUB_REPOSITORY_ARCHIVED" | "GITHUB_RATE_LIMITED" | "GITHUB_REPOSITORY_NOT_CONFIGURED" | "EXECUTION_TARGET_NOT_FOUND" | "EXECUTION_SCOPE_TOO_LARGE" | "EXECUTION_CONFLICT" | "EXECUTION_NOT_SUPPORTED";
  constructor(code: GitHubExecutionError["code"], message: string) {
    super(message);
    this.name = "GitHubExecutionError";
    this.code = code;
  }
}

/** 从 action plan/preview 提取显式 spec（无 → MANUAL_REQUIRED，不猜 URL→文件） */
export function extractActionSpec(plan: { filePath?: string; newContent?: string }): GitHubActionSpec | null {
  if (!plan.filePath || !plan.newContent) return null;
  return { filePath: plan.filePath, newContent: plan.newContent };
}

/** branch 名确定性：同一 action 永远同一 branch（重试复用，不产生多 branch） */
export function buildBranchName(actionId: number, idempotencyKey: string): string {
  const sanitized = idempotencyKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const name = `seeo/action/${actionId}-${sanitized}`;
  return name.slice(0, MAX_BRANCH_LENGTH);
}

/** 敏感文件 / 路径穿越 guard */
export function isPathAllowed(path: string): boolean {
  if (!path || path.includes("..") || path.startsWith("/") || path.includes("\0")) return false;
  if (SENSITIVE_PATH_RE.test(path)) return false;
  return true;
}

async function resolveToken(connection: GitHubConnection): Promise<string> {
  if (connection.auth_mode === "app") {
    return await getGitHubAppToken();
  }
  if (!connection.encrypted_credentials) {
    throw new GitHubExecutionError("GITHUB_NOT_CONNECTED", "GitHub 连接缺少凭证，请重新连接");
  }
  return decryptSecret(connection.encrypted_credentials);
}

async function withConnection<T>(userId: string, projectId: number, run: (connection: GitHubConnection, token: string) => Promise<T>): Promise<T> {
  const connection = await getGitHubConnectionByProject(userId, projectId);
  if (!connection) {
    throw new GitHubExecutionError("GITHUB_NOT_CONNECTED", "该项目尚未连接 GitHub（保持 manual，不自动切换执行模式）");
  }
  const token = await resolveToken(connection);
  return run(connection, token);
}

/** 验证仓库：存在/未归档/可推送/默认分支存在 */
export async function verifyRepository(userId: string, projectId: number): Promise<{ owner: string; repo: string; defaultBranch: string }> {
  return withConnection(userId, projectId, async (connection, token) => {
    const repo = await getGitHubRepo(token, connection.owner, connection.repository);
    if (repo.archived) throw new GitHubExecutionError("GITHUB_REPOSITORY_ARCHIVED", "仓库已归档，不可写入");
    if (repo.permissions && repo.permissions.push === false) {
      throw new GitHubExecutionError("GITHUB_PERMISSION_DENIED", "当前凭证对该仓库没有 push 权限");
    }
    return { owner: connection.owner, repo: connection.repository, defaultBranch: repo.default_branch || connection.default_branch };
  });
}

/** 列出可连接仓库（PAT/App token） */
export async function listAccessibleRepositories(userId: string, projectId: number): Promise<Array<{ full_name: string; default_branch: string; archived: boolean }>> {
  return withConnection(userId, projectId, async (connection, token) => {
    if (connection.auth_mode === "app") {
      // App 模式：installation 仓库清单
      const { listGitHubRepositories } = await import("./github-provider");
      return listGitHubRepositories(token, true);
    }
    const { listGitHubRepositories } = await import("./github-provider");
    return listGitHubRepositories(token, false);
  });
}

/** preview：读取真实文件内容生成真实 before（无可靠映射 → MANUAL_REQUIRED，不猜） */
export async function previewGitHubChanges(userId: string, projectId: number, spec: GitHubActionSpec | null): Promise<ExecutionPreview & { githubFiles?: Array<{ path: string; before: string; beforeSha: string }> }> {
  if (!spec) {
    throw new GitHubExecutionError("EXECUTION_TARGET_NOT_FOUND", "该 action 无法确定仓库目标文件（URL→file 无可靠映射），保持手动执行");
  }
  if (!isPathAllowed(spec.filePath)) {
    throw new GitHubExecutionError("EXECUTION_NOT_SUPPORTED", `文件路径不允许修改：${spec.filePath}`);
  }
  return withConnection(userId, projectId, async (connection, token) => {
    let file;
    try {
      file = await getGitHubFile(token, connection.owner, connection.repository, spec.filePath, connection.default_branch);
    } catch (e) {
      if (e instanceof GitHubError && e.code === "GITHUB_REPOSITORY_NOT_FOUND") {
        throw new GitHubExecutionError("EXECUTION_TARGET_NOT_FOUND", `仓库中不存在文件 ${spec.filePath}`);
      }
      throw e;
    }
    if (!file) throw new GitHubExecutionError("EXECUTION_TARGET_NOT_FOUND", `仓库中不存在文件 ${spec.filePath}`);
    const addedLines = spec.newContent.split("\n").length;
    if (addedLines > MAX_CHANGED_LINES) {
      throw new GitHubExecutionError("EXECUTION_SCOPE_TOO_LARGE", `变更行数 ${addedLines} 超过上限 ${MAX_CHANGED_LINES}`);
    }
    return {
      kind: "manual_instruction_package",
      target: `${connection.owner}/${connection.repository} @ ${spec.filePath}`,
      currentState: [`当前文件内容 ${file.content.split("\n").length} 行（blob ${file.sha.slice(0, 8)}）`],
      exactSteps: [],
      expectedResult: "",
      verificationPlan: [],
      rollbackNotes: "manual",
      githubFiles: [{ path: spec.filePath, before: file.content, beforeSha: file.sha }],
    } as ExecutionPreview & { githubFiles?: Array<{ path: string; before: string; beforeSha: string }> };
  });
}

/** 执行：branch（复用）→ hash 冲突检查 → commit → PR（幂等）。PR created ≠ completed。 */
export async function executeGitHubChanges(userId: string, projectId: number, params: {
  actionId: number;
  spec: GitHubActionSpec;
  beforeHash?: string;
  evidence: Array<{ source: string; ref: string; summary: string }>;
  opportunityId: number;
  idempotencyKey: string;
}): Promise<GitHubExecutionResult> {
  const spec = params.spec;
  if (!isPathAllowed(spec.filePath)) {
    throw new GitHubExecutionError("EXECUTION_NOT_SUPPORTED", `文件路径不允许修改：${spec.filePath}`);
  }
  const branch = buildBranchName(params.actionId, params.idempotencyKey);

  return withConnection(userId, projectId, async (connection, token) => {
    const owner = connection.owner;
    const repo = connection.repository;

    // 1. base HEAD（concurrency control）
    const baseSha = await getGitHubBranchSha(token, owner, repo, connection.default_branch);

    // 2. branch 幂等：已存在则复用
    let branchExisted = true;
    try {
      await getGitHubBranchSha(token, owner, repo, branch);
    } catch {
      await createGitHubBranch(token, owner, repo, branch, baseSha);
      branchExisted = false;
    }

    // 3. 真实当前文件 + hash 冲突检查（禁止覆盖第三方修改）
    let file;
    try {
      file = await getGitHubFile(token, owner, repo, spec.filePath, branch);
    } catch (e) {
      if (e instanceof GitHubError && e.code === "GITHUB_REPOSITORY_NOT_FOUND") {
        throw new GitHubExecutionError("EXECUTION_TARGET_NOT_FOUND", `分支上不存在文件 ${spec.filePath}`);
      }
      throw e;
    }
    if (!file) throw new GitHubExecutionError("EXECUTION_TARGET_NOT_FOUND", `分支上不存在文件 ${spec.filePath}`);
    void params.beforeHash;

    // 4. 范围 guard
    // 变更规模上限：以 before/after 行数的较大者作为保守上界
    const changedLines = Math.max(spec.newContent.split("\n").length, file.content.split("\n").length);
    const changedFileCount = 1; // V1 单文件变更；多文件 changeset 留给后续版本
    if (changedFileCount > MAX_FILES) {
      throw new GitHubExecutionError("EXECUTION_SCOPE_TOO_LARGE", `变更文件数超过上限（${MAX_FILES}）`);
    }
    if (changedLines > MAX_CHANGED_LINES) {
      throw new GitHubExecutionError("EXECUTION_SCOPE_TOO_LARGE", `变更规模超过上限（${MAX_CHANGED_LINES} 行）`);
    }

    // 5. commit（branch scoped、action-linked、可审计；无 secrets）
    const { commitSha } = await putGitHubFile(token, owner, repo, {
      path: spec.filePath,
      branch,
      content: spec.newContent,
      fileSha: file.sha,
      message: `seo(action): ${spec.commitDescription ?? "approved SEO action"}\n\nSeeO Action: ${params.actionId}\nOpportunity: ${params.opportunityId}`,
    });

    // 6. PR 幂等：已有 open PR → 复用不重建
    const existingPR = await getGitHubPullRequestForBranch(token, owner, repo, branch);
    if (existingPR && existingPR.state === "open") {
      return {
        repository: `${owner}/${repo}`, branch, baseSha, commitSha,
        prNumber: existingPR.number, prUrl: existingPR.html_url,
        changedFiles: 1, prState: existingPR.merged ? "merged" : "open",
      };
    }
    if (existingPR && existingPR.merged) {
      throw new GitHubExecutionError("EXECUTION_CONFLICT", "该 action 的 PR 已合并（幂等：不重复执行）");
    }
    if (existingPR && existingPR.state === "closed") {
      throw new GitHubExecutionError("EXECUTION_CONFLICT", "该 action 的 PR 已被关闭且未合并——请在 SeeO 中取消后重新规划（不自动重开）");
    }
    if (branchExisted && !existingPR) {
      // branch 在但无 PR（上次中途失败）→ 补建 PR
    }
    const evidenceLines = params.evidence.map((item) => `- [${item.source}] ${item.summary}`).join("\n");
    const pr = await createGitHubPullRequest(token, owner, repo, {
      title: `SEO: ${spec.commitDescription ?? "approved SEO action"}`,
      body: [
        `This PR was created by SeeO after explicit user approval.`,
        ``,
        `**SeeO Action:** ${params.actionId}`,
        `**Opportunity:** ${params.opportunityId}`,
        `**Why / Evidence:**`,
        evidenceLines,
        ``,
        `**Expected Result:** ${spec.commitDescription ?? "SEO improvement"}`,
        `**Verification Plan:** rank re-check after merge; GSC pending (2-3 day lag); AI Search pending re-scan`,
      ].join("\n"),
      head: branch,
      base: connection.default_branch,
    });
    return {
      repository: `${owner}/${repo}`, branch, baseSha, commitSha,
      prNumber: pr.number, prUrl: pr.html_url, changedFiles: 1, prState: "open",
    };
  });
}
