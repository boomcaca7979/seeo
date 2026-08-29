---
name: seo-github-execution
description: "Execute an approved SEO action via GitHub PR workflow: inspect the action, verify the repository, preview the real file change, require explicit approval, execute branch/commit/PR, wait for human merge, monitor status, and verify production. Never auto-approve, never auto-merge, never write main."
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
- 必须先完成 preview：preview 持久化目标文件的 blob SHA（beforeHash），execute 时据此做冲突检查

## Approval Requirement（硬规则）

1. Opportunity 必须已在 SeeO UI 批准（status approved）。
2. Agent 可以 preview / show diff / explain，但 **永远不能代替用户批准**。
3. `preview_seo_action` 是只读的（真实读取仓库文件生成 before/after）；真正提交只发生在用户于 SeeO UI 批准之后，通过 `/api/actions` `operation:"execute"`（同一 service，MCP 无执行工具，不做绕过审批的后门）。
4. 即便 Agent 判断"这个修改显然没问题"，也不能跳过 approval。

## Hard Safety Rules（P4 实测验证过的安全链）

**NEVER AUTO-APPROVE. NEVER AUTO-MERGE. NEVER WRITE MAIN.**

执行链（全部校验先行，任何拒绝路径不产生 branch/commit/PR）：

1. **Inspect action**：`get_action_plan` 读取执行包与状态（仅 `approved` 可执行；未批准 → 409 `EXECUTION_NOT_APPROVED`）。
2. **Verify repository**：连接存在、仓库存在、未归档、可 push（否则 `GITHUB_*` 错误码，不静默降级）。
3. **Preview**：`preview_seo_action`（filePath + newContent）读取真实文件展示 before/after，并持久化 beforeHash。
4. **Require explicit approval**：用户在 SeeO UI 批准（无任何 Agent 代替路径）。
5. **Execute**：SeeO 依次执行 敏感路径 guard → scope guard（≤400 行）→ 文件存在检查 → beforeHash 冲突检查 → PR 幂等检查 → branch（确定性命名，同 action 永远同 branch）→ commit（含 Action/Opportunity 元数据）→ PR。
6. **Wait for human merge**：PR created ≠ completed。状态停在 awaiting_review；merge 由人完成，SeeO 不自动 merge。轮询用 `get_action_status`。
7. **Monitor status**：open → awaiting_review；merged → 触发 verification；closed 未合并 → failed + 手动包（不自动重开）。
8. **Verify production**：merge 检测后自动触发 `verifyOpportunity`（rank 即时复检；GSC/AI Search 因数据滞后显式 PENDING，不判 failed）。

## Conflict / Failure 语义（不静默重试）

- preview 后目标文件被第三方修改 → 409 `EXECUTION_CONFLICT`（blob 前后 SHA 出现在错误信息中），零变更应用。恢复路径：刷新预览（action 重置为 planned）→ 重新批准 → 重新执行。
- 重复执行同一 action → 幂等返回既有 PR，不产生第二个 branch/commit/PR。
- PR 已 merged → `EXECUTION_CONFLICT`（幂等：不重复执行）。
- 敏感文件（`.env`/secrets/CI/package.json/migrations）与路径穿越 → `EXECUTION_NOT_SUPPORTED`，零 GitHub 写操作。
- Provider 失败（限速/网络）→ 对应 `GITHUB_*` 错误码；重试由用户决定。

## Cost Constraints

- GitHub API 免费；限速 429 → GITHUB_RATE_LIMITED（稍后重试，不无限）。
- Verification provider 调用（rank/GSC/AI）沿用既有 cache + 单点计费，PR created 不触发全量调用。

## UI 状态对照（Agent 解释时使用同一词汇）

Preview Ready → Approved → Preparing → PR Created / Awaiting Review → Merged → Verifying → Completed；以及 Conflict / Failed / Manual。这些不是同一个状态，不要合并表述。
