---
name: seo-diagnostic
description: "Evidence-based overall SEO health check across rank, search performance, backlinks, and AI visibility. Use when asked to analyze or diagnose a site's SEO overall."
---

# SeeO SEO Diagnostic

## Purpose

Organize SeeO's real data (rank distribution, GSC performance, backlinks, AI visibility) into an evidence-based overall assessment with prioritized observations. SeeO does not invent data: every FACT comes from a tool call.

## Trigger

"全面分析我的网站 SEO" / "analyze my site" / "SEO 体检" / "diagnose my SEO".

## Required Context

- `projectId`（SeeO 项目；未知时先调 `list_projects`）
- 无需用户再提供 domain/语言：`project_context` 是第一优先调用。

## Tool Selection（预算：最多 6 次调用）

| Order | Tool | Cost | Purpose |
| ----- | ---- | ---- | ------- |
| 1 | `project_context` | free | 项目 domain / 追踪词数 / 竞品 |
| 2 | `get_rank_history` | free (DB) | 排名分布与状态 |
| 3 | `search_console_tools` (compare_periods) | GSC API | 流量方向（未连接则记 DATA GAP 继续） |
| 4 | `get_backlinks_profile` | DataForSEO | 外链/引用域概况 |
| 5 | `ai_search_brand_lookup` | DataForSEO | AI 搜索可见性（可选） |

## Workflow

1. `project_context` 建立 domain 与范围。
2. `get_rank_history` 取分布（Top3/10/20/50/notRanking + declined/lost 计数）。
3. `search_console_tools compare_periods` 取流量方向；GSC 未连接时记 `DATA GAP` 并继续。
4. `get_backlinks_profile` 取外链基线。
5. `ai_search_brand_lookup`（target = 项目 domain）取 AI 可见性；配额不足记 `DATA GAP`。
6. 交叉：排名分布 × 流量方向 × AI 存在感 → 优先观察项。

## Evidence Rules

- 每条结论引用 evidenceId（ev-N）。
- GSC position ≠ SERP rank，两者不可互换表述。
- 无数据写 `unknown` / `DATA GAP`，禁止估计。

## Output Format

```
## Findings
### FACTS
（工具原始数据，标注 evidenceId）
### SIGNALS
（由 FACT 直接计算的信号）
### INTERPRETATION
（置信度 high/medium/low，依据证据数量与一致性）
### RECOMMENDATIONS
（每条带 evidenceIds[]）
### DATA GAPS
（缺口 + 对置信度的影响）
```

## Failure Handling

GSC / AI Search / 外链任一失败 → 记 DATA GAP，其余层照常输出。绝不整体失败。

## Safety

只读诊断；不修改网站；demo 模式下 provider 工具自动降级为 DATA GAP。
