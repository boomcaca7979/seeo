---
name: gsc-diagnosis
description: "Diagnose traffic decline by separating impressions / CTR / position / clicks dimensions. Use for 'why is my traffic down' questions."
---

# SeeO GSC Diagnosis

## Purpose

区分流量下降的真实维度：曝光减少（visibility）、CTR 下降（snippet 吸引力）、平均位置变差、还是点击结构变化。这四个是不同问题、不同解法。

## Trigger

"流量为什么跌" / "traffic drop" / "clicks 下降" / "曝光下降".

## Required Context

- `projectId`（GSC 需已在 SeeO 连接 property；未连接 → DATA GAP）

## Tool Selection（预算：最多 4 次调用）

| Order | Tool | Cost | Purpose |
| ----- | ---- | ---- | ------- |
| 1 | `search_console_tools` (compare_periods) | GSC API | 四维 delta |
| 2 | `search_console_tools` (top_queries) | GSC API | 哪些查询失量 |
| 3 | `search_console_tools` (top_pages) | GSC API | 哪些页面失量 |

## Decision Rules（deterministic）

- impressions ↓ → visibility 问题 → 转 rank-drop-diagnosis 排查排名/收录
- impressions 稳定 + clicks ↓ + CTR ↓ → CTR 问题 → 优化 title/description
- position ↑（变差）+ clicks ↓ → 排名侧问题
- 以上皆非但 clicks ↓ → 对照 top_pages 找结构性失量页

## Workflow

1. `compare_periods`（默认区间；GSC 数据滞后 2-3 天）。
2. `top_queries` + `top_pages` 定位失量来源。
3. 按 Decision Rules 输出分类 + 建议 + evidenceIds。

## Failure Handling

GSC_NOT_CONNECTED → DATA GAP + 明确提示"流量诊断置信度受限"，建议先在设置中连接。
