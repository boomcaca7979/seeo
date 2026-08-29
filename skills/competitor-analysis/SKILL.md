---
name: competitor-analysis
description: "Keyword gap between the project and one saved competitor: shared / weaklyOwned / competitorOnly / projectOnly with rank gaps. Answers 'where does the competitor beat us?'."
---

# SeeO Competitor Analysis

## Purpose

Answer: 竞品在哪些关键词上领先、领先多少、哪些词只有竞品在排。universe = 项目 tracked keywords。

## Trigger

"竞争对手怎么样" / "竞品分析" / "competitor analysis" / "差距在哪".

## Required Context

- `projectId`
- `competitorId`（项目已保存竞品；未知时让用户先在 SeeO 界面添加，不得编造 id）

## Tool Selection（预算：最多 4 次调用）

| Order | Tool | Cost | Purpose |
| ----- | ---- | ---- | ------- |
| 1 | `project_context` | free | 上下文 |
| 2 | `get_competitor_keyword_gap` | DB + SerpApi/DataForSEO（refresh/enrich 可关） | 差距分类 + rank gap + 指标 |
| 3 | `get_serp_results` | SerpApi | Top competitorOnly 词 head-to-head（可选） |

## Workflow

1. `project_context`。
2. `get_competitor_keyword_gap`（competitorId；先 `refresh=false` 读存量，必要时建议 refresh）。
3. 对前 3 个 competitorOnly 词查 SERP 实况。
4. 输出：竞品领先词（带 rank gap）、weaklyOwned（内容刷新候选）、projectOnly（我方优势）。

## Evidence Rules

- rankGap 为正 = 竞品领先（口径与 rank tracking 一致）。
- competitorId 不属于该项目 → PROJECT_ACCESS_DENIED（工具层强制）。

## Output Format

FACTS（差距分布）/ SIGNALS / RECOMMENDATIONS（按 competitorOnly → weaklyOwned 优先级）/ DATA GAPS。
