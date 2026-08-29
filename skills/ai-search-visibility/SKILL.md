---
name: ai-search-visibility
description: "Check whether a brand is mentioned and cited in AI answers (ChatGPT / Google AI Overview), with AI Share of Voice versus competitors. Use for GEO/AI visibility questions."
---

# SeeO AI Search Visibility

## Purpose

回答"AI 搜索里有没有我"：mentions（品牌被提及）、citations（URL 被引用）、AI SOV（与竞品的提及份额对比）。

## Trigger

"AI 搜索里有没有我" / "AI visibility" / "ChatGPT 提到我们吗" / "GEO".

## Required Context

- `projectId`（domain 自动取自项目；或显式传 seed 作为 brand/domain）

## Tool Selection（预算：最多 2 次调用）

| Order | Tool | Cost | Purpose |
| ----- | ---- | ---- | ------- |
| 1 | `project_context` | free | 取 domain |
| 2 | `ai_search_brand_lookup` | DataForSEO（~$0.10/任务 × 平台扇出） | mentions/citations/AI SOV |

## Workflow

1. `project_context` 取 domain。
2. `ai_search_brand_lookup`。
3. 输出：mentions 总量 / 平台分布 / topCitedDomains / AI SOV（有 competitors 时）/ warnings。

## Evidence Rules

- mention ≠ citation，必须分开表述。
- ChatGPT mentions 库官方仅 US/en：非 US locale 会有显式 warning——如实转述，不要隐藏。
- provider 无数据 → 明确说"provider 无数据"，不得解读为"品牌没有 AI 可见性"。
- 历史对比经 /api/ai-search/history（MCP 暂未暴露 run history——GAP 已记录）。

## Failure Handling

配额不足（429）→ DATA GAP + 建议升级或稍后重试；单平台失败 → 部分结果仍有效。
