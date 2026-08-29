---
name: seo-github-execution
description: "Execute an approved SEO action via GitHub PR workflow: preview the real file change, create branch/commit/PR, track PR status, and hand off to verification after merge. Never auto-approve."
---

# SeeO GitHub Execution

## Purpose

把已批准的 SEO action 通过 GitHub branch → commit → PR 安全落地。SeeO 绝不写 production main；PR 由人 review 并 merge。

## Trigger

"执行这个 action" / "create the PR" / "execute via GitHub" / 用户明确要求落地已批准机会。

## Required Context

- `projectId` + `opportunityId`
- GitHub connection 必须已建立（未连接 → `GITHUB_NOT_CONNECTED`，建议 manual execution，不静默切换）
- 显式 `filePath`（URL→文件无可靠映射时不得猜测 → manual）

## Approval Requirement（硬规则）

1. Opportunity 必须已在 SeeO UI 批准（status approved）。
2. Agent 可以 preview / show diff / explain，但 **永远不能代替用户批准**。
3. `preview_seo_action` 是只读的；真正提交发生在用户于 SeeO UI / API 批准后。
4. 即便 Agent 判断"这个修改显然没问题"，也不能跳过 approval。

## Workflow

1. `get_action_plan` 读取执行包（steps/expected result）。
2. `preview_seo_action`（filePath + newContent）读取真实文件并展示 before/after。
3. 请求用户在 SeeO UI 中批准（或在已批准时继续）。
4. 提交后（SeeO API /actions execute）用 `get_action_status` 轮询 PR 状态（open → merged/closed）。
5. merged 后 SeeO 自动触发 verification（rank 即时复检；GSC/AI pending）。
6. PR closed 未合并 → 状态 failed + 手动包，由用户决定下一步（不自动重开）。

## Cost Constraints

- GitHub API 免费；限速 429 → GITHUB_RATE_LIMITED（稍后重试，不无限）。
- Verification provider 调用（rank/GSC/AI）沿用既有 cache + 单点计费，PR created 不触发全量调用。

## Safety

- 只允许修改 preview 中显式列出的文件；`.env`/secrets/CI/package.json/migrations 默认禁止。
- 分支命名确定性（seeo/action/<id-...>），同 action 永远同一 branch。
- PR created ≠ completed：merged + production verification 之后才算完成。
- 失败 → failed + 手动执行包（不静默降级为 manual）。
