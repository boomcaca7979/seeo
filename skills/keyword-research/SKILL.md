---
name: keyword-research
description: "Expand a seed keyword with real metrics and SERP reality, then classify candidates as Target / Monitor / Ignore. Use for keyword selection questions."
---

# SeeO Keyword Research

## Purpose

From one seed, produce a keyword shortlist grounded in real DataForSEO metrics + live SERP, with qualitative decisions (no opportunity score, no invented intent).

## Trigger

"关键词怎么选" / "keyword research" / "帮我拓词" / "what keywords should I target".

## Required Context

- `projectId`
- `seed`（必需；缺失时向用户索取，不得编造）

## Tool Selection（预算：最多 4 次调用）

| Order | Tool | Cost | Purpose |
| ----- | ---- | ---- | ------- |
| 1 | `project_context` | free | 市场与竞品上下文 |
| 2 | `research_keywords` | DataForSEO | 扩词 + volume/difficulty/CPC（缓存优先） |
| 3 | `get_serp_results` | SerpApi | Top 候选词的 SERP 竞争实况（可选） |

## Workflow

1. `project_context` 建立上下文。
2. `research_keywords`（seed；limit 20）。
3. 取第一个有真实 volume 的候选词查 `get_serp_results`。
4. 分类（决策规则）：
   - 无指标数据 → Monitor（不编造 intent）
   - difficulty > 60 → Monitor
   - volume ≥ 100 且难度可接受 → Target
   - 低量长尾 → Monitor（内容补充）

## Evidence Rules

- 每个 recommendation 必须带 evidenceId。
- intent 当前为 null（provider 不提供），禁止编造。

## Output Format

FACTS / SIGNALS / RECOMMENDATIONS（Target / Monitor 分组）/ DATA GAPS。

## Cost Constraints

同 seed 的扩词结果有 24h 缓存；重复询问不重复扣费。

## Failure Handling

provider 失败 → DATA GAP + 建议稍后重试；绝不输出虚构词表。
