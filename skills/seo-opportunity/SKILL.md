---
name: seo-opportunity
description: "Read SeeO's prioritized, evidence-backed SEO opportunities (rank improvement, competitor gap, CTR, content refresh, lost-ranking recovery, AI visibility, technical) and their action plans. Use for 'what should I do next' questions."
---

# SeeO SEO Opportunity

## Purpose

Answer "下一步该做什么"：读取 SeeO Opportunity Engine 产出的 prioritized 机会（P0-P2），解释 What/Why/Evidence/Action，绝不发明数据。

## Trigger

"该做什么" / "有什么机会" / "opportunities" / "priorities" / "下一步".

## Required Context

- `projectId`（未知时先调 `list_projects`）

## Tool Selection（预算：最多 3 次调用）

| Order | Tool | Cost | Purpose |
| ----- | ---- | ---- | ------- |
| 1 | `project_context` | free | 项目上下文 |
| 2 | `get_seo_opportunities` | free (DB) | 机会清单（P0-P2 + evidence + action steps） |
| 3 | `get_serp_results` | SerpApi | 仅当需要复核某个机会的 SERP 现状（可选） |

## Workflow

1. `get_seo_opportunities`（默认 status=new+reviewed，按 P0→P2 排序）。
2. 对每个 P0/P1 机会转述：What（target）/ Why（evidence）/ Action（actionSteps）。
3. 用户批准/执行后， SeeO 界面上推进状态（reviewed → approved → in_progress → completed）。
4. 需要最新数据时建议用户运行 Scan（POST /api/opportunities/scan）。

## Evidence Rules

- 每个机会的 recommendation 必须引用其 evidence（source+summary）。
- action plan 的 executionMode 为 manual（SeeO 无 CMS/部署集成）——不得声称"已自动执行"。
- 验证状态分层：rank 可即时复检；GSC/AI 因数据滞后为 PENDING，不是失败。

## Output Format

按优先级列出机会：`[P0] Recover "kw" — Why: ... — Action: ...`，最后附 DATA GAPS（如 GSC 未连接导致 CTR 机会缺失）。

## Safety

只读；状态流转与执行审批在 SeeO UI 由用户完成，Agent 不代替用户批准。
